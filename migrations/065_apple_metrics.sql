-- Apple's numbers in one place: App Store sales and subscriptions, Apple Ads reports, and the App Store's server
-- notifications. One row per source, day and subject; a re-pulled day replaces what it said before.
CREATE TABLE IF NOT EXISTS apple_metrics (
  source TEXT NOT NULL,
  day DATE NOT NULL,
  key TEXT NOT NULL,
  dims JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, day, key)
);
CREATE INDEX IF NOT EXISTS apple_metrics_source_day ON apple_metrics (source, day);

-- When each source last pulled, and why it didn't when it couldn't: a source that isn't set up has no rows and a reason.
CREATE TABLE IF NOT EXISTS apple_pulls (
  source TEXT PRIMARY KEY,
  last_ok_at TIMESTAMPTZ,
  rows INT NOT NULL DEFAULT 0,
  last_error TEXT,
  last_error_at TIMESTAMPTZ
);
