-- 061: pursuit drafts. A person's loose request, what the engine gathered for it (its own truth for the
-- confirm step), the draft the model produced and the engine validated, and what the person confirmed.
-- Its own table, not oca_user_jobs: that drain is serial and a draft can take minutes on a cloud model.
CREATE TABLE IF NOT EXISTS pursuit_drafts (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'drafting' CHECK (status IN ('drafting', 'ready', 'needs_answers', 'failed', 'confirmed', 'abandoned')),
  phase TEXT,
  provider TEXT,
  by TEXT NOT NULL DEFAULT 'quinn',
  turns JSONB NOT NULL DEFAULT '[]'::jsonb,
  gathered JSONB,
  draft JSONB,
  confirmed JSONB,
  chain_id INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX IF NOT EXISTS pursuit_drafts_open ON pursuit_drafts (created_at DESC) WHERE status IN ('drafting', 'ready', 'needs_answers');
