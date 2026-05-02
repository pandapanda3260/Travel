import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "travel-model-usage-"));

Object.assign(process.env, {
  NODE_ENV: "development",
  TRAVEL_DATA_DIR: testDataDir,
  USAGE_BILLING_STRICT_MODE: "true",
  USAGE_BILLING_REQUIRE_PRICING: "true",
});

process.on("exit", () => {
  rmSync(testDataDir, { recursive: true, force: true });
});

let modulesPromise: Promise<{
  authStore: any;
  commercialCreditLedger: any;
  commercialOrderService: any;
  modelUsageService: any;
}> | null = null;

function loadModules() {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import("./auth-store"),
      import("./commercial-credit-ledger"),
      import("./commercial-order-service"),
      import("./model-usage-service"),
    ]).then(([authStore, commercialCreditLedger, commercialOrderService, modelUsageService]) => ({
      authStore,
      commercialCreditLedger,
      commercialOrderService,
      modelUsageService,
    }));
  }

  return modulesPromise;
}

function activateCommercialMembership(commercialOrderService: any, userId: string, suffix: string) {
  const { order } = commercialOrderService.createCommercialOrder({
    userId,
    productCode: "travel_light_monthly",
    idempotencyKey: `model-usage-commercial-order:${suffix}`,
  });
  commercialOrderService.fulfillCommercialOrder({
    orderId: order.orderId,
    idempotencyKey: `model-usage-commercial-fulfill:${suffix}`,
  });
}

function createAuthUser(authStore: any, userId: string) {
  const timestamp = new Date().toISOString();
  authStore.upsertAuthUser({
    avatar: null,
    certificationLabel: null,
    createdAt: timestamp,
    lastLoginAt: timestamp,
    lastLoginIp: "127.0.0.1",
    mergedIntoUserId: null,
    nickname: "用量测试用户",
    planLevel: null,
    quotaScope: "limited",
    status: "normal",
    updatedAt: timestamp,
    userId,
  });
}

function assertBillingError(error: unknown, code: string) {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "ModelUsageBillingError");
  assert.equal((error as { code?: string }).code, code);
}

test("strict usage preflight blocks provider calls without user context", async () => {
  const { modelUsageService } = await loadModules();

  assert.throws(
    () =>
      modelUsageService.assertModelUsagePreflight({
        serviceName: "image.generate",
        pricingKey: "doubao.seedream.5.0",
      }),
    (error) => {
      assertBillingError(error, "MISSING_USAGE_CONTEXT");
      return true;
    },
  );
});

test("strict usage preflight blocks provider calls without pricing", async () => {
  const { modelUsageService } = await loadModules();

  assert.throws(
    () =>
      modelUsageService.runWithModelUsageContext({ userId: "user-pricing-required" }, () =>
        modelUsageService.assertModelUsagePreflight({
          serviceName: "image.generate",
          pricingKey: null,
        }),
      ),
    (error) => {
      assertBillingError(error, "MISSING_PRICING_RULE");
      return true;
    },
  );
});

test("strict usage preflight no longer uses legacy points balance as a blocking gate", async () => {
  const { authStore, modelUsageService } = await loadModules();
  const userId = "user-legacy-balance-ignored";
  createAuthUser(authStore, userId);
  const previousEnforceBalance = process.env.USAGE_BILLING_ENFORCE_BALANCE;
  process.env.USAGE_BILLING_ENFORCE_BALANCE = "true";

  try {
    assert.doesNotThrow(() =>
      modelUsageService.runWithModelUsageContext({ userId }, () =>
        modelUsageService.assertModelUsagePreflight({
          serviceName: "image.generate",
          pricingKey: "doubao.seedream.5.0",
          estimatedMetrics: {
            imageCount: 1,
            requestCount: 1,
          },
        }),
      ),
    );
  } finally {
    if (previousEnforceBalance === undefined) {
      delete process.env.USAGE_BILLING_ENFORCE_BALANCE;
    } else {
      process.env.USAGE_BILLING_ENFORCE_BALANCE = previousEnforceBalance;
    }
  }
});

