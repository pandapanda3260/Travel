"use client";

import { Clapperboard, KeyRound, Map, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

type LoginTab = "password" | "sms" | "register" | "reset";

type LoginContentProps = {
  passwordRuleText: string;
};

const workbenchFeatureCards = [
  {
    title: "手机号主体",
    description: "手机号是唯一账号主体，昵称与密码可随时维护。",
    icon: ShieldCheck,
  },
  {
    title: "双通道登录",
    description: "支持手机号密码与短信验证码，两种方式都能快速进入。",
    icon: KeyRound,
  },
  {
    title: "攻略内容生成",
    description: "围绕目的地、路线与卖点，继续推进脚本和镜头规划。",
    icon: Map,
  },
  {
    title: "素材成片协同",
    description: "图片、音频、片段与成片集中管理，创作链路更顺手。",
    icon: Clapperboard,
  },
];

export function LoginContent({ passwordRuleText }: LoginContentProps) {
  const [tab, setTab] = useState<LoginTab>("password");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({ phone: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ nickname: "", phone: "", password: "" });
  const [smsForm, setSmsForm] = useState({ phone: "", code: "" });
  const [resetForm, setResetForm] = useState({ phone: "", code: "", password: "" });
  const isPasswordTab = tab === "password";
  const isSmsTab = tab === "sms";
  const isRegisterTab = tab === "register";
  const isResetTab = tab === "reset";

  useEffect(() => {
    if (countdown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((value) => value - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  async function handleJsonRequest(url: string, payload: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      debugCode?: string | null;
    };
    if (!response.ok) {
      throw new Error(data.error || "请求失败");
    }
    return data;
  }

  async function ensureUserSessionReady() {
    const response = await fetch("/api/auth/session?mode=probe", {
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as {
      authenticated?: boolean;
    };

    if (!response.ok || !data.authenticated) {
      throw new Error("登录态校验失败，请确认使用同一个访问地址登录（不要混用 localhost 与 127.0.0.1）后重试。");
    }
  }

  async function finishAuthenticatedNavigation(nextPath: string, readyMessage: string) {
    setSuccess("登录成功，正在校验登录状态...");
    await ensureUserSessionReady();
    setSuccess(readyMessage);
    window.location.assign(nextPath);
  }

  async function handlePasswordLogin() {
    setError("");
    setSuccess("");
    setDebugCode(null);
    setIsSubmitting(true);
    try {
      await handleJsonRequest("/api/auth/login/password", {
        phone: passwordForm.phone.trim(),
        password: passwordForm.password,
      });
      await finishAuthenticatedNavigation("/overview", "登录成功，正在进入工作台...");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "登录失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegister() {
    setError("");
    setSuccess("");
    setDebugCode(null);
    setIsSubmitting(true);
    try {
      await handleJsonRequest("/api/auth/register", {
        nickname: registerForm.nickname.trim(),
        phone: registerForm.phone.trim(),
        password: registerForm.password,
      });
      await finishAuthenticatedNavigation("/overview", "注册成功，正在进入工作台...");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "注册失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSendSmsCode(input: { phone: string; purpose: "login" | "reset_password" }) {
    setError("");
    setSuccess("");
    setDebugCode(null);
    setIsSendingCode(true);
    try {
      const data = (await handleJsonRequest("/api/auth/sms/send", {
        phone: input.phone.trim(),
        purpose: input.purpose,
      })) as { debugCode?: string | null };
      setSuccess("验证码已发送。");
      setDebugCode(data.debugCode ?? null);
      setCountdown(60);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "验证码发送失败");
    } finally {
      setIsSendingCode(false);
    }
  }

  async function handleSmsLogin() {
    setError("");
    setSuccess("");
    setIsSubmitting(true);
    try {
      await handleJsonRequest("/api/auth/login/sms", {
        phone: smsForm.phone.trim(),
        code: smsForm.code.trim(),
      });
      await finishAuthenticatedNavigation("/overview", "登录成功，正在进入工作台...");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "登录失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword() {
    setError("");
    setSuccess("");
    setDebugCode(null);
    setIsSubmitting(true);
    try {
      await handleJsonRequest("/api/auth/password/reset", {
        phone: resetForm.phone.trim(),
        code: resetForm.code.trim(),
        password: resetForm.password,
      });
      await finishAuthenticatedNavigation("/settings/account", "密码已重置，正在进入账号安全页...");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "重置密码失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-entry-shell">
      <div className="auth-entry-backdrop">
        <span className="auth-entry-glow auth-entry-glow-a" />
        <span className="auth-entry-glow auth-entry-glow-b" />
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
              <strong>Hi Traveler 工作台</strong>
              <span>Travel Visual Content Creation</span>
            </div>
          </div>
        </header>

        <section className="auth-entry-layout">
          <section className="auth-entry-stage">
            <div className="auth-entry-stage-copy">
              <p className="auth-entry-stage-kicker">Hi Traveler</p>
              <h1 className="auth-entry-stage-title">
                旅行内容创作
                <span>从灵感直达成片</span>
              </h1>
              <p className="auth-entry-stage-desc">
                围绕目的地、玩法、路线与卖点，快速组织脚本、镜头、画面和配音，自动生成视频。
              </p>
            </div>

            <div className="auth-entry-feature-grid compact">
              {workbenchFeatureCards.map((item) => {
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

          <section className="auth-entry-card">
            <div className="auth-entry-card-panel compact">
              <div className="auth-entry-card-head compact">
                <div>
                  <p className="auth-entry-card-kicker">欢迎回来</p>
                  <h2>登录工作台</h2>
                </div>
              </div>

              <div className="auth-entry-tab-row compact">
                <button
                  type="button"
                  className={`auth-entry-tab ${tab === "password" ? "active" : ""}`}
                  onClick={() => setTab("password")}
                >
                  密码登录
                </button>
                <button
                  type="button"
                  className={`auth-entry-tab ${tab === "sms" ? "active" : ""}`}
                  onClick={() => setTab("sms")}
                >
                  验证码登录
                </button>
                <button
                  type="button"
                  className={`auth-entry-tab ${tab === "register" ? "active" : ""}`}
                  onClick={() => setTab("register")}
                >
                  账号注册
                </button>
              </div>

              <div className="auth-entry-feedback-slot" aria-live="polite">
                {success ? <div className="auth-banner success">{success}</div> : null}
                {!success && debugCode ? <div className="auth-banner info">验证码 {debugCode}</div> : null}
              </div>

              <div className="auth-entry-tab-panels" aria-live="polite">
                <div
                  className={`auth-entry-tab-panel ${isPasswordTab ? "active" : "inactive"}`}
                  aria-hidden={!isPasswordTab}
                >
                  <div className="auth-entry-form-stack compact">
                    <label className="setting-field wide">
                      <span>手机号</span>
                      <input
                        className="setting-input"
                        autoComplete="tel"
                        inputMode="numeric"
                        disabled={!isPasswordTab}
                        value={passwordForm.phone}
                        onChange={(event) => setPasswordForm((current) => ({ ...current, phone: event.target.value }))}
                        placeholder="请输入手机号"
                      />
                    </label>
                    <label className="setting-field wide">
                      <span>密码</span>
                      <input
                        className="setting-input"
                        type="password"
                        autoComplete="current-password"
                        disabled={!isPasswordTab}
                        value={passwordForm.password}
                        onChange={(event) =>
                          setPasswordForm((current) => ({ ...current, password: event.target.value }))
                        }
                        placeholder="请输入密码"
                      />
                    </label>
                    <button
                      type="button"
                      className="auth-entry-submit-button"
                      onClick={handlePasswordLogin}
                      disabled={isSubmitting || !isPasswordTab}
                    >
                      {isSubmitting ? "登录中..." : "登录"}
                    </button>
                  </div>
                  <div className="auth-entry-panel-meta">
                    <span className="auth-entry-error-text">{error}</span>
                    <button
                      type="button"
                      className="auth-entry-link-button"
                      onClick={() => {
                        setError("");
                        setSuccess("");
                        setDebugCode(null);
                        setTab("reset");
                      }}
                    >
                      找回密码
                    </button>
                  </div>
                </div>

                <div className={`auth-entry-tab-panel ${isSmsTab ? "active" : "inactive"}`} aria-hidden={!isSmsTab}>
                  <div className="auth-entry-form-stack compact">
                    <label className="setting-field wide">
                      <span>手机号</span>
                      <input
                        className="setting-input"
                        autoComplete="tel"
                        inputMode="numeric"
                        disabled={!isSmsTab}
                        value={smsForm.phone}
                        onChange={(event) => setSmsForm((current) => ({ ...current, phone: event.target.value }))}
                        placeholder="请输入手机号"
                      />
                    </label>
                    <div className="auth-entry-inline-field compact">
                      <label className="setting-field wide">
                        <span>验证码</span>
                        <input
                          className="setting-input"
                          inputMode="numeric"
                          disabled={!isSmsTab}
                          value={smsForm.code}
                          onChange={(event) => setSmsForm((current) => ({ ...current, code: event.target.value }))}
                          placeholder="请输入验证码"
                        />
                      </label>
                      <button
                        type="button"
                        className="auth-entry-secondary-button"
                        onClick={() => handleSendSmsCode({ phone: smsForm.phone, purpose: "login" })}
                        disabled={isSendingCode || countdown > 0 || !isSmsTab}
                      >
                        {countdown > 0 ? `${countdown}s` : isSendingCode ? "发送中..." : "发送验证码"}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="auth-entry-submit-button"
                      onClick={handleSmsLogin}
                      disabled={isSubmitting || !isSmsTab}
                    >
                      {isSubmitting ? "登录中..." : "登录"}
                    </button>
                  </div>
                  <div className="auth-entry-panel-meta">
                    <span className="auth-entry-error-text">{error}</span>
                  </div>
                </div>

                <div
                  className={`auth-entry-tab-panel ${isRegisterTab ? "active" : "inactive"}`}
                  aria-hidden={!isRegisterTab}
                >
                  <div className="auth-entry-form-stack compact">
                    <label className="setting-field wide">
                      <span>昵称</span>
                      <input
                        className="setting-input"
                        autoComplete="nickname"
                        disabled={!isRegisterTab}
                        value={registerForm.nickname}
                        onChange={(event) =>
                          setRegisterForm((current) => ({ ...current, nickname: event.target.value }))
                        }
                        placeholder="请输入昵称"
                      />
                    </label>
                    <label className="setting-field wide">
                      <span>手机号</span>
                      <input
                        className="setting-input"
                        autoComplete="tel"
                        inputMode="numeric"
                        disabled={!isRegisterTab}
                        value={registerForm.phone}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, phone: event.target.value }))}
                        placeholder="请输入手机号"
                      />
                    </label>
                    <label className="setting-field wide">
                      <span>密码</span>
                      <input
                        className="setting-input"
                        type="password"
                        autoComplete="new-password"
                        disabled={!isRegisterTab}
                        value={registerForm.password}
                        onChange={(event) =>
                          setRegisterForm((current) => ({ ...current, password: event.target.value }))
                        }
                        placeholder={passwordRuleText}
                      />
                    </label>
                    <button
                      type="button"
                      className="auth-entry-submit-button"
                      onClick={handleRegister}
                      disabled={isSubmitting || !isRegisterTab}
                    >
                      {isSubmitting ? "注册中..." : "注册并登录"}
                    </button>
                  </div>
                  <div className="auth-entry-panel-meta">
                    <span className="auth-entry-error-text">{error}</span>
                  </div>
                </div>

                <div className={`auth-entry-tab-panel ${isResetTab ? "active" : "inactive"}`} aria-hidden={!isResetTab}>
                  <div className="auth-entry-form-stack compact">
                    <label className="setting-field wide">
                      <span>手机号</span>
                      <input
                        className="setting-input"
                        autoComplete="tel"
                        inputMode="numeric"
                        disabled={!isResetTab}
                        value={resetForm.phone}
                        onChange={(event) => setResetForm((current) => ({ ...current, phone: event.target.value }))}
                        placeholder="请输入已注册手机号"
                      />
                    </label>
                    <div className="auth-entry-inline-field compact">
                      <label className="setting-field wide">
                        <span>验证码</span>
                        <input
                          className="setting-input"
                          inputMode="numeric"
                          disabled={!isResetTab}
                          value={resetForm.code}
                          onChange={(event) => setResetForm((current) => ({ ...current, code: event.target.value }))}
                          placeholder="请输入验证码"
                        />
                      </label>
                      <button
                        type="button"
                        className="auth-entry-secondary-button"
                        onClick={() => handleSendSmsCode({ phone: resetForm.phone, purpose: "reset_password" })}
                        disabled={isSendingCode || countdown > 0 || !isResetTab}
                      >
                        {countdown > 0 ? `${countdown}s` : isSendingCode ? "发送中..." : "发送验证码"}
                      </button>
                    </div>
                    <label className="setting-field wide">
                      <span>新密码</span>
                      <input
                        className="setting-input"
                        type="password"
                        autoComplete="new-password"
                        disabled={!isResetTab}
                        value={resetForm.password}
                        onChange={(event) => setResetForm((current) => ({ ...current, password: event.target.value }))}
                        placeholder={passwordRuleText}
                      />
                    </label>
                    <button
                      type="button"
                      className="auth-entry-submit-button"
                      onClick={handleResetPassword}
                      disabled={isSubmitting || !isResetTab}
                    >
                      {isSubmitting ? "重置中..." : "重置并登录"}
                    </button>
                  </div>
                  <div className="auth-entry-panel-meta">
                    <span className="auth-entry-error-text">{error}</span>
                  </div>
                </div>
              </div>

              <div className="auth-entry-agreement">继续即表示同意协议与隐私。</div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
