// What Quinn texts back to Oneiro, routed without a model in the middle. Before 2026-11 an OpenClaw agent read his
// Messages and decided what each reply meant; now the engine reads the conversation itself (channels/imessage.js) and
// routes each message by rule:
//   1. "APPROVE <code>" / "DENY <code>" decides that one payment (payment-approvals.js), and nothing else does.
//   2. A reply to an open ask answers it and goes to the agent waiting on it. "#12" in the text picks ask 12 or
//      pursuit 12; otherwise the newest ask that was texted to him is the one he is answering.
//   3. "status" (or a reply when no ask is open) gets the active pursuits back in two lines.
// He hears a one-line receipt for every message, so a reply never vanishes. Only his own received messages are read,
// and only he is ever texted.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseDecision, approvalLine } from './payment-approvals.js';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const STATUS = /^\s*(status|what('s| is) (it|oneiro) (working on|doing)|what are you (working on|doing))\??\s*$/i;

export function pickAsk(open, message) {
  const candidates = open.filter(a => a.kind !== 'notice');
  if (!candidates.length) return null;
  const tag = String(message).match(/#(\d+)/);
  if (tag) {
    const n = Number(tag[1]);
    return candidates.find(a => a.id === n) || candidates.find(a => a.chainId === n) || null;
  }
  const texted = candidates.filter(a => (a.delivered || []).includes('imessage'));
  return (texted.length ? texted : candidates).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
}

export function createImessageInbox({ imessage, asks, inbox, payments, wants = async () => [], statePath, ready = () => true, clock = Date.now, log = console, tickMs = 20_000 } = {}) {
  let state = null, timer = null, ticking = false;

  async function load() {
    if (state) return state;
    try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch { state = {}; }
    if (!Number.isFinite(state.lastId)) {
      // A fresh reader starts at the newest message: what he sent before the engine read Messages was for the old reader.
      state.lastId = await imessage.latestId();
      await save();
    }
    return state;
  }
  async function save() { await mkdir(dirname(statePath), { recursive: true }); await writeFile(statePath, JSON.stringify(state)); }
  const reply = m => imessage.send(m).catch(e => log.warn?.('[imessage] receipt not sent:', text(e.message, 160)));

  async function statusLine() {
    const ws = await wants().catch(() => []);
    if (!ws.length) return 'Oneiro has no open pursuits right now.';
    return `Working on: ${ws.slice(0, 4).map(w => `#${w.id} ${text(w.description || w.seed, 60)}`).join('; ')}.`;
  }

  async function handle(m) {
    const decision = parseDecision(m.text);
    if (decision) {
      const r = await payments.decide({ ...decision, from: m.sender, via: 'Messages', at: m.at || clock() });
      return reply(r.ok ? (r.approved ? `Approved. Oneiro will make that payment (ask #${r.askId}).` : `Denied. That payment won't be made (ask #${r.askId}).`) : `Not done: ${r.why}.`);
    }
    if (STATUS.test(m.text)) return reply(await statusLine());
    const open = await asks.open().catch(() => []);
    const target = pickAsk(open, m.text);
    if (!target) return reply(`Noted, but nothing is waiting on you right now. ${await statusLine()} Text "status" anytime.`);
    if (target.payment) {
      // A payment takes its code, never a plain yes.
      const live = target.approval && !target.approval.settled;
      return reply(live ? `That's a payment (ask #${target.id}): reply with the APPROVE or DENY code from its text.` : `That payment (ask #${target.id}) has closed; Oneiro will ask again if it still needs it.`);
    }
    await inbox.answerAsk({ id: target.id, reply: text(m.text, 500), via: 'Messages' });
    return reply(`Got it — passed to ${target.chainId ? `#${target.chainId}` : 'the engine'} (ask #${target.id}).`);
  }

  async function tick() {
    if (ticking || !ready()) return; ticking = true;
    try {
      const s = await load();
      const msgs = await imessage.since(s.lastId);
      for (const m of msgs) {
        try { await handle(m); } catch (e) { log.warn?.(`[imessage] message ${m.id}:`, text(e.message, 200)); }
        s.lastId = Math.max(s.lastId, m.id);
        await save();
      }
    } catch (e) { log.warn?.('[imessage] read:', text(e.message, 200)); }
    finally { ticking = false; }
  }

  function start() { if (!timer) { timer = setInterval(() => { tick(); }, tickMs); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { tick, handle, start, stop, approvalLine };
}
