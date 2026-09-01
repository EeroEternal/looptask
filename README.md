# looptask

`looptask` is a Rust Loop Engineering service for AI-assisted development
maintenance loops.

It follows the [rust-agentic-skeleton](https://github.com/EeroEternal/rust-agentic-skeleton)
shape: Rust 2024, Axum, Tokio, structured errors, typed configuration, and
local quality gates with `cargo fmt`, Clippy, and workspace tests.

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

- **Rust service**: project configuration, API, loop planning, verification
  policy, and operator-facing control plane
- **celld Durable Object app**: one long-lived cell per agent/loop, with SQLite
  hot state, inbox, alarms, checkpoints, and artifact metadata
- **external sandbox**: untrusted code execution, shell commands, dependency
  installation, and mutable workspaces

celld is the agent memory/scheduler foundation, not the security sandbox.

## MVP loop types

- **Documentation sync**: keep README, architecture docs, generated docs, and
  source behavior aligned.
- **External data sync**: fetch and validate external data before updating local
  caches or generated assets.
- **Architecture decoupling scan**: find coupling hotspots and produce
  human-reviewed suggestions before refactors.

## Local development

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

Run the Rust service:

```bash
LOOPTASK_HOST=127.0.0.1 cargo run
```

Run the celld agent runtime locally:

```bash
cd celld
celld dev
```

The local celld runtime persists Durable Object state under `celld/.celld/dev`.

## HTTP API

- `GET /health`
- `GET /api/v1/ping`
- `POST /api/v1/runtime/celld`
- `POST /api/v1/loops/plan`
- `POST /api/v1/loops/dispatch`
- `POST /api/v1/celld/agents/state`
- `POST /api/v1/celld/agents/inbox`
- `POST /api/v1/celld/agents/artifacts`

`POST /api/v1/loops/plan` accepts a project config payload and returns the
celld-backed agent cell ID and dispatch plan, without contacting celld.

`POST /api/v1/loops/dispatch` plans a loop the same way and, when accepted,
actually dispatches it: it calls the project's celld runtime
(`project.celld.internalUrl` or `publicUrl`) and enqueues a wakeup event into
the target agent cell's inbox (`POST /agents/{cellId}/inbox` on the celld
worker). The response includes the loop plan plus the celld inbox
acknowledgement.

`POST /api/v1/celld/agents/state`, `.../inbox`, and `.../artifacts` proxy the
corresponding `AgentCell` Durable Object endpoints
(`GET /agents/{cellId}/state`, `POST /agents/{cellId}/inbox`,
`POST /agents/{cellId}/artifacts`) for a given `project` and `agentCellId`,
so operators and other services can inspect or drive a cell without talking
to celld directly.

## Configuration

See [`examples/looptask.json`](examples/looptask.json).

A project config defines:

- repository metadata
- source and documentation paths
- celld app directory, bucket, public URL, and Durable Object class
- external data sources
- loop definitions
- agent cell ID template and sandbox requirement
- verifier commands
- stop and escalation rules

## State and artifact rules

Cell SQLite stores hot, decision-critical state:

- agent identity and policy
- current plan, tasks, inbox, and checkpoints
- short memory summaries
- artifact IDs, hashes, sizes, previews, and storage URIs

Object storage stores cold or large outputs:

- generated files and patches
- repository snapshots
- long logs and full message history
- external data snapshots
- sandbox workspaces and build artifacts

Rule of thumb:

> The cell stores who the agent is, what it is doing, and where artifacts live;
> object storage stores the artifacts themselves.

## Safety model

Loops use three modes:

- `report-only`: analyze and report only
- `safe-pr`: allow low-risk generated changes after verifiers pass
- `human-gated`: require approval before code or architecture changes

celld should run trusted application code for each fleet. Do not use celld as a
hostile multi-tenant sandbox for user- or model-generated code.
