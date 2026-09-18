// Quiet cognition is telemetry, not new evidence. No recurrent self-input as progress.
export function isSubstantiveThought(text) {
  return typeof text === 'string' && !!text.trim()
    && !/\b(?:previous thought|last thought|continues? to resonate|still feels? relevant|I (?:am|was) (?:thinking|pondering) about)\b/i.test(text)
    && !/^(?:—\s*\(silent|\[no |Proposed |Dream noted:|Appended to |Private writing:|Share with Quinn:|Diagnose:|Cognitive upgrade:|Build:|Escalate:|Web search:|Shell:|Self-edit:|Feeling:)/i.test(text.trim());
}
export class ThoughtCadence {
  constructor({ baseMs = 60000, maxMs = 600000, clock = Date.now } = {}) {
    this.baseMs = baseMs; this.maxMs = maxMs; this.clock = clock;
    this.key = null; this.quietRuns = 0; this.nextAt = 0;
  }
  due(key) {
    if (key !== this.key) { this.key = key; this.quietRuns = 0; this.nextAt = 0; }
    return this.clock() >= this.nextAt;
  }
  record(substantive) {
    this.quietRuns = substantive ? 0 : Math.min(5, this.quietRuns + 1);
    this.nextAt = this.clock() + Math.min(this.maxMs, this.baseMs * 2 ** this.quietRuns);
  }
  snapshot() { return { quietRuns: this.quietRuns, nextAt: this.nextAt }; }
}
