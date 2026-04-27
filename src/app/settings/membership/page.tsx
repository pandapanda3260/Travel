import { PageBrandTitle } from "../../_components/page-brand-title";
import { formatDateTime } from "../../../lib/auth-display";
import { requireUserPageSession } from "../../../lib/auth-session";
import { getMemberCenterPayload, isMemberCenterEnabled } from "../../../lib/member-service";

export const dynamic = "force-dynamic";

function formatMemberStatus(status: string) {
  switch (status) {
    case "active":
      return "正常";
    case "grace":
      return "观察期";
    case "frozen":
      return "冻结";
    case "merged":
      return "已合并";
    default:
      return status;
  }
}

const pointsSettledBenefitKeys = new Set([
  "daily_video_tasks",
  "video_material_limit",
  "product_archive_limit",
  "voice_clone_limit",
]);

function formatBenefitValue(value: string | number | boolean, unit: string | null, benefitKey?: string) {
  if (benefitKey && pointsSettledBenefitKeys.has(benefitKey)) {
    return "按积分结算";
  }
  if (typeof value === "boolean") {
    return value ? "已启用" : "未启用";
  }
  if (value === "unlimited") {
    return "按积分结算";
  }
  if (typeof value === "string" && unit) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return value;
    }
  }
  if (unit) {
    return `${value}${unit}`;
  }
  return String(value);
}

