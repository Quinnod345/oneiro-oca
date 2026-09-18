-- Every appraised action is journaled with its prediction; the observed outcome is attached later.
-- This is the calibration record for the risk model and the source of self-capability worth.
CREATE TABLE IF NOT EXISTS risk_decisions (
  id TEXT PRIMARY KEY,
  chain_id INTEGER,
  capability TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('proceed', 'prepare_artifact', 'refuse', 'learn_stakes')),
  proposal JSONB NOT NULL,
  appraisal JSONB NOT NULL,
  outcome JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS risk_decisions_recent ON risk_decisions (created_at DESC);
CREATE INDEX IF NOT EXISTS risk_decisions_chain ON risk_decisions (chain_id, created_at DESC);
