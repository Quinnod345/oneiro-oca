-- Affect continuity and versioned evaluation. Historical measurements stay intact.
BEGIN;
ALTER TABLE emotional_states ADD COLUMN IF NOT EXISTS state_snapshot JSONB;
ALTER TABLE benchmark_history ADD COLUMN IF NOT EXISTS evaluation_version TEXT NOT NULL DEFAULT 'activity-v1';
ALTER TABLE benchmark_history ALTER COLUMN composite DROP NOT NULL;
ALTER TABLE benchmark_history DROP CONSTRAINT IF EXISTS benchmark_history_benchmark_date_run_source_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmark_date_source_version ON benchmark_history (benchmark_date, run_source, evaluation_version);
CREATE INDEX IF NOT EXISTS idx_benchmark_version_time ON benchmark_history (evaluation_version, created_at DESC);
COMMIT;
