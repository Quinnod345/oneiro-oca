The file write needs your approval. Once granted, `cognitive/motor/skills/capability-snapshot.js` will be created with:

- **`generate(opts?)`** — builds a full snapshot (motor skills, CLI tools, DB tables, APIs), writes `private/capability-manifest-YYYY-MM-DD.json` + updates `private/capability-manifest.json` latest pointer. Skips if today's file already exists unless `{ force: true }`.
- **`diff(prevDate?)`** — diffs today's snapshot against a previous date (or auto-finds most recent prior manifest). Returns added/removed/changed per category + emits `capability_snapshot_diff`.
- **`listSnapshots()`** — lists all historical manifests in private/ sorted newest-first.
- **`load(date?)`** — reads and returns a specific snapshot by date string.
- **`run()`** — thin wrapper (calls `generate`) so the skill passes health checks.

CLI tools checked: node, npm, psql, pg_dump, git, ffmpeg, lame, python3, peekaboo, cliclick, brightness, osascript, open, pbcopy, pbpaste, launchctl, security. APIs inferred from `private/credentials.md` + env vars. Emits `capability_snapshot_generated` on each write.