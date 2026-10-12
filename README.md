# looptask

`looptask` is a Loop Engineering service for AI-assisted development
maintenance loops.

It keeps a typed configuration, structured errors, and local quality gates,
implemented as a Cloudflare-native stack.

AI coding agents working in this repository must start at
[`AGENTS.md`](AGENTS.md) for the collaboration spec, standing constraints,
and reusable skills under [`.agents/skills/`](.agents/skills/).

## Positioning

`looptask` is not a chat UI. It is an outer loop system for development projects:

1. discover recurring maintenance work
2. dispatch a focused agent
3. persist agent state across wakeups
4. verify the result independently
5. stop, report, open a safe PR, or escalate to a human

The runtime split is intentional:

- **Cloudflare Worker API** (`worker/`): project configuration, API, loop
  planning, verification policy, and operator-facing control plane
- **Cloudflare D1 (SQLite)**: the only database; users, projects, loop
  definitions, runs, and events live there.
- **external sandbox executor** (`executor/`): untrusted code execution,
  shell commands, and mutable workspaces. It claims queued runs over the API
  (`GET /api/v1/executions/next`), clones the target repository itself, and
  reports results only through HMAC-signed completion callbacks.

## MVP loop types

- **Documentation sync**: keep README, architecture docs, generated docs, and
  source behavior aligned.
- **External data sync**: fetch and validate external data before updating local
  caches or generated assets.
- **Architecture decoupling scan**: find coupling hotspots and produce
  human-reviewed suggestions before refactors.

## Local development

```bash
cd worker && npm test          # node --test gates
node --test executor/          # executor self-check
npx wrangler dev               # local Worker + local D1
cd ../web && npm run build     # Next.js static export (admin dashboard)
```

