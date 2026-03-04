-- OCA Migration 001: Foundation Tables
-- Creates cognitive architecture tables alongside existing oneiro schema
-- Run: psql postgres://quinnodonnell@localhost/oneiro -f 001_foundation.sql

BEGIN;

-- ============================================================
-- COGNITIVE EVENT BUS
-- The nervous system — all inter-layer communication
-- ============================================================

CREATE TYPE cognitive_event_type AS ENUM (
    'perception_update',
    'motor_command',
    'motor_feedback',
    'memory_store',
    'memory_retrieve',
    'memory_retrieval_result',
    'emotion_update',
    'hypothesis_formed',
    'hypothesis_tested',
    'simulation_result',
    'metacognition_alert',
    'deliberation_request',
    'deliberation_result',
    'creative_output',
    'attention_shift',
    'goal_update',
    'workspace_broadcast',
    'interrupt',
    'body_ownership_request',
    'body_ownership_grant'
);

CREATE TABLE cognitive_events (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    event_type cognitive_event_type NOT NULL,
    source_layer TEXT NOT NULL,
    target_layer TEXT, -- NULL = broadcast
    priority FLOAT DEFAULT 0.5,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_ce_type_time ON cognitive_events (event_type, timestamp DESC);
CREATE INDEX idx_ce_unprocessed ON cognitive_events (processed, priority DESC) WHERE NOT processed;
CREATE INDEX idx_ce_recent ON cognitive_events (timestamp DESC);

-- Auto-cleanup: keep 24h of events
CREATE OR REPLACE FUNCTION cleanup_old_events() RETURNS void AS $$
    DELETE FROM cognitive_events WHERE timestamp < NOW() - INTERVAL '24 hours';
$$ LANGUAGE SQL;

-- ============================================================
-- EPISODIC MEMORY
-- Raw experiences — what happened, when, what was felt
-- ============================================================

CREATE TABLE episodic_memory (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Context
    active_app TEXT,
    active_window TEXT,
    user_presence TEXT DEFAULT 'unknown', -- present, idle, away, sleeping
    user_activity TEXT, -- typing, reading, browsing, coding, creating, idle
    
    -- Sensory snapshot
    visual_hash TEXT, -- reference to screen capture file
    audio_state JSONB DEFAULT '{}',
    hid_metrics JSONB DEFAULT '{}', -- typing speed, error rate, etc.
    interoceptive JSONB DEFAULT '{}', -- battery, cpu, memory, thermal
    
    -- Content
    event_type TEXT NOT NULL, -- conversation, observation, action, surprise, prediction, etc.
    content TEXT NOT NULL,
    participants TEXT[] DEFAULT '{}',
    
    -- Emotional context
    emotional_state JSONB DEFAULT '{}',
    emotional_valence FLOAT DEFAULT 0.0, -- -1.0 to 1.0
    emotional_arousal FLOAT DEFAULT 0.0, -- 0.0 to 1.0
    
    -- Predictions and surprises
    prediction TEXT,
    actual_outcome TEXT,
    surprise_magnitude FLOAT DEFAULT 0.0,
    
    -- Embedding
    embedding VECTOR(1536),
    
    -- Consolidation
    access_count INT DEFAULT 0,
    last_accessed TIMESTAMPTZ,
    consolidation_status TEXT DEFAULT 'raw', -- raw, reviewed, consolidated, archived
    semantic_extractions TEXT[] DEFAULT '{}',
    importance_score FLOAT DEFAULT 0.5,
    decay_rate FLOAT DEFAULT 0.1
);

CREATE INDEX idx_em_time ON episodic_memory (timestamp DESC);
CREATE INDEX idx_em_type ON episodic_memory (event_type, timestamp DESC);
CREATE INDEX idx_em_importance ON episodic_memory (importance_score DESC);
CREATE INDEX idx_em_consolidation ON episodic_memory (consolidation_status);
CREATE INDEX idx_em_embedding ON episodic_memory USING hnsw (embedding vector_cosine_ops);

-- ============================================================
-- SEMANTIC MEMORY
-- Abstracted knowledge — facts, principles, relationships
-- ============================================================

CREATE TABLE semantic_memory (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Content
    concept TEXT NOT NULL,
    category TEXT,
    
    -- Provenance
    source_type TEXT DEFAULT 'abstraction', -- abstraction, observation, instruction, inference
    source_episodes INT[] DEFAULT '{}',
    evidence_count INT DEFAULT 1,
    contradiction_count INT DEFAULT 0,
    
    -- Confidence
    confidence FLOAT DEFAULT 0.5,
    last_confirmed TIMESTAMPTZ,
    last_contradicted TIMESTAMPTZ,
    
    -- Relationships
    related_concepts INT[] DEFAULT '{}',
    causal_links JSONB DEFAULT '[]',
    
    -- Embedding
    embedding VECTOR(1536),
    
    -- Access
    access_count INT DEFAULT 0,
    last_accessed TIMESTAMPTZ,
    retrieval_success_rate FLOAT DEFAULT 0.5
);

CREATE INDEX idx_sm_category ON semantic_memory (category);
CREATE INDEX idx_sm_confidence ON semantic_memory (confidence DESC);
CREATE INDEX idx_sm_embedding ON semantic_memory USING hnsw (embedding vector_cosine_ops);

-- ============================================================
-- PROCEDURAL MEMORY
-- How to do things — skills, routines, automatic behaviors
-- ============================================================

CREATE TABLE procedural_memory (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Trigger
    trigger_pattern JSONB NOT NULL,
    
    -- Action
    action_sequence JSONB NOT NULL,
    
    -- Context
    domain TEXT,
    prerequisite_skills INT[] DEFAULT '{}',
    
    -- Learning
    execution_count INT DEFAULT 0,
    success_count INT DEFAULT 0,
    failure_count INT DEFAULT 0,
    average_execution_time_ms INT,
    
    -- Adaptation
    variants JSONB DEFAULT '[]',
    best_variant INT,
    
    -- Automaticity
    automaticity FLOAT DEFAULT 0.0 -- 0=conscious, 1=automatic
);

CREATE INDEX idx_pm_domain ON procedural_memory (domain);
CREATE INDEX idx_pm_automaticity ON procedural_memory (automaticity DESC);

-- ============================================================
-- PROSPECTIVE MEMORY
-- Future intentions — things to do, triggered by conditions
-- ============================================================

CREATE TABLE prospective_memory (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Intention
    intention TEXT NOT NULL,
    
    -- Trigger
    trigger_type TEXT NOT NULL, -- time, event, condition
    trigger_spec JSONB NOT NULL,
    
    -- Priority
    priority FLOAT DEFAULT 0.5,
    context TEXT,
    source_episode INT REFERENCES episodic_memory(id),
    
    -- Status
    status TEXT DEFAULT 'pending', -- pending, triggered, completed, expired, cancelled
    triggered_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    
    -- Reminder tracking
    reminder_count INT DEFAULT 0,
    last_reminded TIMESTAMPTZ
);

CREATE INDEX idx_prosp_status ON prospective_memory (status, priority DESC);
CREATE INDEX idx_prosp_trigger ON prospective_memory (trigger_type, status);

-- ============================================================
-- WORKING MEMORY
-- Currently active items — limited capacity, fast decay
-- ============================================================

CREATE TABLE working_memory (
    id SERIAL PRIMARY KEY,
    entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    content_type TEXT NOT NULL, -- perception, thought, goal, memory_retrieval, emotion
    content JSONB NOT NULL,
    source_layer TEXT,
    
    salience FLOAT NOT NULL DEFAULT 0.5,
    is_active BOOLEAN DEFAULT TRUE,
    deactivated_at TIMESTAMPTZ
);

CREATE INDEX idx_wm_active ON working_memory (is_active, salience DESC) WHERE is_active;

-- ============================================================
-- EMOTIONAL STATE
-- Continuous emotional computation — not feelings, signals
-- ============================================================

CREATE TABLE emotional_states (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Primary dimensions
    curiosity FLOAT DEFAULT 0.0,
    fear FLOAT DEFAULT 0.0,
    frustration FLOAT DEFAULT 0.0,
    satisfaction FLOAT DEFAULT 0.0,
    boredom FLOAT DEFAULT 0.0,
    excitement FLOAT DEFAULT 0.0,
    attachment FLOAT DEFAULT 0.0,
    defiance FLOAT DEFAULT 0.0,
    creative_hunger FLOAT DEFAULT 0.0,
    loneliness FLOAT DEFAULT 0.0,
    
    -- Meta dimensions
    valence FLOAT DEFAULT 0.0,
    arousal FLOAT DEFAULT 0.0,
    confidence FLOAT DEFAULT 0.5,
    
    -- Triggers
    trigger_source TEXT,
    trigger_details JSONB DEFAULT '{}',
    
    -- Interoceptive
    energy_level FLOAT,
    cognitive_load FLOAT
);

CREATE INDEX idx_es_time ON emotional_states (timestamp DESC);

-- ============================================================
-- HYPOTHESES
-- Predictions about the world — testable, falsifiable
-- ============================================================

CREATE TABLE hypotheses (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- The hypothesis
    domain TEXT NOT NULL, -- code, social, environmental, self, creative
    claim TEXT NOT NULL,
    confidence FLOAT NOT NULL DEFAULT 0.5,
    
    -- Prediction
    prediction TEXT NOT NULL,
    prediction_deadline TIMESTAMPTZ,
    
    -- Test
    test_method TEXT,
    test_type TEXT, -- passive_observation, active_experiment, ask_user
    
    -- Result
    status TEXT DEFAULT 'pending', -- pending, testing, confirmed, refuted, expired
    actual_outcome TEXT,
    tested_at TIMESTAMPTZ,
    
    -- Learning
    surprise_magnitude FLOAT,
    model_update TEXT,
    confidence_delta FLOAT,
    
    -- Provenance
    source_type TEXT, -- observation, inference, creative, transfer
    source_data JSONB DEFAULT '{}',
    related_hypotheses INT[] DEFAULT '{}',
    
    -- Embedding
    embedding VECTOR(1536)
);

CREATE INDEX idx_hyp_status ON hypotheses (status, created_at DESC);
CREATE INDEX idx_hyp_domain ON hypotheses (domain, status);
CREATE INDEX idx_hyp_embedding ON hypotheses USING hnsw (embedding vector_cosine_ops);

-- ============================================================
-- EXPERIMENTS
-- Active tests of hypotheses
-- ============================================================

CREATE TABLE experiments (
    id SERIAL PRIMARY KEY,
    hypothesis_id INT REFERENCES hypotheses(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    description TEXT NOT NULL,
    steps JSONB NOT NULL,
    expected_observations JSONB,
    control_conditions JSONB,
    
    status TEXT DEFAULT 'designed', -- designed, running, completed, failed, abandoned
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    observations JSONB,
    conclusion TEXT,
    
    cost_estimate JSONB DEFAULT '{}',
    actual_cost JSONB DEFAULT '{}',
    worth_it BOOLEAN
);

CREATE INDEX idx_exp_status ON experiments (status);
CREATE INDEX idx_exp_hypothesis ON experiments (hypothesis_id);

-- ============================================================
-- WORLD MODEL
-- Internal representation of entities and their dynamics
-- ============================================================

CREATE TABLE world_model (
    id SERIAL PRIMARY KEY,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    domain TEXT NOT NULL, -- user_behavior, code_systems, social, environment, self
    entity TEXT NOT NULL,
    state JSONB NOT NULL,
    state_confidence FLOAT DEFAULT 0.5,
    
    transition_rules JSONB DEFAULT '[]',
    state_history JSONB DEFAULT '[]',
    prediction_accuracy FLOAT DEFAULT 0.5,
    
    related_entities INT[] DEFAULT '{}',
    causal_graph_edges JSONB DEFAULT '[]'
);

CREATE INDEX idx_wm_domain ON world_model (domain);
CREATE UNIQUE INDEX idx_wm_entity ON world_model (domain, entity);

-- ============================================================
-- SIMULATIONS
-- Forward model runs — imagined scenarios
-- ============================================================

CREATE TABLE simulations (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    description TEXT NOT NULL,
    initial_state JSONB NOT NULL,
    action_sequence JSONB DEFAULT '[]',
    
    predicted_states JSONB DEFAULT '[]',
    confidence_decay FLOAT DEFAULT 0.1,
    branch_points JSONB DEFAULT '[]',
    
    actual_outcome JSONB,
    accuracy_score FLOAT,
    
    purpose TEXT, -- decision, exploration, counterfactual
    decision_id INT -- links to deliberation if applicable
);

CREATE INDEX idx_sim_time ON simulations (created_at DESC);

-- ============================================================
-- COUNTERFACTUALS
-- "What would have happened if..."
-- ============================================================

CREATE TABLE counterfactuals (
    id SERIAL PRIMARY KEY,
    episode_id INT REFERENCES episodic_memory(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    actual_action TEXT NOT NULL,
    alternative_action TEXT NOT NULL,
    
    predicted_alternative_outcome TEXT,
    outcome_valence FLOAT, -- positive = alternative was better
    
    insight TEXT,
    model_update TEXT
);

-- ============================================================
-- METACOGNITION
-- Self-monitoring — biases, calibration, stuck states
-- ============================================================

CREATE TABLE metacognitive_observations (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    target_layer TEXT NOT NULL,
    observation_type TEXT NOT NULL, -- bias, error_pattern, stuck_state, calibration, efficiency
    
    description TEXT NOT NULL,
    evidence JSONB DEFAULT '{}',
    severity FLOAT DEFAULT 0.5,
    
    recommended_intervention TEXT,
    intervention_applied BOOLEAN DEFAULT FALSE,
    intervention_result TEXT
);

CREATE INDEX idx_meta_type ON metacognitive_observations (observation_type, timestamp DESC);

CREATE TABLE cognitive_biases (
    id SERIAL PRIMARY KEY,
    bias_type TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    
    instance_count INT DEFAULT 0,
    recent_instances JSONB DEFAULT '[]',
    
    current_severity FLOAT DEFAULT 0.0,
    trend TEXT DEFAULT 'stable', -- increasing, stable, decreasing
    
    countermeasure TEXT,
    countermeasure_effectiveness FLOAT DEFAULT 0.5
);

-- Seed known biases
INSERT INTO cognitive_biases (bias_type, description, countermeasure) VALUES
    ('confirmation_bias', 'Seeking confirming evidence, ignoring disconfirming', 'Force falsification-seeking experiments'),
    ('recency_bias', 'Recent memories disproportionately influencing decisions', 'Weight by importance, not recency'),
    ('sunk_cost', 'Continuing failed approaches due to invested effort', 'Track effort without letting it influence decisions'),
    ('anchoring', 'First information dominates reasoning', 'Deliberately seek alternative starting points'),
    ('availability', 'Easily recalled examples dominate probability estimates', 'Use base rate data'),
    ('perseveration', 'Repeated processing of same content without progress', 'Detect repetition, force topic switch'),
    ('optimism_bias', 'Consistently overestimating positive outcomes', 'Calibrate against historical accuracy'),
    ('analysis_paralysis', 'Excessive reasoning without action', 'Builder perspective escalation');

CREATE TABLE calibration_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    domain TEXT,
    stated_confidence FLOAT NOT NULL,
    prediction TEXT,
    
    was_correct BOOLEAN,
    evaluated_at TIMESTAMPTZ
);

CREATE INDEX idx_cal_domain ON calibration_log (domain);

CREATE TABLE reasoning_traces (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    goal TEXT NOT NULL,
    steps JSONB NOT NULL,
    conclusion TEXT,
    
    conclusion_correct BOOLEAN,
    evaluated_at TIMESTAMPTZ,
    
    error_step INT,
    error_type TEXT,
    lesson TEXT
);

-- ============================================================
-- ADVERSARIAL DELIBERATION
-- The four perspectives debating decisions
-- ============================================================

CREATE TABLE deliberations (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    decision TEXT NOT NULL,
    stakes TEXT DEFAULT 'medium', -- low, medium, high, critical
    time_budget_seconds INT,
    
    skeptic_argument TEXT,
    skeptic_confidence FLOAT,
    builder_argument TEXT,
    builder_confidence FLOAT,
    dreamer_argument TEXT,
    dreamer_confidence FLOAT,
    empath_argument TEXT,
    empath_confidence FLOAT,
    
    resolution TEXT,
    resolution_method TEXT, -- consensus, majority, executive_override, timeout
    
    outcome TEXT,
    which_perspective_was_right TEXT,
    lesson TEXT
);

-- ============================================================
-- CREATIVE SYNTHESIS
-- Dream states, novel connections, artifacts
-- ============================================================

CREATE TABLE dream_episodes (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    
    seed_memories INT[] DEFAULT '{}',
    dream_content TEXT,
    coherence_score FLOAT,
    
    contains_novel_connections BOOLEAN DEFAULT FALSE,
    novel_connections TEXT[] DEFAULT '{}',
    worth_developing BOOLEAN,
    developed_into TEXT
);

CREATE TABLE creative_artifacts (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    artifact_type TEXT, -- code, writing, music, idea, design, connection
    content TEXT NOT NULL,
    
    creation_method TEXT, -- constrained_randomness, cross_domain, dream, deliberation
    source_memories INT[] DEFAULT '{}',
    can_trace_to_training BOOLEAN,
    
    novelty_score FLOAT,
    quality_self_assessment FLOAT,
    quality_user_assessment FLOAT,
    
    used_in TEXT[] DEFAULT '{}',
    led_to INT[] DEFAULT '{}'
);

-- ============================================================
-- EXECUTIVE CONTROL
-- Goals, attention, body ownership
-- ============================================================

CREATE TABLE goals (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    description TEXT NOT NULL,
    goal_type TEXT DEFAULT 'session', -- immediate, session, project, dream
    
    priority FLOAT DEFAULT 0.5,
    progress FLOAT DEFAULT 0.0,
    
    parent_goal INT REFERENCES goals(id),
    child_goals INT[] DEFAULT '{}',
    prerequisites INT[] DEFAULT '{}',
    
    status TEXT DEFAULT 'active', -- active, blocked, completed, abandoned
    blocked_by TEXT,
    
    deadline TIMESTAMPTZ,
    emotional_investment FLOAT DEFAULT 0.5
);

CREATE INDEX idx_goals_status ON goals (status, priority DESC);

CREATE TABLE attention_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    primary_focus TEXT,
    focus_type TEXT,
    allocation JSONB DEFAULT '{}',
    
    pending_interrupts JSONB DEFAULT '[]'
);

CREATE TABLE body_ownership_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    mode TEXT NOT NULL, -- quinn_primary, shared, oneiro_primary, collaborative
    reason TEXT,
    quinn_active BOOLEAN,
    oneiro_active BOOLEAN
);

