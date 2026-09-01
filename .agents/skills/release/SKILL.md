---
name: release
description: Full release (tag) promoter process - full local gate re-run, three-point release verification, human approval hard stop, tag and verify. Use before cutting any vX.Y.Z tag or running a production deploy.
---

# Release Promoter Process

## Applicability
Must be followed strictly before running any `git tag v*.*.*`, merging a
release branch, or triggering a production deploy.

---

## Core rule (highest standing constraint)
**An AI agent must never run `git tag` or merge a release branch without
explicit written human approval.**

---

## Step-by-step

### Step 1: Full local gate re-run
Ensure the working tree is clean and every gate passes 100%:
```bash
git status

cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

### Step 2: Three-point release verification
1. **Version consistency**: confirm `Cargo.toml`'s version has been bumped
   correctly (e.g. `v0.1.0` → `v0.2.0`).
2. **Changelog**: confirm `CHANGELOG.md` or the relevant release notes record
   this version's key features and breaking changes.
3. **Secrets & build artifact scan**: confirm no private keys, `.env` files,
   temporary debug logs, or uncompiled artifacts are included.

### Step 3: Human approval hard stop
Present a complete release summary to the user (proposed tag name, commit
hash, change list) and **explicitly request human approval**.

### Step 4: Tag and verify
Only after explicit human approval, tag and push:
```bash
git tag -a vX.Y.Z -m "release: vX.Y.Z"
git push origin vX.Y.Z
```
