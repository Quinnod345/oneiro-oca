#!/usr/bin/env node
// Texts you one test payment approval and reports what comes back. Nothing is bought and no ask or agent is involved:
// it's the same text a real payment sends, with a one-time code, so you can check that the line to your phone works
// both ways and that "APPROVE <code>" / "DENY <code>" from your phone is read as yours.
//
//   OCA_OWNER_IMESSAGE=you@icloud.com node scripts/test-payment-approval.mjs
//
// It uses the same line the engine does: Messages on the work Mac over SSH (OCA_IMESSAGE_HOST), read back from that
// Mac's Messages database.
import { createImessage } from '../channels/imessage.js';
import { newCode, parseDecision, approvalLine, APPROVAL_WINDOW_MS } from '../reasoning/payment-approvals.js';

const owner = process.env.OCA_OWNER_IMESSAGE;
if (!owner) { console.error('Set OCA_OWNER_IMESSAGE to your iMessage handle.'); process.exit(2); }
const line = createImessage({ owner });
if (!(await line.ping())) { console.error('The work Mac\'s Messages could not be reached over SSH; the line is down.'); process.exit(1); }

const code = newCode();
const start = await line.latestId();
await line.send(`Oneiro test: this is a test payment approval; nothing will be bought.\n${approvalLine(code)}`);
console.log(`Sent. Reply from your phone with APPROVE ${code} or DENY ${code} within 10 minutes…`);

const until = Date.now() + APPROVAL_WINDOW_MS;
while (Date.now() < until) {
  for (const m of await line.since(start)) {
    const d = parseDecision(m.text);
    if (d?.code === code) {
      console.log(`${d.approved ? 'Approved' : 'Denied'} from ${m.sender} at ${new Date(m.at).toLocaleTimeString()}: the line works both ways.`);
      await line.send(`Oneiro test: got your ${d.approved ? 'APPROVE' : 'DENY'}. Nothing was bought.`).catch(() => {});
      process.exit(0);
    }
    console.log(`Read "${m.text.slice(0, 60)}" from ${m.sender}: not this test's code, ignored.`);
  }
  await new Promise(r => setTimeout(r, 5000));
}
console.log('No answer within 10 minutes; the code has expired.');
process.exit(1);
