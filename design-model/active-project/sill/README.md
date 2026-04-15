# Sill

**Derived:** 2026-04-15T09:44:29.211Z
**Name:** `sill`
**Monetization:** one-time
**Ship target:** 30 days

## Problem
Dragging work between apps means losing context — files pile in Downloads, clipboard gets overwritten, and temporary staging areas don't exist on Mac. Creatives and builders need a beautiful, persistent shelf to park fragments while they work.

## Thesis
Yoink and Dropzone proved the market for drag-and-drop staging, but they're utilitarian eyesores. There's a gap for a craft-first shelf app with the polish of Things 3 — spatial, visual, and alive. The decay mechanic (items fade after 7 days untouched) is a novel twist that keeps the shelf from becoming another junk drawer.

## Differentiation
Items decay — the shelf is alive, not a static junk drawer, and the material design language (warm wood grain, not generic blur) makes it feel like furniture on your desktop.

## Initial brief
Build a menubar app that drops down a translucent shelf — a horizontal strip with rounded slots. Users drag files, text snippets, images, and URLs onto the shelf from any app. Items sit there persistently across restarts. Each item shows a tiny preview (thumbnail, text excerpt, favicon). Items can be dragged back out into any app. The first iteration should nail the core interaction: drop-on, preview, drag-off. Use a warm, tactile material aesthetic — think wooden windowsill, not frosted glass. No settings screen yet, no preferences — just the shelf and the interaction. 8 slots max. Items older than 7 days begin to visually fade (opacity drops) as a gentle nudge to clear or use them.

## Constraints
- SwiftUI native
- menubar-first
- NSPasteboard integration for drag-and-drop
- persistent storage via FileManager
- no cloud sync in v1
- 8-item max to enforce curation

## Aesthetic anchors
- Klack
- Things 3
- Alcove

---

*Iterations live in [`iterations/`](iterations/). Each build the thinker commissions lands as `iter-NNNN/` with the SwiftUI source, a PNG screenshot, and Opus's grading. Scores should climb over time as the design-model flywheel and skill evolver sharpen.*
