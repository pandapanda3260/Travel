"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { getModelUsageAdminSnapshot } from "../../../lib/model-usage-service";

type ApiUsageSnapshot = ReturnType<typeof getModelUsageAdminSnapshot>;
type PricingRule = ApiUsageSnapshot["pricingRules"][number];

type ConfigForm = {
  billingEnabled: boolean;
  strictModeEnabled: boolean;
  requirePricingRule: boolean;
  enforceSufficientBalance: boolean;
  minimumBalancePoints: string;
  dailyUserPointLimit: string;
  pointsPerRmb: string;
  usdToCnyRate: string;
};

type MeterForm = {
  meter: string;
  unitSize: string;
  unitPrice: string;
  currency: string;
};

type TokenTierForm = {
  maxInputTokens: string;
  inputPricePerKTokens: string;
  outputPricePerKTokens: string;
  cachedInputPricePerKTokens: string;
  currency: string;
};

type RuleForm = {
  label: string;
  serviceName: string;
  provider: string;
  modelId: string;
  enabled: boolean;
  source: string;
  notes: string;
  meters: MeterForm[];
  tokenTiers: TokenTierForm[];
};

function toConfigForm(snapshot: ApiUsageSnapshot): ConfigForm {
  return {
    billingEnabled: snapshot.billingConfig.billingEnabled,
    strictModeEnabled: snapshot.billingConfig.strictModeEnabled,
    requirePricingRule: snapshot.billingConfig.requirePricingRule,
    enforceSufficientBalance: snapshot.billingConfig.enforceSufficientBalance,
    minimumBalancePoints: String(snapshot.billingConfig.minimumBalancePoints),
    dailyUserPointLimit: snapshot.billingConfig.dailyUserPointLimit === null ? "" : String(snapshot.billingConfig.dailyUserPointLimit),
    pointsPerRmb: String(snapshot.billingConfig.pointsPerRmb),
    usdToCnyRate: String(snapshot.billingConfig.usdToCnyRate),
  };
}

function toRuleForm(rule: PricingRule): RuleForm {
  return {
    label: rule.label,
    serviceName: rule.serviceName,
    provider: rule.provider,
    modelId: rule.modelId ?? "",
    enabled: rule.enabled,
    source: rule.source,
    notes: rule.notes,
    meters: rule.meters.map((item) => ({
      meter: item.meter,
      unitSize: String(item.unitSize),
      unitPrice: String(item.unitPrice),
      currency: item.currency,
    })),
    tokenTiers: rule.tokenTiers.map((item) => ({
      maxInputTokens: item.maxInputTokens === null ? "" : String(item.maxInputTokens),
      inputPricePerKTokens: String(item.inputPricePerKTokens),
      outputPricePerKTokens: String(item.outputPricePerKTokens),
      cachedInputPricePerKTokens: String(item.cachedInputPricePerKTokens ?? 0),
      currency: item.currency,
    })),
  };
}

function formatPricingSource(source: string) {
  switch (source) {
    case "official":
      return "官方";
    case "official_archived":
      return "官方历史刊例";
    case "official_product":
      return "官方产品页";
    case "manual":
      return "人工维护";
    case "inferred":
      return "推断值";
    default:
      return source;
  }
}

async function parseApiResponse(response: Response) {
  const data = (await response.json()) as { snapshot?: ApiUsageSnapshot; error?: string };
  if (!response.ok || !data.snapshot) {
    throw new Error(data.error ?? "保存失败");
  }
  return data.snapshot;
}

