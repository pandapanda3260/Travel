import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "travel-commercial-credit-ledger-"));

Object.assign(process.env, {
  NODE_ENV: "test",
  TRAVEL_DATA_DIR: testDataDir,
});

process.on("exit", () => {
  rmSync(testDataDir, { recursive: true, force: true });
});

let ledgerPromise: Promise<typeof import("./commercial-credit-ledger")> | null = null;

function loadLedger() {
  ledgerPromise ??= import("./commercial-credit-ledger");
  return ledgerPromise;
}

function assertLedgerError(error: unknown, code: string) {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "CommercialCreditLedgerError");
  assert.equal((error as { code?: string }).code, code);
}

test("充值/购买发放积分会写余额和幂等流水", async () => {
  const ledger = await loadLedger();

  const first = ledger.grantCredits({
    userId: "user-credit-grant",
    credits: 10_000,
    sourceType: "membership_grant",
    sourceBizId: "order-001",
    idempotencyKey: "grant:order-001",
    expireAt: "2026-05-31T23:59:59.000Z",
    remark: "轻量版会员月积分",
  });
  const second = ledger.grantCredits({
    userId: "user-credit-grant",
    credits: 10_000,
    sourceType: "membership_grant",
    sourceBizId: "order-001",
    idempotencyKey: "grant:order-001",
    expireAt: "2026-05-31T23:59:59.000Z",
    remark: "重复回调不重复到账",
  });

  assert.equal(second.transaction.transactionId, first.transaction.transactionId);
  assert.equal(second.balance.availableCredits, 10_000);
  assert.equal(second.balance.frozenCredits, 0);
  assert.equal(second.balance.lifetimePurchasedCredits, 10_000);
});

test("冻结积分会从可用转入冻结且重复冻结不会重复占用", async () => {
  const ledger = await loadLedger();
  ledger.grantCredits({
    userId: "user-credit-freeze",
    credits: 10_000,
    sourceType: "credit_package_grant",
    sourceBizId: "order-002",
    idempotencyKey: "grant:order-002",
  });

  const first = ledger.freezeCredits({
    userId: "user-credit-freeze",
    credits: 2_400,
    sourceType: "usage_charge",
    sourceBizId: "task-15s",
    idempotencyKey: "freeze:task-15s:video",
    taskId: "task-15s",
    featureCode: "video_generation_15s",
  });
  const second = ledger.freezeCredits({
    userId: "user-credit-freeze",
    credits: 2_400,
    sourceType: "usage_charge",
    sourceBizId: "task-15s",
    idempotencyKey: "freeze:task-15s:video",
    taskId: "task-15s",
    featureCode: "video_generation_15s",
  });

  assert.equal(second.freeze.freezeId, first.freeze.freezeId);
  assert.equal(second.balance.availableCredits, 7_600);
  assert.equal(second.balance.frozenCredits, 2_400);
});

test("积分为 0 时不能冻结积分", async () => {
  const ledger = await loadLedger();

  assert.throws(
    () =>
      ledger.freezeCredits({
        userId: "user-credit-insufficient",
        credits: 2_400,
        sourceType: "usage_charge",
        idempotencyKey: "freeze:insufficient",
      }),
    (error) => {
      assertLedgerError(error, "INSUFFICIENT_CREDITS");
      return true;
    },
  );
});

test("剩余积分不足但大于 0 时允许冻结并把可用积分扣成负数", async () => {
  const ledger = await loadLedger();
  ledger.grantCredits({
    userId: "user-credit-overdraft",
    credits: 100,
    sourceType: "manual_adjustment",
    idempotencyKey: "grant:overdraft",
  });

  const frozen = ledger.freezeCredits({
    userId: "user-credit-overdraft",
    credits: 2_400,
    sourceType: "usage_charge",
    sourceBizId: "task-overdraft",
    idempotencyKey: "freeze:task-overdraft:video",
    taskId: "task-overdraft",
    featureCode: "video_generation_15s",
  });

  assert.equal(frozen.freeze.frozenCredits, 2_400);
  assert.equal(frozen.balance.availableCredits, -2_300);
  assert.equal(frozen.balance.frozenCredits, 2_400);

  assert.throws(
    () =>
      ledger.freezeCredits({
        userId: "user-credit-overdraft",
        credits: 34,
        sourceType: "usage_charge",
        sourceBizId: "task-overdraft-next",
        idempotencyKey: "freeze:task-overdraft-next:image",
        taskId: "task-overdraft-next",
        featureCode: "metered_image_generation",
      }),
    (error) => {
      assertLedgerError(error, "INSUFFICIENT_CREDITS");
      return true;
    },
  );
});

