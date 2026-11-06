// Words a person reads get shortened at a sentence or a word, never inside one. A bare slice is what put
// "pick another accou" in a night's report.

/** At most `max` characters. Ends on a finished sentence when one keeps at least half, otherwise on a whole word and "…". Pure. */
export function clip(value, max = 300) {
  const s = String(value ?? '');
  if (s.length <= max) return s;
  if (max < 2) return s.slice(0, Math.max(0, max));
  const room = s.slice(0, max - 1);
  const sentence = [...room.matchAll(/[.!?](?=\s)/g)].at(-1);
  if (sentence && sentence.index + 1 >= max * 0.5) return room.slice(0, sentence.index + 1);
  const space = room.lastIndexOf(' ');
  // One unbroken token (a path or a hash) has no word to stop at.
  const kept = space >= max * 0.5 ? room.slice(0, space) : room;
  return `${kept.replace(/[\s,;:—–-]+$/, '')}…`;
}

/** Collapses white space, then clips. Every report and notice line goes through this or `clip`. Pure. */
export const clipText = (value, max = 300) => clip(String(value ?? '').replace(/\s+/g, ' ').trim(), max);
