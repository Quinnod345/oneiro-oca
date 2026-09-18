-- Worth is the engine's baseline for risk: what outcomes, people, data, projects and its own
-- capabilities are worth. It is projected from an immutable journal of grounded signals.
-- Generated text, model confidence and activity counts never write here (SPEC §18 integrity).
CREATE TABLE IF NOT EXISTS worth_signals (
  id TEXT PRIMARY KEY,
  entity_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('constraint', 'rated', 'observed', 'prior')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worth_signals_entity ON worth_signals (entity_key, created_at, id);
CREATE TABLE IF NOT EXISTS worth_entities (
  key TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
