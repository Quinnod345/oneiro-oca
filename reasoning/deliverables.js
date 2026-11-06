// What a finished agent leaves behind: a brief a person can read, saved as a markdown file in the pursuit's work folder
// and attached to the pursuit as an artifact commitment, so it lands in Judge for a verdict and stays on the pursuit's
// page afterwards. Without this, an agent's work lived only in its thread and in a 300-character summary.
//
// The file uses the same shape the inbox parses for every deliverable:
//   # Title
//
//   _For:_ the goal it serves
//
//   _Judge by:_ how to tell if it helped
//
//   body
import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { USEFUL_AT } from '../motivation/hunger.js';

const line = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// Markdown keeps its lines; only the length is bounded and stray carriage returns are dropped.
const block = (v, max = 20000) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim().slice(0, max);
const slug = s => line(s, 200).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'brief';

// What kind of thing a deliverable is, from the agent's report. A brief is read, kept and rated. A mail draft and a
// calendar block also carry a card the person can edit, with one action carried out on their press (the code is in
// reasoning/deliverable-cards.js): Gmail opens the draft for them to send (nothing is ever sent from here), and Calendar
// gets the event.
export const DELIVERABLE_KINDS = ['brief', 'mail_draft', 'calendar_block'];
const addresses = v => (Array.isArray(v) ? v : String(v ?? '').split(/[,;]/)).map(a => line(a, 200)).filter(Boolean).slice(0, 20);
const iso = v => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** A card as the engine keeps it, or null when what it was given can't make one (it stays a plain brief). Pure. */
export function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'mail_draft') {
    const subject = line(raw.subject, 200), body = block(raw.body, 20000);
    if (!subject || !body) return null;
    // A reply names its thread and the account it arrived on; without them the card opens a new message.
    const threadId = line(raw.threadId, 120), account = line(raw.account, 200);
    return { kind: 'mail_draft', to: addresses(raw.to), subject, body, ...(threadId ? { threadId } : {}), ...(account ? { account } : {}) };
  }
  if (raw.kind === 'calendar_block') {
    const title = line(raw.title, 200), start = iso(raw.start);
    if (!title || !start) return null;
    const end = iso(raw.end);
    const fromEnd = end ? (Date.parse(end) - Date.parse(start)) / 60_000 : NaN;
    const stated = Number(raw.durationMinutes);
    const minutes = fromEnd > 0 ? fromEnd : stated > 0 ? stated : 60;
    const account = line(raw.account, 200);
    return { kind: 'calendar_block', title, start, durationMinutes: Math.min(24 * 60, Math.round(minutes)), notes: block(raw.notes, 4000), calendar: line(raw.calendar, 120), ...(account ? { account } : {}) };
  }
  return null;
}
/** The card written out, so the file on disk (and an export) says what the card says. Pure. */
export function cardMarkdown(card) {
  if (card?.kind === 'mail_draft') return `## The draft\n\n**To:** ${card.to.join(', ') || '(nobody yet)'}\n\n**Subject:** ${card.subject}\n\n${card.body}`;
  if (card?.kind === 'calendar_block') return `## The calendar block\n\n**${card.title}**\n\n${new Date(card.start).toISOString().slice(0, 16).replace('T', ' ')} UTC, ${card.durationMinutes} minutes${card.calendar ? ` on ${card.calendar}` : ''}${card.notes ? `\n\n${card.notes}` : ''}`;
  return '';
}

// A title in a few words: the agent's own, else the first clause of its task.
export function briefTitle({ title, task, summary }) {
  const own = line(title, 90);
  if (own.length >= 4) return own;
  const first = line(String(task || '').split('\n')[0], 400).replace(/^(please|now|then)\s+/i, '');
  const clause = first.split(/(?<=[.;:])\s|\s[—–-]\s/)[0].replace(/[.;:]$/, '');
  const words = clause.split(' ');
  const short = words.length > 12 ? `${words.slice(0, 12).join(' ')}…` : clause;
  return short.length >= 4 ? short.charAt(0).toUpperCase() + short.slice(1) : line(summary, 80) || 'What the agent found';
}

