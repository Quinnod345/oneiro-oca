-- Tables the engine reads and writes that were only ever created by an older parent project, so a clean database never
-- got them and migrations 051, 052 and 055 failed on it. Existing databases already have these; IF NOT EXISTS leaves them be.
CREATE TABLE IF NOT EXISTS thought_chains (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seed TEXT NOT NULL,
  status TEXT DEFAULT 'pondering',
  depth INT DEFAULT 0,
  priority DOUBLE PRECISION DEFAULT 0.5,
  share_worthy BOOLEAN DEFAULT FALSE,
  share_reason TEXT,
  embedding vector(1024)
);
CREATE INDEX IF NOT EXISTS thought_chains_status_idx ON thought_chains (status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_thought_chains_embedding_hnsw ON thought_chains USING hnsw (embedding vector_cosine_ops);

-- The read-only dream archive (/oca/dreams/state). Empty on a new Mac, but the route reads it.
CREATE TABLE IF NOT EXISTS dreams (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content TEXT NOT NULL,
  type TEXT DEFAULT 'wonder',
  weight DOUBLE PRECISION DEFAULT 0.3,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  lifecycle_state TEXT NOT NULL DEFAULT 'dormant',
  lifecycle_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  executing_at TIMESTAMPTZ,
  lifecycle_context JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS dream_tasks (
  id SERIAL PRIMARY KEY,
  dream_id INT REFERENCES dreams(id),
  task_description TEXT,
  task_type TEXT,
  status TEXT DEFAULT 'pending',
  result JSONB DEFAULT '{}'::jsonb,
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  retry_count INT DEFAULT 0
);
