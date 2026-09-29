#!/usr/bin/env node
// Sends one test payment approval to your phone and reports what the gateway recorded when you answer it. Nothing is
// bought and no ask or agent is involved: it's the same notification a real payment raises, so you can check that
// pressing and holding it shows Approve and Deny, and that your tap comes back as made on your phone.
//
//   node scripts/test-payment-approval.mjs
//
// It trusts the same devices the engine does: OCA_OWNER_PUSH_NODE plus OCA_PAYMENT_APPROVER_DEVICES, read from the
// engine's LaunchAgent when they aren't in the environment.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { createGateway } from '../gateway.js';
import { createPaymentApprovals, APPROVE } from '../reasoning/payment-approvals.js';

function launchAgentEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :EnvironmentVariables:${name}`, `${homedir()}/Library/LaunchAgents/com.oneiro.oca.plist`], { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

const deciders = [launchAgentEnv('OCA_OWNER_PUSH_NODE'), ...launchAgentEnv('OCA_PAYMENT_APPROVER_DEVICES').split(',')].map(s => s.trim()).filter(Boolean);
const gateway = createGateway();
const approvals = createPaymentApprovals({ pool: null, gateway, deciders, log: { log() {}, warn: (...a) => console.warn(...a) } });

const opened = await approvals.request({
  title: 'Test: approve $0.01?',
  description: 'This is a test from Oneiro. Nothing will be bought. Press and hold, then tap Approve or Deny. Are you sure you want to go through with this?',
  detail: 'A test of payment approvals, started from scripts/test-payment-approval.mjs.',
});
if (!opened) { console.error('The gateway could not deliver the approval to a phone. Check that the phone is paired and has notifications on.'); process.exit(1); }
console.log(`Sent (${opened.route || 'delivered'}). Answer it on your phone within 10 minutes…`);

const until = opened.expiresAt + 60_000;
while (Date.now() < until) {
  await new Promise(r => setTimeout(r, 3000));
  let snap;
  try { snap = (await gateway.call('approval.get', { id: opened.id }, { timeout: 20_000 }))?.approval; }
  catch (e) { console.error(`Couldn't read the approval: ${e.message}`); process.exit(1); }
  if (!snap || snap.status === 'pending') continue;
  const who = snap.resolver ? `${snap.resolver.kind} ${String(snap.resolver.id || '').slice(0, 12)}` : 'an unknown client';
  const trusted = snap.resolver?.kind === 'device' && deciders.includes(String(snap.resolver.id));
  if (!snap.decision) { console.log(`It closed without an answer (${snap.status}).`); process.exit(1); }
  console.log(`${snap.decision === APPROVE ? 'Approved' : 'Denied'} by ${who}: ${trusted ? 'your phone, so the engine would act on it.' : 'NOT one of your trusted phones, so the engine would ignore it.'}`);
  process.exit(trusted ? 0 : 2);
}
console.log('No answer within the window; the notification has been taken off the phone.');
process.exit(1);
