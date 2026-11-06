-- A short name the engine writes for each agent, so the app can say what it's doing. NULL until written; readers fall
-- back to a clean shortening of its task, and an old row gets its name the first time it's read.
ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS name TEXT;
