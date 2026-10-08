# Module Boundaries & Crate Architecture

Defines module boundaries, dependency flow directions, and cross-module
interaction rules for `looptask`.

## 1. Core Principles

1. **Unidirectional dependency flow**: `route()` may depend on the domain
   helpers, persistence helpers, integration helpers, and `templates.js`;
   those modules must never depend back on the router. No cyclic
   dependencies.
2. **No direct cross-module data tampering**: cross-module data access goes
   through the exported functions in `worker/src/worker.js`, never by
   reaching into another module's private state.
3. **Change atomicity**: breaking changes to `ProjectConfig`, `LoopDefinition`,
   or the executor dispatch payload shape must ship with backward-compatible
   parsing or an explicit migration note in
   [`examples/looptask.json`](../../examples/looptask.json).

## 2. D1 schema boundary

All SQL lives in the persistence helpers of `worker/src/worker.js`; schema
changes ship as `worker/migrations/NNN_*.sql` (SQLite dialect) and are
applied explicitly with `wrangler d1 migrations apply`.
