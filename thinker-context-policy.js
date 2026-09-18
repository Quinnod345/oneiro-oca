// Match names as tokens: 'Sill' is not present in 'silly', and 'Arc' is not 'search'.
function hasTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^\\p{L}\\p{N}])' + escaped + '($|[^\\p{L}\\p{N}])', 'iu').test(text);
}

function envFlag(env, name) {
  return /^(1|true|yes|on)$/i.test(String(env?.[name] || '').trim());
}

export function shouldIncludeTargetProject(env = process.env) {
  return envFlag(env, 'OCA_THINKER_INCLUDE_TARGET_PROJECT')
    || envFlag(env, 'ONEIRO_THINKER_INCLUDE_TARGET_PROJECT')
    || envFlag(env, 'OCA_ENABLE_AUTONOMOUS_ACTIONS')
    || envFlag(env, 'ONEIRO_ENABLE_AUTONOMOUS_ACTIONS')
    || envFlag(env, 'OCA_ENABLE_AUTONOMOUS_BUILD')
    || envFlag(env, 'ONEIRO_ENABLE_AUTONOMOUS_BUILD');
}

export function textPreview(text, max = 360) {
  const clean = String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function projectTerms(target) {
  if (!target) return [];
  return [target.name, target.display_name]
    .map(term => String(term || '').trim().toLowerCase())
    .filter(term => term.length >= 3)
    .filter((term, index, arr) => arr.indexOf(term) === index);
}

export function contextMentionsProject(target, contextParts = []) {
  const terms = projectTerms(target);
  if (terms.length === 0) return false;
  const context = contextParts
    .map(part => String(part || '').toLowerCase())
    .join(' ');
  return terms.some(term => hasTerm(context, term));
}

export function isProjectScopedText(text, target) {
  const terms = projectTerms(target);
  if (terms.length === 0) return false;
  const body = String(text || '').toLowerCase();
  return terms.some(term => hasTerm(body, term));
}

export function filterContextRowsForThinker(rows, {
  target = null,
  includeTargetProject = false,
  contextParts = [],
  textForRow = row => row?.content || row?.claim || ''
} = {}) {
  if (!Array.isArray(rows)) return [];
  if (includeTargetProject || contextMentionsProject(target, contextParts)) {
    return rows;
  }
  return rows.filter(row => !isProjectScopedText(textForRow(row), target));
}

export function targetProjectPromptSection(target, {
  includeTargetProject = false
} = {}) {
  if (!target) {
    return `
════════════════════════════════════════════════════════
NO ACTIVE BUILD TARGET
════════════════════════════════════════════════════════
target-project.json does not exist yet. Do not infer Quinn's current
work from old design-model artifacts.
════════════════════════════════════════════════════════
`;
  }

  if (!includeTargetProject) {
    return `
════════════════════════════════════════════════════════
PARKED BUILD TARGET — not current user context
════════════════════════════════════════════════════════
target-project.json exists, but autonomous build actions are disabled.
Do not infer Quinn's current work, attention, or thoughts from that
parked target. Mention it only when the direct current screen/app
context explicitly names it.
════════════════════════════════════════════════════════
`;
  }

  return `
════════════════════════════════════════════════════════
ACTIVE PROJECT — you are building this singular Mac app
════════════════════════════════════════════════════════
NAME: ${target.display_name || target.name}
PROBLEM: ${target.problem_statement || '(none)'}
THESIS: ${target.thesis || '(none)'}
TARGET USER: ${target.target_user || 'Quinn + creators'}
MONETIZATION: ${target.monetization || 'TBD'}
CONSTRAINTS: ${(target.constraints || []).join(', ') || '(none)'}
AESTHETIC ANCHORS: ${(target.aesthetic_anchors || []).join(', ') || '(none)'}
INITIAL BRIEF: ${target.initial_brief || '(none)'}

HARD RULES for "build" actions:
- Every build MUST iterate on ${target.name}. Do NOT propose new app ideas.
- Builds accrete into active-project/${target.name}/iterations/ automatically.
- The builder receives --project ${target.name} — the goal field describes the
  specific iteration change (e.g. "add emotional color temperature to the menubar
  glyph"), NOT a new app concept.
- If you believe ${target.name} is the wrong target, file a "dream" with
  {content: "target_revision: <why>", type: "goal", weight: 0.8}.  DO NOT
  silently drift to a new idea — the previous drift cost 48h of wasted cycles.
════════════════════════════════════════════════════════
`;
}

// Durable history is not an active assignment. When no build session is enabled,
// only directly named tasks belong in the background prompt. The durable ponder queue
// owns explicit wants and supplies their own context independently of this filter.
export function currentTaskRows(rows, { includeTargetProject = false, target = null, contextParts = [], textForRow = row => row?.description || row?.content || '' } = {}) {
  if (!Array.isArray(rows)) return [];
  if (includeTargetProject) return rows;
  if (!contextMentionsProject(target, contextParts)) return [];
  return rows.filter(row => isProjectScopedText(textForRow(row), target));
}
export function observedWorkspaceRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(row => ['observation', 'perception', 'user_message'].includes(row?.content_type));
}
