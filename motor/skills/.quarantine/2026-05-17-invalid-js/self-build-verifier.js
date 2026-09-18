The file is ready to write at `cognitive/motor/skills/self-build-verifier.js`. Please approve the write permission to create it.

Here's what the file does:

- **`verify(buildSpec, { dreamId })`** — main entry point:
  1. Runs `build_spec.test_command` via `execSync` (cwd = OCA_ROOT)
  2. Dynamic-imports the new skill file (with cache-bust `?t=` param)
  3. Checks that `toCamelCase(skill_name)` appears in `index.js`
  4. Finds or creates the `capability_gaps` row for this skill/dream
  5. Updates row to `status=verified` or `status=failed` with `error_message`
  6. Emits `build:verified` or `build:failed` via event bus

- Handles the case where `capability_gaps` table doesn't exist yet (CREATE TABLE IF NOT EXISTS)
- Infers skill file path from `files_to_create[0]` or falls back to `motor/skills/{skill_name}.js`
- Also exports `checkIndexExport`, `runTestCommand`, `tryImportSkill` for unit testing