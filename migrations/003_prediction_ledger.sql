-- OCA Migration 003: Unified Prediction Ledger
-- Tracks prediction start/outcome/error across motor, hypothesis, simulation

BEGIN;

DO $$
BEGIN
  ALTER TYPE cognitive_event_type ADD VALUE IF NOT EXISTS 'reasoning_trace_created';
  ALTER TYPE cognitive_event_type ADD VALUE IF NOT EXISTS 'causal_experiment_designed';
  ALTER TYPE cognitive_event_type ADD VALUE IF NOT EXISTS 'causal_experiment_completed';
  ALTER TYPE cognitive_event_type ADD VALUE IF NOT EXISTS 'counterfactual_evaluated';
  ALTER TYPE cognitive_event_type ADD VALUE IF NOT EXISTS 'semantic_reinforced';
  ALTER TYPE cognitive_event_type ADD VALUE IF NOT EXISTS 'semantic_created';
  ALTER TYPE cognitive_event_type ADD VALUE IF NOT EXISTS 'semantic_contradicted';
END $$;

CREATE TABLE IF NOT EXISTS prediction_ledger (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Source/action
    action_source TEXT NOT NULL, -- motor, hypothesis, simulation, procedural, benchmark
    action_type TEXT NOT NULL,
    action_details JSONB NOT NULL DEFAULT '{}',

    -- Prediction (pre-action)
    expected_outcome TEXT,
    expected_structured JSONB,
    confidence FLOAT NOT NULL DEFAULT 0.5,

    -- Outcome (post-action)
    observed_outcome TEXT,
    observed_structured JSONB,
    observed_at TIMESTAMPTZ,
    success BOOLEAN,
    status TEXT NOT NULL DEFAULT 'started', -- started, completed, failed, unverifiable

    -- Evaluator metadata
    evaluation_mode TEXT, -- structured, semantic, structured_fallback_semantic, none
    evaluation_reason TEXT,
    verifiability TEXT, -- structured, semantic, none
    prediction_error FLOAT,

    -- Links
    hypothesis_id INT REFERENCES hypotheses(id) ON DELETE SET NULL,
    simulation_id INT REFERENCES simulations(id) ON DELETE SET NULL,
    procedure_id INT REFERENCES procedural_memory(id) ON DELETE SET NULL,
    motor_command_id INT,

    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_pl_source_time ON prediction_ledger (action_source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pl_status_time ON prediction_ledger (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pl_hypothesis ON prediction_ledger (hypothesis_id) WHERE hypothesis_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pl_simulation ON prediction_ledger (simulation_id) WHERE simulation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pl_error ON prediction_ledger (prediction_error DESC);

COMMIT;