test("recordModelUsage writes charged usage without legacy points side effects", async () => {
  const { authStore, modelUsageService } = await loadModules();
  const userId = "user-model-usage-audit-only";
  createAuthUser(authStore, userId);

  const record = modelUsageService.runWithModelUsageContext(
    {
      userId,
      routePath: "/test/model-usage",
      objectType: "test",
      objectId: "object-1",
    },
    () =>
      modelUsageService.recordModelUsage({
        pricingKey: "doubao.seedream.5.0",
        serviceName: "image.generate",
        provider: "volcengine",
        modelId: "doubao-seedream-5-0-260128",
        metrics: { imageCount: 2, requestCount: 1 },
        requestId: "request-1",
        remark: "模型用量测试",
      }),
  );

  assert.equal(record.status, "charged");
  assert.equal(record.amountRmb, 0.44);
  assert.equal(record.pointsCost, 47.52);

  const usagePayload = modelUsageService.getUserModelUsagePayload(userId);
  assert.equal("pointsAccount" in usagePayload, false);
  assert.equal(usagePayload.commercialBalance.availableCredits, 0);
  assert.equal(usagePayload.records[0].usageId, record.usageId);
});

test("strict usage preflight ignores legacy daily user point limit", async () => {
  const { authStore, modelUsageService } = await loadModules();
  const userId = "user-daily-limit-ignored";
  createAuthUser(authStore, userId);

  modelUsageService.runWithModelUsageContext({ userId }, () =>
    modelUsageService.recordModelUsage({
      pricingKey: "doubao.seedream.5.0",
      serviceName: "image.generate",
      provider: "volcengine",
      modelId: "doubao-seedream-5-0-260128",
      metrics: { imageCount: 1, requestCount: 1 },
      requestId: "daily-limit-ignored-used",
      remark: "旧日限额回归测试",
    }),
  );

  const previousDailyLimit = process.env.USAGE_BILLING_DAILY_USER_POINT_LIMIT;
  process.env.USAGE_BILLING_DAILY_USER_POINT_LIMIT = "1";
  try {
    assert.doesNotThrow(() =>
      modelUsageService.runWithModelUsageContext({ userId }, () =>
        modelUsageService.assertModelUsagePreflight({
          serviceName: "image.generate",
          pricingKey: "doubao.seedream.5.0",
          estimatedMetrics: {
            imageCount: 1,
            requestCount: 1,
          },
        }),
      ),
    );
  } finally {
    if (previousDailyLimit === undefined) {
      delete process.env.USAGE_BILLING_DAILY_USER_POINT_LIMIT;
    } else {
      process.env.USAGE_BILLING_DAILY_USER_POINT_LIMIT = previousDailyLimit;
    }
  }
});

test("commercial model usage bridge freezes before provider call and confirms after successful usage record", async () => {
  const { authStore, commercialCreditLedger, commercialOrderService, modelUsageService } = await loadModules();
  const userId = "user-commercial-model-usage";
  createAuthUser(authStore, userId);
  activateCommercialMembership(commercialOrderService, userId, "bridge-success");

  const result = modelUsageService.runWithModelUsageContext(
    {
      userId,
      routePath: "/test/commercial-model-usage",
      objectType: "test",
      objectId: "commercial-object-1",
      requestId: "commercial-request-1",
    },
    () => {
      const prepared = modelUsageService.prepareCommercialModelUsageCharge({
        pricingKey: "doubao.seedream.5.0",
        serviceName: "image.generate",
        estimatedMetrics: { imageCount: 1, requestCount: 1 },
      });
      assert.equal(prepared.freeze.frozenCredits, 34);

      const record = modelUsageService.confirmCommercialModelUsageCharge(prepared, {
        pricingKey: "doubao.seedream.5.0",
        serviceName: "image.generate",
        provider: "volcengine",
        modelId: "doubao-seedream-5-0-260128",
        metrics: { imageCount: 1, requestCount: 1 },
        requestId: "commercial-provider-request-1",
        remark: "商业图片用量测试",
      });
      return { prepared, record };
    },
  );

  const freeze = commercialCreditLedger.getCommercialCreditFreezeById(result.prepared.freeze.freezeId);
  const transactions = commercialCreditLedger.listCreditTransactionsByUserId(userId);

  assert.equal(result.record.status, "charged");
  assert.equal(result.record.amountRmb, 0.22);
  assert.equal(freeze.status, "confirmed");
  assert.equal(transactions.some((item: any) => item.changeCredits === -34 && item.realCostRmb === 0.22), true);
});

