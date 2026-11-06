// A short name for an agent, so the app can say what it's doing instead of showing the start of its instructions.
// The same model that writes a pursuit's headline writes the name when the agent is sent; until it has, and whenever it
// can't, the first clause of the task is shortened cleanly. The whole task stays on the row, shown under "Sent to do".
const line = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// The openings the engine puts in front of a task, which say nothing about what the agent is doing.
const OPENERS = [
  /^start with the first step[^:]*:\s*/i,
  /^something is already waiting on [^:]*:\s*/i,
  /^(?:please|now|then|next)[,:]?\s+/i,
  /^(?:in|inside|from) ~?\/\S+,?\s+/i,
  /^through (?:read-only )?aside(?: inspection)?(?: of [^,]+)?,\s*/i,
  /^check existing [^,]+,\s*(?:and\s+)?then\s+/i,
  /^using [^,]+,\s*/i,
];
const TRAILING = /^(?:a|an|the|and|or|but|of|to|for|in|on|at|by|with|from|as|that|this|its|their|into|via|so|then|if|when|while|using|through|is|are|be)$/i;
const NOISE = [
  /\bhttps?:\/\/\S+/gi,                                                        // addresses
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::\d+)?\b/gi,  // run ids
  /\b(?:at |in )?commit [0-9a-f]{7,40}\b/gi,
  /\b(?:fix|feat|chore|branch)\/\S+/gi,                                        // branches
  /\b(?:on|at|to) (?=\s|$)/g,
];
const paths = s => s.replace(/(?:~|\.{0,2})\/[\w./~-]+/g, p => p.split('/').filter(Boolean).pop() || '');
const MAX_WORDS = 7, MAX_CHARS = 46;

/** The first clause of a task, shortened on a word boundary. Pure. Never cuts a word in half, never ends on "of the". */
export function agentNameFromTask(task, { kind = '' } = {}) {
  let s = line(String(task ?? '').split('\n')[0], 600);
  let before;
  do { before = s; for (const o of OPENERS) s = s.replace(o, ''); } while (s !== before);
  for (const n of NOISE) s = s.replace(n, ' ');
  s = paths(s).replace(/\s+/g, ' ').trim();
  const clause = s.split(/[.;:?!](?=\s|$)|\s[—–-]\s|,\s/)[0].replace(/[’']s$/, m => m).trim();
  const words = clause.split(' ').filter(Boolean);
  const kept = [];
  for (const w of words) {
    if (kept.length >= MAX_WORDS || [...kept, w].join(' ').length > MAX_CHARS) break;
    kept.push(w);
  }
  while (kept.length > 1 && TRAILING.test(kept.at(-1))) kept.pop();
  const name = kept.join(' ').replace(/[,(]+$/, '');
  if (name.length >= 3) return name.charAt(0).toUpperCase() + name.slice(1);
  const k = line(kind, 20);
  return k ? `${k.charAt(0).toUpperCase()}${k.slice(1)} agent` : 'Agent';
}

const SYSTEM = `You name one agent for the person it works for, the way a good app labels a task. Reply with the name only: 2 to 5 plain words, sentence case, starting with a verb where that reads naturally, like "Find book prices" or "Compare cancellation flows". No quotes, no punctuation at the end, no file paths, commit ids, branch names or run ids. Never use the words OCA, thinker, deployed or agent.`;

/** What came back from the model as a name, or null when it isn't one. Pure. */
export function cleanWrittenName(raw) {
  const s = line(String(raw ?? '').split('\n')[0], 120).replace(/^["“'`]+|["”'`.]+$/g, '').trim();
  if (s.length < 3 || s.length > MAX_CHARS + 8 || s.split(' ').length > MAX_WORDS) return null;
  if (/[/\\]|\b[0-9a-f]{7,}\b|^here\b|\bOCA\b/i.test(s)) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Asks the model for a name. Resolves to a name or null; it never throws. */
export async function writeAgentName({ llm, task, want = '' }) {
  if (!llm) return null;
  try {
    const r = await llm.messages.create({ provider: 'codex', max_tokens: 40, temperature: 0.2, system: SYSTEM,
      messages: [{ role: 'user', content: `What it serves: ${line(want, 300)}\n\nIts task: ${line(task, 900)}` }] });
    return cleanWrittenName(typeof r === 'string' ? r : r?.content?.[0]?.text ?? r?.text ?? '');
  } catch { return null; }
}
