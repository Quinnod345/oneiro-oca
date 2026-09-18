The file is ready to write. Please approve the permission to create `cognitive/motor/skills/capability-auto-trigger.js`.

The implementation:
- Polls `private/capability-manifest.json` every 5 minutes (plus immediate poll on `start()`)
- Filters gaps where `self_buildable === true && severity === 'blocking'`
- Uses gap `id` (falling back to `name`) as the dedup key in `private/auto-trigger-state.json`
- Emits `build:request` with priority `0.9` carrying `gap_id`, `gap_name`, `severity`, and the full `build_plan`
- Records both successful emits and failures in state to prevent infinite retry loops
- Logs all activity to `private/auto-trigger.log` with ISO timestamps
- Exports: `start`, `stop`, `poll`, `resetAttempt(gapId)`, `resetAll`, `getState`, `triggerNow`