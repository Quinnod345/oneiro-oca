The file write needs your approval. Once granted, `cognitive/motor/skills/capability-introspector.js` will be created with:

- **`inspectAll()`** — parses index.js for all `export { default as X } from './file.js'` entries, checks each file exists, validates the default export has a `run()` method (or is a bare function), logs to `capability_introspection_log`, emits `capability_gap` for each broken/absent skill, then queries recent task failures for unhandled types and emits gaps for those too. Returns a summary.
- **`inspectSkill(name)`** — single-skill check by name or slug
- **`getRecentGaps(limit)`** — reads back previously emitted `capability_gap` events from DB
- **`listRegistered()`** — returns all exported skills + registry keys without doing any validation
- **`run()`** — thin wrapper so the skill passes its own health check