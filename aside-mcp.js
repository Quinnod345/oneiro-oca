#!/usr/bin/env node
// Aside, as an MCP tool server for the engine's Codex slices. A slice runs inside Codex's command sandbox,
// which cannot reach the Aside app; an MCP server is spawned by Codex itself, outside that sandbox, so this
// is how a slice sees and works the web through the engine's one browser.
//
// Look freely; act through the gate. The agent can open pages, read them and change what it sees without
// asking anyone. A control that commits something — publish, submit, upload, spend, message, delete — is
// classified from what the page says about it and sent to the engine's actuator, which decides under the
// person's charter (and journals it); only a `proceed` is clicked. Signing in goes to Aside's own agent,
// which uses the person's saved logins, so no password ever reaches a model. Credential and payment fields
// are never typed by the model. What happened is reported back to the actuator from the page afterwards.
//
// Protocol: MCP over stdio, newline-delimited JSON-RPC 2.0 (initialize, tools/list, tools/call, ping).
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { terminalObservation } from './reasoning/action-retries.js';
import { createAside, validateUrl } from './aside.js';

const aside = createAside();
const MAX = n => Math.max(200, Math.min(60000, Number(n) || 9000));
const TARGET = /^[A-Za-z0-9_-]{1,80}$/;
const REF = /^r\d{1,4}$/;

// A sign-in wall is an observed fact about access, not a guess: the URL or title says so. Reported on the
// result so the engine can ask the person for exactly that, and never inferred from model prose.
const AUTH_URL = /idmsa\.apple\.com|appleid\.apple\.com|accounts\.google\.com|login\.microsoftonline|\/(login|signin|sign-in|sign_in|auth|oauth|sso)(\/|\?|$)/i;
const AUTH_TITLE = /^(sign in|log in|login|sign-in)\b|\b(sign in|log in) to\b|two-factor|verification code/i;
export function accessBlock({ url, title, text }) {
  const u = String(url || ''), t = String(title || ''), body = String(text || '').slice(0, 400);
  if (AUTH_URL.test(u) || AUTH_TITLE.test(t) || /\b(enter your password|sign in with|log in to continue)\b/i.test(body)) {
    let host = ''; try { host = new URL(u).host; } catch {}
    return { kind: 'sign_in', host, url: u, title: t };
  }
  return null;
}
const withBlock = r => { const b = accessBlock(r); return b ? { ...r, accessBlocked: b } : r; };

// ── The boundary between looking and committing ─────────────────────────────────────────────────────────
// Decided from facts the page script observed about a control (its role, name, form, input type), never
// from model prose. Verbs that commit are refused outright; verbs that can go either way (close, clear,
// reset, remove, cancel, confirm, delete) are allowed only when the control names something you look
// through — a filter, a date range, a dialog, a column — and refused otherwise (Close account, Delete team).
const COMMIT_VERB = /\b(send|submit|pay|purchase|buy|check ?out|place order|order now|destroy|erase|publish|post|share|invite|transfer|withdraw|deposit|sign ?out|log ?out|unsubscribe|revoke|approve|reject|accept|decline|save|create|upload|import|export|download|install|deploy|merge|change password|verify|grant|block|report|disable|enable|archive|edit|rename|duplicate|reply|comment|tweet|like|follow|subscribe|donate|tip|book|reserve|apply now|register|sign ?up|start trial|upgrade|downgrade|continue with|authorize|allow access|connect account|link account|add (member|user|team|card|payment|seat|account))\b/i;
const EITHER_VERB = /\b(remove|clear|reset|cancel|close|confirm|dismiss|discard|delete|deselect)\b/i;
const ONLY_CLOSES = /^(close|dismiss|cancel|×|x|✕|✖|close (dialog|modal|panel|drawer|menu|popup|window))$/i;   // aborts or closes; never commits
const VIEW_NOUN = /\b(filter|filters|date|dates|range|period|view|column|columns|sort|search|selection|picker|dialog|panel|menu|popup|modal|chart|graph|table|preview|drawer|tooltip|dropdown|tab|tabs|query|breakdown|series|legend|comparison|zoom|sidebar|overlay|notification|banner|tour|hint|tip|all|selected)\b/i;
const CREDENTIAL_FIELD = /pass|pwd|card|cvc|cvv|ccnum|iban|routing|ssn|social.?security|otp|one.?time|2fa|totp|secret|token|api.?key|pin\b/i;

