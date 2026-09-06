# Loop triggers, lifetime, and Command Center (design)

Status: **design contract**. Types live in `src/models.rs` and
`examples/looptask.json`. Scheduling, webhooks, dashboard wiring, and SQL
CHECK expansions are **not** shipped by this document alone — implement in
follow-up slices without documenting them as ready.

Related: [`loop-charter.md`](../ai/agents/loop-charter.md),
[`architecture.md`](../architecture.md), [`examples/looptask.json`](../../examples/looptask.json).

## Goals

Borrow Grok Bot’s *dispatcher* patterns (event-first wakeups, finite watches,
mid-flight steer, decision cards, auth auto-pause, lesson promotion) without
turning looptask into a chat UI.

Hard boundaries from the charter stay absolute:

- Terminal action = open a PR (never merge / tag / push protected branches).
- Path allow-lists; expand only via human PR to the charter / loop safety.
- Hard budgets; machine-checkable stop conditions.
- Modes remain `report-only` | `safe-pr` | `human-gated`.

## P0 — Trigger model

### Existing variants (kept)

| `type` | Meaning |
| --- | --- |
| `manual` | Operator / API dispatch only |
| `cron` | Schedule string; optional `timezone`, `quietHours` |
| `resident` | Interval polling — debug/coarse only in production |
| `gitHubEvent` | Legacy single `event` string |

### New variants

| `type` | Meaning |
| --- | --- |
| `github` | Filtered events: `events[]`, `paths[]`, `branches[]`, `prScoped`, optional `ciBranch`, `userAllowlist` |
| `group` | OR of nested listeners (e.g. github primary + weekday cron backup) |

Event names for `github.events` should stay stable kebab tokens such as
`pr-pushed`, `ci-failed`, `ci-passed`, `review-changes-requested`. Wire format
to GitHub webhooks is a later implementation detail.

### Lifetime

`LoopDefinition.lifetime` (default `standing`):

```json
{
  "kind": "standing" | "until" | "maxRuns",
  "until": {
    "anyOf": [
      { "type": "pr-merged" },
      { "type": "pr-closed" },
      { "type": "ci-passed" },
      { "type": "human-disable" },
      { "type": "deadline", "at": "2026-09-20T00:00:00+08:00" },
      { "type": "maxRuns", "count": 5 }
    ]
  },
  "onExpire": "pause-and-archive"
}
```

On expire: stop arming new runs, retain history, optionally cancel cell alarms.
Do not silently delete audit rows.

## P0 — Run states and Command Center API (sketch)

### Status values

Today’s DB CHECK: `queued | running | passed | failed | needs-human`.

Design additions (migration follow-up): `paused | stuck | cancelled`.

Rust `RunStatus` already enumerates the full set for API/docs alignment; do not
claim the Postgres CHECK is updated until a migration lands.

### Suggested event types (`loop_events.event_type`)

`progress`, `needs-decision`, `steered`, `auth-failed`, `budget-hit`,
`verifier-failed`, `stuck-detected`, plus existing queued/dispatched/completed
names as implemented.

### HTTP sketch (not routed yet)

| Method | Purpose |
| --- | --- |
| `GET /api/v1/runs?view=command-center` | Group in-flight / waiting-human / stuck / auth-failed |
| `POST /api/v1/runs/{id}/steer` | Inject correction intent into cell inbox (same run) |
| `POST /api/v1/runs/{id}/cancel` | Hard stop + cleanup |
| `POST /api/v1/runs/{id}/decision` | Generalize merge-confirmation: `approve` / `reject` / `redirect` / `escalate` |
| `POST /api/v1/loops/{name}/pause` · `/resume` | Scheduler pause (including auth auto-pause) |

Request shapes: `SteerRunRequest`, `RunDecisionRequest` in `src/models.rs`.

**Steer allow-list rule:** `allowedPathsDelta.add` must be rejected by the
control plane. Only shrink (`remove`) is allowed without a human charter PR.

## P1 — Decision cards, auth pause, lessons

- Persist decision cards in `loop_events.payload_json` (or a later table) with
  `DecisionCard` / `DecisionCardKind`.
- On repeated auth failures to GitHub / celld / sandbox: pause the loop, emit
  `auth-failed` + `auth-reconnect` card; do not keep burning budget.
- Successful runs may emit `LessonCandidate`; applying it requires human
  promotion (skill `promote-lesson`), never silent policy mutation from cell
  hot state.

## P2 — Starter loops

After GitHub bind, suggest 1–2 templates from repo signals (docs drift, CI,
`externalDataSources`) via existing `loop-templates` — UX only, later slice.

## Implementation slices (suggested)

1. Types + example + this doc (this PR).
2. Trigger validation + serde compatibility tests (partially started in unit tests).
3. Scheduler/webhook for `github` / `group` / `lifetime`.
4. Run status migration + steer/cancel/pause routes.
5. Command Center list + decision cards UI.
6. Auth auto-pause + starter suggestions.

## Non-goals

- Chat / conversational control plane.
- Auto-merge or auto-widen allow-lists.
- Treating `resident` as the primary production trigger.
- Documenting unfinished webhook handlers as shipping features.