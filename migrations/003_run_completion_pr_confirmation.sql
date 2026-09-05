ALTER TABLE loop_runs
    ADD COLUMN dispatch_id TEXT,
    ADD COLUMN callback_id TEXT,
    ADD COLUMN completion_summary TEXT,
    ADD COLUMN head_branch TEXT,
    ADD COLUMN head_sha TEXT,
    ADD COLUMN pr_number INTEGER,
    ADD COLUMN pr_url TEXT,
    ADD COLUMN confirmation_state TEXT CHECK (confirmation_state IN ('pending', 'approved', 'rejected')),
    ADD COLUMN confirmation_decided_at TIMESTAMPTZ,
    ADD COLUMN confirmation_email_sent_at TIMESTAMPTZ,
    ADD COLUMN completion_processing BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN completion_processing_at TIMESTAMPTZ,
    ADD COLUMN email_delivery_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (email_delivery_state IN ('pending', 'claimed', 'unknown', 'sent')),
    ADD COLUMN email_delivery_claimed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX loop_runs_callback_id_unique
    ON loop_runs (callback_id) WHERE callback_id IS NOT NULL;

CREATE INDEX loop_runs_dispatch_id_idx ON loop_runs (dispatch_id) WHERE dispatch_id IS NOT NULL;