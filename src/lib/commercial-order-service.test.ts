import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "travel-commercial-order-service-"));

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
}> | null = null;

function loadModules() {
  modulesPromise ??= Promise.all([import("./commercial-credit-ledger"), import("./commercial-order-service")]).then(
    ([ledger, orderService]) => ({ ledger, orderService }),
  );
  return modulesPromise;
}

test("会员订单履约会开通当前会员并发放当期积分", async () => {
  const { ledger, orderService } = await loadModules();
  const created = orderService.createCommercialOrder({
    userId: "user-order-member",
    productCode: "travel_light_monthly",
    idempotencyKey: "order:create:member",
  });

  const fulfilled = orderService.fulfillCommercialOrder({
    orderId: created.order.orderId,
    idempotencyKey: "order:fulfill:member",
    operatorId: "admin-001",
  });

  const membership = orderService.getUserCommercialMembership("user-order-member");
  const balance = ledger.getCommercialCreditBalance("user-order-member");

  assert.equal(fulfilled.order.status, "fulfilled");
  assert.equal(membership?.planCode, "travel_light_monthly");
  assert.equal(membership?.status, "active");
  assert.equal(balance.availableCredits, 10_000);
});

test("重复订单创建和重复履约不会重复到账", async () => {
  const { ledger, orderService } = await loadModules();
  const first = orderService.createCommercialOrder({
    userId: "user-order-idempotent",
    productCode: "travel_standard_monthly",
    idempotencyKey: "order:create:idempotent",
  });
  const second = orderService.createCommercialOrder({
    userId: "user-order-idempotent",
    productCode: "travel_standard_monthly",
    idempotencyKey: "order:create:idempotent",
  });

  const firstFulfilled = orderService.fulfillCommercialOrder({
    orderId: first.order.orderId,
    idempotencyKey: "order:fulfill:idempotent",
  });
  const secondFulfilled = orderService.fulfillCommercialOrder({
    orderId: second.order.orderId,
    idempotencyKey: "order:fulfill:idempotent",
  });

  const balance = ledger.getCommercialCreditBalance("user-order-idempotent");

  assert.equal(second.order.orderId, first.order.orderId);
  assert.equal(secondFulfilled.order.orderId, firstFulfilled.order.orderId);
  assert.equal(balance.availableCredits, 102_000);
});

test("积分包订单只增加积分不改变会员", async () => {
  const { ledger, orderService } = await loadModules();
  const created = orderService.createCommercialOrder({
    userId: "user-order-pack",
    productCode: "monthly_standard_pack",
    idempotencyKey: "order:create:pack",
  });
  orderService.fulfillCommercialOrder({
    orderId: created.order.orderId,
    idempotencyKey: "order:fulfill:pack",
  });

  const balance = ledger.getCommercialCreditBalance("user-order-pack");
  const membership = orderService.getUserCommercialMembership("user-order-pack");

  assert.equal(balance.availableCredits, 45_000);
  assert.equal(membership, null);
});
