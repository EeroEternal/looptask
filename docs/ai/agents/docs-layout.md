# Documentation Layout & Lifecycle

Describes the structure and lifecycle of the `docs/` tree.

## Directory Structure

- `docs/architecture.md`: high-level system architecture and layering.
- `docs/architecture/module-boundaries.md`: crate/module dependency rules.
- `docs/ai/agents/`: engineering guidelines, commit standards, and agent
  governance.

## Document Lifecycle Discipline

1. **No Phantom Capabilities**: never document skeleton-only or hypothetical
   features (e.g. unimplemented loop types, unbuilt celld endpoints) as
   ready.
2. **Deterministic Verification**: config/JSON examples and code snippets
   inside documentation must be executable and verified against
   [`examples/looptask.json`](../../examples/looptask.json) and the current
   API surface.
