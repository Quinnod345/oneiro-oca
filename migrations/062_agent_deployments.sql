-- Deployed agents: gateway sessions the engine opened for a want. One row per deployment; the session
-- outlives the row's terminal status so the person can still read it.
CREATE TABLE IF NOT EXISTS agent_deployments (
  id UUID PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL,
  session_key TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  run_id TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  question TEXT,
  ask_id INTEGER,
  report JSONB,
  error TEXT,
  seen_messages INTEGER NOT NULL DEFAULT 0,
  fired_by TEXT NOT NULL DEFAULT 'engine',
  cwd TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_deployments_chain_status ON agent_deployments (chain_id, status);
-- Transcripts change shape after a turn (streamed parts merge), so "seen so far" is a time, not a count.
ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS seen_at_ms BIGINT NOT NULL DEFAULT 0;
