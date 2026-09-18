The file is ready. Approve the write permission and it will be created at `cognitive/motor/skills/gap-auto-resolver.js`.

Here's what it does:

- **`ensureSchema()`** — creates `capability_gaps` table if not exists (id, skill_name, severity, self_buildable, status, build_plan, etc.)
- **`resolveNextGap()`** — queries `pending` + `self_buildable=TRUE` gaps, picks highest severity via `SEVERITY_RANK` (blocking>high>medium>low), atomically marks it `in_progress` (race-safe), emits `build_skill` event with the `build_plan`, appends a timestamped entry to `execution-log.md`, rolls back status if emit fails
- **`start()`** — polls every 30s with immediate first run
- **`stop()`** — clears interval
- **`queueGap(name, description, { severity, selfBuildable, buildPlan })`** — insert a new gap
- **`markResolved(id)` / `markFailed(id, msg)`** — lifecycle transitions for build outcomes
- **`listGaps(status?)` / `getStats()`** — inspection helpers