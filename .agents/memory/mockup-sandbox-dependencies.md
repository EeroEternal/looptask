---
name: Mockup sandbox dependencies
description: The setup requirement that is easy to miss when starting a newly created mockup artifact.
---

New mockup artifacts may have their Vite configuration and package manifest ready while their local npm dependencies are still absent. Install dependencies inside the artifact before restarting its preview workflow.

**Why:** The preview workflow can fail immediately with `vite: not found` even though the generated artifact structure is valid.

**How to apply:** After creating a new mockup sandbox, verify its component directory, install the artifact's declared dependencies, then restart the exact managed preview workflow once.