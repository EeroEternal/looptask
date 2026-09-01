# AGENTS.md — Code Agent Collaboration Specification

High-density, lightweight entry point for all AI coding agents in this
repository. Purpose: eliminate hallucinations, prevent piggybacking changes,
and keep commits/PRs reproducible. Details live in
[`docs/ai/agents/`](docs/ai/agents/) and `.agents/skills/`; **do not load all
chapters into context by default**.

## Knowledge Tiering & Token Budget Discipline

| Tier | Content | Entry Point |
| --- | --- | --- |
| **Standing Constraints** | Inviolable rules across all tasks | This file ("Always Active"); expanded in [`docs/ai/agents/`](docs/ai/agents/) |
| **Reusable Workflows** | Domain-specific procedures & validation commands | `.agents/skills/*/SKILL.md` (Authoritative) |
| **Domain Specs** | System architecture / module boundaries | [`docs/architecture.md`](docs/architecture.md) + [`docs/architecture/module-boundaries.md`](docs/architecture/module-boundaries.md) |

- **Token Budget & Zero-Sum Updates**: hard limit of **80 lines / 1200
  tokens**. Near the limit, follow the zero-sum rule (add one, remove one).
- **Anti-Anecdote & Batch Threshold**: never add global rules from an isolated
  single-session mistake. Rules need ≥2 independent session transcripts and go
  through skill [`promote-lesson`](.agents/skills/promote-lesson/SKILL.md).

## Agent Reading Map

| Task Signal | Required Reading |
| --- | --- |
| `git stash` operations | skill [`git-stash-safe`](.agents/skills/git-stash-safe/SKILL.md) |
| Adding SQL migrations (`migrations/NNN_*.sql`) | skill [`add-sql-migration`](.agents/skills/add-sql-migration/SKILL.md) |
| Release / tagging / production deployment | skill [`release`](.agents/skills/release/SKILL.md) |
| Code review / PR audit / acceptance verification | skill [`review`](.agents/skills/review/SKILL.md) (independent read-only context) |
| Autonomous agent loops / cron tasks | [`loop-charter.md`](docs/ai/agents/loop-charter.md) |
| `tokio::spawn` / daemons / celld runtime / exit codes | [`engineering.md`](docs/ai/agents/engineering.md) |
| Commit message conventions | [`commit-style.md`](docs/ai/agents/commit-style.md) |
| Cross-module boundaries / server vs celld vs sandbox | [`module-boundaries.md`](docs/architecture/module-boundaries.md) |
| Push before `git push` on `src/` or `tests/` | skill [`pre-push-local-gates`](.agents/skills/pre-push-local-gates/SKILL.md) |

## Always Active (Highest Standing Constraints)

1. **No Piggybacking**: commits/PRs must not carry unrelated changes;
   unannounced tuning, repo-wide formatting, undocumented `#[allow]`, and
   cross-module opportunistic refactoring are prohibited. Split violations via
   `git reset --mixed HEAD~1`.
2. **Zero Hallucination Code**: every definition must have callers; every
   cached field must have a store policy; every `TODO` must reference an
   issue. Docs must never cite skeleton-only features as existing.
3. **Safe Stash**: honest stash naming; `git diff --stat` before stash;
   `cargo check --tests` required after pop; never stash `Cargo.toml`,
   `Cargo.lock`, or build scripts.
4. **Release Guardrail**: merging to `main` or creating release tags is
   strictly prohibited without explicit human approval.
5. **Sandbox Boundary**: `celld` is the agent memory/scheduler foundation, not
   a hostile-code sandbox; untrusted execution stays in the external sandbox
   (see [`README.md`](README.md)).
6. **Loop Safety Modes**: loop dispatch must always tag one of `report-only`,
   `safe-pr`, or `human-gated`; never bypass the declared mode.
7. **Pre-push Local Quality Gate**: never use CI as a local sandbox; run
   `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and
   `cargo test --workspace` via skill
   [`pre-push-local-gates`](.agents/skills/pre-push-local-gates/SKILL.md)
   before pushing.

## Skills Index

Authoritative skills are located under `.agents/skills/`.

- [`git-stash-safe`](.agents/skills/git-stash-safe/SKILL.md)
- [`add-sql-migration`](.agents/skills/add-sql-migration/SKILL.md)
- [`promote-lesson`](.agents/skills/promote-lesson/SKILL.md)
- [`pre-push-local-gates`](.agents/skills/pre-push-local-gates/SKILL.md)
- [`release`](.agents/skills/release/SKILL.md)
- [`review`](.agents/skills/review/SKILL.md)
