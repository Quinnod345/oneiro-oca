-- OCA Migration 007: Entity Graph
-- Persistent entities/relations/events for world understanding

BEGIN;

CREATE TABLE IF NOT EXISTS entities (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    entity_key TEXT NOT NULL UNIQUE, -- canonical stable key
    canonical_name TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'unknown', -- person, app, project, concept, place, file, etc
    aliases TEXT[] NOT NULL DEFAULT '{}',

    confidence FLOAT NOT NULL DEFAULT 0.5,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (entity_type, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_entities_last_seen ON entities (last_seen DESC);

CREATE TABLE IF NOT EXISTS entity_relations (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    subject_entity_id INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL, -- works_on, uses, causes, owns, references, etc
    object_entity_id INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

    confidence FLOAT NOT NULL DEFAULT 0.5,
    evidence_count INT NOT NULL DEFAULT 1,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    metadata JSONB NOT NULL DEFAULT '{}',
    UNIQUE (subject_entity_id, relation_type, object_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_er_subject ON entity_relations (subject_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_er_object ON entity_relations (object_entity_id, relation_type);

CREATE TABLE IF NOT EXISTS entity_mentions (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    entity_id INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL, -- episode, hypothesis, semantic, deliberation, user_message, etc
    source_id INT,

    mention_text TEXT,
    context JSONB NOT NULL DEFAULT '{}',
    confidence FLOAT NOT NULL DEFAULT 0.5,
    mentioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_em_entity_time ON entity_mentions (entity_id, mentioned_at DESC);
CREATE INDEX IF NOT EXISTS idx_em_source ON entity_mentions (source_type, source_id);

COMMIT;