Run the sandbox executor (see [Sandbox executor](#sandbox-executor)):

```bash
LOOPTASK_API=https://looptask.io \
LOOPTASK_EXECUTOR_SECRET=<your-secret> node executor/executor.mjs
```

Apply the D1 schema once per database:

```bash
cd worker && npx wrangler d1 migrations apply looptask --local   # dev
cd worker && npx wrangler d1 migrations apply looptask --remote  # deploy
```

## HTTP API

- `GET /health`
- `GET /api/v1/ping`
- `POST /api/v1/auth/request-code`
- `POST /api/v1/auth/verify-code`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/{projectId}`
- `GET /api/v1/github/repositories`
- `GET /api/v1/runs`
- `GET /api/v1/runs/{runId}/events`
- `POST /api/v1/runs/{runId}/completion` (executor HMAC callback; no session cookie)
- `POST /api/v1/runs/{runId}/merge-confirmation` (owner session required)
- `GET /api/v1/loop-templates`
- `POST /api/v1/loops/validate`
- `POST /api/v1/loops/dispatch`
- `POST /api/v1/loops/resident/stop`

`POST /api/v1/loops/validate` saves the project and expands the selected loop
definition into stages and guardrails.

`POST /api/v1/loops/dispatch` saves the project, creates a durable run record
plus a `queued` event in D1, and hands the task to an executor:

1. **pull model** (default, recommended): the run stays `queued` in D1 and a
   sandbox executor claims it via `GET /api/v1/executions/next`. No public
   endpoint is needed on the executor side.
2. **push model** (`LOOPTASK_EXECUTOR_URL` set): the dispatch payload (loop,
   goal, steps, verifiers, safety, `runId`, and the `completionCallback`
   protocol) is POSTed to that endpoint immediately.

The response includes the loop plan, the dispatch acknowledgement, and the
`runId`. Callers may send an `idempotencyKey` to safely retry without creating
the same run twice; retries return `deduplicated: true`.

`POST /api/v1/loops/resident/stop` posts a stop request for a resident loop to
`LOOPTASK_EXECUTOR_URL` (push model only).

Projects and Loop definitions are upserted per authenticated user when they
are saved, validated, or dispatched. Dispatches create durable run records and
queued/dispatched events in D1.

### Registration and login

Accounts are username + password (no email codes). Passwords are stored as
PBKDF2-SHA256 (100k iterations — the Workers WebCrypto cap — with a per-user random salt) — never in plaintext.
Usernames are 3-32 characters of `A-Za-z0-9_-`, passwords at least 8.
Registration takes an optional email address used only for PR confirmation
mail; without one, the confirmation is recorded in the dashboard and the mail
delivery state becomes `unknown`.

### Secrets and vars

Secrets (`npx wrangler secret put <NAME>` in `worker/`, values grant power):

- `SESSION_SECRET` — HMAC key for session hashes and token encryption (set at deploy)
- `LOOPTASK_EXECUTOR_SECRET` — ≥32 bytes, shared with the sandbox executor
  (guards both the claim endpoint and the completion callback)
- `GITHUB_CLIENT_SECRET` — GitHub App OAuth client secret
- `CLOUDFLARE_API_TOKEN` — Cloudflare Email Sending (PR confirmation mail)

Vars (`[vars]` in `worker/wrangler.toml`, not secret):

- `CLOUDFLARE_ACCOUNT_ID` — Email Sending REST call
- `LOOPTASK_EMAIL_FROM` — verified sender address
- `GITHUB_CLIENT_ID` — GitHub App OAuth client id
- `LOOPTASK_EXECUTOR_URL` — optional push-model endpoint; unset (default),
  runs queue in D1 and are claimed by `executor/`

Sessions store only a hash of the opaque cookie token, expire after 30 days,
and can be revoked on logout. Email sending (Cloudflare Email Sending, via
`CLOUDFLARE_API_TOKEN` + `LOOPTASK_EMAIL_FROM`) is used only for PR
confirmation mail.

### Mentora integration

`POST /api/v1/mentora/import` pulls a task from
[Mentora](https://mentora.pub) (share link or id + its per-task `mtk_` token
+ a target repository), stores it as a looptask task with the token
**encrypted at rest**, and dispatches it. When the executor finishes and
looptask opens the PR, the run's completion callback writes the result back:

```
POST https://mentora.pub/api/v1/tasks/<id>/process
{ process_status: "completed", process_result: <markdown + PR link>,
  result_artifacts: "[{\"name\":\"PR #n\",\"url\":...}]" }
```

A failed write-back records a `mentora_result_failed` event and never fails
the completion (the PR already exists). Dashboard: **Import from Mentora**.

### Executor completion callback and PR confirmation

After dispatch, the executor calls `POST /api/v1/runs/{runId}/completion` with
JSON fields `callbackId`, `dispatchId`, `success`, `headBranch`, `headSha`, and
`summary`. It must supply `x-looptask-timestamp` (Unix seconds) and
`x-looptask-signature` (hex HMAC-SHA256). The signed bytes are the exact raw
JSON request body prefixed by the timestamp and a period:
`timestamp + "." + body`. Callbacks outside a five-minute window, malformed
signatures, or dispatch IDs not recorded for that run are rejected.

`completionCallback.url` is derived from the Worker's own request origin; it
is never a relative URL. The repository scope is enforced by `GITHUB_TOKEN`
itself: looptask only touches repositories the token can access, so scope the
token to exactly the repositories looptask may use.

For a successful callback, the service derives repository, default branch,
task goal, and owner from D1, opens or reuses an open PR, then emails the
owner. A callback ID is idempotent. The authenticated owner can POST
`{"decision":"approve"}` or `{"decision":"reject"}` to the merge-confirmation
endpoint. This stores the decision only; looptask does **not** merge the PR.

`/health`, `/api/v1/ping`, and the authentication endpoints are public. Loop
template, validation, dispatch, and run endpoints require a valid session
cookie.

### GitHub repository binding

The dashboard's **Bind GitHub repository** action calls the authenticated
`GET /api/v1/github/repositories` endpoint. The server asks GitHub for the
repositories the shared `GITHUB_TOKEN` can access (`GET /user/repos`) and
returns them with their default branch and push permission. The token is
never returned to the browser. Only repositories whose GitHub
`permissions.push` value is true can be bound; binding immediately saves
the project with GitHub's reported URL and default branch. Arbitrary repository
URLs are intentionally not supported by this flow.

### Loop Task abstraction

A loop is more than a prompt: it is a typed definition with a goal, ordered
steps, decision rules, verifiers, budget, safety policy, state policy, and
cleanup policy. `GET /api/v1/loop-templates` exposes reusable capabilities;
`POST /api/v1/loops/validate` expands a selected definition into stages and
guardrails before dispatch.

The built-in `docs-lifecycle-patrol` template captures the common pattern:
isolate in a fresh worktree, inspect, classify signals, mechanically repair only
allowlisted paths, verify, open a PR or escalation issue, enforce hard budgets,
and clean up without ever merging, tagging, or pushing the protected branch.

## Sandbox executor

`executor/executor.mjs` is the trusted-side runner (zero npm dependencies,
Node ≥ 20). It executes untrusted loop commands on your machine or VM — never
in the Worker.

| env | purpose |
| --- | --- |
| `LOOPTASK_API` | Worker base URL |
| `LOOPTASK_EXECUTOR_SECRET` | ≥32 bytes, must match the Worker secret |
| `GIT_TOKEN` | optional: clone private repos / push branches |
| `AGENT_CMD` | optional: shell command doing the agent work (cwd = worktree, `$TASK_FILE` = the task description) |
| `WORK_ROOT` / `KEEP_WORKDIR=1` / `POLL_MS` | tuning |

Per claimed run it clones the repository into a disposable worktree, writes
`TASK.md` **outside** the repo (never dirties the tree), runs `AGENT_CMD` (or
the loop's step commands), then runs every verifier (all must pass). If the
worktree has changes it pushes a `looptask/<run>` branch and reports
`headBranch`/`headSha`, so looptask verifies the SHA and opens the PR; if
nothing changed it reports the default branch and looptask records a `passed`
report run (no PR).

Results return only through `POST /api/v1/runs/{runId}/completion`, signed with
`LOOPTASK_EXECUTOR_SECRET` (HMAC-SHA256 over `timestamp + "." + body`). The
executor never receives looptask's `GITHUB_TOKEN`: pushing branches uses its own
`GIT_TOKEN`, and looptask opens the PR from its side after verifying the pushed
SHA.

Behind an HTTP proxy, run with `NODE_USE_ENV_PROXY=1` (Node ≥ 24).

## Configuration

See [`examples/looptask.json`](examples/looptask.json).

A project config defines:

- repository metadata
- source and documentation paths
- external data sources
- loop definitions
- agent cell ID template and sandbox requirement
- verifier commands
- stop and escalation rules

## Production deployment topology

```text
Cloudflare Pages (web/)          https://looptask.io — dashboard + functions/api proxy
Cloudflare Workers (worker/)     looptask API (JavaScript)
Cloudflare D1 (looptask)          the only database
external sandbox                 untrusted execution (signed callbacks)
```

Cloudflare Pages uses `functions/api/[[path]].js` as a same-origin proxy for
the Worker API. Set the Pages environment variable `LOOPTASK_API_ORIGIN` to
the published Worker URL. The Pages project should use `web/out` as its
output directory. The Next.js application in `web/` uses a static export, so it
keeps the Pages deployment simple while providing a component-based frontend
for future capabilities.

Deploy the Worker with `npx wrangler deploy` from `worker/`; set the D1
`database_id` in `worker/wrangler.toml` from `npx wrangler d1 create looptask`
and apply migrations with `npx wrangler d1 migrations apply looptask --remote`.

## Safety model

Loops use three modes:

- `report-only`: analyze and report only
- `safe-pr`: allow low-risk generated changes after verifiers pass
- `human-gated`: require approval before code or architecture changes

The external sandbox executes untrusted or model-generated code. Never grant
it the GitHub token or the Worker secrets; it receives only the dispatch
payload and reports back through the HMAC-signed completion callback.
