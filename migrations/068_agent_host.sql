-- Agents run as Codex threads (no OpenClaw gateway). Work agents run on the engine's own `codex app-server`
-- (host 'codex'); the conversation for each pursuit runs as a T3 Code thread on Codex (host 't3'), so Quinn talks to
-- it in T3 Code and every thread also shows in Codex. agent_threads maps the engine's session key to that thread;
-- agent_runs is each turn the engine started (or saw Quinn start), so an outcome survives a restart.
CREATE TABLE IF NOT EXISTS agent_threads (
  session_key  TEXT PRIMARY KEY,
  host         TEXT NOT NULL DEFAULT 'codex',     -- codex | t3
  thread_id    TEXT NOT NULL UNIQUE,
  agent_id     TEXT,
  display_name TEXT,
  cwd          TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id       TEXT PRIMARY KEY,
  host         TEXT NOT NULL DEFAULT 'codex',
  session_key  TEXT NOT NULL,
  thread_id    TEXT NOT NULL,
  turn_id      TEXT,
  status       TEXT NOT NULL DEFAULT 'running',   -- running | ok | error | interrupted | lost | external
  reply        TEXT,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_runs_turn ON agent_runs (turn_id);
CREATE INDEX IF NOT EXISTS agent_runs_session ON agent_runs (session_key, started_at DESC);