test("确认扣费只扣一次并写负向流水", async () => {
  const ledger = await loadLedger();
  ledger.grantCredits({
    userId: "user-credit-confirm",
    credits: 10_000,
    sourceType: "membership_grant",
    sourceBizId: "order-003",
    idempotencyKey: "grant:order-003",
  });
  const frozen = ledger.freezeCredits({
    userId: "user-credit-confirm",
    credits: 4_700,
    sourceType: "usage_charge",
    sourceBizId: "task-30s",
    idempotencyKey: "freeze:task-30s:video",
    taskId: "task-30s",
    featureCode: "video_generation_30s",
  });

  const first = ledger.confirmCreditFreeze({
    freezeId: frozen.freeze.freezeId,
    idempotencyKey: "charge:task-30s:video",
    realCostRmb: 30.25,
    chargedRevenueRmb: 43.52,
    grossMarginRate: 0.305,
    provider: "volcengine",
    modelId: "seedance-2",
  });
  const second = ledger.confirmCreditFreeze({
    freezeId: frozen.freeze.freezeId,
    idempotencyKey: "charge:task-30s:video",
    realCostRmb: 30.25,
    chargedRevenueRmb: 43.52,
    grossMarginRate: 0.305,
    provider: "volcengine",
    modelId: "seedance-2",
  });

  assert.equal(second.transaction.transactionId, first.transaction.transactionId);
  assert.equal(first.transaction.changeCredits, -4_700);
  assert.equal(second.balance.availableCredits, 5_300);
  assert.equal(second.balance.frozenCredits, 0);
  assert.equal(second.balance.lifetimeUsedCredits, 4_700);
});

test("生成失败释放冻结积分且不产生扣费流水", async () => {
  const ledger = await loadLedger();
  ledger.grantCredits({
    userId: "user-credit-release",
    credits: 10_000,
    sourceType: "membership_grant",
    sourceBizId: "order-004",
    idempotencyKey: "grant:order-004",
  });
  const frozen = ledger.freezeCredits({
    userId: "user-credit-release",
    credits: 9_400,
    sourceType: "usage_charge",
    sourceBizId: "task-60s",
    idempotencyKey: "freeze:task-60s:video",
    taskId: "task-60s",
    featureCode: "video_generation_60s",
  });

  const released = ledger.releaseCreditFreeze({
    freezeId: frozen.freeze.freezeId,
    reason: "provider_failed",
  });

  assert.equal(released.freeze.status, "released");
  assert.equal(released.balance.availableCredits, 10_000);
  assert.equal(released.balance.frozenCredits, 0);
  assert.equal(ledger.listCreditTransactionsByUserId("user-credit-release").filter((item) => item.changeCredits < 0).length, 0);
});

test("后台可以按余额排序查看商业积分账户", async () => {
  const ledger = await loadLedger();
  ledger.grantCredits({
    userId: "user-credit-balance-list-low",
    credits: 90_000,
    sourceType: "manual_adjustment",
    idempotencyKey: "grant:balance-list-low",
  });
  ledger.grantCredits({
    userId: "user-credit-balance-list-high",
    credits: 100_000,
    sourceType: "manual_adjustment",
    idempotencyKey: "grant:balance-list-high",
  });

  const balances = ledger.listCommercialCreditBalances(2);

  assert.equal(balances.length, 2);
  assert.equal(balances[0]?.userId, "user-credit-balance-list-high");
  assert.equal(balances[1]?.userId, "user-credit-balance-list-low");
});
