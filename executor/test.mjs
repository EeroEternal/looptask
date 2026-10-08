import test from "node:test";
import assert from "node:assert/strict";
import { sign, renderTask } from "./executor.mjs";
import { hmacVerify } from "../worker/src/worker.js";

test("executor signature verifies against the worker's HMAC check", async () => {
  const body = '{"callbackId":"cb-1","success":true}';
  const headers = sign("secret", body);
  assert.equal(
    await hmacVerify("secret", `${headers["x-looptask-timestamp"]}.${body}`, headers["x-looptask-signature"]),
    true,
  );
  assert.equal(
    await hmacVerify("secret", `123.${body}`, headers["x-looptask-signature"]),
    false,
  );
});

test("task rendering carries goal, verifiers, safety", () => {
  const text = renderTask({
    runId: "run-1",
    repository: "https://github.com/acme/widget",
    defaultBranch: "main",
    loop: {
      name: "fix-docs",
      goal: "修文档",
      mode: "human-gated",
      steps: [{ id: "s1", title: "巡检", purpose: "找断链" }],
      verifiers: [{ name: "docs", command: ["bash", "check.sh"] }],
      safety: { protectedBranches: ["main"], forbiddenActions: ["merge"] },
      budget: { maxDurationMinutes: 30, maxToolCalls: 200 },
    },
  });
  assert.match(text, /修文档/);
  assert.match(text, /bash check\.sh/);
  assert.match(text, /禁止触碰保护分支 main/);
});