test("commercial model usage bridge releases frozen credits when provider call fails", async () => {
  const { authStore, commercialCreditLedger, commercialOrderService, modelUsageService } = await loadModules();
  const userId = "user-commercial-model-usage-failed";
  createAuthUser(authStore, userId);
  activateCommercialMembership(commercialOrderService, userId, "bridge-failed");

  const prepared = modelUsageService.runWithModelUsageContext(
    {
      userId,
      routePath: "/test/commercial-model-usage",
      objectType: "test",
      objectId: "commercial-object-failed",
      requestId: "commercial-request-failed",
    },
    () =>
      modelUsageService.prepareCommercialModelUsageCharge({
        pricingKey: "doubao.seedream.5.0",
        serviceName: "image.generate",
        estimatedMetrics: { imageCount: 1, requestCount: 1 },
      }),
  );

  modelUsageService.releaseCommercialModelUsageCharge(prepared, "provider_failed");
  const freeze = commercialCreditLedger.getCommercialCreditFreezeById(prepared.freeze.freezeId);
  const balance = commercialCreditLedger.getCommercialCreditBalance(userId);

  assert.equal(freeze.status, "released");
  assert.equal(balance.availableCredits, 10_000);
  assert.equal(balance.frozenCredits, 0);
});

test("estimateTextModelUsageMetrics gives a conservative preflight estimate for LLM calls", async () => {
  const { modelUsageService } = await loadModules();
  const metrics = modelUsageService.estimateTextModelUsageMetrics({
    inputText: "这是一段用于生成旅行视频脚本的中文提示词",
    maxOutputTokens: 1800,
  });

  assert.equal(metrics.requestCount, 1);
  assert.equal(metrics.outputTokens, 1800);
  assert.equal(metrics.inputTokens > 0, true);
});

test("seedream 4.5 resolves pricing and records image usage", async () => {
  const { authStore, modelUsageService } = await loadModules();
  const userId = "user-model-usage-seedream45";
  createAuthUser(authStore, userId);

  assert.equal(
    modelUsageService.resolveDefaultModelPricingKey("doubao-seedream-4-5-251128"),
    "doubao.seedream.4.5",
  );

  const record = modelUsageService.runWithModelUsageContext(
    {
      userId,
      routePath: "/test/model-usage",
      objectType: "test",
      objectId: "object-seedream45",
    },
    () =>
      modelUsageService.recordModelUsage({
        pricingKey: "doubao.seedream.4.5",
        serviceName: "image.generate",
        provider: "volcengine",
        modelId: "doubao-seedream-4-5-251128",
        metrics: { imageCount: 1, requestCount: 1 },
        requestId: "request-seedream45",
        remark: "Seedream 4.5 图片用量测试",
      }),
  );

  assert.equal(record.status, "charged");
  assert.equal(record.amountRmb, 0.22);
  assert.equal(record.pointsCost, 23.76);

  const usagePayload = modelUsageService.getUserModelUsagePayload(userId);
  assert.equal("pointsAccount" in usagePayload, false);
  assert.equal(usagePayload.records.some((item: any) => item.usageId === record.usageId), true);
});

