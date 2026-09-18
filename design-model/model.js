// Stub for the design-model loadModel API. The original file was never
// checked in; the 21-day-running OCA daemon held the imports in memory
// from an earlier filesystem state. Fresh ESM imports fail without this.
//
// The real design-model server lives at /tmp/design-model-v2.sock and is
// driven via design-model/client.js — `loadModel` here is just the
// in-process metadata that OCA's `index.js` exposes under `design.model`.
// Returns `null` so any caller that gates on truthiness skips cleanly.

export function loadModel() {
  return null;
}

export default { loadModel };
