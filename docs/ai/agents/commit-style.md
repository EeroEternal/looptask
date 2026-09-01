# Commit message style

Format: `<type>(<scope>): <subject>`

Common types:
- `feat` — new feature
- `fix` — bug fix
- `refactor` — refactor (no behavior change)
- `perf` — performance
- `test` — test-only changes
- `docs` — docs-only changes
- `chore` — build, release, dependency bumps

**Subject must reflect real content.** Forbidden:
- `fix: misc` / `chore: cleanup` style non-informative messages
- `feat: complete phase N` commits that hide unrelated tuning
- Using the commit message to obscure piggybacked changes

**Long bodies should include**:
- what changed
- why it changed
- risk / rollback notes
