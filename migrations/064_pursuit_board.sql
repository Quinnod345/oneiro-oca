-- The workstream an agent was deployed into: a category the orchestrator named for the pursuit ("Content",
-- "Distribution", "Measurement"). The strategist sets it when it picks the move; the board keeper labels
-- older deployments it finds without one. The board itself lives in ponder_state.continuity.board.
ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS stream TEXT;
