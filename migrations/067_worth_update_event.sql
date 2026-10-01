-- The worth ledger emits a 'worth_update' cognitive event for every worth signal it records
-- (motivation/worth-ledger.js), but the enum never had that value, so each insert failed: about
-- 2,000 Postgres errors by 2026-10-01, and none of those events was ever stored.
ALTER TYPE cognitive_event_type ADD VALUE IF NOT EXISTS 'worth_update';