test("良心中转站 gpt-image-2 resolves image2 pricing rule", async () => {
  const { modelUsageService } = await loadModules();

  assert.equal(modelUsageService.resolveDefaultModelPricingKey("gpt-image-2"), "liangxin.gpt-image-2");

  const snapshot = modelUsageService.getModelUsageAdminSnapshot();
  const rule = snapshot.pricingRules.find((item: any) => item.pricingKey === "liangxin.gpt-image-2");

  assert.equal(rule?.provider, "liangxin");
  assert.equal(rule?.serviceName, "image.generate");
  assert.equal(rule?.modelId, "gpt-image-2");
  assert.equal(rule?.enabled, true);
  assert.equal(rule?.meters.some((item: any) => item.meter === "image_count" && item.unitPrice > 0), true);
});

test("recordModelUsage is idempotent across usage audit records", async () => {
  const { authStore, modelUsageService } = await loadModules();
  const userId = "user-model-usage-idempotent";
  createAuthUser(authStore, userId);

  const writeUsage = () =>
    modelUsageService.runWithModelUsageContext(
      {
        userId,
        routePath: "/test/model-usage",
        objectType: "test",
        objectId: "object-2",
      },
      () =>
        modelUsageService.recordModelUsage({
          pricingKey: "doubao.seedream.5.0",
          serviceName: "image.generate",
          provider: "volcengine",
          modelId: "doubao-seedream-5-0-260128",
          metrics: { imageCount: 1, requestCount: 1 },
          requestId: "request-idempotent",
          remark: "模型用量幂等测试",
        }),
    );

  const firstRecord = writeUsage();
  const secondRecord = writeUsage();

  assert.equal(secondRecord.usageId, firstRecord.usageId);

  const usagePayload = modelUsageService.getUserModelUsagePayload(userId);
  assert.equal(usagePayload.records.filter((item: any) => item.requestId === "request-idempotent").length, 1);
});

test("production mode does not force strict preflight when billing switches are disabled", async () => {
  const { modelUsageService } = await loadModules();
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousStrict = process.env.USAGE_BILLING_STRICT_MODE;
  const previousRequirePricing = process.env.USAGE_BILLING_REQUIRE_PRICING;
  const previousEnforceBalance = process.env.USAGE_BILLING_ENFORCE_BALANCE;
  const previousDailyLimit = process.env.USAGE_BILLING_DAILY_USER_POINT_LIMIT;

  env.NODE_ENV = "production";
  env.USAGE_BILLING_STRICT_MODE = "false";
  env.USAGE_BILLING_REQUIRE_PRICING = "false";
  env.USAGE_BILLING_ENFORCE_BALANCE = "false";
  delete env.USAGE_BILLING_DAILY_USER_POINT_LIMIT;

  try {
    const policy = modelUsageService.getModelUsageBillingPolicy();
    assert.equal(policy.strictModeEnabled, false);
    assert.equal(policy.requirePricingRule, false);
    assert.equal(policy.enforceSufficientBalance, false);
    assert.equal(policy.dailyUserPointLimit, null);
    assert.equal(policy.strictModeSource, "env");

    assert.doesNotThrow(() =>
      modelUsageService.assertModelUsagePreflight({
        serviceName: "image.generate",
        pricingKey: null,
      }),
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = previousNodeEnv;
    }
    if (previousStrict === undefined) {
      delete env.USAGE_BILLING_STRICT_MODE;
    } else {
      env.USAGE_BILLING_STRICT_MODE = previousStrict;
    }
    if (previousRequirePricing === undefined) {
      delete env.USAGE_BILLING_REQUIRE_PRICING;
    } else {
      env.USAGE_BILLING_REQUIRE_PRICING = previousRequirePricing;
    }
    if (previousEnforceBalance === undefined) {
      delete env.USAGE_BILLING_ENFORCE_BALANCE;
    } else {
      env.USAGE_BILLING_ENFORCE_BALANCE = previousEnforceBalance;
    }
    if (previousDailyLimit === undefined) {
      delete env.USAGE_BILLING_DAILY_USER_POINT_LIMIT;
    } else {
      env.USAGE_BILLING_DAILY_USER_POINT_LIMIT = previousDailyLimit;
    }
  }
});

