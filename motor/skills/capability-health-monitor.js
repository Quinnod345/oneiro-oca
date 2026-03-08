The file content is ready. Please approve the write permission and I'll create the file at `cognitive/motor/skills/capability-health-monitor.js`.

The implementation:
- **`checkAll()`** — iterates all named exports from `index.js` (skipping registry helpers), calls `inspectSkill()` on each, writes a row to `capability_health_log`, and emits `skill:health_check` per skill
- **`inspectSkill()`** — checks for a `run` function on the export; accepts a bare function as pass; flags objects without `run` as fail with the methods they do have listed
- **`run()`** — thin wrapper so the skill itself passes its own health check
- **`getLatestSummary()`** — queries the most recent check batch from DB
- Emits `skill:health_summary` aggregate event after all checks complete