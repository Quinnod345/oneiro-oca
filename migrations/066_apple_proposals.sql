-- The growth loop's proposals: one row per kind of move and subject, re-evaluated daily. Each keeps the numbers
-- behind it, the exact request, and the Apple broker's answer (dry_run, needs_approval, sent, denied).
CREATE TABLE IF NOT EXISTS apple_proposals (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  request JSONB,
  why TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  decision JSONB,
  approval_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, subject)
);
