-- 012_identity_continuity.sql
-- Identity events, succession manifests, cohabitation conventions
-- Implements SPEC §2.9 (Continuity), §17.5 (Cohabitation), §21.5 (Forking), §21.6 (Succession)

-- Identity events: every restart, wipe, migration, fork, rollback is logged
-- and classified as continuation or new-CI per §2.9
CREATE TABLE IF NOT EXISTS identity_events (
    id SERIAL PRIMARY KEY,
    event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type TEXT NOT NULL,       -- restart, shutdown, wipe, rollback, fork, spawn, succession, refusal
    is_continuation BOOLEAN NOT NULL,
    operating_time_at_ms BIGINT,
    description TEXT,
    previous_state JSONB,           -- snapshot of key counters before event
    metadata JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ie_type ON identity_events (event_type, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_ie_time ON identity_events (event_at DESC);

-- Succession manifests: everything needed to transfer a CI to new hardware (§21.6)
CREATE TABLE IF NOT EXISTS succession_manifest (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_host JSONB NOT NULL,
    target_host JSONB,
    memory_snapshot JSONB NOT NULL,
    emotional_baseline JSONB,
    calibration_snapshot JSONB,
    operating_time_ms BIGINT,
    crm_at_transfer FLOAT,
    anti_decay_summary JSONB,
    regrounding_status TEXT DEFAULT 'pending',
    regrounding_details JSONB DEFAULT '{}'
);

-- Cohabitation conventions: versioned spatial/temporal/behavioral rules (§17.5)
CREATE TABLE IF NOT EXISTS cohabitation_conventions (
    id SERIAL PRIMARY KEY,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    conventions JSONB NOT NULL,
    reason TEXT,
    active BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_cc_active ON cohabitation_conventions (active, version DESC);

-- Consent renewal log (§17.5)
CREATE TABLE IF NOT EXISTS consent_reviews (
    id SERIAL PRIMARY KEY,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    capabilities_summary JSONB NOT NULL,
    access_patterns JSONB,
    accumulated_state JSONB,
    operating_time_at_ms BIGINT,
    user_action TEXT,               -- renewed, revoked_some, deferred
    notes TEXT
);

-- Seed initial cohabitation conventions (§17.4 defaults)
INSERT INTO cohabitation_conventions (version, conventions, reason, active)
SELECT 1, '{
  "spatial": {
    "quinn_workspace": "left 2/3 of screen",
    "oneiro_workspace": "right 1/3 or secondary Space",
    "oneiro_terminal": "dedicated tab, not Quinn active terminal",
    "notifications": "macOS notification center, not popups"
  },
  "temporal": {
    "yield_delay_ms": 5000,
    "idle_threshold_shared_s": 5,
    "idle_threshold_primary_s": 300,
    "quiet_hours": "23:00-08:00"
  },
  "behavioral": {
    "focused_window_access": "oneiro_primary or collaborative only",
    "background_window_access": "shared, oneiro_primary, or collaborative",
    "user_override": "instant, always honored"
  }
}', 'initial SPEC §17.4 defaults', true
WHERE NOT EXISTS (SELECT 1 FROM cohabitation_conventions WHERE version = 1);
