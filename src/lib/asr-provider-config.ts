import { loadOptionalEnvFile, parseBoolean } from "./env-file";

export type AsrRuntime = {
  liveEnabled: boolean;
  hasCredential: boolean;
  providerLabel: string;
  apiBase: string;
  appId: string;
  accessToken: string;
  resourceId: string;
  configFileName: string;
};

export function getAsrRuntime(): AsrRuntime {
  const configFileName = "audio.env.local";
  const localConfig = loadOptionalEnvFile(configFileName);

  const appId =
    process.env.VOLCENGINE_ASR_APP_ID ??
    localConfig.VOLCENGINE_ASR_APP_ID ??
    process.env.VOLCENGINE_AUDIO_APP_ID ??
    localConfig.VOLCENGINE_AUDIO_APP_ID ??
    "";
  const accessToken =
    process.env.VOLCENGINE_ASR_ACCESS_TOKEN ??
    localConfig.VOLCENGINE_ASR_ACCESS_TOKEN ??
    process.env.VOLCENGINE_AUDIO_ACCESS_TOKEN ??
    localConfig.VOLCENGINE_AUDIO_ACCESS_TOKEN ??
    "";
  const apiBase =
    process.env.VOLCENGINE_ASR_API_BASE ??
    localConfig.VOLCENGINE_ASR_API_BASE ??
    process.env.VOLCENGINE_AUDIO_API_BASE ??
    localConfig.VOLCENGINE_AUDIO_API_BASE ??
    "https://openspeech.bytedance.com";
  const resourceId =
    process.env.VOLCENGINE_ASR_RESOURCE_ID ??
    localConfig.VOLCENGINE_ASR_RESOURCE_ID ??
    "volc.bigasr.auc_turbo";
  const liveEnabled = parseBoolean(
    process.env.VOLCENGINE_ASR_LIVE_ENABLED ??
      localConfig.VOLCENGINE_ASR_LIVE_ENABLED,
    true,
  );

  return {
    liveEnabled: liveEnabled && Boolean(appId) && Boolean(accessToken),
    hasCredential: Boolean(appId) && Boolean(accessToken),
    providerLabel: "火山方舟 · Doubao-录音文件识别2.0",
    apiBase,
    appId,
    accessToken,
    resourceId,
    configFileName,
  };
}
