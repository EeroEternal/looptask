CREATE TABLE projects (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    repository TEXT,
    default_branch TEXT NOT NULL,
    config_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE INDEX projects_user_updated_idx ON projects (user_id, updated_at DESC);

CREATE TABLE loop_definitions (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    definition_json JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, name, version)
);

CREATE TABLE loop_runs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    loop_definition_id UUID NOT NULL REFERENCES loop_definitions(id) ON DELETE RESTRICT,
    loop_name TEXT NOT NULL,
    agent_key TEXT NOT NULL,
    agent_cell_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed', 'needs-human')),
    idempotency_key TEXT NOT NULL,
    request_json JSONB NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    failure_reason TEXT,
    UNIQUE (user_id, idempotency_key)
);

CREATE INDEX loop_runs_user_started_idx ON loop_runs (user_id, started_at DESC);
CREATE INDEX loop_runs_project_started_idx ON loop_runs (project_id, started_at DESC);

CREATE TABLE loop_events (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES loop_runs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX loop_events_run_created_idx ON loop_events (run_id, created_at ASC);