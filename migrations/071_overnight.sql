-- The night: what Oneiro may read overnight, what each run did, the notes waiting to be written, and the morning's
-- cards. Item contents are not stored here: a judged item leaves only a hash and its verdict, and a private item
-- leaves nothing else, so the table can't say what it was. Only an item kept by the on-device judge has words here.
CREATE TABLE IF NOT EXISTS night_settings (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mail       BOOLEAN NOT NULL DEFAULT false,   -- nothing is read until the person turns it on
  calendar   BOOLEAN NOT NULL DEFAULT false,
  files      BOOLEAN NOT NULL DEFAULT false,
  folders    TEXT[] NOT NULL DEFAULT '{}',     -- absolute paths the person chose
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO night_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS night_runs (
  id           SERIAL PRIMARY KEY,
  trigger      TEXT NOT NULL,                  -- scheduled | wake | manual
  status       TEXT NOT NULL DEFAULT 'running', -- running | finished | failed | skipped
  stage        TEXT NOT NULL DEFAULT 'starting',
  progress     TEXT,                           -- a plain line on what it is doing now
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  report       JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS night_runs_started ON night_runs (started_at DESC);
-- One run at a time, even across a restart.
CREATE UNIQUE INDEX IF NOT EXISTS night_runs_one_running ON night_runs ((1)) WHERE status = 'running';

-- Every item judged, by hash. A failed judgement counts attempts and is retried; three strikes and it is given up on.
CREATE TABLE IF NOT EXISTS night_seen (
  key_hash TEXT PRIMARY KEY,
  source   TEXT NOT NULL,
  verdict  TEXT NOT NULL,                      -- kept | private | off_topic | failed | gave_up
  attempts INT NOT NULL DEFAULT 1,
  seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What the on-device judge kept: its short summary, waiting to be written into the knowledge base.
CREATE TABLE IF NOT EXISTS night_notes (
  id           SERIAL PRIMARY KEY,
  run_id       INT REFERENCES night_runs(id) ON DELETE SET NULL,
  source       TEXT NOT NULL,                  -- mail | calendar | files
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL,
  location     TEXT,
  item_date    TIMESTAMPTZ,
  needs_reply  BOOLEAN NOT NULL DEFAULT false,
  ref          JSONB NOT NULL DEFAULT '{}',    -- mail: account, threadId, from, subject
  state        TEXT NOT NULL DEFAULT 'queued', -- queued | written
  attempts     INT NOT NULL DEFAULT 0,
  written_path TEXT,
  written_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS night_notes_queued ON night_notes (state, created_at DESC);

CREATE TABLE IF NOT EXISTS night_cards (
  id            SERIAL PRIMARY KEY,
  run_id        INT REFERENCES night_runs(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('mail_draft', 'calendar_block', 'brief')),
  dedupe_key    TEXT NOT NULL,                 -- the same thing is never proposed twice, even after a skip
  title         TEXT NOT NULL,
  why           TEXT NOT NULL DEFAULT '',
  evidence      TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',      -- what approve acts on; the person's edits land here
  payload       JSONB NOT NULL DEFAULT '{}',   -- mail: account, threadId, to, subject. block: account, start, end
  status        TEXT NOT NULL DEFAULT 'ready', -- ready | approving | approved | skipped | expired | dropped
  status_detail TEXT,
  edited        BOOLEAN NOT NULL DEFAULT false,
  checked_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key)
);
CREATE INDEX IF NOT EXISTS night_cards_status ON night_cards (status, expires_at);
