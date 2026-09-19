// Parsing a thought is a runtime concern, not a model concern: the first balanced JSON object
// in the text, trailing prose ignored, fields normalized to the shapes downstream expects.
const TEXT_ALIASES = ['thoughts', 'thought', 'text', 'reflection', 'body', 'content', 'message', 'answer'];

export function extractFirstJsonObject(text) {
  const s = String(text ?? '').replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

function asText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' ');
  if (typeof value === 'object') return asText(value.text ?? value.content ?? value.thoughts ?? JSON.stringify(value));
  return String(value);
}

// Returns { thought } or { error, raw }. Never throws.
export function parseThought(rawText) {
  const candidate = extractFirstJsonObject(rawText);
  if (!candidate) return { error: 'no JSON object in response', raw: String(rawText ?? '').slice(0, 600) };
  let thought;
  try { thought = JSON.parse(candidate); }
  catch (e) { return { error: `malformed JSON: ${e.message}`, raw: candidate.slice(0, 600) }; }
  if (!thought || typeof thought !== 'object' || Array.isArray(thought)) return { error: 'response is not a JSON object', raw: candidate.slice(0, 600) };
  // Some prompt variants return `thought`, `text`, etc.; some models return an object or array. Downstream needs a string.
  let text = '';
  for (const key of TEXT_ALIASES) { text = asText(thought[key]); if (text) break; }
  thought.thoughts = text.trim();
  if (thought.continue_pondering !== undefined) thought.continue_pondering = thought.continue_pondering === true || thought.continue_pondering === 'true';
  return { thought };
}
