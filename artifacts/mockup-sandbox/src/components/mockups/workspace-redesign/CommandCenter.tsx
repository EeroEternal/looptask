import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Box,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  Code2,
  Command,
  FileCheck2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  Info,
  Layers3,
  LockKeyhole,
  MoreHorizontal,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  TimerReset,
  TriangleAlert,
  UserRound,
  X,
  Zap,
} from "lucide-react";

type TriggerMode = "run-now" | "scheduled" | "resident";
type RunState = "running" | "passed" | "needs-review" | "failed";

type CheckItem = {
  id: string;
  label: string;
  detail: string;
  required: boolean;
};

type Run = {
  id: string;
  state: RunState;
  started: string;
  duration: string;
  commit: string;
  evidence: string;
  note: string;
};

const checkItems: CheckItem[] = [
  {
    id: "tests",
    label: "Regression suite passes",
    detail: "cargo test --workspace",
    required: true,
  },
  {
    id: "contract",
    label: "API contract stays compatible",
    detail: "No breaking changes in /contracts",
    required: true,
  },
  {
    id: "evidence",
    label: "Attach a before / after diff",
    detail: "Diff artifact required for review",
    required: true,
  },
  {
    id: "owner",
    label: "Route uncertainty to an owner",
    detail: "Escalate after 15 minutes without signal",
    required: false,
  },
];

const initialRuns: Run[] = [
  {
    id: "run-218",
    state: "running",
    started: "8 min ago",
    duration: "08:14",
    commit: "a1f4c8d",
    evidence: "12 artifacts",
    note: "Watching acceptance evidence",
  },
  {
    id: "run-217",
    state: "passed",
    started: "Yesterday",
    duration: "21:42",
    commit: "7d92be1",
    evidence: "18 artifacts",
    note: "Merged after operator review",
  },
  {
    id: "run-216",
    state: "needs-review",
    started: "2 days ago",
    duration: "14:08",
    commit: "2c10a9e",
    evidence: "6 artifacts",
    note: "Behavior changed outside prompt scope",
  },
  {
    id: "run-215",
    state: "passed",
    started: "3 days ago",
    duration: "18:31",
    commit: "f8041b2",
    evidence: "15 artifacts",
    note: "No policy exceptions",
  },
];

const modeCopy: Record<TriggerMode, { title: string; detail: string; meta: string }> = {
  "run-now": {
    title: "Run now",
    detail: "One controlled dispatch",
    meta: "Manual",
  },
  scheduled: {
    title: "Scheduled",
    detail: "Weekdays at 09:00 UTC",
    meta: "Cron",
  },
  resident: {
    title: "Resident",
    detail: "Listen for repository events",
    meta: "Always on",
  },
};

function stateLabel(state: RunState) {
  return {
    running: "Running",
    passed: "Passed",
    "needs-review": "Needs review",
    failed: "Failed",
  }[state];
}

function stateTone(state: RunState) {
  return {
    running: "text-[#176d58] bg-[#e4f2e9] border-[#c3dfcf]",
    passed: "text-[#176d58] bg-[#e4f2e9] border-[#c3dfcf]",
    "needs-review": "text-[#a65a22] bg-[#fff0dd] border-[#f1cfaa]",
    failed: "text-[#a43d32] bg-[#fce7e3] border-[#eabbb4]",
  }[state];
}

function StateIcon({ state }: { state: RunState }) {
  if (state === "running") return <RefreshCw className="h-3.5 w-3.5 animate-[spin_3s_linear_infinite]" />;
  if (state === "passed") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (state === "failed") return <TriangleAlert className="h-3.5 w-3.5" />;
  return <AlertTriangle className="h-3.5 w-3.5" />;
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#68756e]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#c6d653]" />
        {children}
      </div>
      {action}
    </div>
  );
}

