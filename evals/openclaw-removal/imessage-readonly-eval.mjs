#!/usr/bin/env node
// Live, read-only: the iMessage line to the work Mac works without OpenClaw. Sends nothing.
//   OCA_OWNER_IMESSAGE=you@example.com node evals/openclaw-removal/imessage-readonly-eval.mjs
import { createImessage } from '../../channels/imessage.js';
const line = createImessage({ owner: process.env.OCA_OWNER_IMESSAGE });
const t0 = Date.now();
const r = { line: await line.ping() };
r.chatId = r.line ? await line.chat() : null;
r.latestMessageId = r.line ? await line.latestId() : null;
r.repliesReadableSince = r.line ? (await line.since(Math.max(0, r.latestMessageId - 200))).length : null;
r.ms = Date.now() - t0;
console.log(JSON.stringify(r));
