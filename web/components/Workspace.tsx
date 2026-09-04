"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

type AnyRecord = Record<string, any>;
type Template = AnyRecord & { id: string; definition: AnyRecord };
type Run = AnyRecord & { id: string; status: string };
type User = { displayName?: string; email?: string };
type TriggerMode = "manual" | "cron" | "resident";
type VerifierDraft = {
  name: string;
  command: string;
  timeoutSeconds: number;
};

const DEFAULTS = {
  hotMessageLimit: 50,
  maxSteps: 12,
  maxConsecutiveFailures: 3,
  largeFileLines: 500,
};

const TRIGGER_COPY: Record<TriggerMode, { label: string; description: string }> = {
  manual: {
    label: "立即执行",
    description: "由你确认后派发一次受控运行。",
  },
  cron: {
    label: "定时执行",
    description: "按 Cron 计划运行，并在每次派发前保留安全闸门。",
  },
  resident: {
    label: "常驻执行",
    description: "由 celld 持久化唤醒，按固定间隔重复进入 Agent cell。",
  },
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
  const [verifiers, setVerifiers] = useState<VerifierDraft[]>([]);
  const [enabledVerifiers, setEnabledVerifiers] = useState<boolean[]>([]);
  const [triggerMode, setTriggerMode] = useState<TriggerMode>("manual");
  const [cronSchedule, setCronSchedule] = useState("0 9 * * 1-5");
  const [residentInterval, setResidentInterval] = useState(900);
  const [status, setStatus] = useState("待命");
  const [notice, setNotice] = useState("未开始运行");
  const [activeView, setActiveView] = useState("workspace");
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState(false);
  const [projectImported, setProjectImported] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    verifiers,
    enabledVerifiers,
    triggerMode,
    cronSchedule,
    residentInterval,
  ]);

  useEffect(() => {
    void loadWorkspace();
  }, []);

  function buildProject(): AnyRecord {
    const baseLoop = definition
      ? { ...definition }
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
    const activeVerifiers = verifiers
      .filter((_, index) => enabledVerifiers[index] !== false)
      .filter((verifier) => verifier.command.trim())
      .map((verifier) => ({
        name: verifier.name.trim() || "acceptance-check",
        command: splitCommand(verifier.command),
        timeoutSeconds: verifier.timeoutSeconds || 300,
      }));

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
      loops: [
        {
          ...baseLoop,
          name: loopName.trim() || "untitled-loop",
          goal,
          verifiers: activeVerifiers,
          trigger:
            triggerMode === "cron"
              ? { type: "cron", schedule: cronSchedule.trim() || "0 9 * * 1-5" }
              : triggerMode === "resident"
                ? { type: "resident", intervalSeconds: residentInterval }
              : { type: "manual" },
        },
      ],
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
    const nextVerifiers = normalizeVerifiers(template.definition?.verifiers);
    setSelected(template);
    setLoopName(template.definition?.name || "");
    setGoal(template.definition?.goal || "");
    setVerifiers(nextVerifiers);
    setEnabledVerifiers(nextVerifiers.map(() => true));
    const templateTrigger = template.definition?.trigger;
    setTriggerMode(
      templateTrigger?.type === "cron"
        ? "cron"
        : templateTrigger?.type === "resident"
          ? "resident"
          : "manual",
    );
    if (template.definition?.trigger?.schedule) {
      setCronSchedule(template.definition.trigger.schedule);
    }
    if (templateTrigger?.intervalSeconds) {
      setResidentInterval(Number(templateTrigger.intervalSeconds));
    }
    setNotice(`已选择 ${template.name}`);
  }

  function restoreProject(config: AnyRecord, availableTemplates = templates) {
    setProject(config?.name || "looptask");
    setRepository(config?.repository || "");
    setProjectImported(Boolean(config?.repository));
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
      const nextVerifiers = normalizeVerifiers(loop.verifiers);
      setVerifiers(nextVerifiers);
      setEnabledVerifiers(nextVerifiers.map(() => true));
      setTriggerMode(
        loop.trigger?.type === "cron"
          ? "cron"
          : loop.trigger?.type === "resident"
            ? "resident"
            : "manual",
      );
      if (loop.trigger?.schedule) setCronSchedule(loop.trigger.schedule);
      if (loop.trigger?.intervalSeconds) {
        setResidentInterval(Number(loop.trigger.intervalSeconds));
      }
    }
    setNotice("已恢复保存的项目");
  }

  async function importProject() {
    if (!repository.trim()) {
      showToast("请先填写仓库地址，再导入项目。", true);
      return;
    }
    await runAction("import", async () => {
      await api("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify(projectConfig),
      });
      setProjectImported(true);
      setProjectModalOpen(false);
      setNotice("项目已导入");
      showToast("项目上下文已导入，Loop 可以继续配置。");
    });
  }

  async function saveProject() {
    await runAction("save", async () => {
      await api("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify(projectConfig),
      });
      setProjectImported(Boolean(repository.trim()));
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
      if (result.accepted) setActiveStep(3);
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
      if (result.accepted) setActiveStep(3);
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
       setStatus(triggerMode === "resident" ? "常驻中" : "运行中");
       setNotice(
         triggerMode === "resident"
           ? `常驻已启动 · 每 ${formatInterval(residentInterval)} 唤醒`
           : result.deduplicated
             ? "已复用原运行"
             : "正在运行",
       );
       showToast(
         triggerMode === "resident"
           ? `常驻 Loop 已启动，将每 ${formatInterval(residentInterval)} 唤醒 Agent cell。`
           : result.deduplicated
             ? "检测到重复派发，已复用原运行。"
             : "Loop 已进入 Agent cell。",
       );
      await loadRuns();
    });
  }

  async function stopResident() {
    await runAction("stop-resident", async () => {
      const result = await api<AnyRecord>("/api/v1/loops/resident/stop", {
        method: "POST",
        body: JSON.stringify({ project: projectConfig, loopName, agentKey }),
      });
      setStatus("已停止");
      setNotice(`常驻已停止 · 取消 ${result.cancelled || 0} 个唤醒`);
      showToast(`常驻执行已停止，取消 ${result.cancelled || 0} 个持久化唤醒。`);
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

  function selectView(view: string) {
    setActiveView(view);
    if (view === "runs") {
      document.getElementById("run-monitor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (view === "policies") {
      setActiveStep(3);
      document.getElementById("loop-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function updateVerifier(index: number, value: string) {
    setVerifiers((current) =>
      current.map((verifier, verifierIndex) =>
        verifierIndex === index ? { ...verifier, command: value } : verifier,
      ),
    );
  }

  function addVerifier() {
    setVerifiers((current) => [
      ...current,
      { name: `check-${current.length + 1}`, command: "", timeoutSeconds: 300 },
    ]);
    setEnabledVerifiers((current) => [...current, true]);
  }

  function removeVerifier(index: number) {
    setVerifiers((current) => current.filter((_, verifierIndex) => verifierIndex !== index));
    setEnabledVerifiers((current) => current.filter((_, verifierIndex) => verifierIndex !== index));
  }

  function toggleVerifier(index: number) {
    setEnabledVerifiers((current) =>
      current.map((enabled, verifierIndex) => (verifierIndex === index ? !enabled : enabled)),
    );
  }

  const displayName = user.displayName || "Operator";
  const currentRun = runs[0];
  const activeVerifierCount = verifiers.filter(
    (_, index) => enabledVerifiers[index] !== false,
  ).length;
  const readiness = [
    { label: "项目", ready: Boolean(projectImported && repository.trim()) },
    { label: "Prompt", ready: Boolean(goal.trim()) },
    { label: "验收", ready: activeVerifierCount > 0 && verifiers.some((item, index) => enabledVerifiers[index] !== false && item.command.trim()) },
    {
      label: "触发",
      ready:
        triggerMode === "manual" ||
        (triggerMode === "cron" && Boolean(cronSchedule.trim())) ||
        (triggerMode === "resident" && residentInterval >= 60),
    },
  ];
  const readinessCount = readiness.filter((item) => item.ready).length;
  const canRun =
    readinessCount === readiness.length &&
    Boolean(selected && loopName.trim()) &&
    !busy;
  const nextStepLabel = activeStep === 1 ? "配置验收" : activeStep === 2 ? "选择触发方式" : "检查并保存";

  return (
    <div className="app dashboard-app">
      <aside className="sidebar">
        <Brand kicker="Control plane" />
        <div className="project-rail">
          <div className="side-kicker">Active project</div>
          <button className="project-switcher" onClick={() => setProjectModalOpen(true)} type="button">
            <span className="project-avatar">{"</>"}</span>
            <span className="project-rail-copy">
              <strong>{projectImported ? project : "未关联项目"}</strong>
              <small>{projectImported ? `${branch} · ${statusLabel(status)}` : "点击关联仓库"}</small>
            </span>
            <span className="project-chevron">↗</span>
          </button>
        </div>
        <div className="side-kicker">Workspace</div>
        <nav className="nav" aria-label="主导航">
          {[
            ["workspace", "01", "Loop workspace"],
            ["runs", "02", "运行记录"],
            ["policies", "03", "安全策略"],
          ].map(([view, icon, label]) => (
            <button
              className={activeView === view ? "active" : ""}
              key={view}
              onClick={() => selectView(view)}
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
            <div className="breadcrumb">Operations / {activeView === "workspace" ? "Loop workspace" : activeView}</div>
            <div className="top-title">Engineering control center</div>
          </div>
          <div className="topbar-right">
            <span className="sync-label">{notice}</span>
            <div className="health"><i className="dot live" />服务在线</div>
          </div>
        </header>

        <section className="dashboard-hero">
          <div className="hero-copy">
            <div className="eyebrow">Loop control center</div>
            <div className="hero-title-row">
              <h1>{loopName || "Untitled Loop"}</h1>
              <span className={`status-badge ${readinessCount === 4 ? "ready" : ""}`}>
                {readinessCount === 4 ? "Ready to review" : "Draft"}
              </span>
            </div>
            <p>{goal || "先写清楚你希望 Agent 完成什么，再选择可验证的验收方式。"}</p>
            <div className="hero-meta">
              <span className="meta-chip">{projectImported ? project : "未关联项目"}</span>
              <span className="meta-chip">{TRIGGER_COPY[triggerMode].label}</span>
              <span className="meta-chip">{activeVerifierCount} 个验收检查</span>
            </div>
          </div>
          <div className="hero-actions">
            <button className="secondary" onClick={() => setProjectModalOpen(true)} type="button">
              {projectImported ? "编辑项目上下文" : "关联项目"}
            </button>
            {triggerMode === "resident" && (status === "常驻中" || status === "运行中") && (
              <button className="secondary danger-action" disabled={!!busy} onClick={() => void stopResident()} type="button">
                {busy === "stop-resident" ? "停止中…" : "停止常驻"}
              </button>
            )}
            <button className="primary dispatch-button" disabled={!canRun} onClick={() => void dispatch()} type="button">
              {busy === "dispatch" ? "派发中…" : "派发 Loop"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>

        <section className="readiness-strip" aria-label="Loop 就绪度">
          <div className="readiness-score">
            <span className="eyebrow">Readiness</span>
            <strong>{readinessCount}<small>/4</small></strong>
            <span>{readinessCount === 4 ? "可以审阅并派发" : "完成输入后继续"}</span>
          </div>
          <div className="readiness-track">
            {readiness.map((item, index) => (
              <div className={`readiness-item ${item.ready ? "ready" : ""}`} key={item.label}>
                <span className="readiness-number">0{index + 1}</span>
                <span>{item.label}</span>
                <i aria-hidden="true">{item.ready ? "✓" : "—"}</i>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-grid">
          <section className="panel builder-card" id="loop-builder">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Loop definition</div>
                <h2>把输入变成可执行 Loop</h2>
                <p>每一步都留下可验证证据，未准备好时不会误派发。</p>
              </div>
              <div className="template-picker">
                <label htmlFor="template-select">能力模板</label>
                <select
                  id="template-select"
                  value={selected?.id || ""}
                  onChange={(event) => {
                    const template = templates.find((item) => item.id === event.target.value);
                    if (template) applyTemplate(template);
                  }}
                >
                  <option value="">选择模板</option>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
              </div>
            </div>

            <div className="loop-stepper" role="tablist" aria-label="Loop 配置步骤">
              {[
                ["1", "Prompt", "执行意图"],
                ["2", "Acceptance", "验收证据"],
                ["3", "Trigger", "触发审阅"],
              ].map(([number, title, subtitle], index) => {
                const step = (index + 1) as 1 | 2 | 3;
                return (
                  <button
                    aria-selected={activeStep === step}
                    className={`step-tab ${activeStep === step ? "active" : ""} ${step < activeStep ? "complete" : ""}`}
                    key={number}
                    onClick={() => setActiveStep(step)}
                    role="tab"
                    type="button"
                  >
                    <span>{step < activeStep ? "✓" : number}</span>
                    <strong>{title}</strong>
                    <small>{subtitle}</small>
                  </button>
                );
              })}
            </div>

            <div className="builder-content" role="tabpanel">
              {activeStep === 1 && (
                <div className="builder-step prompt-step">
                  <div className="step-intro">
                    <span className="step-icon">01</span>
                    <div>
                      <h3>先写清楚 Agent 要完成什么</h3>
                      <p>Prompt 是 Loop 的执行意图，会随每次运行进入隔离的 Agent cell。</p>
                    </div>
                  </div>
                  <Field label="Loop 名称">
                    <input value={loopName} onChange={updateField(setLoopName)} placeholder="例如 docs-lifecycle-patrol" />
                  </Field>
                  <Field label="Prompt / 执行意图">
                    <textarea
                      className="prompt-input"
                      value={goal}
                      onChange={updateField(setGoal)}
                      placeholder="例如：检查最近的实现变更，找出文档漂移，只在允许路径内提出有证据的修复建议。"
                      rows={7}
                    />
                  </Field>
                  <div className="input-hint"><span>建议写清楚目标、允许做什么、不能做什么。</span><code>{goal.length} chars</code></div>
                  <div className="field-row">
                    <Field label="Agent key"><input className="mono" value={agentKey} onChange={updateField(setAgentKey)} /></Field>
                    <div className="inline-callout"><span className="callout-dot" />执行将在独立 worktree 中进行</div>
                  </div>
                </div>
              )}

              {activeStep === 2 && (
                <div className="builder-step acceptance-step">
                  <div className="step-intro">
                    <span className="step-icon">02</span>
                    <div>
                      <h3>定义什么结果才算完成</h3>
                      <p>每条验收命令会在 Agent 运行后执行，退出码与输出会进入运行证据。</p>
                    </div>
                  </div>
                  <div className="acceptance-list">
                    {verifiers.map((verifier, index) => {
                      const enabled = enabledVerifiers[index] !== false;
                      return (
                        <div className={`acceptance-row ${enabled ? "" : "disabled"}`} key={`${verifier.name}-${index}`}>
                          <button
                            aria-pressed={enabled}
                            className={`check-toggle ${enabled ? "checked" : ""}`}
                            onClick={() => toggleVerifier(index)}
                            title={enabled ? "停用此检查" : "启用此检查"}
                            type="button"
                          >
                            {enabled ? "✓" : ""}
                          </button>
                          <div className="acceptance-fields">
                            <input
                              aria-label={`验收检查 ${index + 1} 名称`}
                              className="check-name"
                              value={verifier.name}
                              onChange={(event) => setVerifiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                            />
                            <div className="command-input">
                              <span>$</span>
                              <input
                                aria-label={`验收命令 ${index + 1}`}
                                className="mono"
                                value={verifier.command}
                                onChange={(event) => updateVerifier(index, event.target.value)}
                                placeholder="输入验收命令，例如 npm test"
                              />
                            </div>
                          </div>
                          <span className="timeout-label">{verifier.timeoutSeconds}s</span>
                          <button className="remove-check" onClick={() => removeVerifier(index)} title="删除验收检查" type="button">×</button>
                        </div>
                      );
                    })}
                  </div>
                  <button className="add-check" onClick={addVerifier} type="button">+ 添加验收检查</button>
                  <div className="evidence-note"><span>Evidence</span> 运行记录会保存命令、退出码、摘要与 Artifact 引用。</div>
                </div>
              )}

              {activeStep === 3 && (
                <div className="builder-step trigger-step">
                  <div className="step-intro">
                    <span className="step-icon">03</span>
                    <div>
                      <h3>选择何时让这个 Loop 开始</h3>
                      <p>触发策略只决定派发时机，项目权限和安全闸门始终跟随每次运行。</p>
                    </div>
                  </div>
                  <div className="trigger-options">
                    {(Object.keys(TRIGGER_COPY) as TriggerMode[]).map((mode) => (
                      <button className={`trigger-option ${triggerMode === mode ? "selected" : ""}`} key={mode} onClick={() => setTriggerMode(mode)} type="button">
                        <span className="trigger-mark">{mode === "manual" ? "▶" : mode === "cron" ? "◷" : "∞"}</span>
                        <span><strong>{TRIGGER_COPY[mode].label}</strong><small>{TRIGGER_COPY[mode].description}</small></span>
                        <i>{triggerMode === mode ? "✓" : ""}</i>
                      </button>
                    ))}
                  </div>
                  {triggerMode === "cron" && (
                    <Field label="Cron 表达式">
                      <div className="cron-field"><span className="mono">cron</span><input className="mono" value={cronSchedule} onChange={updateField(setCronSchedule)} placeholder="0 9 * * 1-5" /></div>
                      <small className="field-help">按 UTC 执行；例如工作日每天 09:00。</small>
                    </Field>
                  )}
                  {triggerMode === "resident" && (
                    <Field label="唤醒间隔">
                      <div className="cron-field">
                        <span className="mono">every</span>
                        <input
                          className="mono"
                          min={60}
                          type="number"
                          value={residentInterval}
                          onChange={(event) => setResidentInterval(Number(event.target.value) || 0)}
                        />
                        <span className="mono">seconds</span>
                      </div>
                      <small className="field-help">
                        celld 会持久化下一次唤醒；最短 60 秒，当前间隔为每 {formatInterval(residentInterval)}。
                      </small>
                    </Field>
                  )}
                  <div className="review-banner">
                    <div className="review-icon">✓</div>
                    <div><strong>派发前人工审阅</strong><span>{definition?.agent?.humanGate === false ? "当前模板允许自动继续。" : "当前模板会在变更前请求人工确认。"}</span></div>
                  </div>
                </div>
              )}
            </div>

            <div className="builder-footer">
              <span className="builder-progress">Step {activeStep} of 3 · {nextStepLabel}</span>
              <div className="builder-actions">
                {activeStep > 1 && <button className="quiet" onClick={() => setActiveStep((activeStep - 1) as 1 | 2 | 3)} type="button">← 上一步</button>}
                {activeStep < 3 ? (
                  <button className="secondary" onClick={() => setActiveStep((activeStep + 1) as 1 | 2 | 3)} type="button">继续：{nextStepLabel} →</button>
                ) : (
                  <>
                    <button className="secondary" disabled={!!busy} onClick={() => void saveProject()} type="button">{busy === "save" ? "保存中…" : "保存草稿"}</button>
                    <button className="primary" disabled={!!busy || !selected} onClick={() => void validate()} type="button">{busy === "validate" ? "验证中…" : "验证完整策略"}</button>
                  </>
                )}
              </div>
            </div>
          </section>

          <aside className="inspector-column">
            <section className="panel inspector-card">
              <div className="panel-heading compact">
                <div><div className="eyebrow">Context</div><h2>运行上下文</h2></div>
                <button className="icon-button" onClick={() => setProjectModalOpen(true)} title="编辑项目上下文" type="button">↗</button>
              </div>
              <div className="context-card">
                <div className="context-icon">{"</>"}</div>
                <div><strong>{projectImported ? project : "尚未关联项目"}</strong><span>{repository || "关联仓库后，Loop 才能运行"}</span></div>
              </div>
              <div className="context-details">
                <Policy title="分支" value={branch || "—"} />
                <Policy title="技术栈" value={stack || "—"} />
                <Policy title="运行模式" value={definition?.mode || "—"} />
                <Policy title="Agent cell" value={agentKey || "default"} />
              </div>
              <button className="text-action" onClick={() => setProjectModalOpen(true)} type="button">{projectImported ? "查看项目设置" : "关联项目开始配置"} <span>→</span></button>
            </section>

            <section className="panel safety-card">
              <div className="panel-heading compact">
                <div><div className="eyebrow">Guardrails</div><h2>安全边界</h2></div>
                <span className="safe-label"><i className="dot live" />受控</span>
              </div>
              <div className="guardrail-list">
                <div><span className="guardrail-icon">✓</span><span>独立 worktree 执行</span></div>
                <div><span className="guardrail-icon">✓</span><span>保护分支：{definition?.safety?.protectedBranches?.join(" / ") || "main"}</span></div>
                <div><span className="guardrail-icon">✓</span><span>预算：{definition?.budget?.maxDurationMinutes || 30} 分钟 · {definition?.budget?.maxToolCalls || 200} 次调用</span></div>
                <div><span className="guardrail-icon">!</span><span>无法安全判断时升级给人工</span></div>
              </div>
              <button className="text-action" onClick={() => { setActiveStep(3); document.getElementById("loop-builder")?.scrollIntoView({ behavior: "smooth" }); }} type="button">查看触发与闸门 <span>→</span></button>
            </section>
          </aside>
        </section>

        <section className="panel monitor-panel" id="run-monitor">
          <div className="monitor-main">
            <div className="monitor-heading">
              <div><div className="eyebrow">Live run monitor</div><h2>{currentRun ? `${currentRun.loopName} · ${statusLabel(currentRun.status)}` : "还没有运行"}</h2></div>
              <span className="run-status active"><i className="dot live" />{status}</span>
            </div>
            <div className="metrics">
              <Metric value={events.length ? String(events.length) : "—"} label="Inbox events" />
              <Metric value={currentRun ? "1" : "—"} label="Active run" />
              <Metric value={currentRun?.status === "passed" ? "100%" : "—"} label="Acceptance" />
            </div>
            <div className="section-label">运行事件 <span>按时间顺序记录</span></div>
            <div className="timeline">
              {events.length ? events.map((event) => <div className="event" key={event.id}><strong>{event.eventType}</strong><span>{JSON.stringify(event.payloadJson)}</span></div>) : <Empty>验证或派发之后，运行事件会按最新顺序出现在这里。</Empty>}
            </div>
            <div className="identity">Agent cell identity · <code>{project || "project"} / {loopName || "loop"} / {agentKey || "agent"}</code></div>
          </div>
          <div className="monitor-side">
            <div className="side-title">Recent runs</div>
            <div className="recent-runs">{runs.length ? runs.slice(0, 6).map((run) => <button className="recent-run" key={run.id} onClick={() => void loadEvents(run.id)} type="button"><span><strong>{run.projectName} · {run.loopName}</strong><span>{run.agentCellId}</span></span><b className="recent-run-status">{statusLabel(run.status)}</b></button>) : <Empty>还没有持久化的运行记录。</Empty>}</div>
            <div className="side-title side-title-gap">Decision branches</div>
            <div className="decision-list">{(definition?.decisionRules || []).slice(0, 4).map((rule: AnyRecord) => <div className="decision" key={rule.signal}><strong>{rule.signal}</strong><span>{rule.action}</span></div>)}</div>
            <p className="footer-note">每个分支都必须留下证据；无法安全判断时，停止并升级给人。</p>
          </div>
        </section>

        {toast && <div className={`toast show ${error ? "error" : ""}`} role="status">{toast}</div>}
      </main>

      {projectModalOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProjectModalOpen(false); }}>
          <div aria-labelledby="project-dialog-title" aria-modal="true" className="project-dialog" role="dialog">
            <div className="dialog-heading">
              <div><div className="eyebrow">Project context</div><h2 id="project-dialog-title">{projectImported ? "编辑项目上下文" : "关联一个项目"}</h2><p>先导入仓库，再把 Loop 绑定到明确的分支和路径。</p></div>
              <button className="dialog-close" onClick={() => setProjectModalOpen(false)} title="关闭" type="button">×</button>
            </div>
            <div className="dialog-body">
              <Field label="GitHub repository URL"><input autoFocus type="url" value={repository} onChange={updateField(setRepository)} placeholder="https://github.com/owner/repository" /></Field>
              <div className="grid-2">
                <Field label="项目名称"><input value={project} onChange={updateField(setProject)} /></Field>
                <Field label="默认分支"><input className="mono" value={branch} onChange={updateField(setBranch)} /></Field>
              </div>
              <button className="advanced-toggle" onClick={() => setAdvancedOpen((open) => !open)} type="button"><span>{advancedOpen ? "⌄" : "›"}</span> 高级上下文设置</button>
              {advancedOpen && (
                <div className="advanced-fields">
                  <div className="grid-2">
                    <Field label="文档路径"><input className="mono" value={docs} onChange={updateField(setDocs)} /></Field>
                    <Field label="源码路径"><input className="mono" value={source} onChange={updateField(setSource)} /></Field>
                  </div>
                  <Field label="技术栈"><input className="mono" value={stack} onChange={updateField(setStack)} /></Field>
                  <Field label="celld URL"><input className="mono" value={celld} onChange={updateField(setCelld)} /></Field>
                </div>
              )}
            </div>
            <div className="dialog-footer">
              <span><i className="dot live" />只保存项目配置，不会自动派发 Loop</span>
              <div><button className="quiet" onClick={() => setProjectModalOpen(false)} type="button">取消</button><button className="primary" disabled={busy === "import"} onClick={() => void importProject()} type="button">{busy === "import" ? "导入中…" : projectImported ? "保存项目上下文" : "导入项目"} <span>→</span></button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Brand({ kicker }: { kicker: string }) {
  return <div className="brand"><div className="brand-mark" aria-hidden="true">↻</div><div><div className="brand-name">looptask</div><div className="brand-kicker">{kicker}</div></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function Policy({ title, value }: { title: string; value: string }) {
  return <div className="policy"><span>{title}</span><strong>{value}</strong></div>;
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

function splitCommand(value: string) {
  return value.trim().split(/\s+/).filter(Boolean);
}

function formatInterval(seconds: number) {
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400} 天`;
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

function normalizeVerifiers(value: AnyRecord[] | undefined): VerifierDraft[] {
  return (value || []).map((verifier) => ({
    name: verifier.name || "acceptance-check",
    command: Array.isArray(verifier.command) ? verifier.command.join(" ") : String(verifier.command || ""),
    timeoutSeconds: Number(verifier.timeoutSeconds || 300),
  }));
}

function statusLabel(status: string) {
  return ({ queued: "排队中", running: "运行中", passed: "已通过", failed: "失败", "needs-human": "待人工" } as Record<string, string>)[status] || status;
}