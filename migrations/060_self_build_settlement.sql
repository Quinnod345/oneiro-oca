-- 060: the self-build journal learns what became of a published branch. A merge is observed from the
-- remote main ('merged'); after the quiet period the defect either stayed away ('settled') or came back
-- ('recurred'). Idempotent: the check is dropped and recreated with the wider set.
ALTER TABLE self_build_events DROP CONSTRAINT IF EXISTS self_build_events_kind_check;
ALTER TABLE self_build_events ADD CONSTRAINT self_build_events_kind_check
  CHECK (kind IN ('enter', 'exit', 'want', 'build', 'refused', 'deploy', 'rollback', 'merged', 'recurred', 'settled'));
