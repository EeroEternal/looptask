---
name: add-sql-migration
description: Add a new D1 (SQLite) migration under worker/migrations/ so wrangler applies it and looptask actually sees the schema. Use when creating worker/migrations/NNN_*.sql, debugging "table/column missing", or changing D1 SQL.
---

# Add a D1 migration (wrangler d1)

## Symptom / misjudgment
You add `worker/migrations/NNN_*.sql`, run the Worker, and the new table or
column is missing — it looks like the SQL is wrong, but the real cause is
usually that the migration was never applied to the database you are
actually hitting (local vs remote D1 are separate databases).

## Root cause
`wrangler d1 migrations apply` is a manual step per database. Local
(`--local`, under `worker/.wrangler/`) and remote (`--remote`) states do not
sync.

## Procedure
1. Create `worker/migrations/NNN_<short_snake_name>.sql` with the next unused
   version prefix. SQLite dialect only (`TEXT` ids, ISO-8601 `TEXT` timestamps).
2. Apply: `cd worker && npx wrangler d1 migrations apply looptask --local`
   (and `--remote` for the deployed database).
3. Confirm: `npx wrangler d1 execute looptask --local --command "SELECT name
   FROM sqlite_master WHERE type='table'"` (or `--remote`) shows the change.

## Editing an existing migration
- Wrangler records applied migrations by file name/hash; do not rewrite
  applied migrations on shared/prod databases — add a new forward migration
  instead.

## Verification
- After apply, the schema query shows the new table/column.
- Do not conclude "SQL bug" until you confirmed the migration was applied to
  the same database the Worker is bound to.