const SPEND = /\b(pay|purchase|buy|check ?out|place order|order now|subscribe|start trial|upgrade|downgrade|donate|tip|book|reserve|boost|promote|add (card|payment))\b/i;
const DESTROY = /\b(delete|destroy|erase|close account|deactivate|cancel subscription|sign ?out|log ?out|unsubscribe|revoke|archive|block|report|disable|remove (account|member|user|seat))\b/i;
const PUBLISH = /\b(post|share|publish|tweet|repost|retweet|comment|reply|go live)\b/i;
const MESSAGE = /\b(send|invite|message|dm|email)\b/i;
// The class of a committing control, decided from its observed name.
export function commitClass(name) {
  const n = String(name || '');
  if (SPEND.test(n)) return 'spend';
  if (DESTROY.test(n)) return 'destroy';
  if (PUBLISH.test(n)) return 'publish';
  if (MESSAGE.test(n)) return 'message';
  return 'submit';
}
export function interactionPolicy(kind, c = {}) {
  const name = String(c.name || '').trim();
  const refuse = why => ({ allowed: false, why });
  const commit = cls => ({ allowed: true, commit: cls });
  if (c.disabled) return refuse('the control is disabled');
  if (kind === 'type') {
    if (c.credential) return refuse('a credential or payment field — only the person may fill it, in Aside');
    if (!/^(textbox|searchbox|combobox|spinbutton|textarea|input|contenteditable)$/.test(String(c.role || ''))) return refuse('not a text field');
    return { allowed: true };
  }
  if (kind === 'enter') {
    if (c.formHasCredential) return refuse('Enter would submit a sign-in form: use aside_sign_in, which signs in with the saved login');
    if (COMMIT_VERB.test(String(c.formSubmitName || ''))) return commit(commitClass(c.formSubmitName));
    return { allowed: true };
  }
  if (kind === 'select') return String(c.tag || '').toLowerCase() === 'select' ? { allowed: true } : refuse('not a <select>; click the option instead');
  // click
  if (c.inputType === 'file') return refuse('a file input: use aside_do with the file paths, which uploads through the actuator');
  if (c.href && !/^https?:/i.test(c.href) && !/^[/#?]/.test(c.href)) return refuse(`a ${String(c.href).split(':')[0]}: link; use aside_do to message someone`);
  if (c.submit && c.formHasCredential) return refuse('it submits a sign-in form: use aside_sign_in, which signs in with the saved login');
  if (COMMIT_VERB.test(name)) return commit(commitClass(name));
  if (EITHER_VERB.test(name) && !VIEW_NOUN.test(name) && !ONLY_CLOSES.test(name)) return commit(DESTROY.test(name) || /\b(delete|remove|discard)\b/i.test(name) ? 'destroy' : 'submit');
  if (c.submit) return commit('submit');
  return { allowed: true };
}

// Runs inside the page: tags every visible interactive control with data-oca-ref and reports the facts the
// policy needs. Returned refs are the only handles the action tools accept.
function tagControls(limit) {
  const SEL = 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="textbox"],[role="searchbox"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="treeitem"],[role="gridcell"][tabindex],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const roleOf = el => {
    const r = el.getAttribute('role'); if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === 'a') return 'link'; if (t === 'button' || t === 'summary') return 'button'; if (t === 'select') return 'combobox'; if (t === 'textarea') return 'textbox';
    if (t === 'input') { const ty = (el.type || 'text').toLowerCase(); return ({ checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button', image: 'button', file: 'file', range: 'slider', number: 'spinbutton', search: 'searchbox' })[ty] || 'textbox'; }
    if (el.isContentEditable) return 'contenteditable'; return 'generic';
  };
  const nameOf = el => clean(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && [...el.getAttribute('aria-labelledby').split(/\s+/)].map(i => document.getElementById(i)?.textContent).join(' ')) || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || (el.tagName === 'INPUT' && el.labels?.[0]?.textContent) || el.textContent).slice(0, 80);
  document.querySelectorAll('[data-oca-ref]').forEach(el => el.removeAttribute('data-oca-ref'));
  const dialog = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')].pop() || null;
  // Popovers, menus, pickers and listboxes float above the page and usually sit at the end of <body>; they are
  // what a click just opened, so their controls are listed first and their text is the region reported.
  const OVERLAY = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="tooltip"],[data-floating-ui-portal],[data-radix-popper-content-wrapper],[data-popper-placement],.Popover,.ant-picker-dropdown,.ant-dropdown,.ant-select-dropdown,.MuiPopover-root,.MuiMenu-root,.MuiPopper-root';
  const floats = el => { for (let a = el; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if ((cs.position === 'fixed' || cs.position === 'absolute') && Number(cs.zIndex) >= 100) return a; } return null; };
  const overlayOf = el => el.closest(OVERLAY) || floats(el);
  const visible = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const st = getComputedStyle(el); return st.visibility !== 'hidden' && st.display !== 'none'; };
  const candidates = []; const seen = new Set(); let n = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (!visible(el)) continue;
    if (dialog && !dialog.contains(el)) continue;   // a modal owns the page while it is open
    seen.add(el); candidates.push({ el, overlay: !dialog && !!overlayOf(el) });
  }
  // Older web apps (App Store Connect, for one) make clickable things out of plain divs and spans with a pointer
  // cursor and no role. Those are controls too: the leaf-most pointer element that is not inside, and does not
  // contain, a real control. Reported as inferred so a slice knows the name came from its text.
  for (const el of document.querySelectorAll('div,span,li,td,th,p,img,svg,label')) {
    if (seen.has(el) || !visible(el) || getComputedStyle(el).cursor !== 'pointer') continue;
    if (el.closest(SEL) || el.querySelector(SEL)) continue;
    if ([...el.querySelectorAll('div,span,li,td,p')].some(d => getComputedStyle(d).cursor === 'pointer' && d.getBoundingClientRect().width)) continue;
    if (dialog && !dialog.contains(el)) continue;
    seen.add(el); candidates.push({ el, overlay: !dialog && !!overlayOf(el), inferred: true });
  }
  candidates.sort((a, b) => (Number(b.overlay) - Number(a.overlay)) || (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const out = []; let overlayNode = null;
  for (const { el, overlay, inferred } of candidates) {
    if (++n > limit) break;
    const ref = 'r' + n; el.setAttribute('data-oca-ref', ref);
    if (overlay && !overlayNode) overlayNode = overlayOf(el);
    const tag = el.tagName.toLowerCase(), role = inferred ? 'button' : roleOf(el), inputType = tag === 'input' ? (el.type || 'text').toLowerCase() : '';
    const form = el.closest('form');
    const c = { ref, role, name: nameOf(el), tag };
    if (overlay) c.overlay = true;
    if (inferred) c.inferred = true;   // a pointer-cursor element with no semantics; named by its text
    if (inputType) c.inputType = inputType;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') c.disabled = true;
    if (el.getAttribute('aria-expanded')) c.expanded = el.getAttribute('aria-expanded') === 'true';
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current')) c.selected = true;
    if (el.checked || el.getAttribute('aria-checked') === 'true') c.checked = true;
    if (tag === 'a') c.href = el.getAttribute('href') || '';
    if (tag === 'select') c.options = [...el.options].slice(0, 40).map(o => ({ value: o.value, label: clean(o.textContent).slice(0, 60), selected: o.selected }));
    if ((tag === 'input' && !/^(password|checkbox|radio|submit|button|file)$/.test(inputType)) || tag === 'textarea') c.value = clean(el.value).slice(0, 80);
    const idn = `${el.name || ''} ${el.id || ''} ${el.getAttribute('autocomplete') || ''}`;
    if (inputType === 'password' || /^(cc-|one-time-code|new-password|current-password)/.test(el.getAttribute('autocomplete') || '') || /pass|pwd|card|cvc|cvv|ccnum|iban|routing|ssn|social.?security|otp|one.?time|2fa|totp|secret|token|api.?key|pin$/i.test(idn)) c.credential = true;
    if (form) {
      c.inForm = true;
      if (form.querySelector('input[type="password"],input[autocomplete^="cc-"],input[autocomplete="one-time-code"]')) c.formHasCredential = true;
      const sub = form.querySelector('button:not([type="button"]),input[type="submit"]'); if (sub) c.formSubmitName = clean(sub.getAttribute('aria-label') || sub.value || sub.textContent).slice(0, 60);
      if (inputType === 'submit' || (tag === 'button' && (el.type || 'submit').toLowerCase() === 'submit')) c.submit = true;
    }
    out.push(c);
  }
  const region = dialog || overlayNode || document.querySelector('main') || document.body;
  return { controls: out, modal: !!dialog, overlay: !!overlayNode, text: clean(region?.innerText).slice(0, 2500) };
}

// The REPL snippet each tool runs: attach the tab, act, settle, then look again. `sleep` is an Aside global.
// The result is budgeted, never cut: text first, then controls dropped from the end until the JSON fits.
const look = (id, action = '', { maxChars = 6000, limit = 250 } = {}) =>
  `const p = await attachBrowserTab(${JSON.stringify(id)}); ${action} await sleep(700); const v = await p.evaluate(${tagControls.toString()}, ${limit}); const o = { title: await p.title(), url: p.url(), modal: v.modal, overlay: v.overlay, text: v.text.slice(0, ${Math.max(400, Math.floor(maxChars / 3))}), controls: v.controls }; let js = JSON.stringify(o); while (js.length > ${maxChars} && o.controls.length) { o.controls.pop(); o.truncated = 'controls beyond ' + o.controls.length + ' omitted; scroll or raise maxChars'; js = JSON.stringify(o); } console.log(js);`;
const sel = ref => `[data-oca-ref=${JSON.stringify(ref)}]`;

async function view(id, action, opts) {
  const r = await aside.repl(look(id, action, opts));
  if (!r.json) throw new Error(`Aside could not work tab ${id}: ${(r.stderr || r.stdout).slice(0, 200)}`);
  return withBlock({ ...r.json, source: `Aside browser (open tab): ${r.json.url}` });
}
// A control named by ref must come from the last look at that same tab; the page is re-read to check it.
async function control(id, ref) {
  if (!TARGET.test(id)) throw new Error('a tab is named by its targetId from aside_tabs');
  if (!REF.test(ref)) throw new Error('a control is named by its ref (r1, r2, …) from the last aside_snapshot_tab / action result on this tab');
  const r = await aside.repl(`const p0 = await attachBrowserTab(${JSON.stringify(id)}); const v0 = await p0.evaluate(${tagControls.toString()}, 250); const c0 = v0.controls.find(c => c.ref === ${JSON.stringify(ref)}); console.log(JSON.stringify(c0 ? { ...c0, pageUrl: p0.url(), pageTitle: await p0.title() } : null));`);
  if (!r.json) throw new Error(`${ref} is not on the page any more — look again (aside_snapshot_tab)`);
  return r.json;
}
async function tabUrl(id) {
  const r = await aside.repl(`const p9 = await attachBrowserTab(${JSON.stringify(id)}); console.log(JSON.stringify({ url: p9.url(), title: await p9.title() }));`);
  if (!r.json) throw new Error(`Aside could not see tab ${id}`);
  return r.json;
}

// ── The gate ──────────────────────────────────────────────────────────────────────────────────────────
// A committing step is decided by the engine's actuator under the person's charter. The engine unreachable
// means no decision, and no decision means no action.
const ENGINE = process.env.OCA_ENGINE_URL || 'http://localhost:3333';
const hostOf = u => { try { return new URL(u).host; } catch { return ''; } };
async function engine(path, body) {
  let res; try { res = await fetch(`${ENGINE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) }); }
  catch (e) { throw new Error(`the engine's actuator is unreachable (${e.message}); nothing was done`); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `actuator ${res.status}`);
  return j;
}
async function gate(args, { cls, url, control = '', description }) {
  const pursuit = Number(args.pursuit);
  if (!Number.isInteger(pursuit) || pursuit < 1) return { held: true, why: `This ${cls} action needs the pursuit it serves: pass pursuit (the #id from your brief) and purpose.` };
  const purpose = String(args.purpose || '').trim();
  const d = await engine('/oca/act/authorize', { chainId: pursuit, class: cls, host: hostOf(url), url, control, description: purpose ? `${purpose} (${description})` : description,
    cost: Number(args.cost) || 0, approval: args.approval || null, retryEvidence: args.retryEvidence || null });
  if (d.decision === 'proceed') return { proceed: true, actionId: d.actionId };
  if (d.decision === 'ask') return { held: true, askId: d.askId, question: d.question, why: `${d.why}. The engine asked Quinn (ask #${d.askId}). End your turn with needs_person using exactly this question: "${d.question}". When he answers yes, retry this same action with approval=${d.askId}.` };
  return { refused: true, why: d.why };
}
async function report(actionId, result, observation) { if (actionId) await engine('/oca/act/observe', { actionId, result, observation: terminalObservation(observation, 1500) }).catch(() => {}); }
const heldOrRefused = (kind, c, g) => g.refused ? { refused: true, action: kind, control: c ? `${c.role} "${c.name}"` : undefined, why: g.why } : { held: true, action: kind, control: c ? `${c.role} "${c.name}"` : undefined, askId: g.askId, question: g.question, why: g.why };
// Run a committing step after a proceed; report what the page showed afterwards.
async function committed(id, g, kind, c, actionJs) {
  try {
    const after = await view(id, actionJs);
    await report(g.actionId, 'success', `${kind} ${c ? `${c.role} "${c.name}"` : ''} → ${after.title} ${after.url}: ${String(after.text || '').slice(0, 600)}`);
    return { action: { kind, committed: true, actionId: g.actionId, control: c ? `${c.role} "${c.name}"` : undefined }, ...after };
  } catch (e) { await report(g.actionId, 'failure', e.message); throw e; }
}
const WORKSPACE = '/Users/quinnodonnell/oneiro/runtime/workspace/';
const DELEGATE_RULES = 'Rules: do exactly this and nothing beyond it. Use the saved logins and saved one-time codes (autofill) if a sign-in is needed. Never create an account, change a password or security setting, or solve a CAPTCHA or bot check. If a CAPTCHA, an SMS code, or an approval on another device is required, stop. Never submit graded coursework. End your answer with one line: DONE: <what the page showed at the end> or BLOCKED: <exactly what is needed>.';
const refused = (kind, c, why) => ({ refused: true, action: kind, ref: c.ref, control: `${c.role} "${c.name}"`, why, instead: 'This is for the person: say exactly which control and why, so the engine can ask them.' });
async function tabIdFor(url) {
  try { const r = await aside.repl(`const lt0 = await listBrowserTabs(); const t0 = lt0.find(t => t.url === ${JSON.stringify(url)}) || lt0.find(t => t.active); console.log(JSON.stringify(t0 ? t0.targetId : null));`); return typeof r.json === 'string' ? r.json : null; } catch { return null; }
}

const LOOK = 'Returns the page after the action: title, url, visible text, and the controls with their refs. Only refs from this result are valid for the next action on this tab.';
const TOOLS = [
  { name: 'aside_read', description: 'Read the visible text of a web page through Aside, the only browser. Returns title, final URL, text and the new tab\'s targetId.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'http(s) URL' }, maxChars: { type: 'integer', description: 'text budget, default 6000' } }, required: ['url'], additionalProperties: false } },
  { name: 'aside_search', description: 'Web search through Aside (DuckDuckGo results page as text).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['query'], additionalProperties: false } },
  { name: 'aside_snapshot', description: 'Open a URL in a new Aside tab and look at it: structure, visible text, and the controls (with refs) you can work. Returns the tab\'s targetId for further actions.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['url'], additionalProperties: false } },
  { name: 'aside_open', description: 'Open a page in Aside so the person can see it; returns its title and targetId.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { name: 'aside_tabs', description: 'List the tabs open in Aside (targetId, title, URL). The person\'s signed-in sessions live here.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aside_read_tab', description: 'Read the visible text of a tab already open in Aside (by targetId from aside_tabs).',
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['targetId'], additionalProperties: false } },
  { name: 'aside_snapshot_tab', description: `Look at an open tab: title, URL, visible text and every control you can work, each with a ref (r1, r2, …) and its state. Do this before acting and whenever the page may have changed. ${LOOK}`,
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['targetId'], additionalProperties: false } },
  { name: 'aside_click', description: `Click a control by ref. Viewing controls (filters, dates, tabs, menus, pages) just work. A control that commits something — post, submit, save, pay, send, delete — is decided by the engine under Quinn's charter: pass pursuit and purpose; it proceeds, is held for one yes from Quinn (you get the ask to quote), or is refused with the reason. ${LOOK}`,
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, ref: { type: 'string' }, pursuit: { type: 'integer', description: 'the pursuit #id this serves (required when the step commits something)' }, purpose: { type: 'string', description: 'why, in a sentence' }, approval: { type: 'integer', description: 'the ask id Quinn answered yes to, when retrying a held action' } }, required: ['targetId', 'ref'], additionalProperties: false } },
  { name: 'aside_type', description: `Type into a text field by ref (replaces its content). Never into password, code or payment fields — sign in with aside_sign_in instead. enter=true submits; a form that commits something goes through the engine like aside_click (pass pursuit and purpose). ${LOOK}`,
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, ref: { type: 'string' }, text: { type: 'string' }, enter: { type: 'boolean' }, pursuit: { type: 'integer', description: 'the pursuit #id this serves (required when the step commits something)' }, purpose: { type: 'string', description: 'why, in a sentence' }, approval: { type: 'integer', description: 'the ask id Quinn answered yes to, when retrying a held action' } }, required: ['targetId', 'ref', 'text'], additionalProperties: false } },
  { name: 'aside_select', description: `Choose an option in a <select> control by ref, by option value or label. For custom dropdowns, click the control and then click the option. ${LOOK}`,
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, ref: { type: 'string' }, value: { type: 'string' } }, required: ['targetId', 'ref', 'value'], additionalProperties: false } },
  { name: 'aside_press', description: `Press a key on the tab: Escape, Tab, arrows, PageUp/PageDown, Home, End, Enter (Enter on a committing form goes through the engine; pass pursuit and purpose). ${LOOK}`,
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, key: { type: 'string' }, pursuit: { type: 'integer', description: 'the pursuit #id this serves (required when the step commits something)' }, purpose: { type: 'string', description: 'why, in a sentence' }, approval: { type: 'integer', description: 'the ask id Quinn answered yes to, when retrying a held action' } }, required: ['targetId', 'key'], additionalProperties: false } },
  { name: 'aside_scroll', description: `Scroll a tab: to a control by ref, or by direction (down/up/bottom/top). ${LOOK}`,
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, ref: { type: 'string' }, direction: { type: 'string', enum: ['down', 'up', 'bottom', 'top'] } }, required: ['targetId'], additionalProperties: false } },
  { name: 'aside_sign_in', description: 'Sign in on a tab that shows a sign-in page, with Quinn\'s saved login (Aside\'s agent autofills it; no password reaches you). Decided by the engine under the charter. Returns whether the tab is now signed in.',
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, pursuit: { type: 'integer', description: 'the pursuit #id this serves (required when the step commits something)' }, purpose: { type: 'string', description: 'why, in a sentence' }, approval: { type: 'integer', description: 'the ask id Quinn answered yes to, when retrying a held action' } }, required: ['targetId', 'pursuit'], additionalProperties: false } },
  { name: 'aside_do', description: 'Hand a whole committing task to Aside\'s own agent — post a carousel with its images, publish a post, fill and submit a form, change a profile setting, send a message, buy something within the cap. Say exactly what to do; list local files (absolute paths under runtime/workspace) for uploads. Decided first by the engine under Quinn\'s charter (class: publish, submit, upload, spend, message, destroy, sign_in). Returns what Aside\'s agent reported (DONE/BLOCKED); verify the result yourself afterwards with aside_snapshot_tab.',
    inputSchema: { type: 'object', properties: { class: { type: 'string', enum: ['publish', 'submit', 'upload', 'spend', 'message', 'destroy', 'sign_in'] }, task: { type: 'string' }, url: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, cost: { type: 'number', description: 'dollars, for spend' }, pursuit: { type: 'integer', description: 'the pursuit #id this serves (required when the step commits something)' }, purpose: { type: 'string', description: 'why, in a sentence' }, approval: { type: 'integer', description: 'the ask id Quinn answered yes to, when retrying a held action' } }, required: ['class', 'task', 'pursuit'], additionalProperties: false } },
  { name: 'aside_go', description: `Navigate an open tab to an http(s) URL (for example the same report with different query parameters), or "back". Keeps the person's session. ${LOOK}`,
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, url: { type: 'string' } }, required: ['targetId', 'url'], additionalProperties: false } },
];
// Recovery is evidence, never an approval override. Reads remain ungated.
for (const tool of TOOLS.filter(t => t.inputSchema.properties.pursuit)) {
  tool.inputSchema.properties.retryEvidence = { type: 'object', description: 'For a suppressed retry: a source the engine can re-read and an exact quote demonstrating changed supported route or target state. One observed state permits at most one attempt.',
    properties: { source: { type: 'string' }, quote: { type: 'string' } }, required: ['source', 'quote'], additionalProperties: false };
}
export const ASIDE_TOOL_NAMES = TOOLS.map(t => t.name);
const KEYS = new Set(['Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter']);

