"use client";

import { Globe, Lock, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const adminFeatureCards = [
  {
    title: "独立鉴权",
    description: "后台账号与用户侧完全隔离。",
    icon: Lock,
  },
  {
    title: "账号治理",
    description: "运营账号与用户状态统一维护。",
    icon: ShieldCheck,
  },
  {
    title: "操作留痕",
    description: "关键操作统一记录，便于审计。",
    icon: Sparkles,
  },
];

export function AdminLoginContent() {
  const router = useRouter();
  const [form, setForm] = useState({
    username: "",
    password: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    setIsSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/admin-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "登录失败");
      }

      router.push("/admin/system-status");
      router.refresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "登录失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-entry-shell auth-entry-shell-admin">
      <div className="auth-entry-backdrop">
        <span className="auth-entry-glow auth-entry-glow-a" />
        <span className="auth-entry-glow auth-entry-glow-c" />
        <span className="auth-entry-gridline" />
      </div>

      <div className="auth-entry-page">
        <header className="auth-entry-header">
          <div className="auth-entry-brand">
            <div className="auth-entry-brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="auth-entry-brand-copy">
              <strong>管理后台</strong>
              <span>Operations Console</span>
            </div>
          </div>

          <div className="auth-entry-header-meta">
            <span className="auth-entry-meta-pill">运营端登录</span>
          </div>
        </header>

        <section className="auth-entry-layout">
          <section className="auth-entry-stage auth-entry-stage-admin">
            <div className="auth-entry-stage-copy">
              <p className="auth-entry-stage-kicker">Admin Access</p>
              <h1 className="auth-entry-stage-title">
                登录运营后台
                <span>进入管理后台</span>
              </h1>
            </div>

            <div className="auth-entry-feature-grid compact">
              {adminFeatureCards.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="auth-entry-feature-card compact">
                    <div className="auth-entry-feature-icon">
                      <Icon size={15} strokeWidth={2.1} />
                    </div>
                    <div className="auth-entry-feature-copy">
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="auth-entry-card auth-entry-card-admin">
            <div className="auth-entry-card-panel compact">
              <div className="auth-entry-card-head compact">
                <div>
                  <p className="auth-entry-card-kicker">欢迎回来</p>
                  <h2>登录管理后台</h2>
                </div>
                <div className="auth-entry-card-mark" aria-hidden="true">
                  <Globe size={18} strokeWidth={2.2} />
                </div>
              </div>

              <div className="auth-entry-feedback-slot" aria-live="polite">
                {error ? <div className="auth-banner error">{error}</div> : null}
              </div>

              <div className="auth-entry-form-stack compact">
                <label className="setting-field wide">
                  <span>运营账号</span>
                  <input
                    className="setting-input"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={form.username}
                    onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="请输入运营账号"
                  />
                </label>
                <label className="setting-field wide">
                  <span>密码</span>
                  <input
                    className="setting-input"
                    type="password"
                    autoComplete="current-password"
                    value={form.password}
                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="请输入密码"
                  />
                </label>
                <button
                  type="button"
                  className="auth-entry-submit-button auth-entry-submit-button-admin"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "登录中..." : "进入后台"}
                </button>
              </div>

              <div className="auth-entry-link-row compact">
                <span>返回工作台</span>
                <Link href="/login">用户侧登录</Link>
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
