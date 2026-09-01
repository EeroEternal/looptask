---
name: add-sql-migration
description: Add a new SQL migration under migrations/ so sqlx embeds it and looptask actually applies it on startup. Use when creating migrations/NNN_*.sql, debugging "migration not applied", or touching sqlx::migrate!.
---

# Add a SQL migration (sqlx compile-time embed)

## Symptom / misjudgment
`looptask` depends on `sqlx` with the `migrate` feature but does not yet ship
a `migrations/` directory. If you add `migrations/NNN_*.sql`, run
`cargo build`, start the service, and the new version never appears applied,
it looks like the SQL is wrong — the real cause is usually cargo not
rebuilding after a **new file** under `migrations/`.

## Root cause
`sqlx::migrate!("./migrations")` embeds migration files at **compile time**.
Cargo does not treat a newly added file in that directory as a reason to
rebuild the crate that embeds it.

## Procedure
1. Create `migrations/NNN_<short_snake_name>.sql` with the next unused
   version prefix.
2. **Force rebuild**: `touch` the source file that calls `sqlx::migrate!`
   (or any file under `src/` that participates in the binary), then
   `cargo build`.
3. Start the service with a valid `DATABASE_URL`; migrations run on startup.
4. Confirm: query `_sqlx_migrations` shows the new `version`, or logs show it
   applied.

## Editing an existing migration
- Changing an already-applied file triggers sqlx checksum checks.
- Do not rewrite applied migrations on shared/prod databases — add a new
  forward migration instead.

## Verification
- After touch + build + start, `_sqlx_migrations` contains the new version.
- Do not conclude "SQL bug" until this rebuild step was done.
