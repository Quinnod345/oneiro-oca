The file is ready to write at `cognitive/motor/skills/build-outcome-verifier.js`. Please approve the write permission.

Here's what it implements:

- **`start()`** — creates schema, subscribes to `build_deployed` events
- **`stop()`** — unsubscribes cleanly
- **`handleBuildDeployed(event)`** — full verification lifecycle:
  1. Upserts a `capability_builds` row at status `verifying`
  2. Runs `test_command` via `execSync` (60s timeout, cwd = OCA_ROOT)
  3. Checks `toCamelCase(skill_name)` appears in `index.js`
  4. On all-pass: marks `verified`, emits `build_verified`
  5. On any failure: marks `failed` (increments `retry_count`), emits `retry_gap` with full error details and original payload
- **`verifyNow(skillName, testCommand?)`** — trigger verification manually without waiting for an event
- **`getRecentBuilds(limit)`**, **`getStats()`**, **`getSkillStatus(skillName)`** — query helpers
- **`ensureSchema()`** — creates `capability_builds` table with indexes if not present