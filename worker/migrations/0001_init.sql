CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
);

CREATE TABLE auth_challenges (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
    code_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    request_ip TEXT,
    created_at TEXT NOT NULL,
    consumed_at TEXT
);

CREATE INDEX auth_challenges_email_created_idx ON auth_challenges (email, created_at DESC);

CREATE TABLE auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX auth_sessions_token_idx ON auth_sessions (token_hash);

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    repository TEXT,
    default_branch TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, name)
);

CREATE INDEX projects_user_updated_idx ON projects (user_id, updated_at DESC);

CREATE TABLE loop_definitions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    definition_json TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, name, version)
);

CREATE TABLE loop_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    loop_definition_id TEXT NOT NULL REFERENCES loop_definitions(id),
    loop_name TEXT NOT NULL,
    agent_key TEXT NOT NULL,
    agent_cell_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed', 'needs-human')),
    idempotency_key TEXT NOT NULL,
    request_json TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    failure_reason TEXT,
    dispatch_id TEXT,
    callback_id TEXT,
    completion_summary TEXT,
    head_branch TEXT,
    head_sha TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    confirmation_state TEXT CHECK (confirmation_state IN ('pending', 'approved', 'rejected')),
    confirmation_decided_at TEXT,
    confirmation_email_sent_at TEXT,
    completion_processing INTEGER NOT NULL DEFAULT 0,
    completion_processing_at TEXT,
    email_delivery_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (email_delivery_state IN ('pending', 'claimed', 'unknown', 'sent')),
    email_delivery_claimed_at TEXT,
    UNIQUE (user_id, idempotency_key)
);

CREATE UNIQUE INDEX loop_runs_callback_id_unique
    ON loop_runs (callback_id) WHERE callback_id IS NOT NULL;

CREATE INDEX loop_runs_user_started_idx ON loop_runs (user_id, started_at DESC);
CREATE INDEX loop_runs_project_started_idx ON loop_runs (project_id, started_at DESC);
CREATE INDEX loop_runs_dispatch_id_idx ON loop_runs (dispatch_id) WHERE dispatch_id IS NOT NULL;

CREATE TABLE loop_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES loop_runs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX loop_events_run_created_idx ON loop_events (run_id, created_at ASC);
