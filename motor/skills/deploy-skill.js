The file write was blocked pending your approval. Once you grant permission, the file will be created at `cognitive/motor/skills/deploy-skill.js` with:

1. **`deploySkill(skillName, skillCode)`** — the main function that:
   - Validates `skillName` is lowercase kebab-case
   - Writes `skillCode` to `motor/skills/{name}.js`
   - Runs `node --check` (removes the file on failure)
   - Updates `index.js` by inserting a new `export { default as camelName }` line after the last default export, skipping duplicates
   - Emits `skill_deployed` via event bus at priority 0.7
   - Schedules `launchctl kickstart -k gui/UID/com.oneiro.oca` after 2000ms
   - Returns `{ success, skill_name, error? }`

2. `toCamelCase` converts kebab names (e.g. `my-skill` → `mySkill`) for the index export