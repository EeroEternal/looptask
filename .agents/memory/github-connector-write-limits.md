---
name: GitHub connector write limits
description: Replit GitHub connector behavior when synchronizing a large local repository
---

GitHub connector reads and isolated writes can work while repeated Git object uploads are blocked by the Replit/Cloudflare gateway before any ref is updated. The shell does not receive Git credentials merely because the connection is bound.

**Why:** A large repository sync attempted through both proxy REST calls and the native client was blocked after a small number of blob writes, while local `git push` remained unauthenticated. Failed blob uploads do not change the branch, but may leave unreachable GitHub objects.

**How to apply:** Prefer the normal authenticated Git remote or a supported repository-sync workflow for large pushes. Treat connector API writes as suitable for small GitHub mutations, not as a drop-in replacement for `git push`; verify the remote ref after any attempted sync.