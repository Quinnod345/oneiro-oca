-- The accounts Oneiro may use, one row per signed-in account. Sign-ins live in Aside (its own password manager and
-- cookies); this table only records which account exists, whether it is signed in right now, and whether Quinn lets
-- Oneiro use it. No password, token, cookie or verification code is ever stored here.
CREATE TABLE IF NOT EXISTS integrations (
  id           SERIAL PRIMARY KEY,
  provider     TEXT NOT NULL,                      -- google | slack | notion | github | linkedin | other
  account      TEXT NOT NULL,                      -- email, handle, workspace slug, or a site's host
  label        TEXT,                               -- personal, upaway, a workspace's name
  uid          INT,                                -- Google's /u/ index when last seen (it can shift)
  capabilities TEXT[] NOT NULL DEFAULT '{}',       -- mail, calendar, docs, chat, notes, code…
  enabled      BOOLEAN NOT NULL DEFAULT true,      -- Oneiro may use it
  status       TEXT NOT NULL DEFAULT 'checking',   -- connected | needs_sign_in | checking | error | disconnected
  detail       TEXT,                               -- a plain sentence about the last check
  avatar_url   TEXT,
  site         TEXT,                               -- the sign-in URL for an "other site" row
  checked_at   TIMESTAMPTZ,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, account)
);

-- A check that can't run says nothing about the account, so it no longer stands next to the word "connected". check_failed
-- marks that the last check couldn't run; last_connected_at is when the account was last actually seen signed in.
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS check_failed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ;
UPDATE integrations SET check_failed = true WHERE last_connected_at IS NULL AND NOT check_failed AND detail LIKE 'Couldn''t check %';
UPDATE integrations SET last_connected_at = checked_at WHERE last_connected_at IS NULL AND status = 'connected' AND NOT check_failed;
