-- OCA Migration 002: Neural Connections
-- Adds a living synapse graph used by neural map and cognitive dynamics

BEGIN;

CREATE TABLE IF NOT EXISTS neural_connections (
    id SERIAL PRIMARY KEY,
    from_layer TEXT NOT NULL,
    from_id INT,
    to_layer TEXT NOT NULL,
    to_id INT,
    connection_type TEXT NOT NULL,
    strength REAL NOT NULL DEFAULT 0.5,
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activation_count INT NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}'
);

-- Null-safe uniqueness for layer/id pairs plus connection type.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nc_unique_path
ON neural_connections (
    from_layer,
    COALESCE(from_id, -1),
    to_layer,
    COALESCE(to_id, -1),
    connection_type
);

CREATE INDEX IF NOT EXISTS idx_nc_strength ON neural_connections (strength DESC);
CREATE INDEX IF NOT EXISTS idx_nc_last_activated ON neural_connections (last_activated DESC);
CREATE INDEX IF NOT EXISTS idx_nc_from_to ON neural_connections (from_layer, to_layer);

COMMIT;
