-- OCA Migration 005: Semantic Truth Maintenance
-- Adds weighted evidence, contradiction tracking, and decay metadata

BEGIN;

ALTER TABLE semantic_memory
    ADD COLUMN IF NOT EXISTS decay_rate FLOAT NOT NULL DEFAULT 0.015,
    ADD COLUMN IF NOT EXISTS last_decay_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_weighted_update TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS semantic_evidence (
    id SERIAL PRIMARY KEY,
    concept_id INT NOT NULL REFERENCES semantic_memory(id) ON DELETE CASCADE,
    episode_id INT REFERENCES episodic_memory(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL DEFAULT 'observation', -- observation, abstraction, inference, user_instruction
    weight FLOAT NOT NULL DEFAULT 1.0,
    supports BOOLEAN NOT NULL DEFAULT TRUE,
    evidence_text TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sem_evidence_concept ON semantic_evidence (concept_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sem_evidence_episode ON semantic_evidence (episode_id) WHERE episode_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS contradiction_sets (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    label TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active', -- active, resolved, deprecated
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS contradiction_set_members (
    id SERIAL PRIMARY KEY,
    contradiction_set_id INT NOT NULL REFERENCES contradiction_sets(id) ON DELETE CASCADE,
    concept_id INT NOT NULL REFERENCES semantic_memory(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'claim', -- claim, counterclaim, synthesis
    confidence FLOAT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contradiction_set_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_csm_set ON contradiction_set_members (contradiction_set_id);
CREATE INDEX IF NOT EXISTS idx_csm_concept ON contradiction_set_members (concept_id);

CREATE TABLE IF NOT EXISTS semantic_contradictions (
    id SERIAL PRIMARY KEY,
    concept_id INT NOT NULL REFERENCES semantic_memory(id) ON DELETE CASCADE,
    contradicting_concept_id INT REFERENCES semantic_memory(id) ON DELETE SET NULL,
    contradiction_set_id INT REFERENCES contradiction_sets(id) ON DELETE SET NULL,
    episode_id INT REFERENCES episodic_memory(id) ON DELETE SET NULL,
    reason TEXT,
    weight FLOAT NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_sem_contra_concept ON semantic_contradictions (concept_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sem_contra_set ON semantic_contradictions (contradiction_set_id);

COMMIT;
