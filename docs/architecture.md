# Architecture & Domain Boundaries

Defines the system architectural model, core component boundaries, and data
flow principles for `looptask`.

## 1. Architecture Overview

```text
[ Operator browser ]
        │
        ▼
[ Cloudflare Pages admin dashboard (web/) ]
        │  functions/api/[[path]].js same-origin proxy
        ▼
[ Cloudflare Worker API (worker/src/worker.js) ]
        │
        ▼
[ Cloudflare D1 (SQLite) — the only database (worker/migrations/) ]
        │
        ▼
[ external executor sandbox ] ──HMAC callback──▶ [ Worker /api/v1/runs/{id}/completion ]
```

The runtime split described in [`README.md`](../README.md) is intentional:
the Worker owns the control plane (auth, projects, loop planning,
verification policy, PR confirmation), D1 owns all persisted state, and the
external executor owns untrusted code execution. This document only covers
the Worker.

## 2. Layering & Invocation Rules

1. **Router (`worker/src/worker.js` `route()`)**: URL matching, session
   gating, and JSON error shaping only. Must not embed loop planning policy
   or executor wire-format details.
2. **Domain helpers (`buildLoopPlan`, `validateLoop`, `agentCellId`,
   `validateCompletion`)**: loop definition validation, agent cell ID
   templating, executor payload validation. Pure functions; keep them
   testable without D1.
3. **Persistence (`saveProject`, `prepareRun`, `claimCompletionCallback`,
   `deliverConfirmationEmail`)**: all D1 SQL lives here. D1 has no
   interactive transactions; concurrency-sensitive updates use conditional
   `UPDATE ... WHERE` guards (see the `ponytail:` note in `worker.js`).
4. **Integrations (`githubConfig`/`githubRequest`, `sendMessage`)**: GitHub
   and Cloudflare Email Sending calls. Repository allowlisting happens in
   the Worker, never in the executor.

## 3. Plugin-First Principle

Custom business adaptations (auth decoration, vendor protocol adaptors, data
masking) must be implemented as small standalone helpers composed inside
`route()`, never hardcoded into unrelated handlers.
