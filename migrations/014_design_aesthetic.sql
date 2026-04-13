-- Migration 014: Design Aesthetic System
-- Tables for design evaluation tracking, skill versioning, training data, and model versions.

CREATE TABLE IF NOT EXISTS design_evaluations (
  id SERIAL PRIMARY KEY,
  artifact_type TEXT NOT NULL,            -- 'screenshot', 'code', 'component', 'full_app'
  artifact_path TEXT,
  input_features JSONB,                   -- the 64-dim feature vector as JSON
  scores JSONB NOT NULL,                  -- the 12-dim MLP output as JSON
  emotion_context JSONB,                  -- PADCN + channels at evaluation time
  design_policy JSONB,                    -- the computed design policy
  overall_score FLOAT NOT NULL,
  model_version INTEGER NOT NULL DEFAULT 1,
  phase TEXT DEFAULT 'js_mlp',            -- 'js_mlp', 'mlx_mobilenet', 'mlx_expert', etc.
  evaluated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS design_skill_versions (
  id SERIAL PRIMARY KEY,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,                  -- full SKILL.md content at this version
  trigger TEXT,                           -- what caused this version ('auto_evolution', 'manual', etc.)
  weak_dimensions JSONB,                  -- which dimensions were weak
  improvement_targets JSONB,              -- what improvements were attempted
  score_before FLOAT,
  score_after FLOAT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS design_training_data (
  id SERIAL PRIMARY KEY,
  features JSONB NOT NULL,                -- input feature vector
  target_scores JSONB NOT NULL,           -- ground truth scores (from LLM or human)
  source TEXT NOT NULL,                   -- 'llm_judge', 'human', 'comparative', 'self_play'
  artifact_path TEXT,
  screenshot_path TEXT,
  comparison_pair_id INTEGER,             -- links A/B comparison pairs
  preference_winner BOOLEAN,              -- true = this one won the comparison
  human_reviewed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS design_model_versions (
  id SERIAL PRIMARY KEY,
  version INTEGER NOT NULL,
  phase TEXT NOT NULL,                    -- 'js_mlp', 'mlx_mobilenet', 'mlx_expert', etc.
  architecture JSONB NOT NULL,            -- full architecture description
  param_count BIGINT NOT NULL,
  training_data_count INTEGER NOT NULL,
  val_loss FLOAT,
  best_dim_scores JSONB,                  -- best achieved per-dimension scores
  weights_path TEXT NOT NULL,
  export_paths JSONB,                     -- { onnx: '...', coreml: '...' }
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_design_eval_score ON design_evaluations(overall_score);
CREATE INDEX IF NOT EXISTS idx_design_eval_time ON design_evaluations(evaluated_at);
CREATE INDEX IF NOT EXISTS idx_design_eval_type ON design_evaluations(artifact_type);
CREATE INDEX IF NOT EXISTS idx_design_training_source ON design_training_data(source);
CREATE INDEX IF NOT EXISTS idx_design_training_time ON design_training_data(created_at);
CREATE INDEX IF NOT EXISTS idx_design_model_phase ON design_model_versions(phase);
CREATE INDEX IF NOT EXISTS idx_design_skill_version ON design_skill_versions(version);
