The file write needs your approval. Once granted, the implementation will be created with:

- **`recordInvocation(skillName, success)`** — upserts into `capability_invocation_stats`, incrementing invocations + successes/failures
- **`getUnhealthySkills()`** — returns skills where `failure_rate > 0.2` and `invocations > 5`, ordered by failure rate
- **`checkAll()`** — inspects all registered skills, writes to `capability_health_log`, emits `skill:health_check` per skill + `skill:health_summary` aggregate
- **`inspectSkill(export)`** — checks for a `run()` function; bare functions pass; objects without `run` fail with detail
- **`startWeeklyCheck()`** / **`runWeeklyCheck()`** — weekly `setInterval` that calls `getUnhealthySkills()` and emits `skill:rebuild:requested` for each
- **`getLatestSummary()`** — reads most recent batch from DB
- **`run()`** — thin wrapper (calls `checkAll`) so the skill passes its own health check