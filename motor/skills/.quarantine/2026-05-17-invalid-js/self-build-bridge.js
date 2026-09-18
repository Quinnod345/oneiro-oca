The file is ready. Here's what it does:

- **Subscribes** to `capability_gap` events via `on()` from the event bus
- **Filters** to only `self_buildable=true` + severity in `{blocking, degraded}`
- **Immediately calls** `autonomousBuilder.queueGap(skillName, description)` on match
- **Logs every trigger** to `self_build_bridge_log` table (gap event id, skill name, severity, full payload, build status)
- **Emits** `self_build:triggered` so other layers can observe the handoff
- Exports: `start`, `stop`, `isActive`, `getTriggerCount`, `getRecentLogs`, `getStats`, `ensureSchema`

Pattern follows `runtime-gap-responder.js` exactly — same schema setup, same log update lifecycle, same `on()`/unsub pattern for clean `stop()`.