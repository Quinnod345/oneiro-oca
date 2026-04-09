-- 013_hippo_memory.sql
-- HippoRAG-inspired hippocampal indexing for multi-hop recall
-- Adds entity embeddings for graph-matching + node specificity

-- Add embedding column to entities for synonymy matching
ALTER TABLE entities ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);

-- Index for fast entity similarity search
CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities USING hnsw (embedding vector_cosine_ops);

-- Add mention_count for node specificity computation
-- (HippoRAG uses specificity = 1/log(1+mentions) instead of IDF)
ALTER TABLE entities ADD COLUMN IF NOT EXISTS mention_count INT DEFAULT 0;

-- Update mention counts from entity_mentions
UPDATE entities e SET mention_count = (
    SELECT COUNT(*) FROM entity_mentions em WHERE em.entity_id = e.id
);

-- Add edge weight to entity_relations for weighted PPR
ALTER TABLE entity_relations ADD COLUMN IF NOT EXISTS weight FLOAT DEFAULT 1.0;

-- Set initial weights from evidence_count
UPDATE entity_relations SET weight = LEAST(5.0, GREATEST(0.1, evidence_count::float * 0.5));
