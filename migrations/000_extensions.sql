-- The vector type the memory tables use. A fresh database needs it before anything else runs; pgvector itself has to be
-- installed for this Postgres first (scripts/install-engine.sh in the app's repository checks and says how).
CREATE EXTENSION IF NOT EXISTS vector;
