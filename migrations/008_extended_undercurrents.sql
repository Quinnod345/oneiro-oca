-- Emergent undercurrents beyond the canonical emotional vocabulary.
-- Canonical undercurrents remain primary; this table captures novel dimensions.
CREATE TABLE IF NOT EXISTS extended_undercurrents (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    name TEXT NOT NULL,
    strength FLOAT NOT NULL DEFAULT 0.5,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    occurrence_count INT NOT NULL DEFAULT 1,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    embedding VECTOR(1536)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_extended_undercurrents_name
    ON extended_undercurrents (name);

CREATE INDEX IF NOT EXISTS idx_extended_undercurrents_active_strength
    ON extended_undercurrents (active, strength DESC, last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_extended_undercurrents_embedding
    ON extended_undercurrents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
