import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  FileCheck2,
  GitCommitHorizontal,
  Image,
  Info,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  Terminal,
  TimerReset,
  UserRound,
  Zap,
} from "lucide-react";

type Stage = "intake" | "actions" | "checks" | "evidence" | "budget" | "escalation";

const stages: { id: Stage; label: string; meta: string }[] = [
  { id: "intake", label: "Prompt intake", meta: "Captured 09:41" },
  { id: "actions", label: "Agent actions", meta: "7 actions" },
  { id: "checks", label: "Acceptance checks", meta: "3 / 4 clear" },
  { id: "evidence", label: "Evidence", meta: "12 artifacts" },
  { id: "budget", label: "Budget", meta: "$18.40 used" },
  { id: "escalation", label: "Human escalation", meta: "Standing by" },
];

const actionLog = [
  { time: "09:43:08", icon: Terminal, title: "Inspected repository structure", detail: "Found 14 packages · no lockfile drift", tone: "green" },
  { time: "09:44:26", icon: Code2, title: "Updated task scheduler", detail: "src/scheduler/retry_policy.rs · +42 −18", tone: "lime" },
  { time: "09:46:01", icon: GitCommitHorizontal, title: "Created commit a1f4c8d", detail: "Retry backoff follows workspace policy", tone: "green" },
  { time: "09:47:19", icon: ShieldCheck, title: "Ran cargo test --workspace", detail: "143 passed · 0 failed · 31.2s", tone: "green" },
  { time: "09:49:54", icon: AlertTriangle, title: "Flagged behavior outside prompt", detail: "Worker timeout changes need an owner decision", tone: "amber" },
];

const evidence = [
  { type: "diff", title: "retry_policy.diff", detail: "Before / after · 28 KB", status: "Verified" },
  { type: "check", title: "workspace-test.log", detail: "143 passed · 0 failed", status: "Verified" },
  { type: "image", title: "scheduler-trace.png", detail: "Captured from run timeline", status: "Attached" },
];

