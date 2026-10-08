"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";

type AnyRecord = Record<string, any>;
type Run = AnyRecord & { id: string; status: string };
type User = { displayName?: string; email?: string; username?: string };
type Repo = { fullName: string; htmlUrl: string; defaultBranch: string; private: boolean; canPush: boolean };
type Task = {
  id: string;
  name: string;
  repository: string | null;
  goal: string;
  resident: boolean;
  intervalSeconds: number;
  config: AnyRecord;
  loopName: string;
};

type Draft = {
  mode: "create" | "edit";
  name: string;
  repoUrl: string;
  goal: string;
  verifier: string;
  resident: boolean;
  intervalSeconds: number;
};

const emptyDraft = (): Draft => ({
  mode: "create",
  name: "",
  repoUrl: "",
  goal: "",
  verifier: "",
  resident: false,
  intervalSeconds: 900,
});

function toTask(saved: AnyRecord): Task | null {
  const config = saved.config || saved;
  const loop = config.loops?.[0];
  if (!loop) return null;
  return {
    id: saved.id,
    name: config.name,
    repository: config.repository || null,
    goal: loop.goal || "",
    resident: loop.trigger?.type === "resident",
    intervalSeconds: Number(loop.trigger?.intervalSeconds) || 900,
    loopName: loop.name,
    config,
  };
}

