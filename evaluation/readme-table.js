// The README's Measured section is written by the benchmark, never by hand: a scorecard typed into a README
// keeps claiming what one run showed long after the engine has changed. `npm run benchmark` renders the last
// run's results between two markers in README.md, dated, so the README can say no more than the last run did.
export const START = '<!-- measured:start (written by npm run benchmark; do not edit by hand) -->';
export const END = '<!-- measured:end -->';

const MIN = 10;   // evaluation/operations.js MIN_RUNS
const fmt = v => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(3));
const words = s => String(s || '').replace(/_/g, ' ');

// The markdown block for one benchmark report (the object scripts/benchmark.mjs writes to latest.json).
export function renderMeasured(report) {
  const day = String(report?.ran_at || '').slice(0, 10) || 'unknown date';
  const lines = [START, ''];
  const t = report?.mechanism;
  lines.push(t ? `**Last run: ${day}.** Mechanism suite: ${t.pass}/${t.tests} passing${t.fail ? `, **${t.fail} failing**` : ''}.` : `**Last run: ${day}.** Mechanism suite not run.`);
  const card = report?.scorecard;
  if (!card || card.error) {
    lines.push('', `Scorecard unavailable: ${card?.error || 'no scorecard in the report'}.`);
  } else {
    lines.push('', '| dimension | score | n | status |', '|---|---|---|---|');
    for (const [name, c] of Object.entries(card.components || {})) lines.push(`| ${name} | ${fmt(c.score)} | ${c.n ?? '—'} | ${words(c.status)} |`);
    const pct = card.evidence_coverage == null ? '—' : `${Math.round(card.evidence_coverage * 100)}%`;
    lines.push('', `Evidence coverage ${pct}. Composite: ${card.composite == null ? 'none yet — it stays empty until every dimension is measured' : fmt(card.composite)}.`);
    const p = card.components?.prediction?.diagnostics?.all;
    if (p && Number.isFinite(p.brier) && Number.isFinite(p.base_rate_brier)) {
      lines.push(`Prediction: Brier ${p.brier.toFixed(3)} against ${p.base_rate_brier.toFixed(3)} for always guessing each metric's base rate, over ${p.n} predictions (skill ${fmt(p.skill)}).`);
    }
  }
  const o = report?.operations;
  if (o && !o.error && o.thisWeek) {
    const pct = r => (r == null ? '—' : `${Math.round(r * 100)}%`);
    const row = (label, a, b) => `| ${label} | ${a} | ${b} |`;
    const t = o.thisWeek, l = o.lastWeek;
    lines.push('', '**Operations**, the orchestrator\'s work over the last 7 days against the 7 before, from the runtime journals:', '',
      '| | last 7 days | the 7 before |', '|---|---|---|',
      row('agent runs the engine answers for', t.counted, l.counted),
      row('went wrong (failed, or repeated a recent failure)', `${t.wentWrong} (${pct(t.rates.wentWrong)})`, `${l.wentWrong} (${pct(l.rates.wentWrong)})`),
      row('stalled (turn budget or timeout)', t.stalled, l.stalled),
      row('productive (something the engine confirmed)', `${t.productive} (${pct(t.rates.productive)})`, `${l.productive} (${pct(l.rates.productive)})`),
      row('stopped by the model provider (not counted)', t.providerStopped, l.providerStopped),
      row('its own fixes merged', o.fixes.merged, o.fixesBefore?.merged ?? '—'),
      row('verdicts from the person (useful or better)', `${o.verdicts.rated} (${o.verdicts.useful})`, `${o.verdictsBefore?.rated ?? '—'} (${o.verdictsBefore?.useful ?? '—'})`),
      '', `Fixes merged at least a day ago: ${o.fixes.holding} of ${o.fixes.matured} holding, ${o.fixes.recurred} recurred. Rates need ${MIN} runs in a week to be compared. Self-improvement criterion: ${o.selfCriterion.why}.`);
  }
  lines.push('', END);
  return lines.join('\n');
}

// README text with the block between the markers replaced. Without both markers the text comes back unchanged
// and `replaced` is false: the benchmark never guesses where a table belongs.
export function updateReadme(text, block) {
  const a = text.indexOf(START), b = text.indexOf(END);
  if (a < 0 || b < a) return { text, replaced: false };
  return { text: text.slice(0, a) + block + text.slice(b + END.length), replaced: true };
}
