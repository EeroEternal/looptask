"use client";

import { FormEvent, useState } from "react";
import { api } from "../lib/api";

type Props = { onAuthenticated: () => void };

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  function changeMode(nextMode: "register" | "login") {
    setMode(nextMode);
    setMessage("");
    setError(false);
    setPassword("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await api(
        mode === "register" ? "/api/v1/auth/register" : "/api/v1/auth/login",
        {
          method: "POST",
          body: JSON.stringify(
            mode === "register"
              ? { username, password, displayName, email }
              : { username, password },
          ),
        },
      );
      onAuthenticated();
    } catch (requestError) {
      setError(true);
      setMessage(
        requestError instanceof Error ? requestError.message : "request failed",
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
            <h1 className="story-title">Turn recurring maintenance into controlled loops.</h1>
            <p className="story-copy">
              Define the boundaries, review the plan, hand it to the
              executor. Every loop keeps evidence, a budget and explicit stop conditions.
            </p>
            <div className="story-points" aria-label="Loop workflow">
              <StoryPoint number="01" title="Define boundaries">
                Project context, allowed paths and protected branches
              </StoryPoint>
              <StoryPoint number="02" title="Review the policy">
                Stages, gates, budget and human decision points
              </StoryPoint>
              <StoryPoint number="03" title="Hand it over">
                The executor leaves events, tasks and evidence behind
              </StoryPoint>
            </div>
          </div>
          <div className="story-foot">
            <span>Isolated worktree</span>
            <span>Verifiable policy</span>
            <span>Human gate</span>
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
              Sign up
            </button>
            <button
              className={`auth-tab ${mode === "login" ? "active" : ""}`}
              onClick={() => changeMode("login")}
              role="tab"
              type="button"
            >
              Log in
            </button>
          </div>
          <h1>{mode === "register" ? "Create your workspace" : "Back to your workspace"}</h1>
          <p className="intro">
            {mode === "register"
              ? "Sign up with a username and password - no email codes."
              : "Log in with your username and password."}
          </p>

          <form onSubmit={submit}>
            <Field label="Username">
              <input
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="3-32 characters: letters, digits, _ or -"
                autoComplete="username"
              />
            </Field>
            <Field label="Password">
              <input
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
            </Field>
            {mode === "register" && (
              <>
                <Field label="Display name (optional)">
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="e.g. Xin"
                    autoComplete="name"
                  />
                </Field>
                <Field label="Email (optional, for PR confirmation notices)">
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                  />
                </Field>
              </>
            )}
            <button className="primary full" disabled={busy} type="submit">
              {busy ? "One moment…" : mode === "register" ? "Sign up" : "Log in"}
            </button>
          </form>

          {message && (
            <div className={`alert show ${error ? "error" : ""}`} role="alert">
              {message}
            </div>
          )}
          <p className="helper auth-disclaimer">
            By continuing you agree that loop configuration and run history are stored securely.
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
