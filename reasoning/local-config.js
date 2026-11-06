// What's particular to one person's machine: who to text, which host carries iMessage, and which company's data stays out
// of the notes. It lives in ~/.config/oneiro/local.json, outside the repo, because this repo is public. The installer
// (scripts/install-engine.sh) writes it. An env var always wins, so a test or a one-off run can say otherwise.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let cached;
export function localConfig({ path = process.env.OCA_LOCAL_CONFIG || join(homedir(), '.config', 'oneiro', 'local.json'), fresh = false } = {}) {
  if (cached && !fresh && !process.env.OCA_LOCAL_CONFIG) return cached;
  let read = {};
  try { read = JSON.parse(readFileSync(path, 'utf8')); } catch { /* no file yet: the setting reads as unset, and whatever needs it says so */ }
  if (!process.env.OCA_LOCAL_CONFIG) cached = read;
  return read;
}
// Where agents and pursuit output work on this Mac: under the home folder, so a clone runs on any Mac and under any name.
export const workspaceDir = (...parts) => join(process.env.ONEIRO_WORKSPACE || join(homedir(), 'oneiro', 'runtime', 'workspace'), ...parts);
export const imessageHost = () => process.env.OCA_IMESSAGE_HOST || localConfig().imessageHost || null;
export const ownerImessage = () => process.env.OCA_OWNER_IMESSAGE || localConfig().ownerImessage || null;
// Who the agents work for. The engine's prompts were written for one person, so this is applied where text leaves for an
// agent or a model, and only the name changes.
export const ownerName = () => process.env.OCA_OWNER_NAME || localConfig().ownerName || 'the person';
export const forOwner = s => { const name = ownerName(); return name === 'Quinn' ? s : String(s ?? '').replace(/\bQuinn\b/g, name); };
// The engine's standing pursuit about its own code. Off unless this Mac's owner asked for it.
export const standingSelf = () => localConfig().standingSelf === true;

// A pattern that matches nothing when no company is set, so an empty config never filters anything by accident.
export function companyPattern() {
  const words = process.env.OCA_COMPANY_WORDS || localConfig().companyWords || '';
  try { return words ? new RegExp(words, 'i') : /$^/; } catch { return /$^/; }
}
