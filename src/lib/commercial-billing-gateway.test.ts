import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "travel-commercial-billing-gateway-"));

Object.assign(process.env, {
  NODE_ENV: "test",
  TRAVEL_DATA_DIR: testDataDir,
});

process.on("exit", () => {
  rmSync(testDataDir, { recursive: true, force: true });
});

let modulesPromise: Promise<{
  authStore: typeof import("./auth-store");
  gateway: typeof import("./commercial-billing-gateway");
  ledger: typeof import("./commercial-credit-ledger");
  orderService: typeof import("./commercial-order-service");
}> | null = null;

function loadModules() {
  modulesPromise ??= Promise.all([
    import("./auth-store"),
    import("./commercial-billing-gateway"),
    import("./commercial-credit-ledger"),
    import("./commercial-order-service"),
  ]).then(([authStore, gateway, ledger, orderService]) => ({ authStore, gateway, ledger, orderService }));
  return modulesPromise;
}

function activateMembership(orderService: typeof import("./commercial-order-service"), userId: string, suffix: string) {
  const { order } = orderService.createCommercialOrder({
    userId,
    productCode: "travel_light_monthly",
    idempotencyKey: `gateway:order:${suffix}`,
  });
  orderService.fulfillCommercialOrder({
    orderId: order.orderId,
    idempotencyKey: `gateway:fulfill:${suffix}`,
  });
}

function createAuthUser(
  authStore: typeof import("./auth-store"),
  userId: string,
  overrides: Partial<import("./auth-store").AuthUserRecord> = {},
) {
  const timestamp = new Date().toISOString();
  authStore.upsertAuthUser({
    avatar: null,
    certificationLabel: null,
    createdAt: timestamp,
    lastLoginAt: timestamp,
    lastLoginIp: "127.0.0.1",
    mergedIntoUserId: null,
    nickname: "商业网关测试用户",
    planLevel: null,
    quotaScope: "limited",
    status: "normal",
    updatedAt: timestamp,
    ...overrides,
    userId,
  });
}

function assertGatewayError(error: unknown, code: string) {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "CommercialBillingGatewayError");
  assert.equal((error as { code?: string }).code, code);
}

test("billing gateway 会用统一入口完成视频生成冻结、确认扣费和成本毛利记录", async () => {
  const { gateway, orderService } = await loadModules();
  activateMembership(orderService, "gateway-user-video", "video");

  const prepared = gateway.prepareCommercialUsageCharge({
    userId: "gateway-user-video",
    taskId: "gateway-task-video-30s",
    featureCode: "video_generation",
    durationSeconds: 30,
    idempotencyKey: "gateway:prepare:video-30s",
  });

  assert.equal(prepared.pricingRule.code, "video_generation_30s");
  assert.equal(prepared.freeze.frozenCredits, 4_700);
  assert.equal(prepared.balance.availableCredits, 5_300);

  const confirmed = gateway.confirmCommercialUsageCharge({
    freezeId: prepared.freeze.freezeId,
    idempotencyKey: "gateway:confirm:video-30s",
    provider: "volcengine",
    modelId: "seedance-2",
  });

  assert.equal(confirmed.transaction.featureCode, "video_generation_30s");
  assert.equal(confirmed.transaction.changeCredits, -4_700);
  assert.equal(confirmed.transaction.realCostRmb, 30.25);
  assert.equal(Number(confirmed.transaction.grossMarginRate?.toFixed(4)), 0.3049);
  assert.equal(confirmed.balance.frozenCredits, 0);
});

