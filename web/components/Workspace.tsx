"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

type AnyRecord = Record<string, any>;
type Template = AnyRecord & { id: string; definition: AnyRecord };
type Run = AnyRecord & { id: string; status: string };
type User = { displayName?: string; email?: string };

const DEFAULTS = {
  hotMessageLimit: 50,
  maxSteps: 12,
  maxConsecutiveFailures: 3,
  largeFileLines: 500,
};

export function Workspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<AnyRecord[]>([]);
  const [project, setProject] = useState("looptask");
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [stack, setStack] = useState("rust");
  const [docs, setDocs] = useState("README.md");
  const [source, setSource] = useState("src,tests");
  const [celld, setCelld] = useState("http://127.0.0.1:9876");
  const [loopName, setLoopName] = useState("docs-lifecycle-patrol");
  const [agentKey, setAgentKey] = useState("default");
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState("待命");
  const [notice, setNotice] = useState("未开始运行");
  const [activeView, setActiveView] = useState("workspace");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState(false);

  const definition = selected?.definition;
  const projectConfig = useMemo(() => buildProject(), [
    project,
    repository,
    branch,
    stack,
    docs,
    source,
    celld,
    loopName,
    agentKey,
    goal,
    selected,
  ]);

  useEffect(() => {
    void loadWorkspace();
  }, []);

  function buildProject(): AnyRecord {
    const loop = definition
      ? { ...definition, name: loopName, goal: goal || definition.goal }
      : {
          name: loopName,
          kind: "docs_sync",
          goal,
          summary: "",
          mode: "human-gated",
          trigger: { type: "manual" },
          agent: {
            cellIdTemplate: "{project}/{loop}/{agent}",
            sandboxRequired: true,
            allowedTools: ["read-repo"],
            humanGate: true,
          },
          verifiers: [],
          state: {
            hotSqliteScope: "agent-cell",
            artifactUriPrefix: "r2://looptask/agents/{agent}/artifacts/",
            hotMessageLimit: DEFAULTS.hotMessageLimit,
          },
          stopRules: {
            maxSteps: DEFAULTS.maxSteps,
            maxConsecutiveFailures: DEFAULTS.maxConsecutiveFailures,
            largeFileLines: DEFAULTS.largeFileLines,
          },
          escalationRules: [],
          steps: [],
          decisionRules: [],
          budget: { maxDurationMinutes: 30, maxToolCalls: 200 },
          safety: {
            protectedBranches: ["main"],
            allowedPaths: [],
            forbiddenActions: [],
            cleanupPolicy: "remove-worktree",
          },
        };
    return {
      name: project.trim(),
      repository: repository.trim() || null,
      defaultBranch: branch.trim() || "main",
      techStack: splitList(stack),
      docs: splitList(docs),
      sourcePaths: splitList(source),
      celld: {
        appDir: "celld",
        bucket: "looptask",
        publicUrl: celld.trim() || null,
        internalUrl: null,
        durableObjectClass: "AgentCell",
        artifactBucketPrefix: "agents",
      },
      loops: [loop],
    };
  }

  async function loadWorkspace() {
    try {
      const [templateData, projectData, runData] = await Promise.all([
        api<Template[]>("/api/v1/loop-templates"),
        api<AnyRecord[]>("/api/v1/projects"),
        api<Run[]>("/api/v1/runs"),
      ]);
      setTemplates(templateData || []);
      if (templateData?.[0]) applyTemplate(templateData[0]);
      if (projectData?.[0]) {
        const saved = await api<AnyRecord>(
          `/api/v1/projects/${encodeURIComponent(projectData[0].id)}`,
        );
        restoreProject(saved.config, templateData || []);
      }
      setRuns(runData || []);
      if (runData?.[0]) {
        setStatus(statusLabel(runData[0].status));
        setNotice(`最近运行 · ${statusLabel(runData[0].status)}`);
      }
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : "加载失败", true);
    }
  }

  function applyTemplate(template: Template) {
    setSelected(template);
    setLoopName(template.definition?.name || "");
    setGoal(template.definition?.goal || "");
  }

  function restoreProject(config: AnyRecord, availableTemplates = templates) {
    setProject(config?.name || "looptask");
    setRepository(config?.repository || "");
    setBranch(config?.defaultBranch || "main");
    setStack((config?.techStack || []).join(", "));
    setDocs((config?.docs || []).join(", "));
    setSource((config?.sourcePaths || []).join(", "));
    setCelld(config?.celld?.publicUrl || "");
    const loop = config?.loops?.[0];
    if (loop) {
      const matching = availableTemplates.find((item) => item.definition?.name === loop.name);
      if (matching) setSelected(matching);
      setLoopName(loop.name || "");
      setGoal(loop.goal || "");
    }
    setNotice("已恢复保存的项目");
  }

  async function saveProject() {
    await runAction("save", async () => {
      await api("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify(projectConfig),
      });
      setNotice("项目已保存");
      showToast("项目配置已安全保存。");
    });
  }

  async function validate() {
    await runAction("validate", async () => {
      const result = await api<AnyRecord>("/api/v1/loops/validate", {
        method: "POST",
        body: JSON.stringify({ project: projectConfig, loopName }),
      });
      setNotice(result.accepted ? "策略已验证" : "策略需要补充");
      showToast(
        result.accepted ? "完整策略通过，可以预览或派发。" : "策略未通过，请检查 Loop 定义。",
        !result.accepted,
      );
    });
  }

  async function plan() {
    await runAction("plan", async () => {
      const result = await api<AnyRecord>("/api/v1/loops/plan", {
        method: "POST",
        body: JSON.stringify({ project: projectConfig, loopName, agentKey }),
      });
      setStatus("已规划");
      setNotice("计划已生成");
      showToast(result.accepted ? "执行计划已生成。" : result.reason || "规划失败", !result.accepted);
    });
  }

  async function dispatch() {
    await runAction("dispatch", async () => {
      const result = await api<AnyRecord>("/api/v1/loops/dispatch", {
        method: "POST",
        body: JSON.stringify({
          project: projectConfig,
          loopName,
          agentKey,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setStatus("运行中");
      setNotice(result.deduplicated ? "已复用原运行" : "正在运行");
      showToast(result.deduplicated ? "检测到重复派发，已复用原运行。" : "Loop 已进入 Agent cell。");
      await loadRuns();
    });
  }

  async function loadRuns() {
    const result = await api<Run[]>("/api/v1/runs");
    setRuns(result || []);
  }

  async function loadEvents(runId: string) {
    try {
      const result = await api<AnyRecord[]>(
        `/api/v1/runs/${encodeURIComponent(runId)}/events`,
      );
      setEvents(result || []);
      showToast("已恢复运行事件。");
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : "读取失败", true);
    }
  }

  async function runAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    try {
      await action();
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : "请求失败", true);
    } finally {
      setBusy("");
    }
  }

  function showToast(message: string, isError = false) {
    setToast(message);
    setError(isError);
    window.setTimeout(() => setToast(""), 4200);
  }

  function updateField(setter: (value: string) => void) {
    return (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setter(event.target.value);
  }

  const displayName = user.displayName || "Operator";
  const currentRun = runs[0];

  return (
    <div className="app">
      <aside className="sidebar">
        <Brand kicker="Control plane" />
        <div className="side-kicker">Workspace</div>
        <nav className="nav" aria-label="主导航">
          {[
            ["workspace", "▣", "Loop workspace"],
            ["runs", "⚑", "运行记录"],
            ["policies", "◇", "安全策略"],
          ].map(([view, icon, label]) => (
            <button
              className={activeView === view ? "active" : ""}
              key={view}
              onClick={() => {
                setActiveView(view);
                if (view !== "workspace") showToast("这个视图会在 Loop 运行后承载对应记录。");
              }}
              type="button"
            >
              <span className="nav-icon">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="user-chip">
          <div className="avatar">{displayName.slice(0, 1).toUpperCase()}</div>
          <div className="user-copy">
            <strong>{displayName}</strong>
            <span>{user.email || "—"}</span>
          </div>
          <button className="logout" onClick={onLogout} title="退出登录" type="button">
            ↗
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="breadcrumb">Operations · {activeView === "workspace" ? "Loop workspace" : activeView}</div>
            <div className="top-title">Engineering control center</div>
          </div>
          <div className="health"><i className="dot live" />服务在线</div>
        </header>

        <section className="page-intro">
          <div><div className="eyebrow">Core operation</div><h1>Loop workspace</h1></div>
          <span className="save-state">{notice}</span>
        </section>
        <div className="page-toolbar">
          <span>选择能力模板后，检查策略边界，再生成或派发执行计划。</span>
          <button className="secondary" onClick={() => void loadWorkspace()} type="button">刷新模板</button>
        </div>

        <div className="workspace">
          <section className="panel">
            <PanelHead title="01 · 连接项目" label="CONTEXT" />
            <div className="panel-body">
              <div className="repo-preview">
                <div className="repo-icon">⌘</div>
                <div className="repo-copy">
                  <strong>{repository ? project : "尚未关联仓库"}</strong>
                  <span>{repository || "输入仓库地址后开始"}</span>
                </div>
              </div>
              <Field label="GitHub repository URL"><input type="url" value={repository} onChange={updateField(setRepository)} placeholder="https://github.com/owner/repository" /></Field>
              <div className="grid-2">
                <Field label="项目名称"><input value={project} onChange={updateField(setProject)} /></Field>
                <Field label="默认分支"><input className="mono" value={branch} onChange={updateField(setBranch)} /></Field>
              </div>
              <details className="advanced">
                <summary>高级上下文设置</summary>
                <div className="grid-2">
                  <Field label="文档路径"><input className="mono" value={docs} onChange={updateField(setDocs)} /></Field>
                  <Field label="源码路径"><input className="mono" value={source} onChange={updateField(setSource)} /></Field>
                </div>
                <Field label="技术栈"><input className="mono" value={stack} onChange={updateField(setStack)} /></Field>
                <Field label="celld URL"><input className="mono" value={celld} onChange={updateField(setCelld)} /></Field>
              </details>
            </div>
          </section>

          <section className="panel">
            <PanelHead title="02 · 选择 Loop 能力" label="CAPABILITY" />
            <div className="panel-body">
              <div className="template-list">
                {templates.length ? templates.map((template) => (
                  <button className={`template ${selected?.id === template.id ? "selected" : ""}`} key={template.id} onClick={() => applyTemplate(template)} type="button">
                    <div className="template-top"><span className="template-title">{template.name}</span><span className="template-badge">{template.kind}</span></div>
                    <div className="template-summary">{template.summary}</div>
                    <div className="tags">{(template.capabilityTags || []).map((tag: string) => <span key={tag}>{tag}</span>)}</div>
                  </button>
                )) : <Empty>暂无能力模板。</Empty>}
              </div>
            </div>
          </section>

          <section className="panel wide">
            <PanelHead title="03 · Loop 执行台" label="EXECUTION" />
            <div className="panel-body">
              <div className="definition-head">
                <div><div className="definition-name">{definition?.name || "等待选择能力模板"}</div><div className="definition-goal">{selected?.summary || definition?.goal || "模板加载后，这里会显示它解决的问题与运行目标。"}</div></div>
                <span className="mode">{definition?.mode || "—"}</span>
              </div>
              <div className="grid-2">
                <Field label="Loop 名称"><input value={loopName} onChange={updateField(setLoopName)} /></Field>
                <Field label="Agent key"><input className="mono" value={agentKey} onChange={updateField(setAgentKey)} /></Field>
              </div>
              <Field label="本次目标描述"><textarea value={goal} onChange={updateField(setGoal)} placeholder="选择模板后生成目标描述" /></Field>
              <div className="section-label">执行阶段</div>
              <div className="stages">
                {(definition?.steps || []).map((step: AnyRecord, index: number) => (
                  <div className="stage" key={`${step.title}-${index}`}><div className="stage-no">{String(index + 1).padStart(2, "0")}</div><div><div className="stage-title">{step.title}</div><div className="stage-purpose">{step.purpose}</div><span className="stage-safety">{step.allowedPaths?.length ? `白名单：${step.allowedPaths.join("、")}` : "受控操作"}</span></div></div>
                ))}
                {!definition?.steps?.length && <Empty>选择一个模板查看阶段。</Empty>}
              </div>
              <div className="policy-grid">
                <Policy title="时间预算" value={`${definition?.budget?.maxDurationMinutes || 30} 分钟`} />
                <Policy title="调用预算" value={`${definition?.budget?.maxToolCalls || 200} 次工具调用`} />
                <Policy title="允许路径" value={definition?.safety?.allowedPaths?.join("、") || "不写入"} safe />
                <Policy title="保护分支" value={definition?.safety?.protectedBranches?.join("、") || "—"} safe />
              </div>
              <div className="section-label section-label-gap">不可绕过的闸门</div>
              <div className="guardrails">{[...(definition?.safety?.forbiddenActions || []), ...(definition?.escalationRules || [])].map((rule: string) => <div className="guardrail" key={rule}>{rule}</div>)}</div>
              <div className="action-bar">
                <button className="secondary" disabled={!!busy} onClick={() => void saveProject()} type="button">{busy === "save" ? "保存中…" : "保存项目"}</button>
                <button className="secondary" disabled={!!busy} onClick={() => void validate()} type="button">{busy === "validate" ? "验证中…" : "验证完整策略"}</button>
                <button className="primary" disabled={!!busy} onClick={() => void plan()} type="button">{busy === "plan" ? "生成中…" : "预览执行计划"}</button>
                <button className="primary" disabled={!!busy} onClick={() => void dispatch()} type="button">{busy === "dispatch" ? "派发中…" : "派发 Loop"}</button>
              </div>
            </div>
          </section>

          <section className="panel wide monitor">
            <div className="monitor-main">
              <div className="run-header"><div><div className="eyebrow">Live run monitor</div><div className="run-title">{currentRun ? `${currentRun.loopName} · ${statusLabel(currentRun.status)}` : "还没有运行"}</div></div><span className="run-status active"><i className="dot live" />{status}</span></div>
              <div className="metrics"><Metric value="—" label="Inbox events" /><Metric value="—" label="Tasks" /><Metric value="—" label="Artifacts" /></div>
              <div className="section-label">运行事件</div>
              <div className="timeline">{events.length ? events.map((event) => <div className="event" key={event.id}><strong>{event.eventType}</strong><span>{JSON.stringify(event.payloadJson)}</span></div>) : <Empty>验证或派发之后，运行事件会按最新顺序出现在这里。</Empty>}</div>
              <div className="identity">Agent cell identity · <code>{project || "project"} / {loopName || "loop"} / {agentKey || "agent"}</code></div>
            </div>
            <div className="monitor-side">
              <div className="side-title">Recent runs</div>
              <div className="recent-runs">{runs.length ? runs.slice(0, 6).map((run) => <button className="recent-run" key={run.id} onClick={() => void loadEvents(run.id)} type="button"><span><strong>{run.projectName} · {run.loopName}</strong><span>{run.agentCellId}</span></span><b className="recent-run-status">{statusLabel(run.status)}</b></button>) : <Empty>还没有持久化的运行记录。</Empty>}</div>
              <div className="side-title side-title-gap">Decision branches</div>
              <div className="decision-list">{(definition?.decisionRules || []).map((rule: AnyRecord) => <div className="decision" key={rule.signal}><strong>{rule.signal}</strong><span>{rule.action}</span></div>)}</div>
              <p className="footer-note">Loop 的每个分支都必须留下证据；无法安全判断时，停止并升级给人。</p>
            </div>
          </section>
        </div>
        {toast && <div className={`toast show ${error ? "error" : ""}`} role="status">{toast}</div>}
      </main>
    </div>
  );
}

function Brand({ kicker }: { kicker: string }) {
  return <div className="brand"><div className="brand-mark" aria-hidden="true">↻</div><div><div className="brand-name">looptask</div><div className="brand-kicker">{kicker}</div></div></div>;
}

function PanelHead({ title, label }: { title: string; label: string }) {
  return <div className="panel-head"><div><h2>{title}</h2></div><span className="step-count">{label}</span></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function Policy({ title, value, safe = false }: { title: string; value: string; safe?: boolean }) {
  return <div className={`policy ${safe ? "safe" : "warning"}`}><strong>{title}</strong><b>{value}</b></div>;
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="metric"><b>{value}</b><span>{label}</span></div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function statusLabel(status: string) {
  return ({ queued: "排队中", running: "运行中", passed: "已通过", failed: "失败", "needs-human": "待人工" } as Record<string, string>)[status] || status;
}