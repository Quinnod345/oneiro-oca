#!/usr/bin/env node
// Blind-judge protocol, part 2: score a pack. A judge (a model by default; a person by passing --human and
// filling in verdicts) sees A and B without the key, scores each rubric item, and states a preference. The
// script then unblinds and reports how often the engine's account was preferred and on which criteria.
// Usage: node scripts/judge.mjs pack.json [--judge-provider codex|local] [--judge-model NAME]
import { readFile, writeFile } from 'node:fs/promises';
import llm from '../llm.js';

const [, , packPath, ...rest] = process.argv;
const opt = k => rest.includes(k) ? rest[rest.indexOf(k) + 1] : null;
if (!packPath) { console.error('usage: node scripts/judge.mjs pack.json'); process.exit(2); }
const pack = JSON.parse(await readFile(packPath, 'utf8'));
const provider = opt('--judge-provider') || process.env.OCA_JUDGE_PROVIDER || process.env.OCA_STRATEGY_PROVIDER || 'local';
const model = opt('--judge-model') || process.env.OCA_JUDGE_MODEL || process.env.OCA_STRATEGY_MODEL || process.env.ONEIRO_OCA_THINKER_MODEL || 'qwen-agent';
const schema = { type: 'object', additionalProperties: false, required: ['scores', 'preferred', 'why'],
  properties: { scores: { type: 'object', additionalProperties: false, required: ['A', 'B'], properties: {
      A: { type: 'array', items: { type: 'integer' } }, B: { type: 'array', items: { type: 'integer' } } } },
    preferred: { type: 'string', enum: ['A', 'B', 'neither'] }, why: { type: 'string' } } };

const verdicts = [];
for (const item of pack.items) {
  const prompt = `Two first-person accounts of reasoning about the same want. Score each account 0-2 on every rubric item, in order, then say which you prefer overall and why in one sentence.\n\nRUBRIC:\n${pack.rubric.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nWANT: ${item.want}\n\n=== ACCOUNT A ===\n${item.A}\n\n=== ACCOUNT B ===\n${item.B}`;
  const r = await llm.messages.create({ provider, model, system: 'You are a careful, skeptical judge of reasoning quality. Respond with JSON only.',
    messages: [{ role: 'user', content: prompt }], max_tokens: 500, temperature: 0 }, { priority: 10, responseSchema: schema });
  let v; try { v = JSON.parse(String(r.content?.[0]?.text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { v = { scores: { A: [], B: [] }, preferred: 'neither', why: 'unparseable verdict' }; }
  const key = pack._key[item.chain_id];
  const oca = key.A === 'oca' ? 'A' : 'B', plain = oca === 'A' ? 'B' : 'A';
  // Judges do not always respect the scale; scores are clamped to the rubric's 0-2 and the raw verdict is kept.
  const clampScores = xs => (xs || []).slice(0, pack.rubric.length).map(x => Math.max(0, Math.min(2, Number(x) || 0)));
  verdicts.push({ chain_id: item.chain_id, preferred: v.preferred === 'neither' ? 'neither' : key[v.preferred], why: v.why,
    oca_scores: clampScores(v.scores[oca]), plain_scores: clampScores(v.scores[plain]), raw: v.scores });
  console.error(`judged want #${item.chain_id}: preferred ${verdicts.at(-1).preferred}`);
}
const n = verdicts.length, ocaWins = verdicts.filter(v => v.preferred === 'oca').length, plainWins = verdicts.filter(v => v.preferred === 'plain').length;
const mean = key => pack.rubric.map((_, i) => { const xs = verdicts.map(v => v[key][i]).filter(Number.isFinite); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; });
const report = { judged_at: new Date().toISOString(), judge: `${provider}:${model}`, n, preferred: { oca: ocaWins, plain: plainWins, neither: n - ocaWins - plainWins },
  rubric_means: pack.rubric.map((r, i) => ({ criterion: r, oca: mean('oca_scores')[i], plain: mean('plain_scores')[i] })), verdicts };
const outPath = packPath.replace(/\.json$/, '') + '.verdict.json';
await writeFile(outPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(`n=${n}  preferred: engine ${ocaWins}, plain ${plainWins}, neither ${n - ocaWins - plainWins}`);
for (const r of report.rubric_means) console.log(`  ${r.criterion.slice(0, 70).padEnd(72)} engine ${r.oca?.toFixed(2) ?? '-'}  plain ${r.plain?.toFixed(2) ?? '-'}`);
console.log(outPath);
const { pool } = await import('../event-bus.js'); await pool.end().catch(() => {});
