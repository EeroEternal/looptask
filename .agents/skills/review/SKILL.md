---
name: review
description: Independent, read-only code review (critic) in a fresh context. Run deterministic gates first, then read the diff. Output file:line findings and a SHIP/REWORK conclusion. Use when reviewing a PR, a finished task, or before requesting human approval.
---

# Review (independent read-only critic)

## Symptom / misjudgment
A generator "self-reviewing" its own change tends to score itself well: in
the same context that wrote the code, attention is already consumed by
implementation details, making it hard to see piggybacked changes,
hallucinated capabilities, or simpler alternatives. Only an **independent**
pass reliably surfaces these.

## Rule
1. **Independent context**: review must happen in a new session or a
   read-only sub-agent (no write/edit access); never "look it over" inside
   the generating conversation. The sub-agent returns only conclusions, not
   its intermediate reasoning.
2. **Read-only**: the reviewer does not edit files. Report `file:line` and a
   suggested fix; the generator (or a new session) applies it and requests
   re-review.
3. **Layered verification**: run the free, deterministic checks first, and
   only spend manual diff-reading attention once they pass:
   ```bash
   cargo fmt --check
   cargo clippy --all-targets -- -D warnings
   cargo test --workspace
   ```
   If a gate is red, fix the gate first — never read code with a red light.
4. **Check against standing constraints**: piggybacked unrelated changes?
   Hallucinated capability (definition without caller / doc referencing a
   non-existent field)? TODOs without an issue?
5. **Look for excess, not just correctness**: is there a simpler approach?
   Code that could be deleted and still pass? "Lines that can be removed"
   and "branches that can be simplified" are first-class review output.

## Procedure
1. Confirm scope: the diff range (commit / PR) and the claimed list of
   completed work.
2. Run the deterministic gates above; any red returns REWORK + the red items
   immediately.
3. Read-only walk of the diff: tests first (do assertions actually assert
   behavior?), then implementation, then docs.
4. Produce a findings list: `file:line [blocker|major|minor] description`;
   only give SHIP with zero findings.
5. Conclude with exactly one of **SHIP** (deliverable / ready for human
   approval) or **REWORK** (with blockers attached). "Mostly fine" is not a
   valid conclusion.

## Scope
- This skill governs the review action itself; it does not replace the
  release skill's human-approval phase.
- After the generator fixes REWORK items, it must request re-review — never
  treat a fix as automatically accepted.