export default async function MembershipPage() {
  const session = await requireUserPageSession();

  if (!isMemberCenterEnabled()) {
    return (
      <main className="shell">
        <section className="content member-center-page">
          <section className="panel member-empty-panel">会员中心暂未开放。</section>
        </section>
      </main>
    );
  }
  const payload = getMemberCenterPayload(session.userId);

  if (!payload) {
    return (
      <main className="shell">
        <section className="content member-center-page">
          <section className="panel member-empty-panel">会员信息加载失败，请稍后重试。</section>
        </section>
      </main>
    );
  }

  const {
    user,
    profile,
    level,
    levels,
    nextLevel,
    benefits,
    growthRules,
    pointRules,
    pointsAccount,
    growthRecords,
    pointRecords,
    levelChanges,
    grantedBenefits,
  } = payload;

  return (
    <main className="shell">
      <section className="content member-center-page">
        <section className="header-panel member-header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="Membership Center" />
            </div>
          </header>
        </section>

        <section className="member-hero panel">
          <div className="member-hero-main">
            <div className="member-hero-copy-stack">
              <h2>
                {level.levelCode} {level.name}
              </h2>
              <p className="member-hero-copy">
                {user.nickname}
                {user.certificationLabel ? ` · ${user.certificationLabel}` : ""}
                {user.maskedPhone ? ` · ${user.maskedPhone}` : ""}
              </p>
            </div>
            <div className="member-pill-row">
              <span className="member-pill accent">{formatMemberStatus(profile.memberStatus)}</span>
              <span className="member-pill">{level.badgeLabel}</span>
            </div>
          </div>

          <div className="member-stat-grid">
            <article className="member-stat-card">
              <span>当前成长值</span>
              <strong>{profile.effectiveGrowthValue}</strong>
              <p>累计 {profile.lifetimeGrowthValue}</p>
            </article>
            <article className="member-stat-card">
              <span>当前积分</span>
              <strong>{pointsAccount?.availablePoints ?? 0}</strong>
              <p>累计 {pointsAccount?.lifetimePoints ?? 0}</p>
            </article>
            <article className="member-stat-card">
              <span>下一等级</span>
              <strong>{nextLevel ? `${nextLevel.levelCode} ${nextLevel.name}` : "已满级"}</strong>
              <p>{nextLevel ? `还差 ${profile.nextLevelGap} 成长值` : "当前已是最高等级"}</p>
            </article>
            <article className="member-stat-card">
              <span>观察期</span>
              <strong>{profile.graceExpireAt ? formatDateTime(profile.graceExpireAt) : "正常"}</strong>
              <p>{profile.memberStatus === "grace" ? "需补足保级成长值" : level.description}</p>
            </article>
          </div>
        </section>

        <section className="member-card-grid">
          <article className="panel member-surface">
            <div className="panel-header compact">
              <h3>当前权益</h3>
              <span className="table-meta">{benefits.length} 项</span>
            </div>
            <div className="member-benefit-grid">
              {benefits.map((benefit) => (
                <div key={benefit.benefitKey} className="member-benefit-card">
                  <div className="member-benefit-head">
                    <strong>{benefit.name}</strong>
                    <span>{benefit.sourceType === "grant" ? "发放" : "等级"}</span>
                  </div>
                  <b>{formatBenefitValue(benefit.value, benefit.unit, benefit.benefitKey)}</b>
                </div>
              ))}
            </div>
          </article>

          <article className="panel member-surface">
            <div className="panel-header compact">
              <h3>成长与积分</h3>
            </div>
            <div className="member-rule-stack">
              <div className="member-section-head">
                <strong>成长规则</strong>
                <span>{growthRules.length} 项</span>
              </div>
              <div className="member-rule-list">
                {growthRules.map((rule) => (
                  <div key={rule.ruleCode} className="member-rule-item">
                    <div>
                      <strong>{rule.name}</strong>
                      <span>{rule.description}</span>
                    </div>
                    <b>+{rule.growthValue}</b>
                  </div>
                ))}
              </div>
              <div className="member-section-head">
                <strong>积分规则</strong>
                <span>{pointRules.length} 项</span>
              </div>
              <div className="member-rule-list">
                {pointRules.map((rule) => (
                  <div key={rule.ruleCode} className="member-rule-item">
                    <div>
                      <strong>{rule.name}</strong>
                      <span>{rule.description}</span>
                    </div>
                    <b>+{rule.pointValue}</b>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </section>

        <section className="member-card-grid">
          <article className="panel member-surface">
            <div className="panel-header compact">
              <h3>成长流水</h3>
            </div>
            <div className="member-record-list">
              {growthRecords.map((record) => (
                <div key={record.growthId} className="member-record-item">
                  <div>
                    <strong>{record.remark || record.eventType}</strong>
                    <span>
                      {formatDateTime(record.createdAt)}
                      {record.expireAt ? ` · ${formatDateTime(record.expireAt)} 到期` : ""}
                    </span>
                  </div>
                  <b className={record.effectiveValue >= 0 ? "positive" : "negative"}>
                    {record.effectiveValue >= 0 ? "+" : ""}
                    {record.effectiveValue}
                  </b>
                </div>
              ))}
              {growthRecords.length === 0 ? <div className="member-empty-inline">暂无成长记录</div> : null}
            </div>
          </article>

          <article id="points-records" className="panel member-surface" style={{ scrollMarginTop: 96 }}>
            <div className="panel-header compact">
              <h3>积分流水</h3>
            </div>
            <div className="member-record-list">
              {pointRecords.map((record) => (
                <div key={record.pointId} className="member-record-item">
                  <div>
                    <strong>{record.remark || record.eventType}</strong>
                    <span>
                      {formatDateTime(record.createdAt)}
                      {record.expireAt ? ` · ${formatDateTime(record.expireAt)} 到期` : ""}
                    </span>
                  </div>
                  <b className={record.changeValue >= 0 ? "positive" : "negative"}>
                    {record.changeValue >= 0 ? "+" : ""}
                    {record.changeValue}
                  </b>
                </div>
              ))}
              {pointRecords.length === 0 ? <div className="member-empty-inline">暂无积分记录</div> : null}
            </div>
          </article>
        </section>

        <section className="member-card-grid">
          <article className="panel member-surface">
            <div className="panel-header compact">
              <h3>等级与补发</h3>
            </div>
            <div className="member-record-list">
              {levelChanges.map((change) => (
                <div key={change.changeId} className="member-record-item">
                  <div>
                    <strong>
                      {change.fromLevelCode ?? "初始化"} → {change.toLevelCode}
                    </strong>
                    <span>{formatDateTime(change.createdAt)}</span>
                  </div>
                  <b>{change.reasonDetail}</b>
                </div>
              ))}
              {grantedBenefits.slice(0, 4).map((grant) => (
                <div key={grant.grantId} className="member-record-item subtle">
                  <div>
                    <strong>{grant.benefitName}</strong>
                    <span>
                      {formatDateTime(grant.startAt)}
                      {grant.expireAt ? ` · ${formatDateTime(grant.expireAt)} 失效` : ""}
                    </span>
                  </div>
                  <b>{grant.benefitValue}</b>
                </div>
              ))}
              {levelChanges.length === 0 && grantedBenefits.length === 0 ? (
                <div className="member-empty-inline">暂无等级变更和额外权益记录</div>
              ) : null}
            </div>
          </article>

          <article className="panel member-surface">
            <div className="panel-header compact">
              <h3>等级门槛</h3>
            </div>
            <div className="member-rule-list">
              {levels.map((item) => (
                <div key={item.levelCode} className="member-rule-item">
                  <div>
                    <strong>
                      {item.levelCode} {item.name}
                    </strong>
                    <span>保级 {item.retainThreshold}</span>
                  </div>
                  <b>{item.upgradeThreshold}</b>
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
