-- OCA Migration 015: Thinker IPC event types
-- Allows the generative thinker to publish thoughts and proactive notices
-- through cognitive_events without being rejected by the enum.

BEGIN;

ALTER TYPE cognitive_event_type ADD VALUE IF NOT EXISTS 'thinker.thought';
ALTER TYPE cognitive_event_type ADD VALUE IF NOT EXISTS 'thinker.proactive_intent';

COMMIT;
