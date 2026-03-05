-- OCA Migration 009: Hypothesis Graveyard + Revision Tracking
-- Keeps rejected/retired hypothesis versions for post-mortem learning.

BEGIN;

CREATE TABLE IF NOT EXISTS hypothesis_graveyard (
    id SERIAL PRIMARY KEY,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    hypothesis_id INT REFERENCES hypotheses(id),
    replacement_hypothesis_id INT REFERENCES hypotheses(id),

    domain TEXT,
    claim TEXT NOT NULL,
    prediction TEXT NOT NULL,
    confidence FLOAT,
    status TEXT,
    actual_outcome TEXT,

    revision_depth INT NOT NULL DEFAULT 0,
    archived_reason TEXT,
    evaluation JSONB NOT NULL DEFAULT '{}',
    source_data JSONB NOT NULL DEFAULT '{}',

    builder_task_dispatched BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_hg_archived_at ON hypothesis_graveyard (archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_hg_hypothesis_id ON hypothesis_graveyard (hypothesis_id);
CREATE INDEX IF NOT EXISTS idx_hg_reason ON hypothesis_graveyard (archived_reason);

COMMIT;