function IconBox({ children, tint = "sage" }: { children: ReactNode; tint?: "sage" | "lime" | "amber" | "peach" }) {
  const tones = {
    sage: "bg-[#e3eee3] text-[#38735c]",
    lime: "bg-[#e8efb8] text-[#5c7029]",
    amber: "bg-[#fff0d9] text-[#a66327]",
    peach: "bg-[#f8e4dc] text-[#a94f3e]",
  };
  return <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tones[tint]}`}>{children}</span>;
}

function StepDot({ state }: { state: "done" | "active" | "idle" }) {
  if (state === "done") return <span className="grid h-5 w-5 place-items-center rounded-full bg-[#dce88f] text-[#526a2b]"><Check className="h-3 w-3" strokeWidth={3} /></span>;
  if (state === "active") return <span className="grid h-5 w-5 place-items-center rounded-full border-2 border-[#b8c96b] bg-[#f7f9ef]"><span className="h-2 w-2 rounded-full bg-[#94ab48]" /></span>;
  return <span className="grid h-5 w-5 place-items-center rounded-full border border-[#cbd5c9] bg-[#f5f7f2]"><Circle className="h-2.5 w-2.5 text-[#b3beb2]" /></span>;
}

function SectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#7c8b80]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#c6d653]" />{eyebrow}
        </div>
        <h2 className="font-['Space_Grotesk'] text-[19px] font-semibold tracking-[-0.045em] text-[#18362f]">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function RunDetail() {
  const [activeStage, setActiveStage] = useState<Stage>("actions");
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState("Run is live · awaiting operator decision");
  const [expandedAction, setExpandedAction] = useState(1);
  const [checks, setChecks] = useState([true, true, true, false]);
  const [escalated, setEscalated] = useState(false);
  const [showAllEvidence, setShowAllEvidence] = useState(false);

  const passed = checks.filter(Boolean).length;
  const progress = Math.round((passed / checks.length) * 100);
  const activeIndex = stages.findIndex((stage) => stage.id === activeStage);

  const stageState = useMemo(() => (index: number) => index < activeIndex ? "done" : index === activeIndex ? "active" : "idle", [activeIndex]);
  function announce(message: string) {
    setNotice(message);
  }
  function setStage(stage: Stage) {
    setActiveStage(stage);
    announce(`${stages.find((item) => item.id === stage)?.label} selected`);
  }

  return (
    <div className="min-h-[100dvh] bg-[#edf1eb] text-[#18362f] selection:bg-[#dce88f]">
      <style>{`
        @keyframes run-in { from { opacity: 0; transform: translateY(7px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes breathe { 0%,100% { opacity:.4 } 50% { opacity:1 } }
        .run-in { animation: run-in .45s ease-out both }
        .run-delay-1 { animation-delay:.05s } .run-delay-2 { animation-delay:.1s } .run-delay-3 { animation-delay:.15s }
        .hide-scroll::-webkit-scrollbar { display:none }
      `}</style>
      <div className="mx-auto min-h-[100dvh] max-w-[1540px] border-x border-[#d8e0d7] bg-[#f4f6f1]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d9e1d7] bg-[#eef2eb] px-5 py-4 sm:px-8">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => announce("Back to command center")} className="grid h-8 w-8 place-items-center rounded-lg border border-[#d4ddd3] bg-[#f8faf5] text-[#62756a] transition hover:border-[#aebf72] hover:text-[#193a31]" aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="h-7 w-px bg-[#d4ded4]" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] font-bold text-[#38584a]">run-218</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-[#c3dfcf] bg-[#e4f2e9] px-2 py-0.5 text-[9px] font-bold text-[#247459]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4b9b71]" /> Running</span>
              </div>
              <div className="mt-1 text-[10px] text-[#839087]">Retry policy hardening · started 8 min ago</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setPaused(!paused); announce(paused ? "Run resumed" : "Run paused"); }} className="inline-flex items-center gap-2 rounded-lg border border-[#d3ded2] bg-[#f8faf5] px-3 py-2 text-[10px] font-bold text-[#577166] transition hover:border-[#b4c576]">
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{paused ? "Resume run" : "Pause run"}
            </button>
            <button type="button" onClick={() => announce("Run actions menu opened")} className="grid h-8 w-8 place-items-center rounded-lg border border-[#d3ded2] bg-[#f8faf5] text-[#698076] hover:border-[#b4c576]" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></button>
          </div>
        </header>

        <div className="grid lg:grid-cols-[242px_1fr]">
          <aside className="border-b border-[#d9e1d7] bg-[#e8eee6] px-5 py-6 lg:min-h-[calc(100dvh-73px)] lg:border-b-0 lg:border-r lg:px-6">
            <div className="mb-7 flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[#193f36] text-[#dce88f]"><Zap className="h-4 w-4" fill="currentColor" /></span>
              <div><div className="font-['Space_Grotesk'] text-[16px] font-semibold tracking-[-0.04em]">looptask</div><div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#829087]">Run detail</div></div>
            </div>
            <div className="mb-3 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-[#87958a]"><span>Dispatch trail</span><span className="font-mono text-[9px] normal-case tracking-normal text-[#a0aba0]">6 steps</span></div>
            <nav className="relative space-y-1" aria-label="Run stages">
              <div className="absolute left-[9px] top-4 bottom-4 w-px bg-[#cad7c9]" />
              {stages.map((stage, index) => (
                <button type="button" key={stage.id} onClick={() => setStage(stage.id)} className={`relative flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition ${activeStage === stage.id ? "bg-[#f5f8ef] shadow-[0_2px_7px_rgba(50,78,50,.06)]" : "hover:bg-[#eff4ed]"}`}>
                  <StepDot state={stageState(index)} />
                  <span className="min-w-0"><span className={`block text-[11px] font-bold ${activeStage === stage.id ? "text-[#244c3e]" : "text-[#668073]"}`}>{stage.label}</span><span className="mt-0.5 block truncate text-[9px] text-[#93a097]">{stage.meta}</span></span>
                  {activeStage === stage.id && <ChevronRight className="ml-auto h-3.5 w-3.5 text-[#8ea354]" />}
                </button>
              ))}
            </nav>
            <div className="mt-8 rounded-xl border border-[#d6e0d2] bg-[#f1f5ed] p-3.5">
              <div className="flex items-center justify-between text-[10px] font-bold text-[#5c776a]"><span>Run health</span><span className="text-[#477d62]">Stable</span></div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#d9e4d5]"><div className="h-full w-[78%] rounded-full bg-[#86a64d]" /></div>
              <div className="mt-2 flex justify-between text-[9px] text-[#89988c]"><span>14:08 elapsed</span><span>$18.40</span></div>
            </div>
          </aside>

          <main className="min-w-0 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
            <div className="run-in mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#819087]"><Radio className="h-3.5 w-3.5 text-[#69985f]" /> Live execution record</div>
                <h1 className="font-['Space_Grotesk'] text-[29px] font-semibold tracking-[-0.06em] text-[#16362d] sm:text-[35px]">Retry policy hardening</h1>
                <p className="mt-2 max-w-[630px] text-[12px] leading-5 text-[#73837a]">Follow the dispatch from its original prompt through agent work, acceptance signals, and the one decision that needs a human.</p>
              </div>
              <div className="rounded-xl border border-[#d7e1d5] bg-[#edf5e7] px-4 py-3 text-right"><div className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#7c8b7e]">Last signal</div><div className="mt-1 text-[11px] font-semibold text-[#3d6f59]">{notice}</div></div>
            </div>

            <section className="run-in run-delay-1 rounded-xl border border-[#d5dfd4] bg-[#f8faf6] shadow-[0_6px_22px_rgba(36,61,40,.035)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e0e7dd] px-5 py-4 sm:px-6">
                <SectionTitle eyebrow="Prompt intake · 09:41:02" title="The request that started this run" action={<button type="button" onClick={() => { navigator.clipboard?.writeText("Harden retry policy for the workspace scheduler"); announce("Prompt copied"); }} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#6d833c] hover:text-[#294d3e]"><Copy className="h-3 w-3" /> Copy prompt</button>} />
              </div>
              <div className="grid gap-5 px-5 py-5 md:grid-cols-[1fr_230px] md:px-6">
                <div className="rounded-lg border border-[#e0e7dc] bg-[#f1f5ed] p-4 text-[13px] leading-6 text-[#345447]">“Harden the retry policy for the workspace scheduler. Keep API behavior compatible, add evidence for changed backoff behavior, and stop for review if the work touches worker timeouts.”</div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-lg bg-[#eef3eb] p-3"><div className="text-[#89978d]">Source</div><div className="mt-1 font-semibold text-[#4e6b5c]">Manual dispatch</div></div>
                  <div className="rounded-lg bg-[#eef3eb] p-3"><div className="text-[#89978d]">Branch</div><div className="mt-1 font-mono font-semibold text-[#4e6b5c]">main</div></div>
                  <div className="rounded-lg bg-[#eef3eb] p-3"><div className="text-[#89978d]">Policy</div><div className="mt-1 font-semibold text-[#4e6b5c]">Guarded</div></div>
                  <div className="rounded-lg bg-[#eef3eb] p-3"><div className="text-[#89978d]">Owner</div><div className="mt-1 flex items-center gap-1 font-semibold text-[#4e6b5c]"><span className="grid h-4 w-4 place-items-center rounded-full bg-[#d2e1bf] text-[8px]">MC</span>Maya Chen</div></div>
                </div>
              </div>
            </section>

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.82fr]">
              <section className="run-in run-delay-2 rounded-xl border border-[#d5dfd4] bg-[#f8faf6] shadow-[0_6px_22px_rgba(36,61,40,.035)]">
                <div className="border-b border-[#e0e7dd] px-5 py-5 sm:px-6"><SectionTitle eyebrow="Agent actions · 09:43—09:49" title="What the agent did" action={<span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f2e5] px-2.5 py-1 text-[9px] font-bold text-[#4e7c5c]"><Activity className="h-3 w-3" /> Live ledger</span>} /></div>
                <div className="px-5 py-2 sm:px-6">
                  {actionLog.map((action, index) => {
                    const ActionIcon = action.icon;
                    const open = expandedAction === index;
                    return <div key={action.title} className="border-b border-[#e5ebe2] last:border-b-0">
                      <button type="button" onClick={() => setExpandedAction(open ? -1 : index)} className="flex w-full items-center gap-3 py-3.5 text-left">
                        <IconBox tint={action.tone === "amber" ? "amber" : action.tone === "lime" ? "lime" : "sage"}><ActionIcon className="h-4 w-4" /></IconBox>
                        <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold text-[#3e5e50]">{action.title}</span><span className="mt-1 block truncate text-[10px] text-[#87968b]">{action.detail}</span></span>
                        <span className="font-mono text-[9px] text-[#a0aaa1]">{action.time}</span><ChevronDown className={`h-3.5 w-3.5 text-[#8c9a8f] transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                      {open && <div className="mb-3 ml-11 rounded-lg border border-[#dce7d8] bg-[#f0f5eb] px-3.5 py-3 text-[10px] leading-5 text-[#6c7e72]">Action completed inside the guarded workspace. <button type="button" onClick={() => announce(`${action.title} details opened`)} className="font-bold text-[#6d873b] hover:underline">View trace <ArrowUpRight className="inline h-3 w-3" /></button></div>}
                    </div>;
                  })}
                </div>
              </section>

              <div className="space-y-5">
                <section className="run-in run-delay-2 rounded-xl border border-[#d5dfd4] bg-[#f8faf6] p-5 shadow-[0_6px_22px_rgba(36,61,40,.035)]">
                  <SectionTitle eyebrow="Acceptance checks" title="Is it safe to accept?" action={<span className="font-mono text-[11px] font-bold text-[#638047]">{passed} / {checks.length}</span>} />
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#e1e8de]"><div className="h-full rounded-full bg-[#8ea951] transition-all" style={{ width: `${progress}%` }} /></div>
                  <div className="mt-4 space-y-2">
                    {["Regression suite passes", "API contract stays compatible", "Before / after diff attached", "Worker timeout has an owner"].map((label, index) => <button type="button" key={label} onClick={() => { const next = [...checks]; next[index] = !next[index]; setChecks(next); announce(`${label} ${next[index] ? "cleared" : "needs a signal"}`); }} className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-[#eef4e9]">
                      <span className={`grid h-5 w-5 place-items-center rounded-md border ${checks[index] ? "border-[#b6ca6a] bg-[#dce88f] text-[#526a2b]" : "border-[#cbd7ca] bg-[#f5f7f2] text-transparent"}`}><Check className="h-3 w-3" strokeWidth={3} /></span>
                      <span className={`text-[11px] font-semibold ${checks[index] ? "text-[#426550]" : "text-[#829188]"}`}>{label}</span>
                      {index === 3 && !checks[index] && <span className="ml-auto rounded-full bg-[#fff0d9] px-2 py-1 text-[8px] font-bold text-[#a66327]">Needs owner</span>}
                    </button>)}
                  </div>
                  <button type="button" onClick={() => setStage("checks")} className="mt-3 flex items-center gap-1 text-[10px] font-bold text-[#6d853e] hover:text-[#274c3d]">Open acceptance policy <ChevronRight className="h-3 w-3" /></button>
                </section>
                <section className="run-in run-delay-3 rounded-xl border border-[#d5dfd4] bg-[#f8faf6] p-5 shadow-[0_6px_22px_rgba(36,61,40,.035)]">
                  <SectionTitle eyebrow="Budget" title="Spend is in bounds" action={<TimerReset className="h-4 w-4 text-[#7b9270]" />} />
                  <div className="mt-4 flex items-end justify-between"><div><span className="font-['Space_Grotesk'] text-[28px] font-semibold tracking-[-.06em] text-[#294d3e]">$18.40</span><span className="ml-2 text-[10px] text-[#829189]">of $65.00</span></div><span className="text-[10px] font-bold text-[#668653]">28.3%</span></div>
                  <div className="mt-3 h-2 rounded-full bg-[#e2e9df]"><div className="h-full w-[28%] rounded-full bg-[#91a94f]" /></div>
                  <div className="mt-2 flex justify-between text-[9px] text-[#9aa69d]"><span>Compute $11.20</span><span>Tools $7.20</span></div>
                </section>
              </div>
            </div>

            <section className="run-in run-delay-3 mt-5 rounded-xl border border-[#d5dfd4] bg-[#f8faf6] shadow-[0_6px_22px_rgba(36,61,40,.035)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e0e7dd] px-5 py-5 sm:px-6"><SectionTitle eyebrow="Evidence · attached to this run" title="Signals you can inspect" action={<button type="button" onClick={() => { setShowAllEvidence(!showAllEvidence); announce(showAllEvidence ? "Showing key evidence" : "Showing all evidence"); }} className="text-[10px] font-bold text-[#6d853e] hover:text-[#294d3e]">{showAllEvidence ? "Show key evidence" : "View all 12 artifacts"} <ChevronRight className="inline h-3 w-3" /></button>} /></div>
              <div className="grid gap-3 p-5 sm:grid-cols-3 sm:px-6">
                {(showAllEvidence ? [...evidence, { type: "diff", title: "agent-trace.json", detail: "Execution metadata · 4 KB", status: "Attached" }] : evidence).map((item) => <button type="button" key={item.title} onClick={() => announce(`${item.title} opened`)} className="flex items-center gap-3 rounded-lg border border-[#dfe7dd] bg-[#f1f5ed] p-3 text-left transition hover:border-[#baca83] hover:bg-[#edf4e7]"><IconBox tint={item.type === "image" ? "lime" : "sage"}>{item.type === "image" ? <Image className="h-4 w-4" /> : item.type === "check" ? <FileCheck2 className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}</IconBox><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-bold text-[#466454]">{item.title}</span><span className="mt-1 block text-[9px] text-[#8b998e]">{item.detail}</span></span><span className="text-[8px] font-bold text-[#6b9059]">{item.status}</span></button>)}
              </div>
            </section>

            <section className={`run-in run-delay-3 mt-5 rounded-xl border p-5 shadow-[0_6px_22px_rgba(36,61,40,.035)] sm:p-6 ${escalated ? "border-[#c2d78d] bg-[#f1f6e7]" : "border-[#ead3bd] bg-[#fff8ef]"}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex gap-3"><IconBox tint={escalated ? "lime" : "amber"}>{escalated ? <CheckCircle2 className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}</IconBox><div><div className="mb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-[#a16c3f]">Human escalation</div><h2 className="font-['Space_Grotesk'] text-[19px] font-semibold tracking-[-.045em] text-[#5f4835]">{escalated ? "Decision routed to Maya Chen" : "One decision is waiting on you"}</h2><p className="mt-2 max-w-[670px] text-[11px] leading-5 text-[#8d7560]">{escalated ? "The run will remain paused at this boundary until the owner responds." : "The agent found a worker timeout change adjacent to the request. It stopped before widening scope."}</p></div></div>
                <span className="rounded-full border border-[#f0cfad] bg-[#fff1df] px-2.5 py-1 text-[9px] font-bold text-[#a1612f]">{escalated ? "Escalated" : "Needs review"}</span>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#efdcc8] pt-4">
                <div className="flex items-center gap-2 text-[10px] text-[#9a7e66]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#ead8c3] text-[9px] font-bold text-[#805d42]">MC</span><span><b className="text-[#6b533f]">Maya Chen</b> · repository owner</span></div>
                <div className="flex gap-2"><button type="button" onClick={() => { setEscalated(true); setPaused(true); announce("Decision routed to Maya Chen"); }} className="inline-flex items-center gap-2 rounded-lg bg-[#274d3d] px-3.5 py-2.5 text-[10px] font-bold text-[#f0f5df] transition hover:bg-[#1d4032]"><UserRound className="h-3.5 w-3.5" /> {escalated ? "Waiting for owner" : "Escalate to owner"}</button><button type="button" onClick={() => announce("Scope decision recorded: keep timeout change out")} className="rounded-lg border border-[#e5c9ac] bg-[#fffaf2] px-3.5 py-2.5 text-[10px] font-bold text-[#8d684b] transition hover:border-[#c8a87d]">Keep scope narrow</button></div>
              </div>
            </section>
            <div className="mt-5 flex items-center gap-2 text-[10px] text-[#91a097]"><Info className="h-3.5 w-3.5" /> All actions are recorded against <span className="font-mono text-[#647b6e]">run-218</span><span className="mx-1">·</span><button type="button" onClick={() => announce("Audit trail opened")} className="font-bold text-[#6d853e] hover:underline">Open audit trail</button></div>
          </main>
        </div>
      </div>
    </div>
  );
}
