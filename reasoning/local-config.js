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

// A pattern that matches nothing when no company is set, so an empty config never filters anything by accident.
export function companyPattern() {
  const words = process.env.OCA_COMPANY_WORDS || localConfig().companyWords || '';
  try { return words ? new RegExp(words, 'i') : /$^/; } catch { return /$^/; }
}
