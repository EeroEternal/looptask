# Architecture & Domain Boundaries

Defines the system architectural model, core component boundaries, and data
flow principles for `looptask`.

## 1. Architecture Overview

```text
[ Operator / CI Trigger ]
           │
           ▼
[ Axum HTTP Transport Layer (src/server.rs) ]
           │
           ▼
[ Domain Layer: project config, loop planning (src/config.rs, src/models.rs) ]
           │
           ▼
[ celld Foundation Bridge (src/celld.rs) ] ──▶ [ celld Durable Object app (celld/) ]
```

The runtime split described in [`README.md`](../README.md) is intentional:
Rust service (config, API, planning, verification policy), celld Durable
Object app (agent cell state, inbox, alarms, checkpoints), and an external
sandbox (untrusted execution). This document only covers the Rust service.

## 2. Layering & Invocation Rules

1. **Transport layer (`src/server.rs`)**: route mounting, middleware
   (CORS, trace), and HTTP (de)serialization only. Must not embed loop
   planning policy or celld wire-format details.
2. **Domain layer (`src/config.rs`, `src/models.rs`)**: project config
   parsing/validation, loop definitions, agent cell ID templating.
3. **celld bridge (`src/celld.rs`)**: translates project/loop domain data
   into celld foundation descriptors and cell IDs. Must not perform HTTP
   routing or own transport-level concerns.
4. **Error handling (`src/error.rs`)**: shared `Error`/`Result` types; new
   error variants must be handled explicitly at the transport boundary, not
   swallowed.

## 3. Plugin-First Principle

Custom business adaptations (auth decoration, vendor protocol adaptors, data
masking) must be implemented as modular middleware, never hardcoded into
`src/server.rs`'s core routing.
