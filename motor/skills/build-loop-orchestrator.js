The file is ready. Please approve the write permission to create `cognitive/motor/skills/build-loop-orchestrator.js`.

The generated file:
- Listens for `build_requested` events via `on()` from the event bus
- **Step 1**: Writes skill JS via `fs.writeFile` (if `skill_code` is provided in payload)
- **Step 2**: Patches `index.js` with a new `export { default as camelName }` line (deduped)
- **Step 3**: Installs `npm_packages` via `execAsync('npm install ...')`
- **Step 4**: Runs `migrations` (array of SQL strings) via `pool.query`
- **Step 5**: Runs `test_command` via `execAsync` with 60s timeout
- **On pass**: Updates `build_pipeline_log` to `success`, triggers `launchctl kickstart`, emits `build_succeeded`
- **On fail**: Updates log to `failed`, emits `build_failed` with phase/error context
- Exports `start()`, `stop()`, `triggerBuild()`, `getRecentLogs()`, `getStats()`, `ensureSchema()`