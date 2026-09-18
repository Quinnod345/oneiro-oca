The file content is ready. Once you grant write permission, it will be created at `cognitive/motor/hot-loader.js`.

**What it does:**
- `init()` — loads all existing `.js` files in `cognitive/motor/skills/` (except `index.js`), then starts `fs.watch` for new additions
- Watch debounces 150ms, only fires on `rename` events (file creation), checks readability before importing, skips already-registered skills
- Dynamic import via `pathToFileURL` for correct ESM resolution
- Emits `skill_loaded` to the event bus with skill name, file path, and exported keys
- Registry exposed via `getSkill(name)`, `listSkills()`, `getRegistry()`
- Call `await hotLoader.init()` once from motor engine startup