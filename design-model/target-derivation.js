// Stub for the design-model target-derivation API. The original file was
// never checked in; Oneiro stubs it so the dream-executor can start.
// `loadTargetProject` returns null so callers treat it as "no current
// design target" and skip the corresponding branch.

export function loadTargetProject() {
  return null;
}

export default { loadTargetProject };
