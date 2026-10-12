import test from "node:test";
import assert from "node:assert/strict";
import {
  encryptSecret,
  decryptSecret,
  hashPassword,
  verifyPassword,
  parseMentoraTaskId,
  mentoraProcessPayload,
  validBranch,
  parseRepository,
  validateCompletion,
  hmacHex,
  hmacVerify,
  validateLoop,
  buildLoopPlan,
  agentCellId,
} from "../src/worker.js";

test("mentora share links and ids parse strictly", () => {
  assert.equal(parseMentoraTaskId("task-1a2b3c4d5e6f"), "task-1a2b3c4d5e6f");
  assert.equal(parseMentoraTaskId("https://mentora.pub/tasks?task=task-abc123"), "task-abc123");
  assert.throws(() => parseMentoraTaskId(""));
  assert.throws(() => parseMentoraTaskId("https://mentora.pub/tasks"));
  assert.throws(() => parseMentoraTaskId("../../etc/passwd"));
});

test("mentora process payload carries PR link and artifacts", () => {
  const payload = JSON.parse(mentoraProcessPayload(42, "https://github.com/acme/r/pull/42", "fixed the crash"));
  assert.equal(payload.process_status, "completed");
  assert.match(payload.process_result, /pull\/42/);
  assert.deepEqual(JSON.parse(payload.result_artifacts), [{ name: "PR #42", url: "https://github.com/acme/r/pull/42" }]);
});

test("password hashing verifies and rejects wrong passwords", async () => {
  const { salt, hash } = await hashPassword("correct-horse-battery");
  assert.doesNotMatch(hash, /correct-horse/);
  assert.equal(await verifyPassword("correct-horse-battery", salt, hash), true);
  assert.equal(await verifyPassword("wrong-password-123", salt, hash), false);
});

test("github token encryption round-trips", async () => {
  const env = { SESSION_SECRET: "test-secret" };
  const blob = await encryptSecret(env, "ghu_secret_token_value");
  assert.doesNotMatch(blob, /ghu_secret_token_value/);
  assert.equal(await decryptSecret(env, blob), "ghu_secret_token_value");
});

test("executor signature is exact-body HMAC", async () => {
  const body = '{"callbackId":"one"}';
  const signature = await hmacHex("secret", `1000.${body}`);
  assert.equal(await hmacVerify("secret", `1000.${body}`, signature), true);
  assert.equal(await hmacVerify("secret", `1000.{"callbackId":"two"}`, signature), false);
  assert.equal(await hmacVerify("secret", `1000.${body}`, "zz"), false);
});

test("repository parsing is strict github https", () => {
  assert.equal(parseRepository("https://github.com/acme/widget.git").name, "widget");
  assert.throws(() => parseRepository("git@github.com:acme/widget.git"));
  assert.throws(() => parseRepository("https://github.com/acme/widget/issues"));
  assert.throws(() => parseRepository("https://evil.example/acme/widget"));
});

test("completion payload validation", () => {
  const good = {
    callbackId: "cb-1",
    dispatchId: "run:1",
    success: true,
    headBranch: "agent/change",
    headSha: "a".repeat(40),
    summary: "ok",
  };
  validateCompletion(good);
  assert.throws(() => validateCompletion({ ...good, headSha: "xyz" }));
  assert.throws(() => validateCompletion({ ...good, headBranch: "bad..branch" }));
  assert.throws(() => validateCompletion({ ...good, callbackId: "with space" }));
  assert.equal(validBranch("agent/change"), true);
});



test("loop plan and validation", () => {
  const project = {
    name: "looptask",
    loops: [
      {
        name: "fix-docs",
        goal: "修文档",
        summary: "",
        steps: [{ id: "s1", title: "t", purpose: "p", allowedPaths: ["docs/**"] }],
        safety: { forbiddenActions: ["merge"] },
        trigger: { type: "resident", intervalSeconds: 900 },
        agent: { cellIdTemplate: "{project}/{loop}/{agent}" },
      },
    ],
  };
  const { loopDef } = buildLoopPlan(project, "fix-docs");
  assert.equal(loopDef.name, "fix-docs");
  assert.equal(buildLoopPlan(project, "missing").reason, "loop 'missing' not found");
  assert.equal(agentCellId(project, loopDef, "default"), "looptask/fix-docs/default");

  const validation = validateLoop(project, "fix-docs");
  assert.equal(validation.accepted, true);
  assert.equal(validation.summary, "修文档");
  assert.equal(validation.stages[0].safety, "allowlist: docs/**");
  assert.ok(validation.guardrails.includes("merge"));

  const tooFast = structuredClone(project);
  tooFast.loops[0].trigger.intervalSeconds = 5;
  assert.match(buildLoopPlan(tooFast, "fix-docs").reason, /resident interval/);
});