test("billing gateway 在无会员但有积分、无配置和生成失败时分别执行服务端保护", async () => {
  const { gateway, ledger, orderService } = await loadModules();
  ledger.grantCredits({
    userId: "gateway-user-no-membership",
    credits: 10_000,
    sourceType: "credit_package_grant",
    idempotencyKey: "gateway:grant:no-membership",
  });

  const noMembershipPrepared = gateway.prepareCommercialUsageCharge({
    userId: "gateway-user-no-membership",
    taskId: "gateway-task-no-membership",
    featureCode: "video_generation",
    durationSeconds: 15,
    idempotencyKey: "gateway:prepare:no-membership",
  });

  assert.equal(noMembershipPrepared.freeze.frozenCredits, 2_400);
  assert.equal(noMembershipPrepared.balance.availableCredits, 7_600);

  activateMembership(orderService, "gateway-user-missing-config", "missing-config");
  assert.throws(
    () =>
      gateway.prepareCommercialUsageCharge({
        userId: "gateway-user-missing-config",
        taskId: "gateway-task-missing-config",
        featureCode: "image_generation",
        idempotencyKey: "gateway:prepare:missing-config",
      }),
    (error) => {
      assertGatewayError(error, "MISSING_FEATURE_PRICING_RULE");
      return true;
    },
  );

  activateMembership(orderService, "gateway-user-release", "release");
  const prepared = gateway.prepareCommercialUsageCharge({
    userId: "gateway-user-release",
    taskId: "gateway-task-release",
    featureCode: "video_generation",
    durationSeconds: 60,
    idempotencyKey: "gateway:prepare:release",
  });
  const released = gateway.releaseCommercialUsageCharge({
    freezeId: prepared.freeze.freezeId,
    reason: "provider_failed",
  });

  assert.equal(released.freeze.status, "released");
  assert.equal(released.balance.availableCredits, 10_000);
  assert.equal(ledger.listCreditTransactionsByUserId("gateway-user-release").filter((item) => item.changeCredits < 0).length, 0);
});

test("billing gateway 支持按真实模型成本动态换算积分并保持 30% 毛利底线", async () => {
  const { gateway, ledger } = await loadModules();
  ledger.grantCredits({
    userId: "gateway-user-metered",
    credits: 100_000,
    sourceType: "manual_adjustment",
    idempotencyKey: "gateway:grant:metered",
  });

  const prepared = gateway.prepareCommercialMeteredUsageCharge({
    userId: "gateway-user-metered",
    taskId: "task-image-metered",
    featureCode: "image_generation",
    estimatedApiCostRmb: 0.22,
    idempotencyKey: "gateway:metered:prepare:image",
  });

  assert.equal(prepared.pricingRule.featureCode, "image_generation");
  assert.equal(prepared.pricingRule.chargedCredits, 34);
  assert.equal(Number(prepared.margin.grossMarginRate.toFixed(4)), 0.3012);

  const confirmed = gateway.confirmCommercialMeteredUsageCharge({
    freezeId: prepared.freeze.freezeId,
    idempotencyKey: "gateway:metered:confirm:image",
    actualCostRmb: 0.22,
    provider: "volcengine",
    modelId: "doubao-seedream-5-0-260128",
  });

  assert.equal(confirmed.transaction.changeCredits, -34);
  assert.equal(confirmed.transaction.realCostRmb, 0.22);
  assert.equal(Number(confirmed.transaction.grossMarginRate?.toFixed(4)), 0.3012);
});

test("billing gateway 会把 auth 侧有效 L5 会员识别为商业模型调用权益", async () => {
  const { authStore, gateway, ledger, orderService } = await loadModules();
  const userId = "gateway-user-legacy-auth-l5";

  createAuthUser(authStore, userId, {
    certificationLabel: "企业认证",
    planLevel: 5,
    quotaScope: "unlimited",
  });
  ledger.grantCredits({
    userId,
    credits: 100_000,
    sourceType: "manual_adjustment",
    idempotencyKey: "gateway:grant:legacy-auth-l5",
    remark: "历史 L5 会员商业积分",
  });

  assert.equal(orderService.getActiveUserCommercialMembership(userId), null);

  const prepared = gateway.prepareCommercialMeteredUsageCharge({
    userId,
    taskId: "task-image-legacy-auth-l5",
    featureCode: "image_generation",
    estimatedApiCostRmb: 0.22,
    idempotencyKey: "gateway:metered:prepare:legacy-auth-l5",
  });

  assert.equal(prepared.freeze.frozenCredits, 34);
  assert.equal(prepared.balance.availableCredits, 99_966);
});
