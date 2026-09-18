-- Additive: legacy chains and past (unverified) outcomes are preserved, never relabelled.
ALTER TABLE thought_chains ADD COLUMN IF NOT EXISTS ponder_state JSONB;
ALTER TABLE deliberations ADD COLUMN IF NOT EXISTS outcome_evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS thought_chains_ponder_queue ON thought_chains (status, priority DESC)
  WHERE ponder_state IS NOT NULL;
