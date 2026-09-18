The file write needs your approval. Once you grant it, the code will be written to `cognitive/motor/skills/build-historian.js`.

The implementation:
- **`run(days=30)`** — main entry: fetches events, groups by skill, computes stats, writes to scratchpad, emits `build_insight`
- **`fetchBuildEvents(days)`** — queries `cognitive_events` for `build_attempt/success/failure` in the window
- **`groupBySkill(events)`** — aggregates attempts/successes/failures/errors keyed on `payload.skill_name`
- **`computeSuccessRates(skills)`** — derives `success_rate_pct`, sorts worst-first
- **`buildSummary(...)`** — global rollup + top-5 error frequency analysis
- **`appendToScratchpad(summary)`** — writes under `## Build History Report — YYYY-MM-DD`, replaces if already exists for today
- **`getSkillHistory(skillName, days)`** — raw event history for a single skill
- **`getRecentInsights(limit)`** — reads back previously emitted `build_insight` events from DB