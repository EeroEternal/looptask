"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../lib/api";

type Session = { authenticated: boolean; user?: { username?: string; displayName?: string; email?: string } };

export default function SettingsPage() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<Session["user"]>({});
  const [github, setGithub] = useState<{ connected: boolean; login?: string }>({ connected: false });
  const [repoCount, setRepoCount] = useState<number | null>(null);

  useEffect(() => {
    void init();
  }, []);

  async function init() {
    try {
      const session = await api<Session>("/api/v1/auth/me");
      if (!session.authenticated) {
        window.location.href = "/";
        return;
      }
      setUser(session.user);
      const status = await api<{ connected: boolean; login?: string }>("/api/v1/github/status").catch(() => ({
        connected: false,
      }));
      setGithub(status);
      if (status.connected) {
        const repos = await api<any[]>("/api/v1/github/repositories").catch(() => []);
        setRepoCount(repos.length);
      }
      setReady(true);
    } catch {
      window.location.href = "/";
    }
  }

  if (!ready) {
    return (
      <div className="workspace-loading">
        <div className="loading-mark">lt</div>
        <span>Loading</span>
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <div className="wordmark">
          <span className="wordmark-mark">lt</span>
          <span>looptask</span>
          <small>settings</small>
        </div>
        <div className="header-actions">
          <a className="logout-link" href="/">
            Back to tasks
          </a>
        </div>
      </header>

      <main className="workspace-main">
        <div className="intro-row">
          <div>
            <p className="overline">Settings</p>
            <h1>Account & connections.</h1>
            <p className="intro-copy">Everything identity-related lives here. Task configuration stays on the task pages.</p>
          </div>
        </div>

        <section className="runs-card" style={{ marginTop: 0 }}>
          <div className="runs-heading">
            <div>
              <p className="overline">Account</p>
              <h2>looptask account</h2>
            </div>
          </div>
          <div style={{ padding: "6px 25px 14px" }}>
            <div className="config-line">
              <span>Username</span>
              <strong>{user?.username || "-"}</strong>
            </div>
            <div className="config-line">
              <span>Display name</span>
              <strong>{user?.displayName || "-"}</strong>
            </div>
          </div>
        </section>

        <section className="runs-card">
          <div className="runs-heading">
            <div>
              <p className="overline">GitHub</p>
              <h2>GitHub connection</h2>
            </div>
            <span className={`latest-label`}>{github.connected ? `connected · @${github.login || "?"}` : "not connected"}</span>
          </div>
          <div style={{ padding: "14px 25px 20px" }}>
            {github.connected && (
              <div className="config-line">
                <span>Visible repositories</span>
                <strong>{repoCount === null ? "…" : `${repoCount} repositories`}</strong>
              </div>
            )}
            <div className="field">
              <label>Connect / re-authorize / switch account</label>
              <p className="section-help">
                Opens GitHub&apos;s authorization page. Whichever GitHub account is signed in on that page becomes the
                connected account — it replaces the current connection.
              </p>
              <a className="run-button" href="/api/v1/github/connect" style={{ marginTop: 8 }}>
                {github.connected ? `Re-authorize as a different account` : "Connect GitHub"}
              </a>
            </div>
            <div className="field">
              <label>How to switch</label>
              <p className="section-help">
                1) Sign out of GitHub (or open the link in a private window and sign in there with the looptask account).{" "}
                2) Sign in with the target GitHub account. 3) Click the button above and authorize. 4) Refresh the
                dashboard — the repository picker follows the new account immediately.
              </p>
            </div>
            <div className="field">
              <label>Cleanup after switching</label>
              <p className="section-help">
                Revoking on GitHub side:{" "}
                <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer">
                  Authorized OAuth Apps → looptask → Revoke
                </a>{" "}
                (the old grant is not removed automatically).
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}
