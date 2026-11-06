import { imessageHost, ownerImessage } from '../reasoning/local-config.js';
// The iMessage line to Quinn, with no OpenClaw in between. Oneiro texts him from Messages on the work Mac (signed in as
// his gmail account), driven over SSH with the `imsg` command there, so his phone sees a real conversation with Oneiro.
// His replies are read back from that Mac's Messages database: a message counts as his only when Messages recorded it
// as received (not sent) from his own handle, which nothing on this Mac can fake.
//
// Never from this Mac's own Messages: it is signed into his iCloud account, so a text from here lands in his own thread
// (Quinn, 2026-10-01). Never to anyone but him.
import { execFile } from 'node:child_process';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const WORK_HOST = imessageHost();
export const IMSG = process.env.OCA_IMSG_BIN || '/opt/homebrew/bin/imsg';

// Quote one argument for the remote shell.
export const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function sshRunner({ host = WORK_HOST, connectTimeout = 10, exec = execFile } = {}) {
  return (args, { timeoutMs = 30_000 } = {}) => new Promise((resolve, reject) => {
    const remote = [IMSG, ...args].map(shq).join(' ');
    exec('ssh', ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${connectTimeout}`, '-T', host, remote], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => err ? reject(new Error(`imsg ${args[0]}: ${text(stderr || err.message, 240)}`)) : resolve(String(stdout)));
  });
}

const jsonLines = out => String(out).split('\n').map(l => l.trim()).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

export function createImessage({ owner = ownerImessage(), run = sshRunner(), log = console } = {}) {
  let chatId = null;

  // The one conversation with Quinn: a direct chat whose only participant is his handle.
  async function chat() {
    if (chatId) return chatId;
    if (!owner) throw new Error('OCA_OWNER_IMESSAGE is not set');
    const chats = jsonLines(await run(['chats', '--limit', '200', '--json']));
    const c = chats.find(x => !x.is_group && Array.isArray(x.participants) && x.participants.length === 1 && x.participants[0] === owner);
    if (!c) throw new Error(`no Messages conversation with ${owner} on the work Mac`);
    chatId = c.id;
    return chatId;
  }

  async function send(message) {
    if (!owner) throw new Error('OCA_OWNER_IMESSAGE is not set');
    const out = await run(['send', '--to', owner, '--text', String(message).slice(0, 4000), '--service', 'imessage', '--json'], { timeoutMs: 45_000 });
    if (/"ok"\s*:\s*false|"error"/i.test(out) && !/"ok"\s*:\s*true/i.test(out)) throw new Error(`imsg send: ${text(out, 160)}`);
    return true;
  }

  // Messages Quinn sent in that conversation after a message id (newest last). Only received messages from his handle.
  async function since(afterId = 0, { limit = 50 } = {}) {
    const id = await chat();
    const msgs = jsonLines(await run(['history', '--chat-id', String(id), '--limit', String(limit), '--json']));
    return msgs.filter(m => !m.is_from_me && m.sender === owner && Number(m.id) > Number(afterId) && String(m.text || '').trim())
      .map(m => ({ id: Number(m.id), guid: m.guid, text: String(m.text), at: Date.parse(m.created_at) || null, sender: m.sender }))
      .sort((a, b) => a.id - b.id);
  }

  // The newest message id in the conversation, from either side: where a fresh reader starts.
  async function latestId() {
    const id = await chat();
    const msgs = jsonLines(await run(['history', '--chat-id', String(id), '--limit', '1', '--json']));
    return Number(msgs[0]?.id) || 0;
  }

  // The line works when the work Mac answers and Messages there can be read.
  async function ping() { try { await chat(); return true; } catch (e) { log.warn?.('[imessage] line check:', text(e.message, 160)); chatId = null; return false; } }

  return { send, since, latestId, ping, chat, owner };
}
