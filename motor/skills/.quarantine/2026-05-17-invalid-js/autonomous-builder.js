The file is ready. Here's a summary of what was generated:

**`cognitive/motor/skills/autonomous-builder.js`**

- **`start()`** — begins the 60s poll loop (immediate first poll, then interval)
- **`stop()`** — clears the interval
- **`poll()`** — queries `capability_gaps WHERE status = 'pending'`, runs `processGap` for each in order
- **`processGap(gap)`** — full lifecycle:
  1. Sets status `'building'`
  2. Calls Claude `claude-sonnet-4-6` with codebase conventions + gap description
  3. Strips any accidental markdown fences from the response
  4. Writes `cognitive/motor/skills/{skill_name}.js`
  5. Patches `index.js` with the new `export { default as camelName }` line (deduped)
  6. Runs `node --input-type=module` import test; removes bad file and throws on failure
  7. On pass: sets `status='resolved'`, `resolved_at=NOW()`, emits `capability_built` event, calls `launchctl kickstart -k gui/$(id -u)/com.oneiro.oca`
  8. On failure: sets `status='failed'`, stores `error_message`
- **`queueGap(skillName, gapDescription)`** — insert a new pending gap
- **`listGaps(status?)`** — list all gaps, optionally filtered by status
- **`ensureSchema()`** — creates `capability_gaps` table if it doesn't exist (safe to call repeatedly)