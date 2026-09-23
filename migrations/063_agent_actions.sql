-- Actions an agent took (or asked to take) on the world under the person's charter: one row per attempt,
-- decided by the actuator, observed afterwards. The monthly spend cap and the approval ramp read from here.
CREATE TABLE IF NOT EXISTS agent_actions (
  id UUID PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  class TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  control TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  cost NUMERIC NOT NULL DEFAULT 0,
  decision TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  ask_id INTEGER,
  approved_by_ask INTEGER,
  outcome TEXT,
  observation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  observed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_actions_class_time ON agent_actions (class, created_at);