function buildProject(draft: Draft, repo: Repo | null): AnyRecord {
  return {
    name: draft.name.trim(),
    repository: repo?.htmlUrl || null,
    defaultBranch: repo?.defaultBranch || "main",
    techStack: [],
    docs: [],
    sourcePaths: [],
    loops: [
      {
        name: draft.name.trim(),
        kind: "architecture_scan",
        goal: draft.goal.trim(),
        summary: "",
        mode: "human-gated",
        trigger: draft.resident
          ? { type: "resident", intervalSeconds: Math.max(60, draft.intervalSeconds) }
          : { type: "manual" },
        agent: {
          cellIdTemplate: "{project}/{loop}/{agent}",
          sandboxRequired: true,
          allowedTools: ["read-repo"],
          humanGate: true,
        },
        verifiers: draft.verifier.trim()
          ? [
              {
                name: "acceptance-check",
                command: draft.verifier.trim().split(/\s+/),
                timeoutSeconds: 300,
              },
            ]
          : [],
        state: { hotSqliteScope: "agent-cell", artifactUriPrefix: "r2://looptask/agents/{agent}/artifacts/", hotMessageLimit: 50 },
        stopRules: { maxSteps: 12, maxConsecutiveFailures: 3, largeFileLines: 500 },
        escalationRules: [],
        steps: [
          {
            id: "execute-task",
            title: "Execute task",
            purpose: draft.goal.trim(),
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

export function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<AnyRecord[]>([]);
  const [github, setGithub] = useState<{ connected: boolean; login?: string }>({ connected: false });
  const [repos, setRepos] = useState<Repo[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [toastError, setToastError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoadError("");
    try {
      const [status, projects, runData] = await Promise.all([
        api<{ connected: boolean; login?: string }>("/api/v1/github/status").catch(() => ({ connected: false })),
        api<AnyRecord[]>("/api/v1/projects"),
        api<Run[]>("/api/v1/runs"),
      ]);
      setGithub(status);
      setRuns(runData || []);
      const configs = await Promise.all(
        (projects || []).slice(0, 20).map((p) => api<AnyRecord>(`/api/v1/projects/${p.id}`).catch(() => null)),
      );
      setTasks(
        configs
          .filter((c): c is AnyRecord => !!c)
          .map(toTask)
          .filter((t): t is Task => !!t),
      );
      setLoaded(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "failed to load workspace");
    }
  }

  async function openDialog(task?: Task) {
    if (task) {
      const loop = task.config.loops?.[0] || {};
      setDraft({
        mode: "edit",
        name: task.name,
        repoUrl: task.repository || "",
        goal: task.goal,
        verifier: (loop.verifiers || []).map((v: AnyRecord) => (v.command || []).join(" ")).join(" ") || "",
        resident: task.resident,
        intervalSeconds: task.intervalSeconds,
      });
    } else {
      setDraft(emptyDraft());
    }
    if (github.connected && !repos.length) {
      api<Repo[]>("/api/v1/github/repositories").then(setRepos).catch(() => setRepos([]));
    }
  }

  async function saveTask(runNow: boolean) {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return showToast("task name is required", true);
    if (!draft.goal.trim()) return showToast("task goal is required", true);
    await action(runNow ? "dispatch" : "save", async () => {
      const repo = repos.find((r) => r.htmlUrl === draft.repoUrl) || null;
      const project = buildProject({ ...draft, name }, repo);
      await api("/api/v1/projects", { method: "POST", body: JSON.stringify(project) });
      if (runNow) {
        const result = await api<AnyRecord>("/api/v1/loops/dispatch", {
          method: "POST",
          body: JSON.stringify({ project, loopName: name, agentKey: "default", idempotencyKey: crypto.randomUUID() }),
        });
        if (!result.accepted) throw new Error(result.reason || "task was not accepted by the run queue");
      }
      setDraft(null);
      showToast(runNow ? "task dispatched" : "task saved");
      await loadAll();
    });
  }

  async function runTask(task: Task) {
    await action(`run-${task.id}`, async () => {
      const result = await api<AnyRecord>("/api/v1/loops/dispatch", {
        method: "POST",
        body: JSON.stringify({
          project: task.config,
          loopName: task.loopName,
          agentKey: "default",
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!result.accepted) throw new Error(result.reason || "task was not accepted by the run queue");
      showToast("task dispatched");
      await loadAll();
    });
  }

  async function stopResident(task: Task) {
    await action(`stop-${task.id}`, async () => {
      await api("/api/v1/loops/resident/stop", {
        method: "POST",
        body: JSON.stringify({ project: task.config, loopName: task.loopName, agentKey: "default" }),
      });
      showToast("recurring task stopped");
      await loadAll();
    });
  }

  async function deleteTask(task: Task) {
    await action(`delete-${task.id}`, async () => {
      await api(`/api/v1/projects/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      showToast("task deleted");
      await loadAll();
    });
  }

  async function loadEvents(id: string) {
    await action("events", async () => {
      setEvents((await api<AnyRecord[]>(`/api/v1/runs/${encodeURIComponent(id)}/events`)) || []);
    });
  }

  async function confirmMerge(run: Run, decision: "approve" | "reject") {
    await action(`confirm-${run.id}`, async () => {
      await api(`/api/v1/runs/${encodeURIComponent(run.id)}/merge-confirmation`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      showToast(decision === "approve" ? "approval recorded - nothing is merged automatically" : "rejection recorded - nothing is merged automatically");
      await loadAll();
    });
  }

  async function action(name: string, task: () => Promise<void>) {
    setBusy(name);
    try {
      await task();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "request failed", true);
    } finally {
      setBusy("");
    }
  }

  function showToast(message: string, error = false) {
    setToast(message);
    setToastError(error);
    window.setTimeout(() => setToast(""), 4000);
  }

  const displayName = user.displayName || user.username || user.email?.split("@")[0] || "operator";

  if (!loaded && !loadError) {
    return (
      <div className="workspace-loading">
        <div className="loading-mark">lt</div>
        <span>Loading workspace</span>
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
          <span className="user-name">{displayName}</span>
          <button className="logout-link" onClick={onLogout} type="button">
            Log out
          </button>
        </div>
      </header>

      <main className="workspace-main">
        <div className="intro-row">
          <div>
            <p className="overline">Tasks</p>
            <h1>Get a task running.</h1>
            <p className="intro-copy">Pick a repo, describe the goal, dispatch. The executor reports back for your confirmation.</p>
          </div>
          <div className="hero-actions">
            <button className="run-button dispatch-button" disabled={!!busy} onClick={() => void openDialog()} type="button">
              + New task
            </button>
          </div>
        </div>

        {loadError && (
          <div className="error-state">
            <strong>Workspace failed to load</strong>
            <span>{loadError}</span>
            <button onClick={() => void loadAll()} type="button">
              Retry
            </button>
          </div>
        )}

        <section className="runs-card" style={{ marginTop: 0 }}>
          <div className="runs-heading">
            <div>
              <p className="overline">My tasks</p>
              <h2>My tasks</h2>
            </div>
          </div>
          {tasks.length ? (
            <div className="run-list">
              {tasks.map((task) => {
                const latest = runs.find((r) => r.projectName === task.name);
                return (
                  <div className="run-item" key={task.id}>
                    <span className={`run-dot ${latest?.status || ""}`} />
                    <span className="run-copy">
                      <strong>{task.name}</strong>
                      <small>
                        {task.repository || "no repository"} · {task.resident ? `recurring · ${formatInterval(task.intervalSeconds)}` : "manual"}
                      </small>
                    </span>
                    <b>{latest ? statusLabel(latest.status) : "never run"}</b>
                    <button className="secondary-button" disabled={!!busy} onClick={() => void runTask(task)} type="button">
                      Run
                    </button>
                    <button className="secondary-button" disabled={!!busy} onClick={() => void openDialog(task)} type="button">
                      Edit
                    </button>
                    <button
                      className="remove-button"
                      disabled={!!busy}
                      onClick={() => {
                        if (window.confirm(`Delete task "${task.name}"? Its runs are removed too.`)) void deleteTask(task);
                      }}
                      type="button"
                    >
                      Delete
                    </button>
                    {task.resident && (
                      <button className="remove-button" disabled={!!busy} onClick={() => void stopResident(task)} type="button">
                        Stop
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="runs-empty">
              <span className="empty-line" />
              <strong>No tasks yet</strong>
              <p>Use "+ New task": pick a repo and describe the goal in the dialog.</p>
            </div>
          )}
        </section>

        <section className="runs-card">
          <div className="runs-heading">
            <div>
              <p className="overline">Recent runs</p>
              <h2>Recent runs</h2>
            </div>
            {runs[0] && <span className="latest-label">latest · {statusLabel(runs[0].status)}</span>}
          </div>
          {runs.length ? (
            <div className="run-list">
              {runs.slice(0, 6).map((run) => (
                <div key={run.id}>
                  <button className="run-item" onClick={() => void loadEvents(run.id)} type="button">
                    <span className={`run-dot ${run.status}`} />
                    <span className="run-copy">
                      <strong>{run.projectName}</strong>
                      <small>{run.startedAt ? formatDate(run.startedAt) : `Run ${run.id}`}</small>
                    </span>
                    <b>{run.status === "needs-human" && run.confirmationState === "pending" ? "awaiting approval" : statusLabel(run.status)}</b>
                    <span className="run-arrow">→</span>
                  </button>
                  {run.prUrl && (
                    <div className="events-preview">
                      <a href={run.prUrl} target="_blank" rel="noreferrer">
                        View PR #{run.prNumber || ""}
                      </a>
                      {run.emailDeliveryState !== "sent" && <span>confirmation email not delivered - open the PR directly</span>}
                      {run.status === "needs-human" && run.confirmationState === "pending" && (
                        <span>
                          <button disabled={!!busy} onClick={() => void confirmMerge(run, "approve")} type="button">
                            Approve
                          </button>{" "}
                          <button disabled={!!busy} onClick={() => void confirmMerge(run, "reject")} type="button">
                            Reject
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="runs-empty">
              <span className="empty-line" />
              <strong>No runs yet</strong>
              <p>Runs show up here after you dispatch a task.</p>
            </div>
          )}
          {events.length > 0 && (
            <div className="events-preview">
              <strong>Run events</strong>
              {events.slice(-3).map((event, index) => (
                <span key={event.id || index}>{event.eventType || "event"}</span>
              ))}
            </div>
          )}
        </section>
      </main>

      {draft && (
        <div className="simple-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}>
          <div className="simple-modal wide" role="dialog" aria-modal="true" aria-labelledby="task-title">
            <button className="modal-close" onClick={() => setDraft(null)} type="button">
              ×
            </button>
            <span className="github-symbol large">{draft.mode === "edit" ? "✎" : "＋"}</span>
            <h2 id="task-title">{draft.mode === "edit" ? "Edit task" : "New task"}</h2>
            <Field label="Task name">
              <input
                value={draft.name}
                disabled={draft.mode === "edit"}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. fix-stale-docs"
              />
            </Field>
            <Field label="Repository">
              {github.connected ? (
                <select value={draft.repoUrl} onChange={(e) => setDraft({ ...draft, repoUrl: e.target.value })}>
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
                  GitHub is not connected yet. <a href="/api/v1/github/connect">Connect GitHub</a>, then come back to pick a repository.
                </div>
              )}
            </Field>
            <Field label="Task goal">
              <textarea
                className="goal-input"
                value={draft.goal}
                onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
                placeholder="Describe the outcome, scope and limits. Example: find outdated API doc examples and only touch docs/."
                rows={4}
              />
            </Field>
            <Field label="Acceptance command (optional - must pass to complete)">
              <input
                className="mono"
                value={draft.verifier}
                onChange={(e) => setDraft({ ...draft, verifier: e.target.value })}
                placeholder="npm test"
              />
            </Field>
            <Field label="Schedule">
              <div className="schedule-options">
                <button
                  className={`schedule-option ${!draft.resident ? "selected" : ""}`}
                  onClick={() => setDraft({ ...draft, resident: false })}
                  type="button"
                >
                  <span className="schedule-icon">→</span>
                  <span>
                    <strong>manualRun</strong>
                    <small>Runs once when you click Run</small>
                  </span>
                  <i>{!draft.resident ? "✓" : ""}</i>
                </button>
                <button
                  className={`schedule-option ${draft.resident ? "selected" : ""}`}
                  onClick={() => setDraft({ ...draft, resident: true })}
                  type="button"
                >
                  <span className="schedule-icon">↻</span>
                  <span>
                    <strong>Recurring</strong>
                    <small>Keeps waking up on a fixed interval</small>
                  </span>
                  <i>{draft.resident ? "✓" : ""}</i>
                </button>
              </div>
              {draft.resident && (
                <div className="interval-field">
                  <label htmlFor="interval">Interval</label>
                  <div>
                    <input
                      id="interval"
                      min={60}
                      type="number"
                      value={draft.intervalSeconds}
                      onChange={(e) => setDraft({ ...draft, intervalSeconds: Number(e.target.value) || 60 })}
                    />
                    <span>s · every {formatInterval(draft.intervalSeconds)}</span>
                  </div>
                </div>
              )}
            </Field>
            <div className="form-actions" style={{ padding: "15px 0 0", background: "transparent" }}>
              <button className="secondary-button" disabled={!!busy} onClick={() => void saveTask(false)} type="button">
                Save only
              </button>
              <button className="run-button" disabled={!!busy} onClick={() => void saveTask(true)} type="button">
                {busy === "dispatch" ? "Dispatching…" : draft.mode === "edit" ? "Save and run" : "Create and run"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`workspace-toast ${toastError ? "error" : ""}`} role="status">
          {toast}
        </div>
      )}
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

function statusLabel(status: string) {
  return (
    (
      {
        queued: "Queued",
        running: "Running",
        passed: "Passed",
        failed: "Failed",
        "needs-human": "Needs approval",
      } as Record<string, string>
    )[status] || status || "Unknown"
  );
}

function formatInterval(seconds: number) {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
      new Date(value),
    );
  } catch {
    return value;
  }
}
