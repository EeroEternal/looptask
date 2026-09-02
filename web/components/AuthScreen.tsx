"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

type Props = { onAuthenticated: () => void };

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [verification, setVerification] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function changeMode(nextMode: "register" | "login") {
    const hadVerification = verification;
    setMode(nextMode);
    setVerification(false);
    setCode("");
    setMessage("");
    setError(false);
    if (hadVerification) {
      setMessage(
        nextMode === "register"
          ? "已切换到注册流程。刚才的验证码仍可继续使用，必要时可以直接重新发送。"
          : "已切换到登录流程。刚才的验证码仍可继续使用，必要时可以直接重新发送。",
      );
    }
  }

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const result = await api<{ message?: string }>(
        "/api/v1/auth/request-code",
        {
          method: "POST",
          body: JSON.stringify({ email, purpose: mode, displayName }),
        },
      );
      setVerification(true);
      setCooldown(60);
      setMessage(result.message || "验证码已发送");
    } catch (requestError) {
      setError(true);
      setMessage(
        requestError instanceof Error ? requestError.message : "请求失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await api("/api/v1/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ email, code, purpose: mode, displayName }),
      });
      onAuthenticated();
    } catch (requestError) {
      setError(true);
      setMessage(
        requestError instanceof Error ? requestError.message : "验证失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-layout">
        <section className="auth-story">
          <div>
            <Brand kicker="Loop engineering" />
            <h1 className="story-title">把重复维护，变成可控的循环。</h1>
            <p className="story-copy">
              定义边界，预览决策，交给 Agent cell 执行。每一次 loop
              都有证据、预算和明确的停止条件。
            </p>
            <div className="story-points" aria-label="Loop 工作流程">
              <StoryPoint number="01" title="先定义边界">
                项目上下文、允许路径和保护分支
              </StoryPoint>
              <StoryPoint number="02" title="再检查策略">
                阶段、闸门、预算和人工裁决点
              </StoryPoint>
              <StoryPoint number="03" title="最后交给执行">
                Agent cell 留下事件、任务与证据
              </StoryPoint>
            </div>
          </div>
          <div className="story-foot">
            <span>隔离 worktree</span>
            <span>可验证策略</span>
            <span>人工闸门</span>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-tabs" role="tablist">
            <button
              className={`auth-tab ${mode === "register" ? "active" : ""}`}
              onClick={() => changeMode("register")}
              role="tab"
              type="button"
            >
              注册
            </button>
            <button
              className={`auth-tab ${mode === "login" ? "active" : ""}`}
              onClick={() => changeMode("login")}
              role="tab"
              type="button"
            >
              登录
            </button>
          </div>
          <h1>{mode === "register" ? "创建你的工作空间" : "回到你的工作空间"}</h1>
          <p className="intro">
            {mode === "register"
              ? "用邮箱验证码确认身份，不需要额外密码。"
              : "输入注册邮箱，我们会发送一次性验证码。"}
          </p>

          {!verification ? (
            <form onSubmit={requestCode}>
              {mode === "register" && (
                <Field label="显示名称">
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="例如 Xin"
                    autoComplete="name"
                  />
                </Field>
              )}
              <Field label="邮箱地址">
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </Field>
              <button className="primary full" disabled={busy} type="submit">
                {busy ? "发送中…" : "发送验证码"}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode}>
              <p className="helper">
                验证码已发送至 <strong>{email}</strong>
              </p>
              <Field label="6 位验证码">
                <div className="code-row">
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="000000"
                    autoComplete="one-time-code"
                  />
                  <button
                    className="secondary resend"
                    disabled={busy || cooldown > 0}
                    onClick={() => void requestCode()}
                    type="button"
                  >
                    {cooldown ? `重发 ${cooldown}s` : "重新发送"}
                  </button>
                </div>
              </Field>
              <button className="primary full" disabled={busy} type="submit">
                {busy ? "确认中…" : "确认并进入"}
              </button>
              <button
                className="quiet full"
                onClick={() => setVerification(false)}
                type="button"
              >
                更换邮箱
              </button>
            </form>
          )}

          {message && (
            <div className={`alert show ${error ? "error" : ""}`} role="alert">
              {message}
            </div>
          )}
          <p className="helper auth-disclaimer">
            继续即表示你同意以安全方式保存 Loop 配置与运行记录。
          </p>
        </section>
      </div>
    </main>
  );
}

function Brand({ kicker }: { kicker: string }) {
  return (
    <div className="brand">
      <div className="brand-mark" aria-hidden="true">
        ↻
      </div>
      <div>
        <div className="brand-name">looptask</div>
        <div className="brand-kicker">{kicker}</div>
      </div>
    </div>
  );
}

function StoryPoint({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="story-point">
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <small>{children}</small>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}