test("strict usage preflight blocks disabled placeholder pricing rules", async () => {
  const { authStore, modelUsageService } = await loadModules();
  const userId = "user-disabled-pricing";
  createAuthUser(authStore, userId);

  assert.throws(
    () =>
      modelUsageService.runWithModelUsageContext({ userId }, () =>
        modelUsageService.assertModelUsagePreflight({
          serviceName: "video.generate",
          pricingKey: "kling.text2video",
        }),
      ),
    (error) => {
      assertBillingError(error, "DISABLED_PRICING_RULE");
      return true;
    },
  );
});

test("blocked usage preflight writes an auditable risk event", async () => {
  const { authStore, modelUsageService } = await loadModules();
  const userId = "user-risk-event";
  createAuthUser(authStore, userId);
  const before = modelUsageService.getModelUsageAdminSnapshot().riskEvents.overview.totalEvents;

  assert.throws(
    () =>
      modelUsageService.runWithModelUsageContext({ userId, routePath: "/test/risk-event" }, () =>
        modelUsageService.assertModelUsagePreflight({
          serviceName: "image.generate",
          pricingKey: null,
        }),
      ),
    (error) => {
      assertBillingError(error, "MISSING_PRICING_RULE");
      return true;
    },
  );

  const snapshot = modelUsageService.getModelUsageAdminSnapshot();
  assert.equal(snapshot.riskEvents.overview.totalEvents, before + 1);
  assert.equal(snapshot.riskEvents.recentEvents[0].code, "MISSING_PRICING_RULE");
  assert.equal(snapshot.riskEvents.recentEvents[0].userId, userId);
});

test("admin pricing updates require a positive unit price before enabling", async () => {
  const { modelUsageService } = await loadModules();

  assert.throws(
    () =>
      modelUsageService.updateModelPricingRuleForAdmin({
        pricingKey: "kling.text2video",
        enabled: true,
      }),
    /大于 0 的单价/,
  );

  const rule = modelUsageService.updateModelPricingRuleForAdmin({
    pricingKey: "kling.text2video",
    enabled: true,
    source: "manual",
    meters: [{ meter: "video_seconds", unitSize: 1, unitPrice: 0.8, currency: "CNY" }],
    notes: "测试定价",
  });
  assert.equal(rule.enabled, true);
  assert.equal(rule.meters[0].unitPrice, 0.8);
});

test("provider bill reconciliation flags matched and mismatched rows", async () => {
  const { authStore, modelUsageService } = await loadModules();
  const userId = "user-reconciliation";
  createAuthUser(authStore, userId);

  const usage = modelUsageService.runWithModelUsageContext({ userId }, () =>
    modelUsageService.recordModelUsage({
      pricingKey: "doubao.seedream.5.0",
      serviceName: "image.generate",
      provider: "volcengine",
      modelId: "doubao-seedream-5-0-260128",
      metrics: { imageCount: 1, requestCount: 1 },
      requestId: "reconcile-request-1",
      remark: "对账测试",
    }),
  );

  const result = modelUsageService.importModelUsageProviderBillsForAdmin([
    {
      provider: "volcengine",
      serviceName: "image.generate",
      pricingKey: "doubao.seedream.5.0",
      externalUsageId: "provider-bill-matched",
      requestId: "reconcile-request-1",
      amountRmb: usage.amountRmb,
      pointsCost: usage.pointsCost,
    },
    {
      provider: "volcengine",
      serviceName: "image.generate",
      pricingKey: "doubao.seedream.5.0",
      externalUsageId: "provider-bill-mismatch",
      requestId: "reconcile-request-1",
      amountRmb: usage.amountRmb + 1,
      pointsCost: usage.pointsCost + 100,
    },
  ]);

  assert.equal(result.imported[0].status, "matched");
  assert.equal(result.imported[1].status, "mismatch");
  assert.equal(result.reconciliation.overview.matchedBills >= 1, true);
  assert.equal(result.reconciliation.overview.mismatchBills >= 1, true);
});
