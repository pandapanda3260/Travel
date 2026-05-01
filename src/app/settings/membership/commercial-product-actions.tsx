"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type MarginPayload = {
  grossMarginRate: number;
};

type MembershipPlanPayload = {
  code: string;
  name: string;
  originalPriceRmb: number;
  priceRmb: number;
  monthlyCredits: number;
  margin: MarginPayload;
};

type CreditPackagePayload = {
  code: string;
  name: string;
  originalPriceRmb: number;
  priceRmb: number;
  credits: number;
  validityMonths: number;
  packageKind: "monthly" | "annual";
  margin: MarginPayload;
};

type VideoPricingPayload = {
  code: string;
  name: string;
  chargedCredits: number;
  estimatedApiCostRmb: number;
  margin: MarginPayload;
};

type CommercialOrderPayload = {
  orderId: string;
  productName: string;
  amountRmb: number;
  credits: number;
  status: string;
  createdAt: string;
};

type ProductsPayload = {
  membershipPlans: MembershipPlanPayload[];
  creditPackages: CreditPackagePayload[];
  videoPricing: VideoPricingPayload[];
};

type NoticeState = {
  tone: "success" | "error";
  text: string;
} | null;

function formatCredits(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatMoney(value: number) {
  return `¥${new Intl.NumberFormat("zh-CN").format(value)}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
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

function buildClientIdempotencyKey(productCode: string) {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `order:create:web:${productCode}:${randomPart}`;
}

export function CommercialProductActions({
  products,
  initialOrders,
}: {
  products: ProductsPayload;
  initialOrders: CommercialOrderPayload[];
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [busyProductCode, setBusyProductCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);

  const monthlyPackages = useMemo(
    () => products.creditPackages.filter((item) => item.packageKind === "monthly"),
    [products.creditPackages],
  );
  const annualPackages = useMemo(
    () => products.creditPackages.filter((item) => item.packageKind === "annual"),
    [products.creditPackages],
  );

  async function createOrder(productCode: string) {
    setBusyProductCode(productCode);
    setNotice(null);
    try {
      const response = await fetch("/api/billing/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCode,
          idempotencyKey: buildClientIdempotencyKey(productCode),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { order?: CommercialOrderPayload; error?: string } | null;
      if (!response.ok || !payload?.order) {
        throw new Error(payload?.error ?? "订单创建失败，请稍后重试。");
      }

      setOrders((current) => [payload.order as CommercialOrderPayload, ...current.filter((item) => item.orderId !== payload.order?.orderId)].slice(0, 10));
      setNotice({
        tone: "success",
        text: `已生成 ${payload.order.productName} 订单，后台确认后自动到账。`,
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "订单创建失败，请稍后重试。",
      });
    } finally {
      setBusyProductCode(null);
    }
  }

  function renderBuyButton(productCode: string) {
    return (
      <button
        type="button"
        className="btn-soft commercial-buy-button"
        disabled={busyProductCode === productCode}
        onClick={() => void createOrder(productCode)}
      >
        {busyProductCode === productCode ? "生成中" : "生成订单"}
      </button>
    );
  }

  return (
    <>
      <section className="panel member-surface commercial-products-panel">
        <div className="panel-header compact">
          <h3>会员套餐</h3>
          <span className="table-meta">主套餐</span>
        </div>
        <div className="commercial-plan-grid membership">
          {products.membershipPlans.map((plan) => (
            <article key={plan.code} className="commercial-plan-card">
              <div className="commercial-plan-head">
                <span>{plan.name}</span>
                <b>{formatMoney(plan.priceRmb)}/月</b>
              </div>
              <strong>{formatCredits(plan.monthlyCredits)} 积分/月</strong>
              <p>
                原价 {formatMoney(plan.originalPriceRmb)} · 毛利 {formatPercent(plan.margin.grossMarginRate)}
              </p>
              {renderBuyButton(plan.code)}
            </article>
          ))}
        </div>
        {notice ? <div className={`commercial-order-notice ${notice.tone}`}>{notice.text}</div> : null}
      </section>

      <section className="member-card-grid settings-section-grid">
        <article className="panel member-surface commercial-products-panel">
          <div className="panel-header compact">
            <h3>月度积分包</h3>
            <span className="table-meta">当月补量</span>
          </div>
          <div className="commercial-plan-grid compact">
            {monthlyPackages.map((item) => (
              <article key={item.code} className="commercial-plan-card">
                <div className="commercial-plan-head">
                  <span>{item.name}</span>
                  <b>{formatMoney(item.priceRmb)}</b>
                </div>
                <strong>{formatCredits(item.credits)} 积分</strong>
                <p>有效期 {item.validityMonths} 个月 · 不改变会员</p>
                {renderBuyButton(item.code)}
              </article>
            ))}
          </div>
        </article>

        <article className="panel member-surface commercial-products-panel">
          <div className="panel-header compact">
            <h3>年度积分包</h3>
            <span className="table-meta">12 个月</span>
          </div>
          <div className="commercial-plan-grid compact">
            {annualPackages.map((item) => (
              <article key={item.code} className="commercial-plan-card">
                <div className="commercial-plan-head">
                  <span>{item.name}</span>
                  <b>{formatMoney(item.priceRmb)}</b>
                </div>
                <strong>{formatCredits(item.credits)} 积分</strong>
                <p>有效期 {item.validityMonths} 个月 · 不改变会员</p>
                {renderBuyButton(item.code)}
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="panel member-surface commercial-products-panel">
        <div className="panel-header compact">
          <h3>视频生成扣费</h3>
          <span className="table-meta">成功后扣费</span>
        </div>
        <div className="commercial-plan-grid video">
          {products.videoPricing.map((item) => (
            <article key={item.code} className="commercial-plan-card">
              <div className="commercial-plan-head">
                <span>{item.name}</span>
                <b>{formatCredits(item.chargedCredits)} 积分</b>
              </div>
              <strong>成本约 {formatMoney(item.estimatedApiCostRmb)}</strong>
              <p>毛利 {formatPercent(item.margin.grossMarginRate)} · 失败不扣费</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel member-surface commercial-orders-panel">
        <div className="panel-header compact">
          <h3>我的订单</h3>
          <span className="table-meta">最近 {orders.length} 条</span>
        </div>
        <div className="commercial-user-order-list">
          {orders.map((order) => (
            <div key={order.orderId} className="commercial-user-order-row">
              <div>
                <strong>{order.productName}</strong>
                <span>{new Date(order.createdAt).toLocaleString("zh-CN")}</span>
              </div>
              <b>{formatMoney(order.amountRmb)}</b>
              <span>{formatCredits(order.credits)} 积分</span>
              <em>{formatOrderStatus(order.status)}</em>
            </div>
          ))}
          {orders.length === 0 ? <div className="auth-empty-state">暂无订单</div> : null}
        </div>
      </section>
    </>
  );
}
