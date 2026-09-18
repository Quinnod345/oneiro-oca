-- Learned interests remain scoped to explicitly requested wants. No historical dream import.
CREATE TABLE IF NOT EXISTS motivational_interests (
  key TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS interest_experiences (
  id TEXT PRIMARY KEY,
  interest_key TEXT NOT NULL,
  parent_chain_id INT NOT NULL REFERENCES thought_chains(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS interest_experiences_topic ON interest_experiences (interest_key);
CREATE TABLE IF NOT EXISTS interest_pursuits (
  fingerprint TEXT PRIMARY KEY,
  interest_key TEXT NOT NULL,
  parent_chain_id INT NOT NULL REFERENCES thought_chains(id),
  chain_id INT NOT NULL UNIQUE REFERENCES thought_chains(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS interest_pursuits_topic ON interest_pursuits (interest_key, created_at);
