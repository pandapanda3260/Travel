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
  modelUsageService: any;
  pointsService: any;
}> | null = null;

function loadModules() {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import("./auth-store"),
      import("./model-usage-service"),
      import("./points-service"),
    ]).then(([authStore, modelUsageService, pointsService]) => ({
      authStore,
      modelUsageService,
      pointsService,
    }));
  }

  return modulesPromise;
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

test("strict usage preflight blocks estimated usage when balance is insufficient", async () => {
  const { authStore, modelUsageService } = await loadModules();
  const userId = "user-insufficient-balance";
  createAuthUser(authStore, userId);
  const previousEnforceBalance = process.env.USAGE_BILLING_ENFORCE_BALANCE;
  process.env.USAGE_BILLING_ENFORCE_BALANCE = "true";

  try {
    assert.throws(
      () =>
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
      (error) => {
        assertBillingError(error, "INSUFFICIENT_POINTS_BALANCE");
        return true;
      },
    );
  } finally {
    if (previousEnforceBalance === undefined) {
      delete process.env.USAGE_BILLING_ENFORCE_BALANCE;
    } else {
      process.env.USAGE_BILLING_ENFORCE_BALANCE = previousEnforceBalance;
    }
  }
});

test("recordModelUsage writes charged usage and point deduction", async () => {
  const { authStore, modelUsageService, pointsService } = await loadModules();
  const userId = "user-model-usage-charge";
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
  assert.equal(record.pointsCost, 44);

  const pointsPayload = pointsService.getPointsPayload(userId);
  assert.equal(pointsPayload.account.availablePoints, -44);
  assert.equal(pointsPayload.records[0].eventType, "model_usage_charge");
});

test("seedream 4.5 resolves pricing and records image usage", async () => {
  const { authStore, modelUsageService, pointsService } = await loadModules();
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
  assert.equal(record.pointsCost, 22);

  const pointsPayload = pointsService.getPointsPayload(userId);
  assert.equal(pointsPayload.account.availablePoints, -22);
});

test("recordModelUsage is idempotent across usage and point ledgers", async () => {
  const { authStore, modelUsageService, pointsService } = await loadModules();
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

  const pointsPayload = pointsService.getPointsPayload(userId);
  assert.equal(pointsPayload.records.length, 1);
  assert.equal(pointsPayload.records[0].changeValue, -22);
  assert.equal(pointsPayload.account.availablePoints, -22);
});

test("strict usage preflight blocks estimated usage beyond the daily user limit", async () => {
  const { authStore, modelUsageService, pointsService } = await loadModules();
  const userId = "user-daily-limit";
  createAuthUser(authStore, userId);
  pointsService.grantPointsForEvent({
    userId,
    eventType: "manual_adjustment",
    sourceType: "manual",
    changeValue: 1000,
    idempotentKey: "daily-limit-seed-points",
    remark: "测试积分",
  });

  modelUsageService.runWithModelUsageContext({ userId }, () =>
    modelUsageService.recordModelUsage({
      pricingKey: "doubao.seedream.5.0",
      serviceName: "image.generate",
      provider: "volcengine",
      modelId: "doubao-seedream-5-0-260128",
      metrics: { imageCount: 1, requestCount: 1 },
      requestId: "daily-limit-used",
      remark: "日限额已用量",
    }),
  );

  const previousDailyLimit = process.env.USAGE_BILLING_DAILY_USER_POINT_LIMIT;
  process.env.USAGE_BILLING_DAILY_USER_POINT_LIMIT = "30";
  try {
    assert.throws(
      () =>
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
      (error) => {
        assertBillingError(error, "DAILY_USAGE_LIMIT_EXCEEDED");
        return true;
      },
    );
  } finally {
    if (previousDailyLimit === undefined) {
      delete process.env.USAGE_BILLING_DAILY_USER_POINT_LIMIT;
    } else {
      process.env.USAGE_BILLING_DAILY_USER_POINT_LIMIT = previousDailyLimit;
    }
  }
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