function Metric({
  label,
  value,
  change,
  positive,
}: {
  label: string;
  value: string;
  change?: string;
  positive?: boolean;
}) {
  return (
    <div className="border-l border-[#d7ded6] pl-4 first:border-l-0 first:pl-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-[#7b877f]">{label}</div>
      <div className="mt-1 flex items-end gap-2">
        <span className="font-['Space_Grotesk'] text-[25px] font-semibold tracking-[-0.06em] text-[#17332d]">{value}</span>
        {change && (
          <span className={`mb-1 flex items-center text-[10px] font-bold ${positive ? "text-[#23795f]" : "text-[#ad5f2d]"}`}>
            {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {change}
          </span>
        )}
      </div>
    </div>
  );
}

function RunPill({ state }: { state: RunState }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold ${stateTone(state)}`}>
      <StateIcon state={state} />
      {stateLabel(state)}
    </span>
  );
}

export function CommandCenter() {
  const [triggerMode, setTriggerMode] = useState<TriggerMode>("run-now");
  const [checks, setChecks] = useState<Record<string, boolean>>({
    tests: true,
    contract: true,
    evidence: true,
    owner: false,
  });
  const [runs, setRuns] = useState(initialRuns);
  const [selectedRun, setSelectedRun] = useState<string>("run-218");
  const [showDetails, setShowDetails] = useState(false);
  const [showAllChecks, setShowAllChecks] = useState(false);
  const [notice, setNotice] = useState("Ready for review");
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const requiredChecks = checkItems.filter((item) => item.required);
  const completedRequired = requiredChecks.filter((item) => checks[item.id]).length;
  const readiness = Math.round((completedRequired / requiredChecks.length) * 100);
  const activeRun = runs.find((run) => run.id === selectedRun) ?? runs[0];

  const readinessCopy = useMemo(() => {
    if (readiness === 100) {
      return {
        label: "Guardrails clear",
        detail: "Every required acceptance check has a signal.",
        tone: "text-[#176d58] bg-[#e4f2e9] border-[#c3dfcf]",
      };
    }
    return {
      label: "Review required",
      detail: `${requiredChecks.length - completedRequired} required check${requiredChecks.length - completedRequired === 1 ? "" : "s"} still needs a signal.`,
      tone: "text-[#a65a22] bg-[#fff0dd] border-[#f1cfaa]",
    };
  }, [completedRequired, readiness, requiredChecks.length]);

  function announce(message: string) {
    setNotice(message);
  }

  function toggleCheck(id: string) {
    setChecks((current) => ({ ...current, [id]: !current[id] }));
    const item = checkItems.find((check) => check.id === id);
    if (item) announce(`${item.label} ${checks[id] ? "marked incomplete" : "marked complete"}`);
  }

  function cycleRunState(id: string) {
    setRuns((current) =>
      current.map((run) => {
        if (run.id !== id) return run;
        const next: RunState = run.state === "running" ? "needs-review" : run.state === "needs-review" ? "passed" : run.state === "passed" ? "running" : "running";
        return { ...run, state: next, note: next === "passed" ? "Accepted by operator" : next === "running" ? "Dispatch acknowledged" : "Waiting for an operator decision" };
      }),
    );
    announce("Run state updated locally");
  }

  function dispatch() {
    const newRun: Run = {
      id: `run-${219 + runs.length}`,
      state: "running",
      started: "just now",
      duration: "00:00",
      commit: "working",
      evidence: "0 artifacts",
      note: triggerMode === "run-now" ? "Manual dispatch acknowledged" : `${modeCopy[triggerMode].title} policy queued`,
    };
    setRuns((current) => [newRun, ...current]);
    setSelectedRun(newRun.id);
    announce(triggerMode === "run-now" ? "Dispatch acknowledged · run is live" : `${modeCopy[triggerMode].title} policy saved`);
  }

  return (
    <div className="min-h-[100dvh] bg-[#edf1ec] text-[#17332d] selection:bg-[#dce88f] selection:text-[#17332d]">
      <style>{`
        @keyframes command-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse-line { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
        .command-enter { animation: command-enter .45s ease-out both; }
        .delay-1 { animation-delay: .06s; } .delay-2 { animation-delay: .12s; } .delay-3 { animation-delay: .18s; } .delay-4 { animation-delay: .24s; }
        .hairline-grid { background-image: linear-gradient(#dfe6de 1px, transparent 1px), linear-gradient(90deg, #dfe6de 1px, transparent 1px); background-size: 24px 24px; }
        .scroll-clean::-webkit-scrollbar { display: none; }
      `}</style>

      <div className="mx-auto flex min-h-[100dvh] max-w-[1680px]">
        <aside className="hidden w-[226px] shrink-0 flex-col border-r border-[#d7ded6] bg-[#e6ebe5] px-5 py-6 lg:flex">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#173c35] text-[#dce88f] shadow-[0_5px_14px_rgba(23,60,53,.14)]">
              <Command className="h-[18px] w-[18px]" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-['Space_Grotesk'] text-[17px] font-semibold tracking-[-0.04em]">looptask</div>
              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.17em] text-[#77847b]">Control plane</div>
            </div>
          </div>

          <div className="mt-12 text-[10px] font-bold uppercase tracking-[0.16em] text-[#87938a]">Workspace</div>
          <nav className="mt-3 space-y-1" aria-label="Workspace navigation">
            <button type="button" onClick={() => announce("Loop workspace is the active view")} className="flex w-full items-center gap-3 rounded-lg bg-[#dbe6d9] px-3 py-2.5 text-left text-[12px] font-bold text-[#173c35]">
              <Layers3 className="h-4 w-4 text-[#68822f]" /> Loop workspace <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#bdd23c]" />
            </button>
            <button type="button" onClick={() => announce("Run history is available in this prototype")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] font-medium text-[#68756e] transition hover:bg-[#eef2ed] hover:text-[#173c35]">
              <History className="h-4 w-4" /> Run history <span className="ml-auto text-[10px] text-[#9aa49c]">24</span>
            </button>
            <button type="button" onClick={() => announce("Policy library is locked to the selected project")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] font-medium text-[#68756e] transition hover:bg-[#eef2ed] hover:text-[#173c35]">
              <ShieldCheck className="h-4 w-4" /> Policy library
            </button>
          </nav>

          <div className="mt-10 text-[10px] font-bold uppercase tracking-[0.16em] text-[#87938a]">Pinned project</div>
          <button type="button" onClick={() => announce("Project context is already attached to this Loop")} className="mt-3 rounded-xl border border-[#d5ded3] bg-[#eef2ed] p-3 text-left transition hover:border-[#b2c47b]">
            <div className="flex items-center gap-2.5">
              <div className="grid h-7 w-7 place-items-center rounded-md bg-[#d8e0d5] text-[#526b35]"><Code2 className="h-3.5 w-3.5" /></div>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-bold">looptask / core</div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#7f8a82]"><GitBranch className="h-3 w-3" /> main</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#68756e]"><span className="h-1.5 w-1.5 rounded-full bg-[#3c9b72]" /> synced 2 min ago</div>
          </button>

          <div className="mt-auto border-t border-[#d2dbd1] pt-4">
            <button type="button" onClick={() => announce("Project settings opened")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[11px] text-[#68756e] transition hover:bg-[#eef2ed] hover:text-[#173c35]"><Settings2 className="h-4 w-4" /> Project settings</button>
            <div className="mt-3 flex items-center gap-2.5 px-2">
              <div className="grid h-7 w-7 place-items-center rounded-full bg-[#c4d486] text-[11px] font-bold text-[#294532]">OP</div>
              <div className="min-w-0"><div className="truncate text-[11px] font-bold">Operator</div><div className="truncate text-[10px] text-[#7f8a82]">operator@looptask.local</div></div>
              <button type="button" title="Account menu" onClick={() => announce("Account menu opened")} className="ml-auto text-[#87938a]"><MoreHorizontal className="h-4 w-4" /></button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d7ded6] bg-[#edf1ec] px-5 py-4 sm:px-8 lg:px-10">
            <div className="flex items-center gap-3 text-[11px] text-[#7b877f]">
              <span className="font-bold uppercase tracking-[0.13em] text-[#87938a]">Operations</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-semibold text-[#52635a]">Loop workspace</span>
              <span className="hidden h-4 w-px bg-[#d1d9d0] sm:block" />
              <span className="hidden items-center gap-1.5 sm:flex"><CircleDot className="h-3.5 w-3.5 text-[#5da478]" /> all systems nominal</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" title="Search" onClick={() => announce("Search is ready for project and run context")} className="grid h-8 w-8 place-items-center rounded-lg border border-[#d6dfd4] bg-[#f2f5f1] text-[#68756e] transition hover:border-[#abbf70] hover:text-[#173c35]"><Search className="h-4 w-4" /></button>
              <button type="button" title="Notifications" onClick={() => announce("No unread operational alerts")} className="relative grid h-8 w-8 place-items-center rounded-lg border border-[#d6dfd4] bg-[#f2f5f1] text-[#68756e] transition hover:border-[#abbf70] hover:text-[#173c35]"><Bell className="h-4 w-4" /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#bd5c36]" /></button>
              <div className="hidden items-center gap-2 border-l border-[#d5ddd4] pl-3 text-[11px] text-[#68756e] sm:flex"><span className="h-2 w-2 rounded-full bg-[#57a17a]" /> Cell cluster healthy</div>
            </div>
          </header>

          <div className="px-5 pb-10 pt-7 sm:px-8 lg:px-10">
            <div className="command-enter flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.17em] text-[#75837a]">
                  <span className="rounded bg-[#dbe6d9] px-2 py-1 text-[#526c40]">Project context attached</span>
                  <span className="text-[#acb5ab]">/</span>
                  <span>Last edited 11 min ago</span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <h1 className="font-['Space_Grotesk'] text-[29px] font-semibold tracking-[-0.065em] text-[#17332d] sm:text-[36px]">Documentation lifecycle patrol</h1>
                  <span className="rounded-full border border-[#d2dfaa] bg-[#eef4d9] px-2.5 py-1 text-[10px] font-bold text-[#5e7131]">draft · v14</span>
                </div>
                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#68756e]">Review documentation drift after implementation changes and prepare a safe, evidence-backed patch for human approval.</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowDetails((current) => !current)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#ced8ce] bg-[#f3f6f2] px-3.5 text-[11px] font-bold text-[#52635a] transition hover:border-[#a5b875] hover:text-[#173c35]"><SlidersHorizontal className="h-3.5 w-3.5" /> Configure <ChevronDown className={`h-3.5 w-3.5 transition ${showDetails ? "rotate-180" : ""}`} /></button>
                <button type="button" onClick={dispatch} disabled={readiness < 100} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#173c35] px-4 text-[11px] font-bold text-[#edf4cb] shadow-[0_5px_14px_rgba(23,60,53,.13)] transition hover:-translate-y-0.5 hover:bg-[#225249] disabled:cursor-not-allowed disabled:opacity-45"><Play className="h-3.5 w-3.5 fill-current" /> {triggerMode === "run-now" ? "Run Loop" : "Save trigger"}</button>
              </div>
            </div>

            <div className="command-enter delay-1 mt-7 grid grid-cols-2 gap-4 rounded-xl border border-[#d5dfd4] bg-[#e8eee7] px-5 py-4 sm:grid-cols-4 sm:px-6">
              <Metric label="Readiness" value={`${readiness}%`} change={readiness === 100 ? "clear" : "blocked"} positive={readiness === 100} />
              <Metric label="Run success" value="93.8%" change="+4.2%" positive />
              <Metric label="Avg. duration" value="18m 42s" change="-2m" positive />
              <Metric label="Budget remaining" value="72%" change="healthy" positive />
            </div>

            <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
              <div className="min-w-0 space-y-5">
                <section className="command-enter delay-2 rounded-xl border border-[#d5dfd4] bg-[#f5f7f3] shadow-[0_8px_25px_rgba(34,60,44,.035)]">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#dce4da] px-5 py-5 sm:px-6">
                    <div>
                      <SectionLabel>Loop intent</SectionLabel>
                      <h2 className="font-['Space_Grotesk'] text-[18px] font-semibold tracking-[-0.045em] text-[#17332d]">Prompt and operating boundary</h2>
                    </div>
                    <button type="button" onClick={() => announce("Prompt editor opened")} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#607b3a] transition hover:text-[#173c35]">Edit prompt <ChevronRight className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="grid gap-0 lg:grid-cols-[1.18fr_.82fr]">
                    <div className="border-b border-[#dce4da] px-5 py-5 lg:border-b-0 lg:border-r sm:px-6">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7d8b81]"><SquareTerminal className="h-3.5 w-3.5 text-[#78943d]" /> Prompt</div>
                      <p className="max-w-2xl text-[14px] leading-6 text-[#2b4840]">Inspect the latest implementation changes, identify documentation drift, and propose updates only where repository evidence supports the claim. Do not modify protected branches or invent behavior.</p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-[#e9efe5] px-2 py-1.5 font-mono text-[10px] text-[#617269]"><GitBranch className="h-3 w-3" /> main</span>
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-[#e9efe5] px-2 py-1.5 font-mono text-[10px] text-[#617269]"><Archive className="h-3 w-3" /> README.md</span>
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-[#e9efe5] px-2 py-1.5 font-mono text-[10px] text-[#617269]"><LockKeyhole className="h-3 w-3" /> no direct writes</span>
                      </div>
                    </div>
                    <div className="bg-[#eef3ec] px-5 py-5 sm:px-6">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7d8b81]"><GitPullRequest className="h-3.5 w-3.5 text-[#78943d]" /> Project source</div>
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#dbe5d7] text-[#526d38]"><Code2 className="h-5 w-5" /></div>
                        <div><div className="text-[13px] font-bold">looptask / core</div><div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-[#7c8980]"><GitCommitHorizontal className="h-3 w-3" /> a1f4c8d · main</div></div>
                      </div>
                      <div className="mt-5 grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-[#dae3d8] bg-[#f5f7f3] p-2.5"><div className="text-[10px] text-[#87938a]">Stack</div><div className="mt-1 text-[11px] font-bold text-[#44584e]">Rust · TypeScript</div></div>
                        <div className="rounded-lg border border-[#dae3d8] bg-[#f5f7f3] p-2.5"><div className="text-[10px] text-[#87938a]">Cell</div><div className="mt-1 text-[11px] font-bold text-[#44584e]">default</div></div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="command-enter delay-3 rounded-xl border border-[#d5dfd4] bg-[#f5f7f3] shadow-[0_8px_25px_rgba(34,60,44,.035)]">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#dce4da] px-5 py-5 sm:px-6">
                    <div>
                      <SectionLabel action={<span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${readinessCopy.tone}`}>{readinessCopy.label}</span>}>Acceptance evidence</SectionLabel>
                      <h2 className="font-['Space_Grotesk'] text-[18px] font-semibold tracking-[-0.045em] text-[#17332d]">What must be true before completion</h2>
                      <p className="mt-1 text-[11px] text-[#7b877f]">{readinessCopy.detail}</p>
                    </div>
                    <span className="font-mono text-[11px] text-[#78857c]">{completedRequired}/{requiredChecks.length} required</span>
                  </div>
                  <div className="px-5 py-2 sm:px-6">
                    {(showAllChecks ? checkItems : checkItems.slice(0, 3)).map((item) => (
                      <button type="button" key={item.id} onClick={() => toggleCheck(item.id)} className="group flex w-full items-center gap-3 border-b border-[#e1e7df] py-3.5 text-left last:border-b-0">
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border transition ${checks[item.id] ? "border-[#a9be56] bg-[#dce88f] text-[#3a542a]" : "border-[#c5d0c5] bg-[#f7f9f5] text-transparent group-hover:border-[#91aa52]"}`}><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
                        <span className="min-w-0 flex-1"><span className={`block text-[12px] font-bold ${checks[item.id] ? "text-[#2d4a40]" : "text-[#64736a]"}`}>{item.label}{item.required && <span className="ml-1 text-[10px] font-medium text-[#a0aaa1]">required</span>}</span><span className="mt-1 block font-mono text-[10px] text-[#89958c]">{item.detail}</span></span>
                        {checks[item.id] ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#4f966f]" /> : <Circle className="h-4 w-4 shrink-0 text-[#c2ccc2]" />}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setShowAllChecks((current) => !current)} className="flex w-full items-center justify-center gap-1 border-t border-[#dce4da] py-3 text-[10px] font-bold text-[#68803c] transition hover:bg-[#eef4e6]">{showAllChecks ? "Show fewer checks" : "Show all checks"} <ChevronDown className={`h-3 w-3 transition ${showAllChecks ? "rotate-180" : ""}`} /></button>
                </section>

                {showDetails && (
                  <section className="command-enter rounded-xl border border-[#cdd9b2] bg-[#eff4db] p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div><SectionLabel>Deep configuration</SectionLabel><h2 className="font-['Space_Grotesk'] text-[18px] font-semibold tracking-[-0.045em]">Policy boundary</h2></div>
                      <button type="button" aria-label="Close configuration" onClick={() => setShowDetails(false)} className="text-[#748261] transition hover:text-[#173c35]"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-[#d6e1b9] bg-[#f7f9eb] p-3"><div className="text-[10px] text-[#87936e]">Time budget</div><div className="mt-1 text-[14px] font-bold">30 minutes</div><div className="mt-2 h-1 rounded-full bg-[#dbe4bd]"><div className="h-1 w-[64%] rounded-full bg-[#859a48]" /></div></div>
                      <div className="rounded-lg border border-[#d6e1b9] bg-[#f7f9eb] p-3"><div className="text-[10px] text-[#87936e]">Tool calls</div><div className="mt-1 text-[14px] font-bold">200 max</div><div className="mt-2 h-1 rounded-full bg-[#dbe4bd]"><div className="h-1 w-[28%] rounded-full bg-[#859a48]" /></div></div>
                      <div className="rounded-lg border border-[#d6e1b9] bg-[#f7f9eb] p-3"><div className="text-[10px] text-[#87936e]">Escalation</div><div className="mt-1 text-[14px] font-bold">Human gated</div><div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-[#65783d]"><UserRound className="h-3 w-3" /> on ambiguity</div></div>
                    </div>
                    <div className="mt-4 grid gap-2 text-[11px] text-[#5e6d4c] sm:grid-cols-2"><div className="flex items-center gap-2"><LockKeyhole className="h-3.5 w-3.5" /> Protected branch: <strong>main</strong></div><div className="flex items-center gap-2"><FileCheck2 className="h-3.5 w-3.5" /> Write access: <strong>README.md only</strong></div></div>
                  </section>
                )}
              </div>

              <div className="min-w-0 space-y-5">
                <section className="command-enter delay-2 rounded-xl border border-[#d5dfd4] bg-[#f5f7f3] shadow-[0_8px_25px_rgba(34,60,44,.035)]">
                  <div className="border-b border-[#dce4da] px-5 py-5">
                    <SectionLabel>Trigger strategy</SectionLabel>
                    <h2 className="font-['Space_Grotesk'] text-[18px] font-semibold tracking-[-0.045em] text-[#17332d]">When should this Loop act?</h2>
                    <p className="mt-1 text-[11px] leading-5 text-[#7b877f]">Choose one policy. The project context and guardrails travel with every dispatch.</p>
                  </div>
                  <div className="space-y-2 p-4">
                    {(Object.keys(modeCopy) as TriggerMode[]).map((mode) => {
                      const selected = triggerMode === mode;
                      const Icon = mode === "run-now" ? Zap : mode === "scheduled" ? CalendarClock : Radio;
                      return (
                        <button type="button" key={mode} onClick={() => { setTriggerMode(mode); announce(`${modeCopy[mode].title} trigger selected`); }} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${selected ? "border-[#aebf67] bg-[#edf3d7] shadow-[inset_3px_0_0_#879d43]" : "border-[#dce4da] bg-[#f8faf7] hover:border-[#b9c9a2] hover:bg-[#f1f5ed]"}`}>
                          <span className={`grid h-8 w-8 place-items-center rounded-lg ${selected ? "bg-[#dce88f] text-[#4e672b]" : "bg-[#e8eee7] text-[#7a897e]"}`}><Icon className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[12px] font-bold text-[#365046]">{modeCopy[mode].title}<span className="rounded bg-[#e6ece4] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#8a978d]">{modeCopy[mode].meta}</span></span><span className="mt-1 block text-[10px] text-[#7c8980]">{modeCopy[mode].detail}</span></span>
                          <span className={`grid h-4 w-4 place-items-center rounded-full border ${selected ? "border-[#819543] bg-[#819543]" : "border-[#c2cec1]"}`}>{selected && <Check className="h-3 w-3 text-[#f2f6df]" strokeWidth={3} />}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mx-4 mb-4 rounded-lg border border-[#dce4da] bg-[#eef3ec] p-3.5">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7b897e]"><TimerReset className="h-3.5 w-3.5 text-[#78943d]" /> {triggerMode === "run-now" ? "Dispatch window" : triggerMode === "scheduled" ? "Next scheduled run" : "Resident signal"}</div>
                    <div className="mt-2 flex items-end justify-between gap-3"><div className="font-['Space_Grotesk'] text-[17px] font-semibold text-[#345146]">{triggerMode === "run-now" ? "Now · manual approval" : triggerMode === "scheduled" ? "Today, 09:00 UTC" : "Listening · webhook connected"}</div><button type="button" onClick={() => announce("Trigger details opened")} className="text-[#6d853c]"><Info className="h-4 w-4" /></button></div>
                  </div>
                </section>

                <section className="command-enter delay-3 overflow-hidden rounded-xl border border-[#d5dfd4] bg-[#f5f7f3] shadow-[0_8px_25px_rgba(34,60,44,.035)]">
                  <div className="flex items-center justify-between border-b border-[#dce4da] px-5 py-5">
                    <div><SectionLabel>Current run</SectionLabel><h2 className="font-['Space_Grotesk'] text-[18px] font-semibold tracking-[-0.045em] text-[#17332d]">Execution health</h2></div>
                    <button type="button" onClick={() => cycleRunState(activeRun.id)} title="Advance run state" className="rounded-md p-1.5 text-[#78943d] transition hover:bg-[#e8efdb]"><RefreshCw className="h-4 w-4" /></button>
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3"><div><div className="font-mono text-[11px] text-[#849188]">{activeRun.id} · {activeRun.started}</div><div className="mt-2 flex items-center gap-2"><RunPill state={activeRun.state} /><span className="text-[11px] text-[#7b877f]">{activeRun.note}</span></div></div><div className="text-right"><div className="font-['Space_Grotesk'] text-[25px] font-semibold tracking-[-0.06em] text-[#315247]">{activeRun.duration}</div><div className="text-[10px] text-[#8b978e]">elapsed</div></div></div>
                    <div className="hairline-grid relative mt-5 h-[75px] overflow-hidden rounded-lg border border-[#dce5da] bg-[#edf3ea]"><div className="absolute inset-x-0 top-[43px] border-t border-dashed border-[#a8bca0]" /><div className="absolute left-[17%] top-[31px] h-3 w-3 rounded-full border-2 border-[#eff4db] bg-[#6b9d76] shadow-[0_0_0_3px_#c8dfcb]" /><div className="absolute left-[43%] top-[17px] h-3 w-3 rounded-full border-2 border-[#eff4db] bg-[#6b9d76] shadow-[0_0_0_3px_#c8dfcb]" /><div className="absolute left-[68%] top-[38px] h-3 w-3 rounded-full border-2 border-[#eff4db] bg-[#d39655] shadow-[0_0_0_3px_#f0ddc6]" /><div className="absolute left-[84%] top-[29px] h-3 w-3 animate-pulse rounded-full border-2 border-[#eff4db] bg-[#b6ca4d] shadow-[0_0_0_3px_#dce88f]" /><div className="absolute bottom-2 left-3 text-[9px] font-medium text-[#8b988e]">prompt accepted</div><div className="absolute bottom-2 right-3 text-[9px] font-medium text-[#8b988e]">evidence stream</div></div>
                    <div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-lg bg-[#eef3ec] p-2.5"><div className="text-[10px] text-[#87938a]">Tasks</div><div className="mt-1 text-[14px] font-bold">7 / 11</div></div><div className="rounded-lg bg-[#eef3ec] p-2.5"><div className="text-[10px] text-[#87938a]">Artifacts</div><div className="mt-1 text-[14px] font-bold">12</div></div><div className="rounded-lg bg-[#eef3ec] p-2.5"><div className="text-[10px] text-[#87938a]">Budget</div><div className="mt-1 text-[14px] font-bold">28%</div></div></div>
                    <button type="button" onClick={() => announce("Live event stream opened")} className="mt-4 flex w-full items-center justify-between rounded-lg border border-[#d8e3d5] bg-[#eef4e8] px-3 py-2.5 text-left transition hover:border-[#aebf72]"><span className="flex items-center gap-2 text-[10px] font-semibold text-[#5f7566]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5aa276]" /> Waiting for acceptance evidence</span><ChevronRight className="h-3.5 w-3.5 text-[#82917f]" /></button>
                  </div>
                </section>
              </div>
            </div>

            <section className="command-enter delay-4 mt-5 rounded-xl border border-[#d5dfd4] bg-[#f5f7f3] shadow-[0_8px_25px_rgba(34,60,44,.035)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dce4da] px-5 py-5 sm:px-6">
                <div><SectionLabel action={<span className="ml-2 inline-flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal text-[#87938a]"><Activity className="h-3 w-3 text-[#6d9b72]" /> live ledger</span>}>Recent execution evidence</SectionLabel><h2 className="font-['Space_Grotesk'] text-[18px] font-semibold tracking-[-0.045em] text-[#17332d]">Runs you can trust</h2></div>
                <button type="button" onClick={() => announce("Run history filtered to this Loop")} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#68803c] transition hover:text-[#173c35]">View run history <ChevronRight className="h-3.5 w-3.5" /></button>
              </div>
              <div className="scroll-clean overflow-x-auto">
                <div className="min-w-[660px]">
                  <div className="grid grid-cols-[1.25fr_.7fr_.55fr_.7fr_1.2fr] gap-3 px-5 py-3 text-[9px] font-bold uppercase tracking-[0.13em] text-[#909b92] sm:px-6"><span>Run</span><span>Status</span><span>Duration</span><span>Evidence</span><span>Operator note</span></div>
                  {runs.slice(0, 4).map((run) => (
                    <button type="button" key={run.id} onClick={() => { setSelectedRun(run.id); announce(`${run.id} selected`); }} className={`grid w-full grid-cols-[1.25fr_.7fr_.55fr_.7fr_1.2fr] items-center gap-3 border-t border-[#e1e7df] px-5 py-3.5 text-left transition sm:px-6 ${selectedRun === run.id ? "bg-[#eef4e4]" : "hover:bg-[#f0f4ee]"}`}>
                      <span className="flex items-center gap-3"><span className={`grid h-7 w-7 place-items-center rounded-md ${run.state === "running" ? "bg-[#dce88f] text-[#58722d]" : "bg-[#e5ece3] text-[#718178]"}`}><Activity className="h-3.5 w-3.5" /></span><span><span className="block font-mono text-[11px] font-bold text-[#3e584d]">{run.id}</span><span className="mt-0.5 block text-[10px] text-[#8a968d]">{run.started} · {run.commit}</span></span></span>
                      <span><RunPill state={run.state} /></span><span className="font-mono text-[10px] text-[#6f7f74]">{run.duration}</span><span className="text-[11px] font-semibold text-[#5c7164]">{run.evidence}</span><span className="truncate text-[11px] text-[#718077]">{run.note}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <footer className="mt-5 flex flex-col items-start justify-between gap-3 border-t border-[#d7ded6] pt-4 text-[10px] text-[#89958b] sm:flex-row sm:items-center">
              <div className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-[#729044]" /> Execution policy v3.8 · changes require review</div>
              <div className="flex items-center gap-4"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#58a176]" /> Agent cell online</span><span>UTC · 14:32:08</span></div>
            </footer>
          </div>
        </main>
      </div>

      {notice && (
        <div className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[#bdcba0] bg-[#eef4d9] px-3.5 py-2.5 text-[11px] font-semibold text-[#526a32] shadow-[0_10px_30px_rgba(46,67,40,.14)]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")} className="ml-2 text-[#829451] transition hover:text-[#31472b]"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </div>
  );
}