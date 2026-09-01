---
name: git-stash-safe
description: Safely use git stash in looptask without stripping feature dependencies or breaking the build. Use when stashing unrelated changes, cleaning the worktree before check/test, or recovering from a stash that may have removed needed files.
---

# Safe `git stash` in looptask

## Symptom / misjudgment
An agent stashes "fmt noise" or "unrelated edits", then reports tests
green — but `Cargo.toml` or a core module was stashed away and the tree no
longer compiles.

## Hard constraints (also in `docs/ai/agents/engineering.md` §2)
1. Message must honestly describe contents (`git stash push -m "..."`).
2. Before stash: `git diff --stat` and confirm no current-feature dependency
   is removed.
3. After stash: `cargo check --tests` is mandatory.
4. Never stash `Cargo.toml` / `Cargo.lock` / build scripts — `git checkout`
   them individually or commit separately.

## Procedure
1. `git status` and `git diff --stat` — list every path that would leave the
   worktree.
2. If any path is required by the current feature, do **not** stash it;
   commit it, leave it unstaged, or split the change.
3. `git stash push -m "<honest summary of what is being hidden>"`.
4. Immediately run `cargo check --tests`.
5. If the check fails: `git stash pop` (or apply), restore the missing
   dependency, and re-evaluate. Do not claim verification while the tree is
   broken.
6. Only after a green check may you proceed with the intended commit/PR
   work.

## Verification
- `cargo check --tests` exits 0 on the post-stash worktree.
- The stash message would let a human restore the right content without
  guessing.
