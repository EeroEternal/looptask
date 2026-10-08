# Engineering hard rules

## 1. No Silent Drift

A single commit / PR must not carry changes unrelated to its stated goal. The
following are always violations:

1. **Smuggled tuning**: changing defaults, thresholds, timeouts, concurrency
   limits, or rate-limit config under the guise of "remediate" / "refactor" /
   "format".
2. **Bulk reformatting**: formatter output (`prettier`) must be
   its own commit, never mixed with logic changes.
3. **Lint suppression**: silencing an ESLint/Clippy warning without
   explaining why.
4. **Cross-module refactor**: fixing a bug in `worker/src/worker.js` must not
   also rename helpers in `worker/src/templates.js` / `web/`.

Violating commits must be split via `git reset --mixed HEAD~1`.

---

## 2. `git stash` rules

`git stash` easily carries away feature dependencies. Hard constraints:

1. Naming must be honest: `git stash push -m "..."` must not hide logic
   changes behind a vague description.
2. Run `git diff --stat` before stashing to confirm no in-flight dependency
   is swept away.
3. Run `cd worker && npm test` after popping (not optional).
4. Never stash `worker/wrangler.toml` / `worker/migrations/` or build
   scripts.

Full steps: skill [`git-stash-safe`](../../../.agents/skills/git-stash-safe/SKILL.md).

---

## 3. Background work / daemons / executor webhooks

Background work (executor dispatch webhooks, resident wakeups, long
integration calls) are high-risk constructs and must:

1. **Make lifetime explicit**: never start unawaited work implicitly; every
   background request has a named entry point and a documented owner.
2. **Respect the Worker lifetime**: use `ctx.waitUntil(...)` for work that
   must outlive the response, never a bare floating promise.
3. **Time out long calls**: every outbound fetch needs an
   `AbortSignal.timeout(...)` fallback so a handler can't hang forever.
4. **Never swallow errors**: timeouts / calculation errors must be logged
   with at least one `console.error`, never a silent `continue`.
5. **Expose observability**: run state written by background work needs at
   least one queryable surface (a run event row or endpoint) so liveness can
   be observed.

---

## 4. Avoid Ghost Code

The following patterns always count as hallucinated code:

1. **Definition without caller**: a function/type exists but a repo-wide
   `grep` finds no caller.
2. **Field with load, no store**: a new `cached_xxx: Arc<AtomicU64>` field
   has a read site but no write site.
3. **One-sided instrumentation**: a metric only records the rising edge
   (e.g. `loop_started`) but never the falling edge (`loop_completed` /
   `loop_failed`), or vice versa — both directions on a critical path.
4. **TODO without an issue**: `// TODO: ...` must reference a GitHub issue.

If found, fill in the caller / store / downstream instrumentation in the same
change; "next round" is not acceptable.

---

## 5. Scripted code edits (`sed` / Python regex / awk)

Bulk-editing source via scripts is a frequent failure mode:

1. **Verify with `grep` after every regex replace.** e.g. after replacing
   `foo` with `bar`, `rg "foo"` must confirm zero matches or an expected
   remainder.
2. **`re.sub` failing does not raise.** A non-matching Python regex silently
   returns the original string; diff the result or re-run `grep`, never
   `git commit` blind.
3. **Multi-line regex is especially dangerous**: whitespace/quote/keyword
   drift silently breaks the replacement. Prefer the `StrReplace`/edit tool
   over ad-hoc scripts.
4. **Escape embedded strings carefully.** Review the generated code by hand
   after any scripted edit.

---

## 6. Database migrations

After adding `worker/migrations/NNN_*.sql`, apply it per skill
[`add-sql-migration`](../../../.agents/skills/add-sql-migration/SKILL.md);
a checked-in migration that was never `wrangler d1 migrations apply`-ed is
never seen by the Worker, which is easy to misdiagnose as bad SQL.

---

## 7. Command pipeline exit codes and "looks verified" traps

A pipeline's exit code defaults to the **last** command:
`failing_cmd | tail -3` exits 0 (tail's status), silently masking failure.

- **Symptom**: `&&` chains keep running; watchers/scripts draw false
  conclusions from the last command's exit code.
- **Correct approach**: use `set -o pipefail` inside scripts, capture output
  to a temp file and inspect it, or check authoritative sources (`gh pr
  checks` / CI conclusion) rather than trusting an agent process's exit code.
- **Verification**: `bash -n` only checks syntax; you must actually run the
  pipeline and force one upstream failure (e.g. `false | true`) to confirm
  the chain breaks. Note `bash -o pipefail -n` is not a valid check — `-n`
  never executes, so pipefail never triggers.

---

## 8. Violation handling

The following are serious violations; the reviewer may require:

1. **Report doesn't match code**: `git reset --hard` to the last honest
   state and rewrite the commit.
2. **Reporting success on a broken build**: work access paused pending a
   written retrospective.
3. **Same mistake repeated ≥3 times**: all subsequent commits from that
   agent require pair review with two sign-offs before merge.
4. **Smuggled production tuning**: immediately revert and resubmit as its
   own commit.