/** The deliverable for one finished agent run: its title and its markdown. Pure. */
export function composeDeliverable({ chainId, want = '', doneWhen = '', agentId = '', kind = 'research', task = '', report = {}, verified = [], at = Date.now() }) {
  const title = briefTitle({ title: report.title, task, summary: report.summary });
  const sources = (report.evidence || []).filter(e => e && e.source);
  const confirmed = new Set(verified.map(v => String(v.observation || '')));
  const isVerified = e => [...confirmed].some(o => o.startsWith(String(e.observation || '').slice(0, 60)));
  const parts = [];
  const card = normalizeCard(report.deliverable);
  if (card) parts.push(cardMarkdown(card));
  const brief = block(report.brief);
  if (brief) parts.push(brief);
  else parts.push(`## What it found\n\n${block(report.summary, 4000) || 'The agent finished without a summary.'}`);
  // An agent's brief often has its own Sources. These are the ones Oneiro can show it quoted, so they get their own name.
  const heading = /^#{1,6}\s*sources\b/im.test(brief || '') ? '## What it quoted' : '## Sources';
  if (sources.length) {
    parts.push(`${heading}\n\n${sources.map((e, i) => {
      const src = /^https?:\/\//i.test(e.source) ? `<${line(e.source, 500)}>` : `\`${line(e.source, 500)}\``;
      const quote = line(e.quote, 600);
      return `${i + 1}. ${src}${isVerified(e) ? ' (re-read and confirmed by Oneiro)' : ''}\n   ${line(e.observation, 800)}${quote ? `\n   > ${quote}` : ''}`;
    }).join('\n')}`);
  } else {
    parts.push(`${heading}\n\nThe agent cited no sources it could quote, so treat this as its account, not as checked fact.`);
  }
  if (line(report.nextStep)) parts.push(`## Next step\n\n${line(report.nextStep, 600)}`);
  const open = (report.remaining || []).map(x => line(x, 300)).filter(Boolean);
  if (open.length) parts.push(`## Still open\n\n${open.map(x => `- ${x}`).join('\n')}`);
  const made = (report.made || []).filter(m => m && line(m.what));
  if (made.length) parts.push(`## What it set up\n\n${made.map(m => `- ${line(m.what, 200)}${line(m.where) ? ` — ${line(m.where, 400)}` : ''}`).join('\n')}`);
  parts.push(`---\n\n_${kind} agent ${String(agentId).slice(0, 8)} on pursuit #${chainId}, finished ${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC. Asked to: ${line(task, 400)}_`);
  const judge = line(doneWhen) ? `Does this get you closer to: ${line(doneWhen, 240)}` : 'Could you act on this without redoing the work?';
  const markdown = `# ${title}\n\n_For:_ ${line(want, 300) || `pursuit #${chainId}`}\n\n_Judge by:_ ${judge}\n\n${parts.join('\n\n')}\n`;
  return { title, markdown, card };
}

// The footer composeDeliverable ends every brief with. The file keeps it; on screen it reads "From <agent>, <date>".
const FOOTER = /\n*---\s*\n+_(\S+) agent (\S+) on pursuit #\d+, finished (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC\. Asked to: [^\n]*_\s*$/;
/** A brief's words without its machine footer, and what the footer said. Pure. */
export function splitFooter(body) {
  const s = String(body ?? ''), m = s.match(FOOTER);
  if (!m) return { body: s.trim(), footer: null };
  return { body: s.slice(0, m.index).trim(), footer: { kind: m[1], agent: m[2], at: `${m[3]}T${m[4]}:00.000Z` } };
}
/**
 * A row's preview: the first section's prose, with no heading run into it and a list read as a list. Sources and what's
 * still open never make it in. Pure.
 */
export function previewOf(markdown, max = 280) {
  let out = '', listing = false;
  for (const raw of String(markdown ?? '').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const rule = /^(?:-{3,}|\*{3,}|_{3,})$/.test(l);
    if (/^#{1,6}\s/.test(l) || rule) { if (out) break; continue; }
    const item = l.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    // An agent's summary arrives on one line, so its list is "found: - this - that" by the time it gets here.
    const flat = (item ? item[1] : l).match(/^(.*?:)\s+-\s+(.*)$/);
    const words = flat ? `${flat[1]} ${flat[2].split(/\s+-\s+/).join(' · ')}` : item ? item[1] : l;
    out += out ? (item && listing ? ' · ' : ' ') + words : words;
    listing = !!item;
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length <= max) return out;
  const cut = out.slice(0, max), space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s·,;:]+$/, '')}…`;
}

/** Write a finished agent's brief and attach it to its pursuit. Returns the commitment it added. */
export async function saveDeliverable({ pool, workRoot, chainId, agentId, clock = Date.now, ...rest }) {
  if (!workRoot) throw new Error('no work folder for deliverables');
  const at = clock();
  const { title, markdown, card } = composeDeliverable({ chainId, agentId, at, ...rest });
  const dir = join(workRoot, String(chainId), 'artifacts');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `agent-${String(agentId).slice(0, 8)}-${slug(title)}.md`);
  await writeFile(path, markdown, { mode: 0o600 });
  const report = rest.report || {};
  // finishLineMet is only the agent's word. It never moves the want: it lets the person's Useful or Great prompt them
  // to confirm (reasoning/finish-watch.js), and they decide.
  const commitment = { kind: 'artifact', path, title: line(title, 120), at, agentId, source: 'agent', deliverableKind: card?.kind || 'brief', ...(card ? { card } : {}),
    ...(report.finishLineMet === true ? { finishLineMet: true, finishEvidence: line(report.finishEvidence || report.summary, 400) } : {}) };
  // One brief per run: a run that reports twice replaces its own entry rather than adding another.
  await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{commitments}',
      COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(COALESCE(ponder_state -> 'commitments', '[]'::jsonb)) c WHERE c ->> 'agentId' IS DISTINCT FROM $3), '[]'::jsonb) || $2::jsonb)
    WHERE id = $1 AND ponder_state IS NOT NULL`, [Number(chainId), JSON.stringify([commitment]), String(agentId)]);
  return commitment;
}

