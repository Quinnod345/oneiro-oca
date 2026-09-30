// One idea of "the same thing" for the whole engine: asks, Judge items, thinker notes, agent tasks and self-wants.
// Quinn, 2026-09-30: "There shouldn't be any agents doing duplicate work or thinking duplicate things."
//
// It compares the words that carry meaning. Want numbers, filler, and the "distinct from #37" clauses the engine
// used to write to slip a near-copy past a check all fall away first; plural and tense endings are folded.
const STOP = new Set(`about above after again against also among another because been before being below between both
could does doing done down during each either else even every from further have having here into itself just
make made many might more most much must near need needs never only other ought over same should since some
such than that their them then there these they this those though through under until upon very want wants
what when where whether which while will with within without would your yours oneiro engine pursuit want's
please thing things something anything distinct separate different new newer another quinn quinn's`.split(/\s+/));

const stem = w => w.replace(/(ings|ing|ies|ied|ed|es|s)$/, m => (m === 'ies' || m === 'ied' ? 'y' : '')).replace(/(.)\1$/, '$1');

export function words(textLike) {
  const s = String(textLike ?? '').toLowerCase()
    .replace(/\b(distinct|separate|different) from[^.;:\n]*/g, ' ')   // "distinct from #37 gateway-run settlement"
    .replace(/#\d+/g, ' ')
    .replace(/[^a-z0-9$]+/g, ' ');
  const out = new Set();
  for (const w of s.split(/\s+/)) if (w.length > 3 && !STOP.has(w)) out.add(stem(w));
  return out;
}

// How much of the shorter one the longer one covers: right for titles, questions and task lines.
export function overlap(a, b) {
  const A = a instanceof Set ? a : words(a), B = b instanceof Set ? b : words(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

// Shared words over all words: right for long bodies, where the shorter-side measure flatters any two texts.
export function jaccard(a, b) {
  const A = a instanceof Set ? a : words(a), B = b instanceof Set ? b : words(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}

export function sameThing(a, b, threshold = 0.6) { return overlap(a, b) >= threshold; }

// Two pieces of writing (a title and a body each) are the same piece: the same title, or largely the same body.
export function sameWriting(x, y, { title = 0.6, body = 0.4 } = {}) {
  if (sameThing(x.title, y.title, title) && words(x.title).size >= 2) return true;
  const bx = String(x.body || '').slice(0, 4000), by = String(y.body || '').slice(0, 4000);
  return bx.length > 200 && by.length > 200 && jaccard(bx, by) >= body;
}

// Where a new item should go instead of standing alone: the open item it repeats (at `threshold`), or, once `max`
// are open, the closest one whatever the score. Null means it's genuinely new and there's room for it.
export function mergeTarget(open, textLike, { describe = x => x, threshold = 0.6, max = Infinity } = {}) {
  const best = open.map(o => ({ o, score: overlap(describe(o), textLike) })).sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  if (best.score >= threshold) return { target: best.o, score: best.score, why: 'same' };
  if (open.length >= max) return { target: best.o, score: best.score, why: 'full' };
  return null;
}
