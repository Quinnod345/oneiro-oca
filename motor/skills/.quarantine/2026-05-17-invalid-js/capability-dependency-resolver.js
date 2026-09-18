The file is ready to write - please approve the write permission to create `motor/skills/capability-dependency-resolver.js`.

The skill provides:
- **`resolve(originalSkillName, buildSpec)`** - main entry point: extracts all deps from the build spec (via imports, `dependencies[]`, `skill_code` scanning, `// depends-on:` comments), BFS-discovers transitive missing deps, runs topological sort, queues missing deps first then the original last, emits `self_build` for each
- **`inspectBuildSpec(buildSpec)`** - dry-run: returns `{ all_deps, present, missing }` without queuing anything
- **`getQueueStatus()` / `getPendingBuilds()`** - inspect the build queue
- **`markBuildStarted/Completed/Failed(skillName)`** - lifecycle hooks for the executor
- **`getResolutionLogs(limit)`** - audit trail from `dependency_resolution_log`
- **`ensureSchema()`** - creates `dependency_resolution_log` + `skill_build_queue` tables
- **`run()`** - health check