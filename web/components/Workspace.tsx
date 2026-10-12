"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type AnyRecord = Record<string, any>;
type Run = AnyRecord & { id: string; status: string };
type User = { displayName?: string; email?: string; username?: string };
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

export function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<AnyRecord[]>([]);
  const [github, setGithub] = useState<{ connected: boolean; login?: string }>({ connected: false });
  const [importOpen, setImportOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [taskToken, setTaskToken] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [importRepos, setImportRepos] = useState<any[]>([]);
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

  async function openImport() {
    setImportOpen(true);
    if (github.connected && !importRepos.length) {
      api<any[]>("/api/v1/github/repositories").then(setImportRepos).catch(() => setImportRepos([]));
    }
  }

  async function importMentora() {
    await action("mentora-import", async () => {
      if (!shareUrl.trim()) throw new Error("paste the mentora share link");
      if (!taskToken.trim()) throw new Error("task token (mtk_...) is required");
      if (!repoUrl) throw new Error("select a repository");
      const created = await api<AnyRecord>("/api/v1/mentora/import", {
        method: "POST",
        body: JSON.stringify({ shareUrl: shareUrl.trim(), taskToken: taskToken.trim(), repository: repoUrl }),
      });
      const result = await api<AnyRecord>("/api/v1/loops/dispatch", {
        method: "POST",
        body: JSON.stringify({
          project: created.project,
          loopName: created.project.name,
          agentKey: "default",
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!result.accepted) throw new Error(result.reason || "task was not accepted by the run queue");
      setImportOpen(false);
      setShareUrl("");
      setTaskToken("");
      showToast(`mentora task "${created.task?.title || created.task?.id}" imported and dispatched`);
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
          <a
            className={github.connected ? "header-status" : "run-button"}
            title="GitHub connected — click to re-authorize after changing installations"
            href="/api/v1/github/connect"
          >
            <i />
            GH · {github.connected ? github.login || "connected" : "Connect"}
          </a>
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
            <button className="secondary-button" disabled={!!busy} onClick={() => void openImport()} type="button">
              Import from Mentora
            </button>
            <a className="run-button dispatch-button" href="/new/">
              + New task
            </a>
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
                    <a className="secondary-button" href={`/new/?id=${encodeURIComponent(task.id)}`}>
                      Edit
                    </a>
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
              <p>Use “+ New task” and describe what the agent should do.</p>
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
                      <small>{run.startedAt ? formatDate(run.startedAt) : `run ${run.id}`}</small>
                    </span>
                    <b>{run.status === "needs-human" && run.confirmationState === "pending" ? "awaiting approval" : statusLabel(run.status)}</b>
                    <span className="run-arrow">→</span>
                  </button>
                  {run.completionSummary && (
                    <div className="events-preview run-summary">
                      <strong>Result{run.mentoraTitle ? ` · ${run.mentoraTitle}` : ""}</strong>
                      <span>
                        {run.completionSummary.slice(0, 500)}
                        {run.completionSummary.length > 500 ? "…" : ""}
                      </span>
                    </div>
                  )}
                  {run.prUrl && (
                    <div className="events-preview">
                      <a href={run.prUrl} target="_blank" rel="noreferrer">
                        {run.prUrl.includes("/issues/") ? "View issue #" : "View PR #"}
                        {run.prNumber || ""}
                      </a>
                      {run.emailDeliveryState !== "sent" && !run.prUrl.includes("/issues/") && (
                        <span>confirmation email not delivered - open the PR directly</span>
                      )}
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

      {importOpen && (
        <div className="simple-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setImportOpen(false)}>
          <div className="simple-modal wide" role="dialog" aria-modal="true" aria-labelledby="mentora-title">
            <button className="modal-close" onClick={() => setImportOpen(false)} type="button">
              ×
            </button>
            <span className="github-symbol large">M</span>
            <h2 id="mentora-title">Import from Mentora</h2>
            <p>
              Paste the task share link and its task token; looptask runs the fix and writes the PR back to the task.
            </p>
            <div className="field">
              <label>Share link or task id</label>
              <input
                value={shareUrl}
                onChange={(e) => setShareUrl(e.target.value)}
                placeholder="https://mentora.pub/tasks?task=task-..."
              />
            </div>
            <div className="field">
              <label>Task token (mtk_...)</label>
              <input
                className="mono"
                type="password"
                value={taskToken}
                onChange={(e) => setTaskToken(e.target.value)}
                placeholder="mtk_..."
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label>Repository to fix</label>
              {github.connected ? (
                <select value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}>
                  <option value="">Select a GitHub repository…</option>
                  {importRepos.map((repo) => (
                    <option key={repo.htmlUrl} value={repo.htmlUrl} disabled={!repo.canPush}>
                      {repo.fullName} · {repo.defaultBranch}
                      {repo.canPush ? "" : " (read-only)"}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="modal-note">
                  GitHub is not connected yet. <a href="/api/v1/github/connect">Connect GitHub</a>, then come back.
                </div>
              )}
            </div>
            <div className="form-actions" style={{ padding: "15px 0 0", background: "transparent" }}>
              <button className="secondary-button" disabled={!!busy} onClick={() => setImportOpen(false)} type="button">
                Cancel
              </button>
              <button className="run-button" disabled={!!busy} onClick={() => void importMentora()} type="button">
                {busy === "mentora-import" ? "Importing…" : "Import and run"}
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
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
      new Date(value),
    );
  } catch {
    return value;
  }
}
