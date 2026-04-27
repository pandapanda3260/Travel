import { sms } from "tencentcloud-sdk-nodejs";
import type {
  SendSmsRequest,
  SendStatus,
} from "tencentcloud-sdk-nodejs/tencentcloud/services/sms/v20210111/sms_models";

import { loadOptionalEnvFile, parseNumber } from "./env-file";

export type TencentSmsPurpose =
  | "login"
  | "bind_phone"
  | "reset_password"
  | "change_phone_old"
  | "change_phone_new";

export type TencentSmsSendResult = {
  provider: "tencent";
  requestId: string | null;
  serialNo: string | null;
  statusCode: string;
  statusMessage: string;
  fee: number | null;
  templateId: string;
  phoneNumber: string;
};

type TencentSmsRuntime = {
  secretId: string;
  secretKey: string;
  region: string;
  endpoint: string;
  requestTimeoutSeconds: number;
  smsSdkAppId: string;
  signName: string;
  templateId: string;
  templateParamFormat: string;
  extendCode: string;
  senderId: string;
  missingKeys: string[];
};

type TencentSmsProviderErrorOptions = {
  code: string;
  statusCode?: string | null;
  statusMessage?: string | null;
  requestId?: string | null;
  missingKeys?: string[];
  cause?: unknown;
};

const PURPOSE_ENV_PREFIX: Record<TencentSmsPurpose, string> = {
  login: "LOGIN",
  bind_phone: "BIND_PHONE",
  reset_password: "RESET_PASSWORD",
  change_phone_old: "CHANGE_PHONE_OLD",
  change_phone_new: "CHANGE_PHONE_NEW",
};

export class TencentSmsProviderError extends Error {
  code: string;
  statusCode: string | null;
  statusMessage: string | null;
  requestId: string | null;
  missingKeys: string[];
  cause?: unknown;

  constructor(message: string, options: TencentSmsProviderErrorOptions) {
    super(message);
    this.name = "TencentSmsProviderError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? null;
    this.statusMessage = options.statusMessage ?? null;
    this.requestId = options.requestId ?? null;
    this.missingKeys = options.missingKeys ?? [];
    this.cause = options.cause;
  }
}

function readSmsEnv() {
  return loadOptionalEnvFile("sms.env.local");
}

function getConfiguredValue(localConfig: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim() || localConfig[key]?.trim() || "";
    if (value) {
      return value;
    }
  }
  return "";
}

function getPurposeTemplateId(localConfig: Record<string, string>, purpose: TencentSmsPurpose) {
  const purposePrefix = PURPOSE_ENV_PREFIX[purpose];
  return getConfiguredValue(localConfig, [
    `TENCENT_SMS_${purposePrefix}_TEMPLATE_ID`,
    "TENCENT_SMS_DEFAULT_TEMPLATE_ID",
    "TENCENT_SMS_TEMPLATE_ID",
  ]);
}

function getPurposeTemplateParamFormat(localConfig: Record<string, string>, purpose: TencentSmsPurpose) {
  const purposePrefix = PURPOSE_ENV_PREFIX[purpose];
  return (
    getConfiguredValue(localConfig, [
      `TENCENT_SMS_${purposePrefix}_TEMPLATE_PARAM_FORMAT`,
      "TENCENT_SMS_TEMPLATE_PARAM_FORMAT",
    ]) || "code,minutes"
  );
}

function getTencentSmsRuntime(purpose: TencentSmsPurpose): TencentSmsRuntime {
  const localConfig = readSmsEnv();
  const secretId = getConfiguredValue(localConfig, ["TENCENTCLOUD_SECRET_ID", "TENCENT_SMS_SECRET_ID"]);
  const secretKey = getConfiguredValue(localConfig, ["TENCENTCLOUD_SECRET_KEY", "TENCENT_SMS_SECRET_KEY"]);
  const smsSdkAppId = getConfiguredValue(localConfig, ["TENCENT_SMS_SDK_APP_ID", "TENCENTCLOUD_SMS_SDK_APP_ID"]);
  const signName = getConfiguredValue(localConfig, ["TENCENT_SMS_SIGN_NAME", "TENCENTCLOUD_SMS_SIGN_NAME"]);
  const templateId = getPurposeTemplateId(localConfig, purpose);
  const missingKeys: string[] = [];

  if (!secretId) {
    missingKeys.push("TENCENTCLOUD_SECRET_ID or TENCENT_SMS_SECRET_ID");
  }
  if (!secretKey) {
    missingKeys.push("TENCENTCLOUD_SECRET_KEY or TENCENT_SMS_SECRET_KEY");
  }
  if (!smsSdkAppId) {
    missingKeys.push("TENCENT_SMS_SDK_APP_ID");
  }
  if (!signName) {
    missingKeys.push("TENCENT_SMS_SIGN_NAME");
  }
  if (!templateId) {
    missingKeys.push(`TENCENT_SMS_${PURPOSE_ENV_PREFIX[purpose]}_TEMPLATE_ID or TENCENT_SMS_DEFAULT_TEMPLATE_ID`);
  }

  return {
    secretId,
    secretKey,
    smsSdkAppId,
    signName,
    templateId,
    missingKeys,
    region: getConfiguredValue(localConfig, ["TENCENT_SMS_REGION"]) || "ap-guangzhou",
    endpoint: getConfiguredValue(localConfig, ["TENCENT_SMS_ENDPOINT"]) || "sms.tencentcloudapi.com",
    requestTimeoutSeconds: parseNumber(
      process.env.TENCENT_SMS_REQUEST_TIMEOUT_SECONDS ?? localConfig.TENCENT_SMS_REQUEST_TIMEOUT_SECONDS,
      10,
    ),
    templateParamFormat: getPurposeTemplateParamFormat(localConfig, purpose),
    extendCode: getConfiguredValue(localConfig, ["TENCENT_SMS_EXTEND_CODE"]),
    senderId: getConfiguredValue(localConfig, ["TENCENT_SMS_SENDER_ID"]),
  };
}

