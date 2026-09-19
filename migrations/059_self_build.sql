-- The self-build phase: entered and left by the engine, permitted by a person. Every phase transition
-- and every build attempt is journaled here; the want itself lives in thought_chains, the appraisal in
-- risk_decisions. Nothing in this table grants credit: a build is a branch pushed with its tests green,
-- and only a person's merge or receipt says it helped.
CREATE TABLE IF NOT EXISTS self_build_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('enter', 'exit', 'want', 'build', 'refused', 'deploy', 'rollback')),
  chain_id INTEGER,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS self_build_events_recent ON self_build_events (created_at DESC);
-- Person-level permissions live with the other controls; defaults are off.
UPDATE oca_user_controls SET settings = settings || '{"selfBuild": false, "selfBuildAutoMerge": false}'::jsonb
  WHERE id = true AND NOT (settings ? 'selfBuild');
