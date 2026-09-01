# Replit setup

## Run the Rust service

The `Start application` workflow runs the Axum service on Replit's preview
port:

```bash
LOOPTASK_HOST=0.0.0.0 LOOPTASK_PORT=5000 cargo run
```

Open the preview to use the dashboard at `/`. The service also exposes
`/health` and `/api/v1/ping` for basic checks.

## Local quality checks

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

## celld runtime

The optional Durable Object runtime is in `celld/`. Its local development
command is documented in the README:

```bash
cd celld
celld dev
```

The Rust service can run without celld for dashboard, health, ping, planning,
and other non-dispatch functionality. Loop dispatch and Agent cell monitoring
require a running celld endpoint configured in the project payload.

## Admin UI design system

The dashboard follows the imported `docs/design.md` specification from
`rust-agentic-skeleton`. Use the semantic tokens and rules in `docs/design/`
for future UI work, especially `tokens.md`, `layout.md`, `components.md`, and
`dos-donts.md`. Keep the console dense and operational: neutral surfaces, one
primary accent, explicit status colors, restrained radius/shadows, and stable
reserved space for dynamic content.