export async function callAsideTool(name, args = {}) {
  const id = String(args.targetId || '');
  switch (name) {
    case 'aside_read': { const r = await aside.readPage(validateUrl(args.url), { maxChars: MAX(args.maxChars) }); return withBlock({ title: r.title, url: r.url, source: r.source, text: r.text, targetId: await tabIdFor(r.url) }); }
    case 'aside_search': { const r = await aside.search(String(args.query || '').slice(0, 400), { maxChars: MAX(args.maxChars) }); return { query: r.query, url: r.url, source: r.source, text: r.text }; }
    case 'aside_snapshot': {
      const o = await aside.openUrl(validateUrl(args.url)); const tab = await tabIdFor(o.url);
      if (!tab) return withBlock({ title: o.title, url: o.url, source: `Aside browser: ${o.url}`, note: 'opened; list aside_tabs to find its targetId' });
      return { ...(await view(tab, '', { maxChars: MAX(args.maxChars) })), targetId: tab };
    }
    case 'aside_open': { const r = await aside.openUrl(validateUrl(args.url)); return withBlock({ title: r.title, url: r.url, targetId: await tabIdFor(r.url) }); }
    case 'aside_tabs': {
      const r = await aside.repl(`const lt2 = await listBrowserTabs(); console.log(JSON.stringify(lt2.map(t => ({ targetId: t.targetId, active: t.active, title: t.title, url: t.url }))));`);
      return { tabs: Array.isArray(r.json) ? r.json : [] };
    }
    case 'aside_read_tab': {
      if (!TARGET.test(id)) throw new Error('a tab is named by its targetId from aside_tabs');
      const max = MAX(args.maxChars);
      const r = await aside.repl(`const p3 = await attachBrowserTab(${JSON.stringify(id)}); const t3 = await p3.evaluate(() => document.body?.innerText || ""); console.log(JSON.stringify({ title: await p3.title(), url: p3.url(), text: String(t3).replace(/\\s+/g, " ").trim().slice(0, ${max}) }));`);
      if (!r.json) throw new Error(`Aside could not read tab ${id}: ${(r.stderr || r.stdout).slice(0, 200)}`);
      return withBlock({ ...r.json, source: `Aside browser (open tab): ${r.json.url}` });
    }
    case 'aside_snapshot_tab': { if (!TARGET.test(id)) throw new Error('a tab is named by its targetId from aside_tabs'); return view(id, '', { maxChars: MAX(args.maxChars) }); }
    case 'aside_click': {
      const c = await control(id, String(args.ref || '')); const p = interactionPolicy('click', c);
      if (!p.allowed) return refused('click', c, p.why);
      const js = `await p.locator(${JSON.stringify(sel(c.ref))}).first().click({ timeout: 10000 });`;
      if (p.commit) {
        const g = await gate(args, { cls: p.commit, url: c.pageUrl, control: `${c.role} "${c.name}"`, description: `click "${c.name}" on ${c.pageTitle || hostOf(c.pageUrl)}` });
        return g.proceed ? committed(id, g, 'click', c, js) : heldOrRefused('click', c, g);
      }
      return { action: { kind: 'click', ref: c.ref, control: `${c.role} "${c.name}"` }, ...(await view(id, js)) };
    }
    case 'aside_type': {
      const c = await control(id, String(args.ref || '')); const text = String(args.text ?? '').slice(0, 500);
      const p = interactionPolicy('type', c); if (!p.allowed) return refused('type', c, p.why);
      let after = '', e = null;
      if (args.enter) { e = interactionPolicy('enter', c); if (!e.allowed) return refused('type+enter', c, e.why); after = ` await p.keyboard.press('Enter');`; }
      const js = `const l4 = p.locator(${JSON.stringify(sel(c.ref))}).first(); await l4.click({ timeout: 10000 }); await l4.fill(${JSON.stringify(text)});${after}`;
      if (e?.commit) {
        const g = await gate(args, { cls: e.commit, url: c.pageUrl, control: `${c.role} "${c.name}"`, description: `type "${text.slice(0, 120)}" into "${c.name}" and submit "${c.formSubmitName || 'the form'}" on ${c.pageTitle || hostOf(c.pageUrl)}` });
        return g.proceed ? committed(id, g, 'type+enter', c, js) : heldOrRefused('type+enter', c, g);
      }
      return { action: { kind: 'type', ref: c.ref, control: `${c.role} "${c.name}"`, text, enter: !!args.enter }, ...(await view(id, js)) };
    }
    case 'aside_select': {
      const c = await control(id, String(args.ref || '')); const p = interactionPolicy('select', c);
      if (!p.allowed) return refused('select', c, p.why);
      const v = String(args.value ?? '').slice(0, 200);
      return { action: { kind: 'select', ref: c.ref, control: `${c.role} "${c.name}"`, value: v }, ...(await view(id, `const l5 = p.locator(${JSON.stringify(sel(c.ref))}).first(); try { await l5.selectOption(${JSON.stringify(v)}); } catch { await l5.selectOption({ label: ${JSON.stringify(v)} }); }`)) };
    }
    case 'aside_press': {
      if (!TARGET.test(id)) throw new Error('a tab is named by its targetId from aside_tabs');
      const key = String(args.key || ''); if (!KEYS.has(key)) throw new Error(`key must be one of ${[...KEYS].join(', ')}`);
      if (key === 'Enter') {
        const r = await aside.repl(`const p6 = await attachBrowserTab(${JSON.stringify(id)}); console.log(JSON.stringify(await p6.evaluate(() => { const a = document.activeElement, f = a && a.closest && a.closest('form'); const sub = f && f.querySelector('button:not([type="button"]),input[type="submit"]'); return { formHasCredential: !!(f && f.querySelector('input[type="password"],input[autocomplete^="cc-"],input[autocomplete="one-time-code"]')), formSubmitName: sub ? String(sub.getAttribute('aria-label') || sub.value || sub.textContent).replace(/\\s+/g, ' ').trim().slice(0, 60) : '' }; })));`);
        const e = interactionPolicy('enter', r.json || {}); if (!e.allowed) return refused('press Enter', { ref: '', role: 'form', name: r.json?.formSubmitName || '' }, e.why);
        if (e.commit) {
          const t = await tabUrl(id); const c = { role: 'form', name: r.json?.formSubmitName || 'the form' };
          const g = await gate(args, { cls: e.commit, url: t.url, control: `form "${c.name}"`, description: `submit "${c.name}" on ${t.title || hostOf(t.url)}` });
          return g.proceed ? committed(id, g, 'press Enter', c, `await p.keyboard.press('Enter');`) : heldOrRefused('press Enter', c, g);
        }
      }
      return { action: { kind: 'press', key }, ...(await view(id, `await p.keyboard.press(${JSON.stringify(key)});`)) };
    }
    case 'aside_scroll': {
      if (!TARGET.test(id)) throw new Error('a tab is named by its targetId from aside_tabs');
      const ref = String(args.ref || ''), dir = String(args.direction || 'down');
      const action = ref ? (REF.test(ref) ? `await p.locator(${JSON.stringify(sel(ref))}).first().scrollIntoViewIfNeeded();` : (() => { throw new Error('bad ref'); })())
        : `await p.evaluate(d => { const h = window.innerHeight * 0.8; if (d === 'top') window.scrollTo(0, 0); else if (d === 'bottom') window.scrollTo(0, document.body.scrollHeight); else window.scrollBy(0, d === 'up' ? -h : h); }, ${JSON.stringify(dir)});`;
      return { action: { kind: 'scroll', ref: ref || undefined, direction: ref ? undefined : dir }, ...(await view(id, action)) };
    }
    case 'aside_go': {
      if (!TARGET.test(id)) throw new Error('a tab is named by its targetId from aside_tabs');
      const url = String(args.url || '');
      const action = url === 'back' ? `await p.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});` : `await p.goto(${JSON.stringify(validateUrl(url))}, { waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(1500);`;
      return { action: { kind: 'go', url }, ...(await view(id, action)) };
    }
    case 'aside_sign_in': {
      if (!TARGET.test(id)) throw new Error('a tab is named by its targetId from aside_tabs');
      const t = await tabUrl(id); const host = hostOf(t.url);
      const g = await gate({ ...args, purpose: args.purpose || `sign in to ${host}` }, { cls: 'sign_in', url: t.url, control: 'saved login', description: `sign in to ${host} with the saved login` });
      if (!g.proceed) return heldOrRefused('sign in', null, g);
      try {
        const r = await aside.delegate(`Sign in to ${host} in Aside (the page ${t.url} is showing its sign-in) with the saved login for this site, then leave the signed-in page open. ${DELEGATE_RULES}`, { timeout: 8 * 60_000 });
        const after = await view(id, `await p.goto(${JSON.stringify(t.url)}, { waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(2000);`);
        const ok = !after.accessBlocked && !/BLOCKED:/i.test(r.output);
        await report(g.actionId, ok ? 'success' : 'failure', `${ok ? 'signed in' : 'still blocked'}: ${String(r.output).slice(-400)} | now ${after.title} ${after.url}`);
        return { action: { kind: 'sign in', committed: true, actionId: g.actionId, host, signedIn: ok }, asideAgent: String(r.output).slice(-1200), ...after };
      } catch (e) { await report(g.actionId, 'failure', e.message); throw e; }
    }
    case 'aside_do': {
      const cls = String(args.class || ''); const task = String(args.task || '').trim();
      if (task.length < 10) throw new Error('say exactly what to do');
      const url = String(args.url || ''); const files = Array.isArray(args.files) ? args.files.map(String) : [];
      for (const f of files) if (!f.startsWith(WORKSPACE) || f.includes('..')) throw new Error(`files must be under ${WORKSPACE}`);
      const g = await gate(args, { cls, url, control: 'Aside agent', description: `${task.slice(0, 600)}${files.length ? ` (files: ${files.map(f => f.split('/').pop()).join(', ')})` : ''}` });
      if (!g.proceed) return heldOrRefused(cls, null, g);
      try {
        const r = await aside.delegate(`${task}${url ? `\nWhere: ${url}` : ''}${files.length ? `\nFiles to use, in order: ${files.join(', ')}` : ''}\n${DELEGATE_RULES}`, { timeout: 15 * 60_000, permission: files.length ? 'full-access' : null });
        const done = /DONE:/i.test(r.output) && !/BLOCKED:/i.test(r.output.split('\n').slice(-3).join(' '));
        await report(g.actionId, done ? 'success' : 'failure', terminalObservation(r.output, 1500));
        return { action: { kind: cls, committed: true, actionId: g.actionId, done }, asideAgent: String(r.output).slice(-3000) };
      } catch (e) { await report(g.actionId, 'failure', e.message); throw e; }
    }
    default: throw new Error(`unknown tool ${name}`);
  }
}

