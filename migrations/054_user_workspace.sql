-- User workspace controls and explicit operation receipts. Never reward UI activity.
CREATE TABLE IF NOT EXISTS oca_user_controls (
 id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
 settings JSONB NOT NULL DEFAULT '{"queuePaused":false,"interestDiscovery":true}',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO oca_user_controls (id) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS oca_user_jobs (
 id UUID PRIMARY KEY,
 kind TEXT NOT NULL,
 title TEXT NOT NULL,
 input JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',
 result JSONB,
 error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