function buildTemplateParamSet(format: string, code: string, expireSeconds: number) {
  const minutes = String(Math.max(1, Math.ceil(expireSeconds / 60)));
  const seconds = String(expireSeconds);
  const tokens = format
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  return tokens.map((token) => {
    switch (token.toLowerCase()) {
      case "code":
        return code;
      case "minutes":
        return minutes;
      case "seconds":
        return seconds;
      default:
        return token;
    }
  });
}

function getProviderErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return "TENCENT_SMS_REQUEST_FAILED";
  }
  const candidate = error as { code?: unknown; Code?: unknown };
  return String(candidate.code || candidate.Code || "TENCENT_SMS_REQUEST_FAILED");
}

function getProviderErrorRequestId(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const candidate = error as { requestId?: unknown; RequestId?: unknown };
  const value = candidate.requestId || candidate.RequestId;
  return value ? String(value) : null;
}

function getProviderErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Tencent SMS request failed";
}

function assertSendStatusOk(status: SendStatus | undefined, requestId: string | null) {
  if (status?.Code === "Ok") {
    return;
  }

  throw new TencentSmsProviderError(status?.Message || "Tencent SMS did not accept the send request", {
    code: "TENCENT_SMS_SEND_REJECTED",
    statusCode: status?.Code ?? null,
    statusMessage: status?.Message ?? null,
    requestId,
  });
}

export async function sendTencentVerificationSms(input: {
  phone: string;
  code: string;
  expireSeconds: number;
  purpose: TencentSmsPurpose;
  sessionContext?: string;
}): Promise<TencentSmsSendResult> {
  const runtime = getTencentSmsRuntime(input.purpose);
  if (runtime.missingKeys.length > 0) {
    throw new TencentSmsProviderError("Tencent SMS configuration is incomplete", {
      code: "TENCENT_SMS_CONFIG_MISSING",
      missingKeys: runtime.missingKeys,
    });
  }

  const smsClient = sms.v20210111.Client;
  const client = new smsClient({
    credential: {
      secretId: runtime.secretId,
      secretKey: runtime.secretKey,
    },
    region: runtime.region,
    profile: {
      httpProfile: {
        endpoint: runtime.endpoint,
        reqMethod: "POST",
        reqTimeout: runtime.requestTimeoutSeconds,
      },
    },
  });
  const phoneNumber = `+86${input.phone}`;
  const params: SendSmsRequest = {
    PhoneNumberSet: [phoneNumber],
    SmsSdkAppId: runtime.smsSdkAppId,
    SignName: runtime.signName,
    TemplateId: runtime.templateId,
    TemplateParamSet: buildTemplateParamSet(runtime.templateParamFormat, input.code, input.expireSeconds),
    SessionContext: input.sessionContext ?? "",
  };

  if (runtime.extendCode) {
    params.ExtendCode = runtime.extendCode;
  }
  if (runtime.senderId) {
    params.SenderId = runtime.senderId;
  }

  try {
    const response = await client.SendSms(params);
    const requestId = response.RequestId ?? null;
    const status = response.SendStatusSet?.[0];
    assertSendStatusOk(status, requestId);

    return {
      provider: "tencent",
      requestId,
      serialNo: status?.SerialNo ?? null,
      statusCode: status?.Code ?? "Ok",
      statusMessage: status?.Message ?? "send success",
      fee: typeof status?.Fee === "number" ? status.Fee : null,
      templateId: runtime.templateId,
      phoneNumber,
    };
  } catch (error) {
    if (error instanceof TencentSmsProviderError) {
      throw error;
    }

    throw new TencentSmsProviderError(getProviderErrorMessage(error), {
      code: getProviderErrorCode(error),
      requestId: getProviderErrorRequestId(error),
      cause: error,
    });
  }
}
