-- OCA Migration 010: Screenshot semantic memory index
-- Persists vision-derived screenshot summaries for fast semantic retrieval.

BEGIN;

CREATE TABLE IF NOT EXISTS screenshot_memory (
    id SERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    filepath TEXT NOT NULL,
    front_app TEXT,
    window_title TEXT,
    url TEXT,
    activity_type TEXT,
    description TEXT NOT NULL,
    content_summary TEXT,
    embedding VECTOR(1536),
    file_retained BOOLEAN NOT NULL DEFAULT TRUE,
    analysis_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scm_filepath_unique
    ON screenshot_memory (filepath);

CREATE INDEX IF NOT EXISTS idx_scm_embedding
    ON screenshot_memory USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_scm_time
    ON screenshot_memory (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_scm_app_time
    ON screenshot_memory (front_app, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_scm_retained_time
    ON screenshot_memory (file_retained, captured_at DESC);

COMMIT;
