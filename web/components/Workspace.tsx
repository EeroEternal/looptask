"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";

type AnyRecord = Record<string, any>;
type Run = AnyRecord & { id: string; status: string };
type User = { displayName?: string; email?: string };
type GitHubRepository = { fullName: string; htmlUrl: string; defaultBranch: string; private: boolean; canPush: boolean };
type Schedule = "manual" | "resident";
type VerifierDraft = { name: string; command: string; timeoutSeconds: number };

const emptyVerifier = (): VerifierDraft => ({
  name: "test",
  command: "",
  timeoutSeconds: 300,
});

export function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<AnyRecord[]>([]);
  const [project, setProject] = useState("looptask");
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [goal, setGoal] = useState("");
  const [loopName, setLoopName] = useState("repository-task");
  const [agentKey, setAgentKey] = useState("default");
  const [verifiers, setVerifiers] = useState<VerifierDraft[]>([emptyVerifier()]);
  const [schedule, setSchedule] = useState<Schedule>("manual");
  const [residentInterval, setResidentInterval] = useState(900);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("准备就绪");
  const [toast, setToast] = useState("");
  const [toastError, setToastError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubRepositories, setGithubRepositories] = useState<GitHubRepository[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState("");

  const projectConfig = useMemo(() => ({
    name: project.trim() || "looptask",
    repository: repository.trim() || null,
    defaultBranch: branch.trim() || "main",
    techStack: [],
    docs: [],
    sourcePaths: [],
    celld: {
      appDir: "celld",
      bucket: "looptask",
      publicUrl: "http://127.0.0.1:9876",
      internalUrl: null,
      durableObjectClass: "AgentCell",
      artifactBucketPrefix: "agents",
    },
    loops: [{
      name: loopName.trim() || "repository-task",
      kind: "architecture_scan",
      goal,
      summary: "",
      mode: "human-gated",
      trigger: schedule === "resident"
        ? { type: "resident", intervalSeconds: Math.max(60, residentInterval) }
        : { type: "manual" },
      agent: {
        cellIdTemplate: "{project}/{loop}/{agent}",
        sandboxRequired: true,
        allowedTools: ["read-repo"],
        humanGate: true,
      },
      verifiers: verifiers.filter((item) => item.command.trim()).map((item) => ({
        name: item.name.trim() || "acceptance-check",
        command: item.command.trim().split(/\s+/),
        timeoutSeconds: item.timeoutSeconds || 300,
      })),
      state: { hotSqliteScope: "agent-cell", artifactUriPrefix: "r2://looptask/agents/{agent}/artifacts/", hotMessageLimit: 50 },
      stopRules: { maxSteps: 12, maxConsecutiveFailures: 3, largeFileLines: 500 },
      escalationRules: [],
      steps: [{
        id: "execute-repository-task",
        title: "执行仓库任务",
        purpose: goal.trim() || "按照用户提交的任务 Prompt 生成可审阅变更",
        command: [],
        allowedPaths: [],
        forbiddenActions: ["push-main", "merge-pr", "create-tag"],
      }],
      decisionRules: [],
      budget: { maxDurationMinutes: 30, maxToolCalls: 200 },
      safety: { protectedBranches: [branch.trim() || "main"], allowedPaths: [], forbiddenActions: [], cleanupPolicy: "remove-worktree" },
    }],
  }), [project, repository, branch, goal, loopName, schedule, residentInterval, verifiers]);

  useEffect(() => { void loadWorkspace(); }, []);

  async function loadWorkspace() {
    setLoadError("");
    try {
      const [, projects, runData] = await Promise.all([
        api<AnyRecord[]>("/api/v1/loop-templates"),
        api<AnyRecord[]>("/api/v1/projects"),
        api<Run[]>("/api/v1/runs"),
      ]);
      setRuns(runData || []);
      if (projects?.[0]) {
        const saved = await api<AnyRecord>(`/api/v1/projects/${encodeURIComponent(projects[0].id)}`);
        restoreProject(saved.config || saved);
      }
      setNotice(runData?.[0] ? `最近一次运行：${statusLabel(runData[0].status)}` : "准备就绪");
      setLoaded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载工作区失败";
      setLoadError(message);
    }
  }

  function restoreProject(config: AnyRecord) {
    setProject(config.name || "looptask");
    setRepository(config.repository || "");
    setBranch(config.defaultBranch || "main");
    const loop = config.loops?.[0];
    if (!loop) return;
    setLoopName(loop.name || "repository-task");
    setGoal(loop.goal || "");
    setVerifiers(normalizeVerifiers(loop.verifiers).length ? normalizeVerifiers(loop.verifiers) : [emptyVerifier()]);
    if (loop.trigger?.type === "resident") {
      setSchedule("resident");
      setResidentInterval(Number(loop.trigger.intervalSeconds) || 900);
    } else setSchedule("manual");
  }

  async function saveProject() {
    await action("save", async () => {
      await api("/api/v1/projects", { method: "POST", body: JSON.stringify(projectConfig) });
      setNotice("任务草稿已保存");
      showToast("项目和任务已保存");
    });
  }

  async function validate() {
    await action("validate", async () => {
      const result = await api<AnyRecord>("/api/v1/loops/validate", {
        method: "POST", body: JSON.stringify({ project: projectConfig, loopName }),
      });
      if (!result.accepted) throw new Error(result.reason || "任务定义未通过校验");
      setNotice("校验通过，可以运行");
      showToast("任务定义已通过校验");
    });
  }

  async function dispatch() {
    if (!repository.trim() || !goal.trim()) {
      showToast("请先填写仓库地址和任务目标", true);
      return;
    }
    await action("dispatch", async () => {
      await api("/api/v1/projects", { method: "POST", body: JSON.stringify(projectConfig) });
      const result = await api<AnyRecord>("/api/v1/loops/dispatch", {
        method: "POST",
        body: JSON.stringify({ project: projectConfig, loopName, agentKey, idempotencyKey: crypto.randomUUID() }),
      });
      if (!result.accepted) throw new Error(result.reason || "任务未被执行队列接受");
      setNotice(schedule === "resident" ? `常驻唤醒已启动 · 每 ${formatInterval(residentInterval)}` : "任务已发送至 Agent cell");
      showToast(result.deduplicated ? "已复用相同运行" : schedule === "resident" ? "常驻唤醒已启动" : "任务已发送至 Agent cell");
      await loadRuns();
    });
  }

  async function stopResident() {
    await action("stop", async () => {
      await api("/api/v1/loops/resident/stop", {
        method: "POST", body: JSON.stringify({ project: projectConfig, loopName, agentKey }),
      });
      setSchedule("manual");
      setNotice("常驻任务已停止");
      showToast("常驻任务已停止");
    });
  }

  async function openGitHubBinding() {
    setGithubOpen(true);
    setGithubLoading(true);
    setGithubError("");
    try {
      setGithubRepositories(await api<GitHubRepository[]>("/api/v1/github/repositories"));
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : "无法加载可绑定的 GitHub 仓库");
    } finally {
      setGithubLoading(false);
    }
  }

  async function bindRepository(repo: GitHubRepository) {
    if (!repo.canPush) return;
    await action("bind-github", async () => {
      const bound = { ...projectConfig, repository: repo.htmlUrl, defaultBranch: repo.defaultBranch };
      await api("/api/v1/projects", { method: "POST", body: JSON.stringify(bound) });
      setRepository(repo.htmlUrl);
      setBranch(repo.defaultBranch);
      setGithubOpen(false);
      setNotice(`已绑定 ${repo.fullName} · ${repo.defaultBranch}`);
      showToast("GitHub 仓库已绑定并保存");
    });
  }

  async function loadRuns() {
    const result = await api<Run[]>("/api/v1/runs");
    setRuns(result || []);
  }

  async function loadEvents(id: string) {
    await action("events", async () => {
      const result = await api<AnyRecord[]>(`/api/v1/runs/${encodeURIComponent(id)}/events`);
      setEvents(result || []);
    });
  }

  async function confirmMerge(run: Run, decision: "approve" | "reject") {
    await action(`confirmation-${run.id}`, async () => {
      await api(`/api/v1/runs/${encodeURIComponent(run.id)}/merge-confirmation`, {
        method: "POST", body: JSON.stringify({ decision }),
      });
      showToast(decision === "approve" ? "已记录批准确认；尚未合并 PR" : "已记录拒绝确认；尚未合并 PR");
      await loadRuns();
    });
  }

  async function action(name: string, task: () => Promise<void>) {
    setBusy(name);
    try { await task(); } catch (error) { showToast(error instanceof Error ? error.message : "请求失败", true); }
    finally { setBusy(""); }
  }

  function showToast(message: string, error = false) {
    setToast(message); setToastError(error);
    window.setTimeout(() => setToast(""), 4000);
  }

  const canRun = Boolean(repository.trim() && goal.trim() && verifiers.some((item) => item.command.trim()) && !busy);
  const currentRun = runs[0];
  const displayName = user.displayName || user.email?.split("@")[0] || "开发者";

  if (!loaded && !loadError) return <div className="workspace-loading"><div className="loading-mark">lt</div><span>正在载入工作区</span></div>;

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <div className="wordmark"><span className="wordmark-mark">lt</span><span>looptask</span><small>task runner</small></div>
        <div className="header-actions"><span className="header-status"><i />{notice}</span><span className="user-name">{displayName}</span><button className="logout-link" onClick={onLogout} type="button">退出</button></div>
      </header>
      <main className="workspace-main">
        <div className="intro-row"><div><p className="overline">工作区 / 新任务</p><h1>让一个任务跑起来。</h1><p className="intro-copy">连接仓库，描述目标，写下完成的证据，然后发送到 Agent cell。</p></div><div className="github-note"><span className="github-symbol">GH</span><div><strong>{repository ? "GitHub 仓库已连接" : "绑定允许的 GitHub 仓库"}</strong><small>{repository ? `${repository} · ${branch}` : "执行器签名回报完成后，系统才会创建 PR 并请求你的确认。"}</small></div><button onClick={() => void openGitHubBinding()} type="button">{repository ? "更换" : "绑定"}</button></div></div>
        {loadError && <div className="error-state"><strong>工作区暂时无法加载</strong><span>{loadError}</span><button onClick={() => void loadWorkspace()} type="button">重试</button></div>}

        <section className="task-layout">
          <div className="task-card">
            <div className="card-heading"><div><p className="overline">Task definition</p><h2>配置一个任务</h2></div><span className="draft-pill">草稿</span></div>
            <div className="form-section"><p className="section-number">01 <span>项目</span></p><div className="field-grid"><Field label="项目名称"><input value={project} onChange={(e) => setProject(e.target.value)} placeholder="例如 looptask" /></Field><Field label="默认分支"><input className="mono" readOnly={!!repository} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" /></Field></div><Field label="GitHub 仓库地址"><div className="repository-binding"><input type="url" readOnly value={repository} placeholder="通过“绑定 GitHub 仓库”选择" /><button onClick={() => void openGitHubBinding()} type="button">{repository ? "更换仓库" : "绑定 GitHub 仓库"}</button></div></Field></div>
            <div className="form-section"><p className="section-number">02 <span>目标</span></p><Field label="任务名称"><input value={loopName} onChange={(e) => setLoopName(e.target.value)} placeholder="例如 fix-stale-docs" /></Field><Field label="你希望 Agent 完成什么？"><textarea className="goal-input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="清楚描述结果、范围和限制。比如：找出 API 文档中已经过期的示例，只修改 docs/ 目录。" rows={6} /><div className="field-meta"><span>写得具体，Agent 才能做出可审阅的改动。</span><code>{goal.length} 字</code></div></Field></div>
            <div className="form-section"><p className="section-number">03 <span>完成证明</span></p><p className="section-help">这些命令会随任务发送给执行器；执行器接入后，全部通过才算完成。</p><div className="verifier-list">{verifiers.map((item, index) => <div className="verifier-row" key={`${index}-${item.name}`}><span className="terminal-prefix">$</span><input aria-label={`验收命令 ${index + 1}`} className="mono" value={item.command} onChange={(e) => setVerifiers((items) => items.map((v, i) => i === index ? { ...v, command: e.target.value } : v))} placeholder="npm test" /><button aria-label="移除验收命令" className="remove-button" onClick={() => setVerifiers((items) => items.length > 1 ? items.filter((_, i) => i !== index) : items)} type="button">移除</button></div>)}</div><button className="add-verifier" onClick={() => setVerifiers((items) => [...items, emptyVerifier()])} type="button">＋ 添加一条命令</button></div>
            <div className="form-section schedule-section"><p className="section-number">04 <span>运行时机</span></p><div className="schedule-options"><button className={schedule === "manual" ? "schedule-option selected" : "schedule-option"} onClick={() => setSchedule("manual")} type="button"><span className="schedule-icon">→</span><span><strong>手动运行一次</strong><small>你准备好后，点击运行</small></span><i>{schedule === "manual" ? "✓" : ""}</i></button><button className={schedule === "resident" ? "schedule-option selected" : "schedule-option"} onClick={() => setSchedule("resident")} type="button"><span className="schedule-icon">↻</span><span><strong>常驻，按固定间隔重复</strong><small>任务会持续唤醒，不使用 Cron</small></span><i>{schedule === "resident" ? "✓" : ""}</i></button></div>{schedule === "resident" && <div className="interval-field"><label htmlFor="interval">每隔多久运行一次？</label><div><input id="interval" min={60} type="number" value={residentInterval} onChange={(e) => setResidentInterval(Number(e.target.value) || 60)} /><span>秒 · 即每 {formatInterval(residentInterval)}</span></div></div>}</div>
            <div className="form-actions"><button className="secondary-button" disabled={!!busy} onClick={() => void saveProject()} type="button">{busy === "save" ? "保存中" : "保存草稿"}</button><button className="secondary-button" disabled={!!busy} onClick={() => void validate()} type="button">{busy === "validate" ? "校验中" : "先校验"}</button><button className="run-button" disabled={!canRun} onClick={() => void dispatch()} type="button">{busy === "dispatch" ? "派发中…" : schedule === "resident" ? "启动常驻" : "运行任务"}<span>→</span></button></div>
          </div>
          <aside className="task-aside"><div className="aside-card github-card"><p className="overline">GitHub connection</p><h3>PR 自动化已配置</h3><p>GitHub Token 仅允许操作指定仓库。受信任执行器完成变更并通过验收后，looptask 会创建 pull request 并发送确认邮件。</p><button onClick={() => setGithubOpen(true)} type="button">查看当前能力 <span>→</span></button></div><div className="aside-card"><p className="overline">当前配置</p><div className="config-line"><span>仓库</span><strong>{repository || "尚未填写"}</strong></div><div className="config-line"><span>分支</span><strong>{branch || "main"}</strong></div><div className="config-line"><span>运行方式</span><strong>{schedule === "manual" ? "手动一次" : `常驻 · ${formatInterval(residentInterval)}`}</strong></div><div className="config-line"><span>验收命令</span><strong>{verifiers.filter((v) => v.command.trim()).length} 条</strong></div></div></aside>
        </section>

        <section className="runs-card"><div className="runs-heading"><div><p className="overline">Recent runs</p><h2>最近派发</h2></div>{currentRun && <span className="latest-label">最新 · {statusLabel(currentRun.status)}</span>}</div>{runs.length ? <div className="run-list">{runs.slice(0, 6).map((run) => <div key={run.id}><button className="run-item" onClick={() => void loadEvents(run.id)} type="button"><span className={`run-dot ${run.status}`} /><span className="run-copy"><strong>{run.projectName || run.project || project} <em>/</em> {run.loopName || loopName}</strong><small>{run.startedAt ? formatDate(run.startedAt) : `运行 ${run.id}`}</small></span><b>{run.status === "needs-human" && run.confirmationState === "pending" ? "等待确认" : statusLabel(run.status)}</b><span className="run-arrow">→</span></button>{run.prUrl && <div className="events-preview"><a href={run.prUrl} target="_blank" rel="noreferrer">查看 PR #{run.prNumber || ""}</a>{run.emailDeliveryState !== "sent" && <span>确认邮件尚未确认送达，请直接查看 PR。</span>}{run.status === "needs-human" && run.confirmationState === "pending" && <span>等待你的确认；确认仅记录决定，不会合并。</span>}{run.status === "needs-human" && run.confirmationState === "pending" && <span><button disabled={!!busy} onClick={() => void confirmMerge(run, "approve")} type="button">批准</button> <button disabled={!!busy} onClick={() => void confirmMerge(run, "reject")} type="button">拒绝</button></span>}</div>}</div>)}</div> : <div className="runs-empty"><span className="empty-line" /><strong>还没有派发记录</strong><p>配置好第一个任务后，它会出现在这里。</p></div>}{events.length > 0 && <div className="events-preview"><strong>派发事件</strong>{events.slice(-3).map((event, index) => <span key={event.id || index}>{event.eventType || "event"}</span>)}</div>}</section>
        {schedule === "resident" && <button className="stop-resident" disabled={!!busy} onClick={() => void stopResident()} type="button">停止当前常驻任务</button>}
      </main>
      {githubOpen && <div className="simple-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setGithubOpen(false); }}><div className="simple-modal" role="dialog" aria-modal="true" aria-labelledby="github-title"><button className="modal-close" onClick={() => setGithubOpen(false)} type="button">×</button><span className="github-symbol large">GH</span><h2 id="github-title">绑定 GitHub 仓库</h2><p>仅显示服务端允许且当前令牌可访问的仓库。需要推送权限才能绑定；完成后由签名执行器回调创建 PR。</p>{githubLoading && <p>正在加载允许的仓库…</p>}{githubError && <div className="error-state"><strong>无法加载仓库</strong><span>{githubError}</span><button onClick={() => void openGitHubBinding()} type="button">重试</button></div>}{!githubLoading && !githubError && githubRepositories.length === 0 && <div className="modal-note">没有可访问的允许仓库。请让管理员检查 GitHub 令牌和仓库允许列表。</div>}{!githubLoading && !githubError && githubRepositories.map((repo) => <div className="config-line" key={repo.fullName}><span><strong>{repo.fullName}</strong><small>{repo.defaultBranch} · {repo.private ? "私有" : "公开"} · {repo.canPush ? "可推送" : "只读"}</small></span><button disabled={!repo.canPush || !!busy} onClick={() => void bindRepository(repo)} type="button">{repo.canPush ? "绑定" : "需要推送权限"}</button></div>)}<div className="modal-note">批准或拒绝只记录确认决定，不会自动合并 PR。</div></div></div>}
      {toast && <div className={`workspace-toast ${toastError ? "error" : ""}`} role="status">{toast}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}
function normalizeVerifiers(value: AnyRecord[] | undefined): VerifierDraft[] {
  return (value || []).map((item) => ({ name: item.name || "test", command: Array.isArray(item.command) ? item.command.join(" ") : String(item.command || ""), timeoutSeconds: Number(item.timeoutSeconds || 300) }));
}
function statusLabel(status: string) {
  return ({ queued: "等待派发", running: "已发送至 Agent cell", passed: "已通过", failed: "失败", "needs-human": "待人工" } as Record<string, string>)[status] || status || "未知";
}
function formatInterval(seconds: number) {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}
function formatDate(value: string) {
  try { return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return value; }
}