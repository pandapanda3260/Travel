import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "travel-commercial-billing-service-"));

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
  billingService: typeof import("./commercial-billing-service");
}> | null = null;

function loadModules() {
  modulesPromise ??= Promise.all([
    import("./commercial-credit-ledger"),
    import("./commercial-order-service"),
    import("./commercial-billing-service"),
  ]).then(([ledger, orderService, billingService]) => ({ ledger, orderService, billingService }));
  return modulesPromise;
}

test("商业商品 payload 汇总会员、积分包、视频扣费和毛利测算", async () => {
  const { billingService } = await loadModules();
  const payload = billingService.getCommercialProductsPayload();

  assert.equal(payload.baseline.pointsPerRmb, 108);
  assert.equal(payload.membershipPlans.length, 4);
  assert.equal(payload.creditPackages.length, 6);
  assert.equal(payload.videoPricing.length, 3);
  assert.equal(payload.membershipPlans[3]?.code, "travel_enterprise_monthly");
  assert.equal(Number(payload.membershipPlans[3]?.margin.grossMarginRate.toFixed(4)), 0.3);
  assert.equal(payload.creditPackages.every((item) => item.changesMembership === false), true);
});

test("用户商业积分账户 payload 展示可用、冻结和流水", async () => {
  const { ledger, billingService } = await loadModules();
  ledger.grantCredits({
    userId: "user-commercial-account",
    credits: 10_000,
    sourceType: "membership_grant",
    sourceBizId: "order-account",
    idempotencyKey: "grant:account",
  });
  ledger.freezeCredits({
    userId: "user-commercial-account",
    credits: 2_400,
    sourceType: "usage_charge",
    sourceBizId: "task-account",
    idempotencyKey: "freeze:account",
    taskId: "task-account",
    featureCode: "video_generation_15s",
  });

  const payload = billingService.getCommercialCreditAccountPayload("user-commercial-account");
  assert.equal(payload.balance.availableCredits, 7_600);
  assert.equal(payload.balance.frozenCredits, 2_400);
  assert.equal(payload.transactions.length, 1);
  assert.equal(payload.transactions[0]?.changeCredits, 10_000);
});

test("用户商业积分账户 payload 展示当前商业会员", async () => {
  const { billingService, orderService } = await loadModules();
  const { order } = orderService.createCommercialOrder({
    userId: "user-commercial-membership",
    productCode: "travel_standard_monthly",
    idempotencyKey: "order:account-membership",
  });
  orderService.fulfillCommercialOrder({
    orderId: order.orderId,
    idempotencyKey: "fulfill:account-membership",
  });

  const payload = billingService.getCommercialCreditAccountPayload("user-commercial-membership");
  assert.equal(payload.membership?.planCode, "travel_standard_monthly");
  assert.equal(payload.activeMembership?.planName, "Travel 标准版");
});