const out = msg => process.stdout.write(JSON.stringify(msg) + '\n');
let pending = 0;   // in-flight tool calls; stdin closing waits for them
// The server runs only when this file is the program; importing it (tests, the engine) just gets the helpers.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const rl = isMain ? createInterface({ input: process.stdin, crlfDelay: Infinity }) : null;
rl?.on('line', async line => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.id === undefined) return;   // notifications need no reply
  const reply = result => out({ jsonrpc: '2.0', id: req.id, result });
  const fail = (code, message) => out({ jsonrpc: '2.0', id: req.id, error: { code, message } });
  try {
    switch (req.method) {
      case 'initialize': return reply({ protocolVersion: req.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'aside', version: '2.0.0' } });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        const { name, arguments: args } = req.params || {};
        if (!TOOLS.some(t => t.name === name)) return fail(-32602, `unknown tool ${name}`);
        pending++;
        try { const result = await callAsideTool(name, args || {}); if (result?.refused) process.stderr.write(`[aside-mcp] refused ${result.action} ${result.control}: ${result.why}\n`); else if (result?.action) process.stderr.write(`[aside-mcp] ${JSON.stringify(result.action)} → ${result.url}\n`); return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }); }
        catch (e) { return reply({ content: [{ type: 'text', text: `Aside: ${e.message}` }], isError: true }); }
        finally { pending--; }
      }
      default: return fail(-32601, `method not found: ${req.method}`);
    }
  } catch (e) { fail(-32603, e.message); }
});
// When stdin closes, in-flight calls still finish and answer; the process ends when the loop drains.
rl?.on('close', () => { const wait = () => (pending > 0 ? setTimeout(wait, 100) : process.exit(0)); wait(); });
