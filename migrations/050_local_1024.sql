-- Migrate every OCA vector(1536) column → vector(1024) for local BGE-large.
-- Drops the old column (which had OpenAI 1536-d embeddings) and adds a fresh
-- 1024-d column. Pre-existing embeddings become NULL. A re-embed script then
-- backfills, prioritized by recency.
--
-- HNSW indexes that reference the embedding column are dropped automatically
-- with the column. They are recreated at the end.
--
-- SAFE TO RE-RUN: each ALTER skips if the column already has vector(1024) type.

BEGIN;

-- Helper: alter a table's vector column from 1536 → 1024 if needed.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT
      table_schema,
      table_name,
      column_name,
      udt_name,
      atttypmod
    FROM information_schema.columns c
    JOIN pg_attribute a
      ON a.attrelid = (c.table_schema || '.' || c.table_name)::regclass
     AND a.attname = c.column_name
    WHERE c.udt_name = 'vector'
      AND c.table_schema IN ('public','second_brain')
      AND a.atttypmod = 1536 + 4   -- pgvector encodes dim as atttypmod = dim + 4
      AND NOT (c.table_schema = 'second_brain' AND c.table_name = 'observations')  -- already migrated
  LOOP
    RAISE NOTICE 'Migrating %.%.% from vector(1536) → vector(1024)…', r.table_schema, r.table_name, r.column_name;
    EXECUTE format('ALTER TABLE %I.%I DROP COLUMN %I', r.table_schema, r.table_name, r.column_name);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN %I vector(1024)', r.table_schema, r.table_name, r.column_name);
    -- HNSW index for fast cosine retrieval. Same name pattern OCA uses elsewhere.
    BEGIN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.%I USING hnsw (%I vector_cosine_ops)',
        'idx_' || r.table_name || '_' || r.column_name || '_hnsw',
        r.table_schema, r.table_name, r.column_name
      );
    EXCEPTION WHEN duplicate_table THEN
      NULL;
    END;
  END LOOP;
END$$;

COMMIT;
