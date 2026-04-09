-- Run against the Oneiro DB (same DATABASE_URL as OCA) to retire stale dreams
-- tied to Logic Pro / “listen to Quinn’s music” loops from older runs.
-- Safe to run multiple times (only updates unresolved rows matching patterns).

UPDATE dreams
SET resolved = true,
    resolved_at = COALESCE(resolved_at, NOW()),
    lifecycle_state = COALESCE(lifecycle_state, 'retired')
WHERE resolved = false
  AND (
    content ILIKE '%logic pro%'
    OR content ILIKE '%logicpro%'
    OR (content ILIKE '%quin%music%' AND content ILIKE '%listen%')
    OR content ILIKE '%crying in the cold%'
  );

-- Optional: review count
-- SELECT id, LEFT(content, 120) FROM dreams WHERE resolved = true AND content ILIKE '%logic%' ORDER BY id DESC LIMIT 20;
