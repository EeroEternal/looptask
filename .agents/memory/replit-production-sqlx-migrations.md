---
name: Replit production SQLx migrations
description: Deployment behavior when Replit Publish manages PostgreSQL schema separately from application-owned SQLx migration history.
---

For this project, keep SQLx migration execution for development, but skip it in the published service. Replit Publish synchronizes the production schema from the development database without copying development `_sqlx_migrations` rows, so replaying the same SQLx migrations during production startup can fail on already-existing tables.

**Why:** A published service entered a crash loop even though all application tables already existed; production `_sqlx_migrations` was empty while development contained the applied records.

**How to apply:** Treat Replit Publish as the production schema-change path. Keep the published run command explicit about skipping runtime migrations, and do not repair production by dropping tables or adding startup-time DDL.