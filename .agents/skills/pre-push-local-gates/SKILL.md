---
name: pre-push-local-gates
description: Run local gates equivalent to CI (Rust fmt/clippy/tests) before pushing; never treat CI as a local sandbox. Use before every git push touching src/ or tests/.
---

# Pre-push local gates

## Core pain point / prohibition
Never treat CI as a local sandbox: discovering lint failures, unformatted
code, compiler warnings, or test failures only after pushing creates a
"push → fail → fix locally → push again" loop that pollutes commit history,
wastes runner quota, and can block team merges in the failure window.

## Local gate checklist
Before `git push` or opening a PR, all of the following must pass locally
(equivalent to CI):

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

Before cutting a release or tag, move to skill
[`release`](../release/SKILL.md) for the full release process (three-point
check + human approval hard stop).

## Scope & discipline
- Intermediate commits during development may skip the full run temporarily,
  but the **last commit before push must be fully green**.
- If CI unexpectedly fails: never guess-and-patch blind. Reproduce the
  equivalent failing command locally first, confirm the fix locally, then
  push.
