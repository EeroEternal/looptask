#!/usr/bin/env node
// looptask sandbox executor — claims runs from the looptask API (pull model),
// does the work in a disposable git worktree, and reports back through the
// HMAC completion callback. Untrusted commands run HERE, never in the Worker.
//
//   LOOPTASK_API                e.g. https://looptask-api.lipeng-sh.workers.dev
//   LOOPTASK_EXECUTOR_SECRET    >=32 bytes, must match the Worker secret
//   GIT_TOKEN                   optional: clone private repos / push branches
//   AGENT_CMD                   optional: shell command that does the agent work
//                               (cwd = worktree, $TASK_FILE = task description)
//   WORK_ROOT / KEEP_WORKDIR / POLL_MS   optional tuning
//
// Usage: node executor/executor.mjs [--once]
import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const API = (process.env.LOOPTASK_API || "").replace(/\/+$/, "");
const SECRET = process.env.LOOPTASK_EXECUTOR_SECRET || "";
const GIT_TOKEN = process.env.GIT_TOKEN || "";
const AGENT_CMD = process.env.AGENT_CMD || "";
const WORK_ROOT = process.env.WORK_ROOT || tmpdir();
const KEEP_WORKDIR = process.env.KEEP_WORKDIR === "1";
const POLL_MS = Number(process.env.POLL_MS || 15_000);

function requireConfig() {
  if (!API || SECRET.length < 32) {
    console.error("LOOPTASK_API and LOOPTASK_EXECUTOR_SECRET (>=32 bytes) are required");
    process.exit(1);
  }
}

const redact = (text) => (GIT_TOKEN ? String(text || "").replaceAll(GIT_TOKEN, "***") : String(text || ""));

export function sign(secret, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { "x-looptask-timestamp": timestamp, "x-looptask-signature": signature };
}

export function renderTask(task) {
  const loop = task.loop || {};
  const lines = [
    `【looptask 任务】${loop.name || "task"}（run ${task.runId}）`,
    `目标：${loop.goal || ""}`,
    `仓库：${task.repository || "(未绑定)"} · 默认分支 ${task.defaultBranch}`,
    `模式：${loop.mode || "report-only"}`,
  ];
  const steps = (loop.steps || []).map((s, i) => `${i + 1}. ${s.title || s.id} — ${s.purpose || ""}`);
  if (steps.length) lines.push("步骤：", ...steps);
  const verifiers = (loop.verifiers || []).map((v) => `${v.name}: ${(v.command || []).join(" ")}`);
  if (verifiers.length) lines.push("完成证明（全部通过才算完成）：", ...verifiers.map((v) => `- ${v}`));
  const forbidden = loop.safety?.forbiddenActions || [];
  const protectedBranches = loop.safety?.protectedBranches || [];
  if (protectedBranches.length || forbidden.length) {
    lines.push(
      `安全约束：禁止触碰保护分支 ${protectedBranches.join("、") || "main"}；禁止 ${forbidden.join("、") || "merge/push-main/tag"}`,
    );
  }
  if (loop.budget) {
    lines.push(`预算：${loop.budget.maxDurationMinutes} 分钟 / ${loop.budget.maxToolCalls} 次工具调用，触顶立即停止。`);
  }
  lines.push("完成后输出：做了什么、证据、遗留的 action。");
  return lines.join("\n");
}

