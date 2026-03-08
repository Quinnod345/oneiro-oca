The file content is ready — waiting for your permission to write it to `cognitive/motor/skills/self-build-scheduler.js`.

The scheduler:
- Polls `capability_gaps` every 60s (immediate first run)
- Selects the highest-severity `self_buildable=TRUE` gap with status `pending` or `open` (blocking→high→medium→low, then oldest first)
- Emits `self_build` event targeting `motor.autonomous-builder` with `gap_id`, `skill_name`, `severity`, `build_plan`, and the full gap row
- Priority maps severity to 0.25–1.0 for the event bus
- Logs to `private/self-build-scheduler.log`
- Exports: `start`, `stop`, `poll`, `triggerNow`, `listOpen`, `getStats`