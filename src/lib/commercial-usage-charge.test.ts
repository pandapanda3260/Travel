import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "travel-commercial-usage-charge-"));

Object.assign(process.env, {
  NODE_ENV: "test",
  TRAVEL_DATA_DIR: testDataDir,
});

process.on("exit", () => {
  rmSync(testDataDir, { recursive: true, force: true });
});

let modulesPromise: Promise<{
  ledger: typeof import("./commercial-credit-ledger");
  orderService: typeof import("./commercial-order-service");
  usageCharge: typeof import("./commercial-usage-charge");
}> | null = null;

function loadModules() {
  modulesPromise ??= Promise.all([
    import("./commercial-credit-ledger"),
    import("./commercial-order-service"),
    import("./commercial-usage-charge"),
  ]).then(([ledger, orderService, usageCharge]) => ({ ledger, orderService, usageCharge }));
  return modulesPromise;
}

function assertLedgerError(error: unknown, code: string) {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "CommercialCreditLedgerError");
  assert.equal((error as { code?: string }).code, code);
}

function assertUsageChargeError(error: unknown, code: string) {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "CommercialUsageChargeError");
  assert.equal((error as { code?: string }).code, code);
}

function activateLightMembership(
  orderService: typeof import("./commercial-order-service"),
  userId: string,
  suffix: string,
) {
  const { order } = orderService.createCommercialOrder({
    userId,
    productCode: "travel_light_monthly",
    idempotencyKey: `order:${suffix}`,
  });
  orderService.fulfillCommercialOrder({
    orderId: order.orderId,
    idempotencyKey: `fulfill:${suffix}`,
  });
}

test("视频扣费预检会按时长配置冻结预计积分", async () => {
  const { orderService, usageCharge } = await loadModules();
  activateLightMembership(orderService, "user-video-charge-prepare", "usage-prepare");

  const prepared = usageCharge.prepareVideoUsageCharge({
    userId: "user-video-charge-prepare",
    taskId: "task-video-30s",
    durationSeconds: 30,
    idempotencyKey: "usage:prepare:task-video-30s",
  });

  assert.equal(prepared.pricingRule.code, "video_generation_30s");
  assert.equal(prepared.freeze.frozenCredits, 4_700);
  assert.equal(prepared.balance.availableCredits, 5_300);
  assert.equal(prepared.balance.frozenCredits, 4_700);
  assert.equal(Number(prepared.margin.grossMarginRate.toFixed(4)), 0.3049);
});

test("无有效会员但有积分时允许在调用第三方 API 前冻结积分", async () => {
  const { ledger, usageCharge } = await loadModules();
  ledger.grantCredits({
    userId: "user-video-charge-no-membership",
    credits: 10_000,
    sourceType: "credit_package_grant",
    idempotencyKey: "grant:no-membership",
  });

  const prepared = usageCharge.prepareVideoUsageCharge({
    userId: "user-video-charge-no-membership",
    taskId: "task-video-no-membership",
    durationSeconds: 15,
    idempotencyKey: "usage:prepare:no-membership",
  });

  assert.equal(prepared.freeze.frozenCredits, 2_400);
  assert.equal(prepared.balance.availableCredits, 7_600);
});

test("剩余积分不足但大于 0 时允许继续生成并扣成负数", async () => {
  const { ledger, usageCharge } = await loadModules();
  ledger.grantCredits({
    userId: "user-video-charge-insufficient",
    credits: 100,
    sourceType: "manual_adjustment",
    idempotencyKey: "grant:usage-overdraft",
  });

  const prepared = usageCharge.prepareVideoUsageCharge({
    userId: "user-video-charge-insufficient",
    taskId: "task-video-overdraft",
    durationSeconds: 15,
    idempotencyKey: "usage:prepare:overdraft",
  });

  assert.equal(prepared.freeze.frozenCredits, 2_400);
  assert.equal(prepared.balance.availableCredits, -2_300);
  assert.equal(prepared.balance.frozenCredits, 2_400);
});

test("积分为负数会在调用第三方 API 前被拦截", async () => {
  const { ledger, usageCharge } = await loadModules();
  ledger.grantCredits({
    userId: "user-video-charge-no-balance",
    credits: 100,
    sourceType: "manual_adjustment",
    idempotencyKey: "grant:usage-negative-balance",
  });
  usageCharge.prepareVideoUsageCharge({
    userId: "user-video-charge-no-balance",
    taskId: "task-video-nearly-empty",
    durationSeconds: 15,
    idempotencyKey: "usage:prepare:nearly-empty",
  });

  assert.throws(
    () =>
      usageCharge.prepareVideoUsageCharge({
        userId: "user-video-charge-no-balance",
        taskId: "task-video-no-balance",
        durationSeconds: 15,
        idempotencyKey: "usage:prepare:no-balance",
      }),
    (error) => {
      assertLedgerError(error, "INSUFFICIENT_CREDITS");
      return true;
    },
  );
});

test("视频生成成功后确认扣费并写入成本和毛利信息", async () => {
  const { orderService, usageCharge } = await loadModules();
  activateLightMembership(orderService, "user-video-charge-confirm", "usage-confirm");

  const prepared = usageCharge.prepareVideoUsageCharge({
    userId: "user-video-charge-confirm",
    taskId: "task-video-15s",
    durationSeconds: 15,
    idempotencyKey: "usage:prepare:task-video-15s",
  });
  const confirmed = usageCharge.confirmPreparedUsageCharge({
    freezeId: prepared.freeze.freezeId,
    idempotencyKey: "usage:confirm:task-video-15s",
    provider: "volcengine",
    modelId: "seedance-2",
  });

  assert.equal(confirmed.transaction.changeCredits, -2_400);
  assert.equal(confirmed.transaction.realCostRmb, 15.15);
  assert.equal(Number(confirmed.transaction.grossMarginRate?.toFixed(4)), 0.3182);
  assert.equal(confirmed.balance.availableCredits, 7_600);
  assert.equal(confirmed.balance.frozenCredits, 0);
});

test("视频生成失败释放冻结且不扣费", async () => {
  const { ledger, orderService, usageCharge } = await loadModules();
  activateLightMembership(orderService, "user-video-charge-release", "usage-release");

  const prepared = usageCharge.prepareVideoUsageCharge({
    userId: "user-video-charge-release",
    taskId: "task-video-failed",
    durationSeconds: 60,
    idempotencyKey: "usage:prepare:task-video-failed",
  });
  const released = usageCharge.releasePreparedUsageCharge({
    freezeId: prepared.freeze.freezeId,
    reason: "provider_failed",
  });

  assert.equal(released.freeze.status, "released");
  assert.equal(released.balance.availableCredits, 10_000);
  assert.equal(ledger.listCreditTransactionsByUserId("user-video-charge-release").filter((item) => item.changeCredits < 0).length, 0);
});
