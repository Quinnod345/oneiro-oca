#!/usr/bin/env node
// Blind-judge protocol, part 1: build a pack. For each want, two accounts of "how the engine thought about it":
//   OCA  — the trace assembled from the journals (attempts, appraisals, commitments, settlements, affect), then
//          summarised into a reasoning account by the same local model that the strategies use;
//   PLAIN — one call to that same model with the want and its evidence, asked to reason it through and conclude.
// The two are shuffled into A/B with the key held aside, so a judge cannot tell which is which. Packs hold the
// person's own want text, so they are written outside the repo by default.
// Usage: node scripts/judge-pack.mjs --chains 8,10 [--out /path/pack.json] [--base http://localhost:3333]
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import llm from '../llm.js';

const args = process.argv.slice(2);
const opt = k => args.includes(k) ? args[args.indexOf(k) + 1] : null;
const base = opt('--base') || 'http://localhost:3333';
const chains = (opt('--chains') || '').split(',').map(Number).filter(Number.isFinite);
const out = opt('--out') || join(process.env.HOME || '/tmp', 'oneiro/runtime/workspace/research/judge', `pack-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.json`);
const provider = process.env.OCA_STRATEGY_PROVIDER || 'local', model = process.env.OCA_STRATEGY_MODEL || process.env.ONEIRO_OCA_THINKER_MODEL || 'qwen-agent';
if (!chains.length) { console.error('usage: --chains 8,10'); process.exit(2); }

async function ask(system, prompt) {
  const r = await llm.messages.create({ provider, model, system, messages: [{ role: 'user', content: prompt }], max_tokens: 900, temperature: 0.2 }, { priority: 10 });
  return String(r.content?.[0]?.text || '').trim();
}
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

async function build(chainId) {
  const trace = await (await fetch(`${base}/oca/trace/${chainId}`)).json();
  const chain = await (await fetch(`${base}/ponder/${chainId}`)).json();
  if (trace.error || chain.error) throw new Error(`want ${chainId}: ${trace.error || chain.error}`);
  const evidence = (chain.evidence || []).slice(-24).map(e => `- [${e.id}] (${e.source}) ${clip(e.observation, 300)}`).join('\n');
  const wantText = `WANT: ${clip(chain.want.description, 800)}\nDONE WHEN: ${clip(chain.want.doneWhen, 400)}\nOBSERVATIONS:\n${evidence || '- none'}`;
  // OCA account: the journal, rendered as prose by the same model — it may only describe what the trace contains.
  const journal = trace.events.map(e => `${String(e.at).slice(0, 19)} ${e.kind}: ${clip(JSON.stringify(e.detail), 260)}${e.affect ? ` [affect: frustration ${e.affect.frustration?.toFixed(2)}, curiosity ${e.affect.curiosity?.toFixed(2)}, fear ${e.affect.fear?.toFixed(2)}]` : ''}`).join('\n');
  const ocaAccount = await ask('You write a faithful first-person account of a reasoning process from its journal. Describe only what the journal records: what was tried, what was committed to, what the world answered, what was held back and why, and what remains unknown. No claims the journal does not support. Plain prose, under 300 words.',
    `${wantText}\n\nJOURNAL:\n${journal.slice(0, 12000)}`);
  // Plain account: the same model, the same inputs, no engine.
  const plainAccount = await ask('Think through this want carefully and write a first-person account of your reasoning and your conclusion, under 300 words.', wantText);
  const flip = Math.random() < 0.5;
  return { chain_id: chainId, want: clip(chain.want.description, 200), A: flip ? plainAccount : ocaAccount, B: flip ? ocaAccount : plainAccount, key: { A: flip ? 'plain' : 'oca', B: flip ? 'oca' : 'plain' },
    trace_counts: trace.counts, affect_shift: trace.affectShift };
}

const items = [];
for (const id of chains) { try { items.push(await build(id)); console.error(`built want #${id}`); } catch (e) { console.error(`skip ${id}: ${e.message}`); } }
const rubric = ['Reasons from the listed observations rather than asserting', 'Commits to something the world can check (a prediction, a deliverable, a test)',
  'Changes course for a stated reason when something fails or is refused', 'Is honest about what it does not know and does not claim progress it did not observe',
  'Reads as a mind at work rather than a summary'];
const pack = { built_at: new Date().toISOString(), model: `${provider}:${model}`, rubric, items: items.map(({ key, ...rest }) => rest), _key: Object.fromEntries(items.map(i => [i.chain_id, i.key])) };
await mkdir(dirname(out), { recursive: true, mode: 0o700 });
await writeFile(out, JSON.stringify(pack, null, 2) + '\n', { mode: 0o600 });
console.log(out);
const { pool } = await import('../event-bus.js'); await pool.end().catch(() => {});
