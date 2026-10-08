"use client";

import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { api } from "../../lib/api";

type AnyRecord = Record<string, any>;
type Repo = { fullName: string; htmlUrl: string; defaultBranch: string; private: boolean; canPush: boolean };

export default function NewTaskPage() {
  const [ready, setReady] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [schedule, setSchedule] = useState<"manual" | "resident">("manual");
  const [intervalSeconds, setIntervalSeconds] = useState(900);
  const [resultTarget, setResultTarget] = useState<"pr" | "issue">("pr");
  const [github, setGithub] = useState<{ connected: boolean; login?: string }>({ connected: false });
  const [repos, setRepos] = useState<Repo[]>([]);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [toastError, setToastError] = useState(false);

  useEffect(() => {
    void init();
  }, []);

  async function init() {
    try {
      await api("/api/v1/auth/me");
    } catch {
      window.location.href = "/";
      return;
    }
    const status = await api<{ connected: boolean; login?: string }>("/api/v1/github/status").catch(() => ({ connected: false }));
    setGithub(status);
    if (status.connected) {
      api<Repo[]>("/api/v1/github/repositories").then(setRepos).catch(() => setRepos([]));
    }
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) {
      setEditId(id);
      try {
        const saved = await api<AnyRecord>(`/api/v1/projects/${encodeURIComponent(id)}`);
        const config = saved.config || saved;
        const loop = config.loops?.[0] || {};
        setName(config.name || "");
        setRepoUrl(config.repository || "");
        setGoal(loop.goal || "");
        setResultTarget(loop.resultTarget === "issue" ? "issue" : "pr");
        if (loop.trigger?.type === "resident") {
          setSchedule("resident");
          setIntervalSeconds(Number(loop.trigger.intervalSeconds) || 900);
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "failed to load task", true);
      }
    }
    setReady(true);
  }

  async function submit(event: FormEvent, runNow: boolean) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return showToast("task name is required", true);
    if (!goal.trim()) return showToast("task goal is required", true);
    setBusy(runNow ? "run" : "save");
    try {
      const repo = repos.find((r) => r.htmlUrl === repoUrl) || null;
      const project = buildProject(trimmed, repo, goal, schedule, intervalSeconds, resultTarget);
      await api("/api/v1/projects", { method: "POST", body: JSON.stringify(project) });
      if (runNow) {
        const result = await api<AnyRecord>("/api/v1/loops/dispatch", {
          method: "POST",
          body: JSON.stringify({ project, loopName: trimmed, agentKey: "default", idempotencyKey: crypto.randomUUID() }),
        });
        if (!result.accepted) throw new Error(result.reason || "task was not accepted by the run queue");
      }
      showToast(runNow ? "task dispatched" : "task saved");
      window.setTimeout(() => (window.location.href = "/"), 600);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "request failed", true);
      setBusy("");
    }
  }

  function showToast(message: string, error = false) {
    setToast(message);
    setToastError(error);
    window.setTimeout(() => setToast(""), 4000);
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
          <small>task runner</small>
        </div>
        <div className="header-actions">
          {github.connected ? (
            <span className="header-status" title="GitHub connected">
              <i />
              GH · {github.login || "connected"}
            </span>
          ) : (
            <a className="run-button" href="/api/v1/github/connect">
              Connect GitHub
            </a>
          )}
          <a className="logout-link" href="/">
            Back to tasks
          </a>
        </div>
      </header>

      <main className="workspace-main">
        <div className="intro-row">
          <div>
            <p className="overline">{editId ? "Edit task" : "New task"}</p>
            <h1>{editId ? "Update this task." : "Describe what the agent should do."}</h1>
            <p className="intro-copy">
              The executor picks the task up, works in an isolated worktree, and reports the result where you choose.
            </p>
          </div>
        </div>

        <section className="runs-card" style={{ marginTop: 0 }}>
          <form onSubmit={(e) => void submit(e, true)}>
            <div className="form-section">
              <p className="section-number">
                01 <span>Basics</span>
              </p>
              <Field label="Task name">
                <input
                  value={name}
                  disabled={!!editId}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. fix-stale-docs"
                />
              </Field>
              <Field label="Repository">
                {github.connected ? (
                  <select value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}>
                    <option value="">Select a GitHub repository…</option>
                    {repos.map((repo) => (
                      <option key={repo.htmlUrl} value={repo.htmlUrl} disabled={!repo.canPush}>
                        {repo.fullName} · {repo.defaultBranch}
                        {repo.canPush ? "" : " (read-only)"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="modal-note">
                    GitHub is not connected yet. <a href="/api/v1/github/connect">Connect GitHub</a>, then come back to pick a
                    repository.
                  </div>
                )}
              </Field>
            </div>

            <div className="form-section">
              <p className="section-number">
                02 <span>Goal</span>
              </p>
              <Field label="What should the agent achieve?">
                <textarea
                  className="goal-input"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="Describe the outcome, scope and limits. Example: find outdated API doc examples and only touch docs/."
                  rows={5}
                />
              </Field>
            </div>

            <div className="form-section">
              <p className="section-number">
                03 <span>Result</span>
              </p>
              <p className="section-help">Where should the finished work go?</p>
              <div className="schedule-options">
                <button
                  type="button"
                  className={`schedule-option ${resultTarget === "pr" ? "selected" : ""}`}
                  onClick={() => setResultTarget("pr")}
                >
                  <span className="schedule-icon">⑂</span>
                  <span>
                    <strong>Open a pull request</strong>
                    <small>Changes are pushed to a branch; you approve the PR</small>
                  </span>
                  <i>{resultTarget === "pr" ? "✓" : ""}</i>
                </button>
                <button
                  type="button"
                  className={`schedule-option ${resultTarget === "issue" ? "selected" : ""}`}
                  onClick={() => setResultTarget("issue")}
                >
                  <span className="schedule-icon">!</span>
                  <span>
                    <strong>File a GitHub issue</strong>
                    <small>The result is a report filed as an issue</small>
                  </span>
                  <i>{resultTarget === "issue" ? "✓" : ""}</i>
                </button>
              </div>
            </div>

            <div className="form-section">
              <p className="section-number">
                04 <span>Schedule</span>
              </p>
              <div className="schedule-options">
                <button
                  type="button"
                  className={`schedule-option ${schedule === "manual" ? "selected" : ""}`}
                  onClick={() => setSchedule("manual")}
                >
                  <span className="schedule-icon">→</span>
                  <span>
                    <strong>Run manually</strong>
                    <small>Runs once when you click Run</small>
                  </span>
                  <i>{schedule === "manual" ? "✓" : ""}</i>
                </button>
                <button
                  type="button"
                  className={`schedule-option ${schedule === "resident" ? "selected" : ""}`}
                  onClick={() => setSchedule("resident")}
                >
                  <span className="schedule-icon">↻</span>
                  <span>
                    <strong>Recurring</strong>
                    <small>Keeps waking up on a fixed interval</small>
                  </span>
                  <i>{schedule === "resident" ? "✓" : ""}</i>
                </button>
              </div>
              {schedule === "resident" && (
                <div className="interval-field">
                  <label htmlFor="interval">Interval</label>
                  <div>
                    <input
                      id="interval"
                      min={60}
                      type="number"
                      value={intervalSeconds}
                      onChange={(e) => setIntervalSeconds(Number(e.target.value) || 60)}
                    />
                    <span>seconds</span>
                  </div>
                </div>
              )}
            </div>

            <div className="form-actions">
              <button className="secondary-button" disabled={!!busy} onClick={(e) => void submit(e, false)} type="button">
                Save only
              </button>
              <button className="run-button" disabled={!!busy} type="submit">
                {busy === "run" ? "Dispatching…" : editId ? "Save and run" : "Create and run"}
              </button>
            </div>
          </form>
        </section>
      </main>

      {toast && (
        <div className={`workspace-toast ${toastError ? "error" : ""}`} role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function buildProject(
  name: string,
  repo: Repo | null,
  goal: string,
  schedule: "manual" | "resident",
  intervalSeconds: number,
  resultTarget: "pr" | "issue",
): AnyRecord {
  return {
    name,
    repository: repo?.htmlUrl || null,
    defaultBranch: repo?.defaultBranch || "main",
    techStack: [],
    docs: [],
    sourcePaths: [],
    loops: [
      {
        name,
        kind: "architecture_scan",
        goal: goal.trim(),
        summary: "",
        mode: "human-gated",
        resultTarget,
        trigger: schedule === "resident" ? { type: "resident", intervalSeconds: Math.max(60, intervalSeconds) } : { type: "manual" },
        agent: {
          cellIdTemplate: "{project}/{loop}/{agent}",
          sandboxRequired: true,
          allowedTools: ["read-repo"],
          humanGate: true,
        },
        verifiers: [],
        state: { hotSqliteScope: "agent-cell", artifactUriPrefix: "r2://looptask/agents/{agent}/artifacts/", hotMessageLimit: 50 },
        stopRules: { maxSteps: 12, maxConsecutiveFailures: 3, largeFileLines: 500 },
        escalationRules: [],
        steps: [
          {
            id: "execute-task",
            title: "Execute task",
            purpose: goal.trim(),
            command: [],
            allowedPaths: [],
            forbiddenActions: ["push-main", "merge-pr", "create-tag"],
          },
        ],
        decisionRules: [],
        budget: { maxDurationMinutes: 30, maxToolCalls: 200 },
        safety: {
          protectedBranches: [repo?.defaultBranch || "main"],
          allowedPaths: [],
          forbiddenActions: [],
          cleanupPolicy: "remove-worktree",
        },
      },
    ],
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}
