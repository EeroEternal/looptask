# Module Boundaries & Crate Architecture

Defines module boundaries, dependency flow directions, and cross-module
interaction rules for `looptask`.

## 1. Core Principles

1. **Unidirectional dependency flow**: `server` may depend on `config`,
   `models`, `celld`, and `error`; those modules must never depend back on
   `server`. No cyclic dependencies.
2. **No direct cross-module data tampering**: cross-module data access goes
   through the public types/functions in `src/lib.rs`'s re-exports, never by
   reaching into another module's private fields.
3. **Change atomicity**: breaking changes to `ProjectConfig`, `LoopDefinition`,
   or the celld foundation payload shape must ship with backward-compatible
   deserialization or an explicit migration note in
   [`examples/looptask.json`](../examples/looptask.json).