// ---- verdicts and what they hold back -------------------------------------------------------------------------------
// A verdict on a deliverable is a receipt on its want. A changed verdict is a new receipt that replaces the old one, and
// a verdict taken back is a receipt with `reopened` and no usefulness. The old ones stay on record.
export const ratedId = name => `rated-artifact-${name}`;
export const verdictsOf = (want, name) => (want?.receipts || []).filter(r => r.receiptId === ratedId(name) || r.receiptId.startsWith(`${ratedId(name)}~`));
export const currentReceipt = (want, name) => verdictsOf(want, name).filter(r => !r.supersededBy).at(-1) || null;
/** The verdict standing on a deliverable now, or null when none was given or it was taken back. */
export const liveVerdict = (want, name) => { const r = currentReceipt(want, name); return r && Number.isFinite(r.usefulness) ? r : null; };
const artifactsOf = state => (state?.commitments || []).filter(c => c.kind === 'artifact' && c.path);
const verdictWord = u => (u >= 1 ? 'Great' : 'Useful');
// A witness the engine can check for itself (reasoning/finish-watch.js observes these).
export const MACHINE_WITNESSES = ['file', 'repo', 'test', 'calendar'];

/**
 * What a Useful or Great verdict says about the finish line, or null. An agent that said it saw the finish line met
 * always counts. For a witness only a person can be, a run that left nothing open also counts, once: after the person
 * says "not yet", only an agent's explicit word about something new asks again. Pure.
 */
export function finishCandidate(state, { nothingOpen = () => false } = {}) {
  const want = state?.want, seen = state?.finishWatch || {};
  if (want?.status !== 'active' || state.standing === 'self' || state.origin?.kind === 'self') return null;
  if (seen.status === 'proposed' || seen.status === 'confirmed') return null;
  const byPerson = !MACHINE_WITNESSES.includes(state.finishLine?.witness?.kind);
  const declined = seen.status === 'declined' ? seen.declined || [] : [];
  const rated = artifactsOf(state).map(c => ({ c, name: basename(c.path), v: liveVerdict(want, basename(c.path)) })).filter(x => x.v && x.v.usefulness >= USEFUL_AT)
    .sort((a, b) => (Number(b.c.at) || 0) - (Number(a.c.at) || 0));
  for (const { c, name, v } of rated) {
    const title = line(c.title || name, 120), word = verdictWord(v.usefulness);
    if (c.finishLineMet && !declined.includes(name)) return { name, explicit: true, evidence: `"${title}", which you rated ${word}: ${line(c.finishEvidence, 300) || 'its agent saw the finish line met'}` };
    if (byPerson && !declined.length && nothingOpen(c)) return { name, explicit: false, evidence: `you rated "${title}" ${word}, and its agent left nothing open` };
  }
  return null;
}

/**
 * Why no more agents should be sent yet, or null. A deliverable waiting for a verdict, or a finish line waiting for the
 * person's confirmation, is the person's move: sending another agent only redoes the work. Pure.
 */
export function deliveryHold(state, { chainId = state?.chain_id, gone = new Set(), dismissed = new Set(), nothingOpen = () => false } = {}) {
  if (state?.standing === 'self' || state?.origin?.kind === 'self' || state?.want?.status !== 'active') return null;
  if (state.finishWatch?.status === 'proposed') return { why: 'finish', title: line(state.finishWatch.evidence, 200) };
  for (const c of artifactsOf(state)) {
    const name = basename(c.path);
    if (gone.has(c.path) || dismissed.has(`artifact:${chainId}/${name}`)) continue;
    if (!liveVerdict(state.want, name)) return { why: 'unrated', title: line(c.title || name, 120) };
  }
  const candidate = finishCandidate(state, { nothingOpen });
  return candidate ? { why: 'finish', title: line(candidate.evidence, 200) } : null;
}

/** What the hold and the finish watch need to know beyond the pursuit's own state: files gone, cards set aside, runs. */
export async function holdContext(pool, row) {
  const paths = artifactsOf(row.state).map(c => c.path), gone = new Set();
  await Promise.all(paths.map(p => access(p).catch(() => gone.add(p))));
  const dismissed = new Set((await pool.query(`SELECT kind, id FROM inbox_dismissed WHERE kind = 'artifact'`).catch(() => ({ rows: [] }))).rows.map(r => `${r.kind}:${r.id}`));
  const { rows } = await pool.query(`SELECT id, report FROM agent_deployments WHERE chain_id = $1 AND status = 'done'`, [row.id]).catch(() => ({ rows: [] }));
  const reports = new Map(rows.map(r => [String(r.id), r.report || {}]));
  const nothingOpen = c => { const r = reports.get(String(c.agentId)); return !!r && !(r.remaining || []).length; };
  return { chainId: row.id, gone, dismissed, nothingOpen };
}
