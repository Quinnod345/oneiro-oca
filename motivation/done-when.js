// What "done" looks like, checked for shape. A want's criterion is observable when it names a witness —
// something a person, a message log, a test suite, a repository, a file, a sensor or a calendar would show —
// and, when it counts or measures, says how much. An intent ("feel better", "figure out", "try to") with no
// witness is a wish, not a criterion; the engine would never know it was met. Pure: no model, no database.
export const WITNESS_KINDS = ['person', 'message', 'test', 'repo', 'file', 'sensor', 'calendar', 'other'];
export const CHECKS = ['binary', 'count', 'threshold'];

// Verbs of intent that describe a state of mind, not a state of the world.
const VAGUE = /\b(feel(s|ing)?|understand(ing)?|be (better|happier|healthier|calmer|smarter)|get (better|good) at|figure (it )?out|get a sense|try(ing)? to|know more|learn more|improve|explore|think(ing)? about|be more|less stressed|more productive)\b/i;
// Nouns and verbs that point at something checkable when they appear in a bare statement.
const WITNESSY = /\b(message[sd]?|text(s|ed)?|call(s|ed)?|email(s|ed)?|test(s)?( pass| green| run)?|build(s)? (green|pass|succeed)|merged|commit(s|ted)?|pull request|PR\b|file (exists|saved|written)|saved to|logged|calendar|scheduled|meeting|invoice|paid|shipped|deployed|published|deleted|count|times|consecutive|per (day|week|month)|every (day|week|month)|at least|no more than|before \d|by (mon|tue|wed|thu|fri|sat|sun|\d)|\d+ ?(%|percent|minutes|hours|days|weeks|wpm|seconds|runs|days in a row))\b/i;

const text = v => String(v ?? '').replace(/\s+/g, ' ').trim();

// A structured criterion, as the drafting model produces it.
export function doneWhenShape({ statement, witness, check = 'binary', target = null, deadlineDays = null } = {}) {
  const problems = [];
  const s = text(statement);
  if (!s) problems.push('The criterion is empty.');
  if (s.length > 400) problems.push('The criterion is longer than 400 characters.');
  const kind = witness?.kind, detail = text(witness?.detail);
  if (!WITNESS_KINDS.includes(kind)) problems.push(`The witness must be one of ${WITNESS_KINDS.join(', ')}.`);
  if (!detail) problems.push('The witness needs a detail: what exactly would show it.');
  if (!CHECKS.includes(check)) problems.push(`The check must be one of ${CHECKS.join(', ')}.`);
  if ((check === 'count' || check === 'threshold') && !(Number.isFinite(target) && target > 0)) problems.push(`A ${check} needs a positive target.`);
  if (deadlineDays !== null && deadlineDays !== undefined && !(Number.isInteger(deadlineDays) && deadlineDays > 0 && deadlineDays <= 365)) problems.push('A deadline is a whole number of days, at most 365.');
  if (VAGUE.test(s) && !detail) problems.push('It describes a state of mind, not a state of the world. Say what a person would see, count, or hold when it is done.');
  return { observable: problems.length === 0, why: problems[0] || 'It names a witness a person could check.', problems };
}

// The statement a structured criterion reads as, when the model gave the parts but not the sentence.
export function composeDoneWhen({ statement, witness, check = 'binary', target = null, deadlineDays = null } = {}) {
  const s = text(statement);
  if (s) return s;
  const who = text(witness?.detail) || 'a person';
  const when = Number.isInteger(deadlineDays) && deadlineDays > 0 ? ` within ${deadlineDays} day${deadlineDays === 1 ? '' : 's'}` : '';
  if (check === 'count') return `${who} shows at least ${target} of them${when}.`;
  if (check === 'threshold') return `${who} shows a value at or past ${target}${when}.`;
  return `${who} shows it is done${when}.`;
}

// A bare sentence a person typed, judged without structure: the same rule, applied to the words that are there.
export function looksObservable(statement) {
  const s = text(statement);
  if (!s) return { observable: false, why: 'Say what you would see when it is done.' };
  if (s.length < 12) return { observable: false, why: 'Too short to check. Say what you would see, count, or hold.' };
  if (VAGUE.test(s) && !WITNESSY.test(s)) return { observable: false, why: 'Looks vague. Only what you observe moves a want — name what you would see, count, or hold.' };
  if (WITNESSY.test(s) || /\b(is|are|has|have|shows?|exists?|runs?|passes|returns|appears)\b/i.test(s)) return { observable: true, why: 'Looks observable: it names something a person could check.' };
  return { observable: false, why: 'Hard to check. Say what you would see, count, or hold when it is done.' };
}
