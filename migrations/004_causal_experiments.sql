-- OCA Migration 004: Causal Experiments
-- Stores intervention-driven causal tests and support scores

BEGIN;

CREATE TABLE IF NOT EXISTS causal_experiments (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    cause_type TEXT NOT NULL DEFAULT 'freeform', -- world_model, semantic, hypothesis, freeform
    cause_id INT,
    cause_description TEXT NOT NULL,
    intervention TEXT NOT NULL,

    expected_effect TEXT,
    expected_mechanism TEXT,

    status TEXT NOT NULL DEFAULT 'designed', -- designed, running, completed, failed, abandoned
    actual_outcome TEXT,
    outcome_valence FLOAT,
    causal_support FLOAT, -- 0..1 support for the claim
    model_update TEXT,

    confidence FLOAT NOT NULL DEFAULT 0.5,

    hypothesis_id INT REFERENCES hypotheses(id) ON DELETE SET NULL,
    simulation_id INT REFERENCES simulations(id) ON DELETE SET NULL,
    episode_id INT REFERENCES episodic_memory(id) ON DELETE SET NULL,
    prediction_ledger_id INT REFERENCES prediction_ledger(id) ON DELETE SET NULL,

    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_ce_status ON causal_experiments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_cause ON causal_experiments (cause_type, cause_id);
CREATE INDEX IF NOT EXISTS idx_ce_hypothesis ON causal_experiments (hypothesis_id) WHERE hypothesis_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_support ON causal_experiments (causal_support DESC);

ALTER TABLE counterfactuals
    ADD COLUMN IF NOT EXISTS actual_outcome TEXT,
    ADD COLUMN IF NOT EXISTS accuracy_score FLOAT,
    ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ;

COMMIT;
