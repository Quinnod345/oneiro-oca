-- Generated consolidation output has provenance but no automatic truth/skill authority.
CREATE TABLE IF NOT EXISTS consolidation_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence JSONB NOT NULL,
  raw_response TEXT NOT NULL,
  candidate_count INT NOT NULL CHECK (candidate_count >= 0 AND candidate_count <= 12)
);
CREATE TABLE IF NOT EXISTS consolidation_candidates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id BIGINT NOT NULL REFERENCES consolidation_reviews(id),
  kind TEXT NOT NULL CHECK (kind IN ('principles','procedures','connections','contradictions')),
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status = 'unverified'),
  payload JSONB NOT NULL,
  evidence JSONB NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consolidation_candidates_recent ON consolidation_candidates (created_at DESC);
