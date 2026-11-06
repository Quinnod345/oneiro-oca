-- Forgetting a memory. A person can ask Oneiro to forget one experience (episodic_memory) or one stored claim
-- (semantic_memory) from the Memory page. Forgetting is a soft delete: the row stays, `forgotten_at` is set, and
-- every recall path filters `forgotten_at IS NULL`, so the memory stops shaping answers, drafts and graph recall
-- while Undo can still bring it back exactly as it was. Restoring clears the column.
--
-- memory_forget_log is the durable audit trail (cognitive_events is pruned after 24 hours, so it can't be one).
-- It records which record was forgotten or restored, when, and the person's optional reason. It deliberately keeps
-- no copy of the memory's text: a forgotten memory should not survive in its own audit trail.
--
-- Idempotent, like every migration here: safe to run again.

ALTER TABLE episodic_memory ADD COLUMN IF NOT EXISTS forgotten_at TIMESTAMPTZ;
ALTER TABLE semantic_memory ADD COLUMN IF NOT EXISTS forgotten_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS memory_forget_log (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('experience', 'knowledge')),
  record_id  INT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('forget', 'restore')),
  reason     TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_forget_log_record ON memory_forget_log (kind, record_id, at DESC);

-- "Recently forgotten" lists forgotten rows newest first; partial indexes keep that cheap without indexing the
-- (overwhelmingly NULL) column for every kept memory.
CREATE INDEX IF NOT EXISTS idx_em_forgotten ON episodic_memory (forgotten_at DESC) WHERE forgotten_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sm_forgotten ON semantic_memory (forgotten_at DESC) WHERE forgotten_at IS NOT NULL;
