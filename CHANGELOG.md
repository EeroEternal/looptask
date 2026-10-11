# Changelog

## v1.1.0 (2026-10-11) — Cloudflare-native rewrite

First tagged release of the Cloudflare-native stack (replaces the Rust +
PostgreSQL + celld backend).

- **Worker API (`worker/`, JavaScript) + D1 as the only database**: auth,
  projects, loops, runs, events, GitHub App per-user OAuth with encrypted
  token storage, PR/issue result targets, HMAC-signed executor callbacks
- **Sandbox executor (`executor/`)**: pull-based claims, disposable
  worktrees, step/verifier execution, branch push, idempotent completion;
  retries survive flaky networks and never crash the process
- **Auth**: username + password (PBKDF2-SHA256, 100k Workers cap), 30-day
  hashed sessions; email only for PR confirmation notices
- **Dashboard (`web/`)**: task list with run/edit/delete/stop, dedicated
  /new task page with GitHub repository picker, issue/PR result choice,
  full English UI, responsive/mobile fixes
- **Deployed**: Pages (`https://looptask.io`) + Worker + D1

Verified end-to-end against `EeroEternal/SmartGate`: task → queue →
executor claim → clone → change → push → SHA check → PR #6 → human
approval → confirmation email delivered.
