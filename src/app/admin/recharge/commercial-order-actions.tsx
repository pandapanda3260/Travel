"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CommercialOrderPayload = {
  orderId: string;
  userId: string;
  productName: string;
  amountRmb: number;
  credits: number;
  status: string;
};

function formatCredits(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatMoney(value: number) {
  return `¥${new Intl.NumberFormat("zh-CN").format(value)}`;
}

function formatOrderStatus(status: string) {
  switch (status) {
    case "pending_payment":
      return "待确认";
    case "paid":
      return "已支付";
    case "fulfilled":
      return "已到账";
    case "refunded":
      return "已退款";
    case "closed":
      return "已关闭";
    default:
      return status;
  }
}

function canFulfill(status: string) {
  return status === "pending_payment" || status === "paid";
}

function buildFulfillIdempotencyKey(orderId: string) {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `order:fulfill:admin:${orderId}:${randomPart}`;
}

export function CommercialAdminOrderActions({ initialOrders }: { initialOrders: CommercialOrderPayload[] }) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fulfillOrder(orderId: string) {
    setBusyOrderId(orderId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/commercial/orders/${orderId}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: buildFulfillIdempotencyKey(orderId) }),
      });
      const payload = (await response.json().catch(() => null)) as { order?: CommercialOrderPayload; error?: string } | null;
      if (!response.ok || !payload?.order) {
        throw new Error(payload?.error ?? "订单确认失败。");
      }

      setOrders((current) => current.map((item) => (item.orderId === orderId ? payload.order! : item)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "订单确认失败。");
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <div className="admin-data-stack">
      {error ? <div className="commercial-order-notice error">{error}</div> : null}
      {orders.map((order) => (
        <div key={order.orderId} className="admin-data-grid commercial-admin-order-grid">
          <strong>{order.userId}</strong>
          <span>{order.productName}</span>
          <span>{formatMoney(order.amountRmb)}</span>
          <span>{formatCredits(order.credits)}</span>
          <span>{formatOrderStatus(order.status)}</span>
          <button
            type="button"
            className="btn-soft commercial-admin-order-button"
            disabled={!canFulfill(order.status) || busyOrderId === order.orderId}
            onClick={() => void fulfillOrder(order.orderId)}
          >
            {busyOrderId === order.orderId ? "处理中" : canFulfill(order.status) ? "确认到账" : "完成"}
          </button>
        </div>
      ))}
      {orders.length === 0 ? <div className="auth-empty-state">暂无商业订单</div> : null}
    </div>
  );
}