async function claim() {
  const response = await fetch(`${API}/api/v1/executions/next`, {
    headers: { authorization: `Bearer ${SECRET}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`claim failed: ${response.status} ${redact(await response.text())}`);
  return response.json();
}

async function report(task, success, summary, headBranch, headSha) {
  const body = JSON.stringify({
    // Deterministic per run: retries of the same run are idempotent.
    callbackId: `cb-${task.runId}`,
    dispatchId: task.dispatchId,
    success,
    headBranch: headBranch || task.defaultBranch,
    headSha: headSha || "0".repeat(40),
    summary: redact(summary).slice(0, 10_000),
  });
  const response = await fetch(task.callback.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...sign(SECRET, body) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  console.log(`run ${task.runId}: reported success=${success} → HTTP ${response.status} ${redact(text)}`);
}

async function git(cwd, args, timeout = 120_000) {
  return gitRaw(["-C", cwd, ...args], timeout);
}

async function gitRaw(args, timeout = 120_000) {
  try {
    const { stdout } = await exec("git", args, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, output: stdout };
  } catch (error) {
    return { ok: false, output: redact(String(error.stdout || "") + error.message) };
  }
}

async function runCommand(command, cwd, timeoutSeconds, taskFile) {
  const [cmd, ...args] = command;
  try {
    const { stdout } = await exec(cmd, args, {
      cwd,
      env: { ...process.env, TASK_FILE: taskFile || "" },
      timeout: (timeoutSeconds || 300) * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, output: redact(stdout).slice(0, 4000) };
  } catch (error) {
    return { ok: false, output: redact(String(error.stdout || "") + error.message).slice(0, 4000) };
  }
}

async function execute(task) {
  const root = await mkdtemp(join(WORK_ROOT, "looptask-"));
  const workdir = join(root, "repo");
  const taskFile = join(root, "TASK.md");
  const notes = [];
  try {
    const remote = GIT_TOKEN
      ? task.repository.replace("https://", `https://x-access-token:${GIT_TOKEN}@`)
      : task.repository;
    const clone = await gitRaw(
      ["clone", "--depth", "50", "--branch", task.defaultBranch, remote, workdir],
      180_000,
    );
    if (!clone.ok) return report(task, false, `clone failed: ${clone.output}`);
    // TASK.md lives OUTSIDE the worktree so it never shows up as a repo change.
    await writeFile(taskFile, renderTask(task), "utf8");

    const budgetMinutes = task.loop?.budget?.maxDurationMinutes || 30;
    if (AGENT_CMD) {
      const result = await runCommand(["bash", "-c", AGENT_CMD], workdir, budgetMinutes * 60, taskFile);
      notes.push(`agent: ${result.ok ? "ok" : "failed"}\n${result.output}`);
      if (!result.ok) return report(task, false, notes.join("\n"), task.defaultBranch, await headSha(workdir));
    } else {
      for (const step of task.loop?.steps || []) {
        if (!step.command?.length) continue;
        const result = await runCommand(step.command, workdir, 900, taskFile);
        notes.push(`step ${step.id || "?"}: ${result.ok ? "ok" : "failed"}\n${result.output}`);
        if (!result.ok) return report(task, false, notes.join("\n"), task.defaultBranch, await headSha(workdir));
      }
    }
    for (const verifier of task.loop?.verifiers || []) {
      const result = await runCommand(verifier.command, workdir, verifier.timeoutSeconds || 300, taskFile);
      notes.push(`verifier ${verifier.name}: ${result.ok ? "pass" : "FAIL"}\n${result.output}`);
      if (!result.ok) return report(task, false, notes.join("\n"), task.defaultBranch, await headSha(workdir));
    }

    await git(workdir, ["add", "-A"]);
    const status = await git(workdir, ["status", "--porcelain"]);
    if (!status.output.trim()) {
      // report-only: nothing changed — hand back the default branch and the
      // Worker records the report without opening a PR.
      return report(task, true, notes.join("\n"), task.defaultBranch, await headSha(workdir));
    }

    const branch = `looptask/${task.runId.slice(0, 8)}`;
    await git(workdir, ["config", "user.email", "looptask@local"]);
    await git(workdir, ["config", "user.name", "looptask executor"]);
    const commit = await git(workdir, ["commit", "-m", `looptask: ${task.loop?.name || task.runId}`], 60_000);
    if (!commit.ok) return report(task, false, `commit failed: ${commit.output}`, task.defaultBranch, await headSha(workdir));
    const push = await git(workdir, ["push", "-u", "origin", `HEAD:refs/heads/${branch}`], 180_000);
    if (!push.ok) return report(task, false, `push failed: ${push.output}`, task.defaultBranch, await headSha(workdir));
    return report(task, true, notes.join("\n"), branch, await headSha(workdir));
  } finally {
    if (!KEEP_WORKDIR) await rm(root, { recursive: true, force: true });
    else console.log(`workdir kept: ${root}`);
  }
}

async function headSha(workdir) {
  const result = await git(workdir, ["rev-parse", "HEAD"]);
  return result.ok ? result.output.trim() : "0".repeat(40);
}

async function main() {
  requireConfig();
  const once = process.argv.includes("--once");
  console.log(`looptask executor → ${API}`);
  for (;;) {
    let task = null;
    try {
      task = await claim();
    } catch (error) {
      console.error(`claim error: ${redact(error.message)}`);
    }
    if (!task) {
      if (once) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      continue;
    }
    console.log(`run ${task.runId}: claimed (${task.repository} @ ${task.defaultBranch})`);
    try {
      await execute(task);
    } catch (error) {
      console.error(`run ${task.runId}: ${redact(error.message)}`);
      await report(task, false, `executor error: ${error.message}`);
    }
    if (once) return;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