export function ApiUsageAdminControls({ initialSnapshot }: { initialSnapshot: ApiUsageSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [configForm, setConfigForm] = useState(() => toConfigForm(initialSnapshot));
  const riskyRules = useMemo(
    () => snapshot.pricingRules.filter((item) => !item.enabled || item.source === "inferred"),
    [snapshot.pricingRules],
  );
  const initialRuleKey = riskyRules[0]?.pricingKey ?? snapshot.pricingRules[0]?.pricingKey ?? "";
  const [selectedRuleKey, setSelectedRuleKey] = useState(initialRuleKey);
  const selectedRule = snapshot.pricingRules.find((item) => item.pricingKey === selectedRuleKey) ?? snapshot.pricingRules[0] ?? null;
  const [ruleForm, setRuleForm] = useState<RuleForm | null>(() => (selectedRule ? toRuleForm(selectedRule) : null));
  const [pendingAction, setPendingAction] = useState<"config" | "rule" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedRule) {
      setRuleForm(toRuleForm(selectedRule));
    }
  }, [selectedRule]);

  async function refreshFromSnapshot(nextSnapshot: ApiUsageSnapshot, nextMessage: string) {
    setSnapshot(nextSnapshot);
    setConfigForm(toConfigForm(nextSnapshot));
    setMessage(nextMessage);
    setError(null);
    router.refresh();
  }

  async function submitConfig() {
    setPendingAction("config");
    try {
      const response = await fetch("/api/admin/model-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_config",
          billingEnabled: configForm.billingEnabled,
          strictModeEnabled: configForm.strictModeEnabled,
          requirePricingRule: configForm.requirePricingRule,
          enforceSufficientBalance: configForm.enforceSufficientBalance,
          minimumBalancePoints: Number(configForm.minimumBalancePoints || 0),
          dailyUserPointLimit: configForm.dailyUserPointLimit.trim() ? Number(configForm.dailyUserPointLimit) : null,
          pointsPerRmb: Number(configForm.pointsPerRmb || 0),
          usdToCnyRate: Number(configForm.usdToCnyRate || 0),
        }),
      });
      await refreshFromSnapshot(await parseApiResponse(response), "计费风控配置已保存。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "计费风控配置保存失败。");
      setMessage(null);
    } finally {
      setPendingAction(null);
    }
  }

  async function submitRule() {
    if (!selectedRule || !ruleForm) {
      return;
    }
    setPendingAction("rule");
    try {
      const response = await fetch("/api/admin/model-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_pricing_rule",
          pricingKey: selectedRule.pricingKey,
          label: ruleForm.label,
          serviceName: ruleForm.serviceName,
          provider: ruleForm.provider,
          modelId: ruleForm.modelId.trim() || null,
          enabled: ruleForm.enabled,
          source: ruleForm.source,
          notes: ruleForm.notes,
          meters: ruleForm.meters.map((item) => ({
            meter: item.meter,
            unitSize: Number(item.unitSize || 0),
            unitPrice: Number(item.unitPrice || 0),
            currency: item.currency,
          })),
          tokenTiers: ruleForm.tokenTiers.map((item) => ({
            maxInputTokens: item.maxInputTokens.trim() ? Number(item.maxInputTokens) : null,
            inputPricePerKTokens: Number(item.inputPricePerKTokens || 0),
            outputPricePerKTokens: Number(item.outputPricePerKTokens || 0),
            cachedInputPricePerKTokens: Number(item.cachedInputPricePerKTokens || 0),
            currency: item.currency,
          })),
        }),
      });
      await refreshFromSnapshot(await parseApiResponse(response), "定价规则已保存。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "定价规则保存失败。");
      setMessage(null);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="admin-billing-control-grid">
      <article className="panel admin-billing-control-panel">
        <div className="panel-header compact">
          <div>
            <h3>计费风控配置</h3>
            <p className="admin-panel-desc">可按业务需要单独开启或关闭严格模式、定价必填、余额拦截和每日限额。</p>
          </div>
        </div>
        <div className="admin-billing-form-grid">
          <label className="setting-field">
            <span>计费状态</span>
            <select
              className="setting-select"
              value={configForm.billingEnabled ? "1" : "0"}
              onChange={(event) => setConfigForm((current) => ({ ...current, billingEnabled: event.target.value === "1" }))}
            >
              <option value="1">开启</option>
              <option value="0">关闭</option>
            </select>
          </label>
          <label className="setting-field">
            <span>严格模式</span>
            <select
              className="setting-select"
              value={configForm.strictModeEnabled ? "1" : "0"}
              onChange={(event) => setConfigForm((current) => ({ ...current, strictModeEnabled: event.target.value === "1" }))}
            >
              <option value="1">开启</option>
              <option value="0">关闭</option>
            </select>
          </label>
          <label className="setting-field">
            <span>定价必填</span>
            <select
              className="setting-select"
              value={configForm.requirePricingRule ? "1" : "0"}
              onChange={(event) => setConfigForm((current) => ({ ...current, requirePricingRule: event.target.value === "1" }))}
            >
              <option value="1">开启</option>
              <option value="0">关闭</option>
            </select>
          </label>
          <label className="setting-field">
            <span>余额拦截</span>
            <select
              className="setting-select"
              value={configForm.enforceSufficientBalance ? "1" : "0"}
              onChange={(event) =>
                setConfigForm((current) => ({ ...current, enforceSufficientBalance: event.target.value === "1" }))
              }
            >
              <option value="1">开启</option>
              <option value="0">关闭</option>
            </select>
          </label>
          <label className="setting-field">
            <span>最低余额</span>
            <input
              className="setting-input"
              type="number"
              min="0"
              value={configForm.minimumBalancePoints}
              onChange={(event) => setConfigForm((current) => ({ ...current, minimumBalancePoints: event.target.value }))}
            />
          </label>
          <label className="setting-field">
            <span>每日限额</span>
            <input
              className="setting-input"
              type="number"
              min="0"
              placeholder="不限"
              value={configForm.dailyUserPointLimit}
              onChange={(event) => setConfigForm((current) => ({ ...current, dailyUserPointLimit: event.target.value }))}
            />
          </label>
          <label className="setting-field">
            <span>积分/元</span>
            <input
              className="setting-input"
              type="number"
              min="1"
              value={configForm.pointsPerRmb}
              onChange={(event) => setConfigForm((current) => ({ ...current, pointsPerRmb: event.target.value }))}
            />
          </label>
          <label className="setting-field">
            <span>美元汇率</span>
            <input
              className="setting-input"
              type="number"
              min="0"
              step="0.01"
              value={configForm.usdToCnyRate}
              onChange={(event) => setConfigForm((current) => ({ ...current, usdToCnyRate: event.target.value }))}
            />
          </label>
        </div>
        <div className="admin-billing-actions">
          <button type="button" className="auth-submit-button" disabled={pendingAction === "config"} onClick={() => void submitConfig()}>
            {pendingAction === "config" ? "保存中..." : "保存风控配置"}
          </button>
        </div>
      </article>

      <article className="panel admin-billing-control-panel">
        <div className="panel-header compact">
          <div>
            <h3>定价规则编辑</h3>
            <p className="admin-panel-desc">未启用或推断价规则会优先出现在选择器里。</p>
          </div>
          <span className="table-meta">风险规则 {riskyRules.length}</span>
        </div>
        {selectedRule && ruleForm ? (
          <div className="admin-billing-rule-editor">
            <label className="setting-field wide">
              <span>规则</span>
              <select className="setting-select" value={selectedRuleKey} onChange={(event) => setSelectedRuleKey(event.target.value)}>
                {snapshot.pricingRules.map((item) => (
                  <option key={item.pricingKey} value={item.pricingKey}>
                    {item.enabled ? "" : "待启用 · "}
                    {item.source === "inferred" ? "推断价 · " : ""}
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="admin-billing-form-grid">
              <label className="setting-field">
                <span>名称</span>
                <input
                  className="setting-input"
                  value={ruleForm.label}
                  onChange={(event) => setRuleForm((current) => (current ? { ...current, label: event.target.value } : current))}
                />
              </label>
              <label className="setting-field">
                <span>服务</span>
                <input
                  className="setting-input"
                  value={ruleForm.serviceName}
                  onChange={(event) => setRuleForm((current) => (current ? { ...current, serviceName: event.target.value } : current))}
                />
              </label>
              <label className="setting-field">
                <span>供应商</span>
                <input
                  className="setting-input"
                  value={ruleForm.provider}
                  onChange={(event) => setRuleForm((current) => (current ? { ...current, provider: event.target.value } : current))}
                />
              </label>
              <label className="setting-field">
                <span>模型 ID</span>
                <input
                  className="setting-input"
                  value={ruleForm.modelId}
                  onChange={(event) => setRuleForm((current) => (current ? { ...current, modelId: event.target.value } : current))}
                />
              </label>
              <label className="setting-field">
                <span>状态</span>
                <select
                  className="setting-select"
                  value={ruleForm.enabled ? "1" : "0"}
                  onChange={(event) => setRuleForm((current) => (current ? { ...current, enabled: event.target.value === "1" } : current))}
                >
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </select>
              </label>
              <label className="setting-field">
                <span>来源</span>
                <select
                  className="setting-select"
                  value={ruleForm.source}
                  onChange={(event) => setRuleForm((current) => (current ? { ...current, source: event.target.value } : current))}
                >
                  {["official", "official_archived", "official_product", "manual", "inferred"].map((source) => (
                    <option key={source} value={source}>
                      {formatPricingSource(source)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="admin-billing-meter-stack">
              {selectedRule.billingMode === "metered"
                ? ruleForm.meters.map((item, index) => (
                    <div key={`${item.meter}-${index}`} className="admin-billing-meter-grid">
                      <strong>{item.meter}</strong>
                      <input
                        className="setting-input"
                        type="number"
                        min="0"
                        value={item.unitSize}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  meters: current.meters.map((meter, meterIndex) =>
                                    meterIndex === index ? { ...meter, unitSize: event.target.value } : meter,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                      <input
                        className="setting-input"
                        type="number"
                        min="0"
                        step="0.000001"
                        value={item.unitPrice}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  meters: current.meters.map((meter, meterIndex) =>
                                    meterIndex === index ? { ...meter, unitPrice: event.target.value } : meter,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                      <select
                        className="setting-select"
                        value={item.currency}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  meters: current.meters.map((meter, meterIndex) =>
                                    meterIndex === index ? { ...meter, currency: event.target.value } : meter,
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        <option value="CNY">CNY</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  ))
                : ruleForm.tokenTiers.map((item, index) => (
                    <div key={`tier-${index}`} className="admin-billing-tier-grid">
                      <input
                        className="setting-input"
                        placeholder="上限为空"
                        value={item.maxInputTokens}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  tokenTiers: current.tokenTiers.map((tier, tierIndex) =>
                                    tierIndex === index ? { ...tier, maxInputTokens: event.target.value } : tier,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                      <input
                        className="setting-input"
                        value={item.inputPricePerKTokens}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  tokenTiers: current.tokenTiers.map((tier, tierIndex) =>
                                    tierIndex === index ? { ...tier, inputPricePerKTokens: event.target.value } : tier,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                      <input
                        className="setting-input"
                        value={item.outputPricePerKTokens}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  tokenTiers: current.tokenTiers.map((tier, tierIndex) =>
                                    tierIndex === index ? { ...tier, outputPricePerKTokens: event.target.value } : tier,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                      <input
                        className="setting-input"
                        value={item.cachedInputPricePerKTokens}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  tokenTiers: current.tokenTiers.map((tier, tierIndex) =>
                                    tierIndex === index ? { ...tier, cachedInputPricePerKTokens: event.target.value } : tier,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                    </div>
                  ))}
            </div>
            <label className="setting-field wide">
              <span>备注</span>
              <textarea
                className="setting-input admin-billing-notes"
                value={ruleForm.notes}
                onChange={(event) => setRuleForm((current) => (current ? { ...current, notes: event.target.value } : current))}
              />
            </label>
            <div className="admin-billing-actions">
              <button type="button" className="auth-submit-button" disabled={pendingAction === "rule"} onClick={() => void submitRule()}>
                {pendingAction === "rule" ? "保存中..." : "保存定价规则"}
              </button>
            </div>
          </div>
        ) : (
          <div className="auth-empty-state">暂无定价规则</div>
        )}
        {message ? <div className="admin-billing-message success">{message}</div> : null}
        {error ? <div className="admin-billing-message error">{error}</div> : null}
      </article>
    </section>
  );
}
