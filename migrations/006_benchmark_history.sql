-- OCA Migration 006: Benchmark History
-- Stores periodic cognition benchmark snapshots

BEGIN;

CREATE TABLE IF NOT EXISTS benchmark_history (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    benchmark_date DATE NOT NULL DEFAULT CURRENT_DATE,

    composite FLOAT NOT NULL,
    interpretation TEXT,

    components JSONB NOT NULL DEFAULT '{}',
    raw_metrics JSONB NOT NULL DEFAULT '{}',

    run_source TEXT NOT NULL DEFAULT 'manual', -- manual, scheduled, heartbeat
    notes TEXT,

    UNIQUE (benchmark_date, run_source)
);

CREATE INDEX IF NOT EXISTS idx_bh_date ON benchmark_history (benchmark_date DESC);
CREATE INDEX IF NOT EXISTS idx_bh_source_time ON benchmark_history (run_source, created_at DESC);

COMMIT;
