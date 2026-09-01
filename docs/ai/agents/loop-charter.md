# Loop charter (autonomous loop governance)

Applies to any automatically triggered agent loop acting on *this* repository
(scheduled heartbeat, CI event). Graduated admission: **L1 semi-automatic**
(human-triggered, agent-executed), **L2 event-driven safe lane** (scheduled +
path allow-list), **L3 issue→PR** (requires a `loop-safe` label + an
acceptance-command issue template, not yet open). Only L1 / L2 are currently
allowed.

## Hard boundaries (any violation is an incident)

1. **Terminal action = open a PR.** Never merge, never tag, never push
   directly to `main` (AGENTS.md rule 4).
2. **Path allow-list**: a loop may only touch paths on its approved lane.
   Expanding an allow-list requires a human PR that edits this file first.
3. **Dedicated worktree**: each run uses an isolated `git worktree`; never
   read/write another checked-out working directory or its uncommitted
   state.
4. **Budget**: hard cap per run — stop immediately and open an issue with the
   current state on hitting the cap; do not "try again".
5. **Stop conditions must be machine-checkable**: e.g. `cargo fmt --check`,
   `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace` all
   green, and diff stays inside the allow-list. If a condition can't be
   judged mechanically, stop and open an issue rather than guessing.
6. **Never enter**: loop verifier command definitions, celld runtime
   protocol boundaries, production tuning, the release process, or SQL
   migration content (migration files are always human-authored/reviewed).
7. **Auditable**: each run's report (what was done, diff summary, budget
   used, what was skipped) goes into the PR description; intermediate
   artifacts go to a local `artifacts/` dir, never committed.

## Trigger and escalation

- Trigger sources: scheduled heartbeat or CI event. Each trigger is an
  independent task with no cross-run memory — handoff happens only through
  files (PR description, issue, progress artifacts), never through session
  state.
- Escalate to a human when: a change outside the allow-list is needed, the
  budget is exhausted, a gate is red and cannot be mechanically fixed, or a
  landed/promote-style judgment call is required (allow-list changes count).

## Relationship to existing mechanisms

- Code review goes through skill `review` (independent read-only context);
  PRs opened by a loop are reviewed the same way.
- This charter does not cover releases (skill `release`'s human-approval
  hard stop always takes priority).