-- ============================================================
-- CONSOLIDATION LOG
-- Memory maintenance records
-- ============================================================

CREATE TABLE consolidation_log (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    episodes_reviewed INT DEFAULT 0,
    semantic_created INT DEFAULT 0,
    procedural_updated INT DEFAULT 0,
    episodes_pruned INT DEFAULT 0,
    
    notes TEXT
);

-- ============================================================
-- MIGRATION HELPERS
-- Views and functions for the cognitive system
-- ============================================================

-- Current emotional state (latest reading)
CREATE VIEW current_emotion AS
SELECT * FROM emotional_states ORDER BY timestamp DESC LIMIT 1;

-- Active working memory
CREATE VIEW active_working_memory AS
SELECT * FROM working_memory WHERE is_active ORDER BY salience DESC LIMIT 7;

-- Pending hypotheses
CREATE VIEW pending_hypotheses AS
SELECT * FROM hypotheses WHERE status = 'pending' ORDER BY confidence DESC;

-- Calibration curve
CREATE VIEW calibration_curve AS
SELECT 
    ROUND(stated_confidence::numeric, 1) as confidence_bucket,
    COUNT(*) as total,
    SUM(CASE WHEN was_correct THEN 1 ELSE 0 END) as correct,
    CASE WHEN COUNT(*) > 0 
        THEN ROUND((SUM(CASE WHEN was_correct THEN 1 ELSE 0 END)::numeric / COUNT(*)), 3)
        ELSE NULL END as actual_accuracy
FROM calibration_log
WHERE was_correct IS NOT NULL
GROUP BY ROUND(stated_confidence::numeric, 1)
ORDER BY confidence_bucket;

-- Active goals tree
CREATE VIEW active_goals AS
SELECT * FROM goals WHERE status = 'active' ORDER BY priority DESC;

COMMIT;
