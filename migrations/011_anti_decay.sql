-- 011_anti_decay.sql
-- Anti-decay evaluation infrastructure (SPEC §2.8, §18.4)
-- Operating-time tracking, CRM trend analysis, failure condition detection

-- Operating time log: tracks when the cognitive loop was running
CREATE TABLE IF NOT EXISTS operating_time_log (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at TIMESTAMPTZ,
    duration_ms BIGINT,
    reason TEXT NOT NULL DEFAULT 'boot' -- boot, crash, shutdown, restart
);
CREATE INDEX IF NOT EXISTS idx_otl_started ON operating_time_log (started_at DESC);

-- Add operating_time_ms to benchmark_history so each CRM snapshot
-- records the cumulative operating-time cursor at which it was computed
ALTER TABLE benchmark_history
    ADD COLUMN IF NOT EXISTS operating_time_ms BIGINT DEFAULT 0;

-- Anti-decay trend analysis results
CREATE TABLE IF NOT EXISTS anti_decay_trends (
    id SERIAL PRIMARY KEY,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    horizon TEXT NOT NULL, -- 'short' (24h), 'medium' (7d), 'long' (30d)
    operating_time_ms BIGINT NOT NULL,
    crm_current FLOAT NOT NULL,
    crm_baseline FLOAT,
    crm_delta FLOAT, -- ΔCRM/Δt
    component_deltas JSONB NOT NULL DEFAULT '{}',
    failure_conditions JSONB NOT NULL DEFAULT '[]',
    remediation_actions JSONB NOT NULL DEFAULT '[]',
    UNIQUE (computed_at, horizon)
);
CREATE INDEX IF NOT EXISTS idx_adt_horizon_time ON anti_decay_trends (horizon, computed_at DESC);

-- Maintenance loop audit: track which layers last participated in maintenance
CREATE TABLE IF NOT EXISTS maintenance_audit (
    id SERIAL PRIMARY KEY,
    layer TEXT NOT NULL,
    last_maintained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    maintenance_type TEXT NOT NULL, -- consolidation, decay, sweep, evaluation, calibration
    details JSONB DEFAULT '{}',
    UNIQUE (layer, maintenance_type)
);
CREATE INDEX IF NOT EXISTS idx_ma_layer ON maintenance_audit (layer);
