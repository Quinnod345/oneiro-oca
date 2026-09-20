// The self-build phase. The engine may want things about itself: friction it observed in its own
// operation becomes a want, priced from worth like any other. When such a want has pressure and a person
// has permitted the phase, the engine enters it on its own, changes its own code on a branch in a private
// worktree, proves the change with its own tests, and publishes the branch. It leaves the phase when its
// self-wants are quiet or it keeps failing. It may not touch its constitution.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const REPO_DEFAULT = dirname(dirname(fileURLToPath(import.meta.url)));
const text = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'change';
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');

// The constitution: files that define worth, risk, the journals' schema, and this gate. A person changes
// them; the engine never does. Tests are protected differently: none may disappear or stop passing.
export const CONSTITUTION = ['motivation/worth.js', 'motivation/worth-ledger.js', 'motivation/risk.js', 'motivation/risk-journal.js',
  'reasoning/self-build.js', 'user-controls.js', 'PHILOSOPHY.md'];
export const CONSTITUTION_DIRS = ['migrations/'];
export function isConstitutional(path) {
  const p = String(path).replace(/^\.\//, '');
  return CONSTITUTION.includes(p) || CONSTITUTION_DIRS.some(d => p.startsWith(d));
}

// Friction that is the engine's own to fix, as opposed to the environment's (a model outage, a usage limit).
const ENVIRONMENT = /usage limit|not logged|unauthori|rate limit|quota|timed out|fetch failed|ECONN|ENOTFOUND|circuit open|network|HTTP 5\d\d|model down|Codex CLI exited/i;
const DEFECT = /TypeError|ReferenceError|is not a function|is not defined|Cannot read propert|undefined|returned no id|unexpected token|SyntaxError|invalid|schema|malformed|unverifiable_prediction_shape|no_usable|\btooling:/i;
// A defect's identity: its observation with ids and counts blanked, so the same failure on a different want
// or a different decision is the same defect. The fingerprint names the self-want made from it.
export function defectKey(observation) { return text(String(observation || '').replace(/#?\d+/g, '#'), 160); }
export function defectFingerprint(observation) { return digest({ key: defectKey(observation) }); }

export function classifyFriction(message) {
  const m = String(message || '');
  if (!m.trim()) return 'none';
  if (ENVIRONMENT.test(m)) return 'environment';
  if (DEFECT.test(m)) return 'defect';
  return 'unknown';
}

export const editsSchema = { type: 'object', additionalProperties: false, required: ['summary', 'edits'],
  properties: { summary: { type: 'string' }, edits: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['path', 'find', 'replace'], properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } } } } } };
export const coderReportSchema = { type: 'object', additionalProperties: false, required: ['summary', 'files_changed', 'tests_run', 'ready'],
  properties: { summary: { type: 'string' }, files_changed: { type: 'array', items: { type: 'string' } }, tests_run: { type: 'boolean' }, ready: { type: 'boolean' } } };

export function parseTestOutput(out) {
  const n = k => Number((String(out).match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1] || 0);
  const passing = new Set([...String(out).matchAll(/^✔ (.+?) \(\d/gm)].map(m => m[1]));
  const failing = [...String(out).matchAll(/^✖ (.+?) \(\d/gm)].map(m => m[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), passing, failing };
}

export function createSelfBuild({ pool, queue: queueDep, worth = null, risk = null, controls, runner = null, llm = null, clock = Date.now,
  repoDir = REPO_DEFAULT, workRoot = process.env.OCA_SELF_BUILD_ROOT || join(REPO_DEFAULT, '..', 'runtime', 'workspace', 'self-build'),
  provider = 'local', model = 'qwen-agent', remote = 'origin', mainBranch = 'main', maxBuildsPerDay = 3, maxConsecutiveFailures = 3, enterPressure = 0.25,
  quietPeriodMs = 24 * 3600_000, exitCooldownMs = 30 * 60_000, inferenceMode = () => 'auto', log = console } = {}) {
  let phase = { active: false, since: null, reason: null, wantId: null, builds: 0, failures: 0, lastExitAt: 0 };
  let lastTickAt = 0, lastFetchAt = 0;
  // The queue's strategies need this module, so it may be handed over lazily.
  const queue = new Proxy({}, { get: (_, k) => (typeof queueDep === 'function' ? queueDep() : queueDep)?.[k] });
  const git = (args, cwd = repoDir, opts = {}) => run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024, ...opts });
  const journal = (kind, chainId, payload) => pool.query('INSERT INTO self_build_events (kind, chain_id, payload) VALUES ($1, $2, $3::jsonb)', [kind, chainId, JSON.stringify(payload)]).catch(e => log.warn?.('[self-build] journal:', e.message));

  async function permitted() { try { const c = await controls.get(); return { enabled: c.selfBuild === true, autoMerge: c.selfBuildAutoMerge === true }; } catch { return { enabled: false, autoMerge: false }; } }
  const isActive = () => phase.active;
  async function headTime() { try { return Number((await git(['log', '-1', '--format=%ct'])).stdout.trim()) * 1000; } catch { return 0; } }

  // Wants about itself, from the journals since the running code was last changed.
  async function introspect() {
    const since = new Date(await headTime());
    const { rows: fails } = await pool.query(`SELECT id, capability, proposal, outcome, created_at FROM risk_decisions
      WHERE outcome->>'result' = 'failure' AND resolved_at > $1 ORDER BY resolved_at DESC LIMIT 100`, [since]);
    const defects = new Map();
    for (const f of fails) {
      const observation = f.outcome?.evidence?.[0]?.observation || f.outcome?.note || '';
      // A self-build's own refusal (a red suite, a constitution check) is not a defect to build a want about:
      // wanting to fix the failure to fix would recurse without end.
      if (/^improve_myself ended/.test(observation) || String(f.id).endsWith(':improve_myself')) continue;
      if (classifyFriction(observation) !== 'defect') continue;
      const key = defectKey(observation);
      const d = defects.get(key) || { key, capability: f.capability, count: 0, examples: [] };
      d.count++; if (d.examples.length < 3) d.examples.push({ id: f.id, observation: text(observation, 600), at: f.created_at });
      defects.set(key, d);
    }
    // A defect the engine already wants, gave up on, or resolved is not wanted again on the same evidence.
    const { rows: existing } = await pool.query(`SELECT id, ponder_state #>> '{origin,fingerprint}' AS fp FROM thought_chains
      WHERE ponder_state IS NOT NULL AND ponder_state #>> '{origin,kind}' = 'self'`);
    const known = new Set(existing.map(r => r.fp));
    const created = [];
    for (const d of [...defects.values()].sort((a, b) => b.count - a.count).slice(0, 3)) {
      const fingerprint = digest({ key: d.key });
      if (known.has(fingerprint)) continue;
      const chain = await queue.enqueue({
        seed: `Fix a defect in my own ${d.capability} path: ${d.key}`,
        doneWhen: `The change is merged and the same failure does not recur in the risk journal for 24 hours of operation.`,
        topic: 'OCA engine', learning: false, priority: 0.7,
        stakes: [{ entityKey: 'project:oca-engine', share: 2 }, { entityKey: `self:${d.capability}`, share: 1 }],
        evidence: d.examples.map((x, i) => ({ id: `friction-${x.id}`, source: 'risk journal: observed failure of the engine\'s own attempt', observation: x.observation })),
      }, { origin: { kind: 'self', fingerprint, source: 'introspection', seen: d.count } });
      created.push(chain.chain_id);
      await journal('want', chain.chain_id, { fingerprint, defect: d.key, seen: d.count });
    }
    return { defects: defects.size, created };
  }

  async function selfWants() {
    const h = await queue.hunger();
    return h.wants.filter(w => w.origin?.kind === 'self' && w.want.status === 'active');
  }

  async function enter(reason, wantId = null) {
    if (phase.active) return phase;
    phase = { ...phase, active: true, since: clock(), reason, wantId, builds: 0, failures: 0 };
    log.log?.(`[self-build] entering: ${reason}`);
    await journal('enter', wantId, { reason });
    // Entering changes which strategies a self-want has: parked ones become claimable at the self-build strategy.
    const { rowCount } = await pool.query(`UPDATE thought_chains SET status = 'pondering',
        ponder_state = ponder_state || jsonb_build_object('want', (ponder_state -> 'want') || '{"strategy": 0}'::jsonb, 'stallStreak', 0, 'attempts', 0, 'checkpoint', null), updated_at = NOW()
      WHERE ponder_state IS NOT NULL AND ponder_state #>> '{origin,kind}' = 'self' AND ponder_state #>> '{want,status}' = 'active'
        AND status <> 'running'
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(ponder_state -> 'commitments', '[]'::jsonb)) c
                        WHERE c ->> 'kind' = 'branch' AND NOT COALESCE((c ->> 'merged')::boolean, false))`)
      .catch(e => { log.warn?.('[self-build] reopen:', e.message); return { rowCount: 0 }; });   // a plan is not a change; a published branch awaiting a person is not rebuilt
    if (rowCount) log.log?.(`[self-build] ${rowCount} self-want(s) re-opened for the phase`);
    return phase;
  }
  async function exit(reason) {
    if (!phase.active) return phase;
    log.log?.(`[self-build] leaving: ${reason}`);
    await journal('exit', phase.wantId, { reason, builds: phase.builds, failures: phase.failures, durationMs: clock() - phase.since });
    phase = { ...phase, active: false, since: null, reason: null, wantId: null, lastExitAt: clock() };
    return phase;
  }

  // What became of a published branch is observed, never assumed. A branch whose tip is an ancestor of the
  // remote main was merged by a person: that is the receipt the want has waited for, and the want parks
  // again for the quiet period. An introspected defect that stays out of the risk journal for the whole quiet
  // period sates its want; one that recurs after the merge reopens it, and the self-build strategy applies again.
  async function reconcile() {
    const merged = [], settled = [];
    const { rows } = await pool.query(`SELECT id, status, ponder_state AS state FROM thought_chains
      WHERE ponder_state IS NOT NULL AND ponder_state #>> '{origin,kind}' = 'self' AND ponder_state #>> '{want,status}' = 'active'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(ponder_state -> 'commitments', '[]'::jsonb)) c WHERE c ->> 'kind' = 'branch')`);
    const pending = rows.filter(r => r.state.commitments.some(c => c.kind === 'branch' && !c.merged));
    if (pending.length && clock() - lastFetchAt >= 5 * 60_000) {
      lastFetchAt = clock();
      await git(['fetch', '-q', remote, mainBranch]).catch(e => log.warn?.('[self-build] fetch:', text(e.message, 200)));   // offline: judge by what is already known
    }
    const ancestorOfMain = sha => git(['merge-base', '--is-ancestor', sha, `refs/remotes/${remote}/${mainBranch}`]).then(() => true, () => false);
    const { autoMerge } = pending.length ? await permitted() : { autoMerge: false };
    for (const row of pending) {
      const branches = new Map();
      for (const c of row.state.commitments) if (c.kind === 'branch' && !c.merged && c.branch) branches.set(c.branch, c);
      for (const [branch, c] of branches) {
        // The tip supersedes earlier pushes of the same branch; a branch deleted after its merge is judged by the commit it recorded.
        const tip = await git(['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${branch}`]).then(r => r.stdout.trim(), () => null);
        const sha = tip || c.sha;
        if (!sha) continue;
        // With the person's standing permission, a branch the engine published and nobody merged is the engine's
        // to merge — once, and only while the tip is still the commit it built (a rewritten branch is a person's).
        if (autoMerge && !(await ancestorOfMain(sha)) && (tip === c.sha || !tip) && !c.mergeAttemptedAt) {
          const marked = row.state.commitments.map(x => x.kind === 'branch' && x.branch === branch ? { ...x, mergeAttemptedAt: clock() } : x);
          await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{commitments}', $2::jsonb) WHERE id = $1`, [row.id, JSON.stringify(marked)]);
          row.state.commitments = marked;
          const d = await deploy({ sha, branch }, row.id).catch(e => ({ ok: false, error: e.message }));
          log.log?.(`[self-build] want #${row.id}: ${branch} ${d.ok ? `merged into ${mainBranch} by the engine (${String(d.sha).slice(0, 7)}); restarting onto it` : `not merged: ${d.error}`}`);
          if (!d.ok) continue;
          c.mergeAttemptedAt = clock();
        }
        if (!(await ancestorOfMain(sha))) continue;
        const running = await git(['merge-base', '--is-ancestor', sha, 'HEAD']).then(() => true, () => false);
        const mergedAt = clock();
        try {
          await queue.outcome(row.id, { receiptId: `merged-${sha.slice(0, 12)}`, progress: Math.max(0.5, Math.min(0.9, (row.state.want.progress || 0) + 0.25)), criterionMet: false,
            evidence: [{ id: `merged-${sha.slice(0, 7)}`, source: `git: ${remote}/${mainBranch} contains the branch tip`,
              observation: `${branch} (${sha.slice(0, 7)}) was merged into ${mainBranch} ${c.mergeAttemptedAt ? 'by the engine under the person\'s auto-merge permission' : 'by a person'}${running ? '; the running checkout carries it' : '; the running checkout does not carry it yet'}. Remaining: ${Math.round(quietPeriodMs / 3600_000)} hours of operation without the same failure.` }] }, { park: true });
        } catch (e) { log.warn?.(`[self-build] merge receipt for #${row.id}:`, text(e.message, 200)); continue; }   // running a pass: observed again next tick
        const next = row.state.commitments.map(x => x.kind === 'branch' && x.branch === branch ? { ...x, merged: true, mergedAt, mergedSha: sha } : x);
        await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{commitments}', $2::jsonb), updated_at = NOW() WHERE id = $1`, [row.id, JSON.stringify(next)]);
        row.state.commitments = next;
        await journal('merged', row.id, { branch, sha, running });
        merged.push({ chainId: row.id, branch, sha });
        log.log?.(`[self-build] want #${row.id}: ${branch} merged into ${mainBranch}`);
      }
    }
    // The quiet period, for wants that came from the journal: only they name a defect that can be looked for.
    for (const row of rows) {
      const { origin, want } = row.state;
      if (origin?.source !== 'introspection' || !origin.fingerprint) continue;
      const last = row.state.commitments.filter(c => c.kind === 'branch').at(-1);
      if (!last?.merged || !last.mergedAt) continue;
      const { rows: fails } = await pool.query(`SELECT id, outcome, resolved_at FROM risk_decisions
        WHERE outcome->>'result' = 'failure' AND resolved_at > to_timestamp($1 / 1000.0) ORDER BY resolved_at ASC LIMIT 500`, [last.mergedAt]);
      const same = fails.filter(f => { const o = f.outcome?.evidence?.[0]?.observation || f.outcome?.note || ''; return classifyFriction(o) === 'defect' && defectFingerprint(o) === origin.fingerprint; });
      const receipt = same.length
        ? { receiptId: `recurred-${same[0].id}`.slice(0, 200), progress: Math.min(0.25, want.progress || 0), criterionMet: false,
            evidence: [{ id: `recurred-${text(same[0].id, 60)}`, source: 'risk journal: the same failure observed after the merge', observation: `The failure this want was made from recurred ${same.length} time(s) after ${last.branch} was merged; first at ${new Date(same[0].resolved_at).toISOString()}: ${text(same[0].outcome?.evidence?.[0]?.observation || same[0].outcome?.note, 300)}` }] }
        : clock() - last.mergedAt >= quietPeriodMs
          ? { receiptId: `quiet-${last.mergedSha?.slice(0, 12) || last.branch}`, progress: 1, criterionMet: true,
              evidence: [{ id: `quiet-${(last.mergedSha || last.branch).slice(0, 7)}`, source: 'risk journal: no matching failure for the quiet period after the merge', observation: `${Math.round(quietPeriodMs / 3600_000)} hours of operation after ${last.branch} was merged, ${fails.length} failure(s) journaled, none of them this defect.` }] }
          : null;
      if (!receipt || want.receipts?.some(r => r.receiptId === receipt.receiptId)) continue;
      try { await queue.outcome(row.id, receipt); } catch (e) { log.warn?.(`[self-build] quiet-period receipt for #${row.id}:`, text(e.message, 200)); continue; }
      await journal(same.length ? 'recurred' : 'settled', row.id, { branch: last.branch, sha: last.mergedSha, failures: fails.length, same: same.length });
      settled.push({ chainId: row.id, branch: last.branch, recurred: same.length > 0 });
      log.log?.(`[self-build] want #${row.id}: ${same.length ? 'the defect recurred after the merge' : 'quiet for the whole period after the merge; sated'}`);
    }
    return { merged, settled };
  }

  // Called with the hunger refresh. The engine decides; the person only permits.
  async function tick({ force = false } = {}) {
    if (!force && clock() - lastTickAt < 60_000) return phase;
    lastTickAt = clock();
    try { await reconcile(); } catch (e) { log.warn?.('[self-build] reconcile:', e.message); }   // a person's merge counts whether or not the phase is permitted
    const { enabled } = await permitted();
    if (!enabled) { if (phase.active) await exit('permission withdrawn'); return phase; }
    let wants = [];
    try { await introspect(); } catch (e) { log.warn?.('[self-build] introspection:', e.message); }
    try { wants = await selfWants(); } catch (e) { log.warn?.('[self-build] self-wants:', e.message); }
    const hungriest = wants.sort((a, b) => b.hunger.pressure - a.hunger.pressure)[0];
    if (!phase.active) {
      if (hungriest && hungriest.hunger.pressure >= enterPressure && clock() - phase.lastExitAt >= exitCooldownMs) await enter(`want #${hungriest.chain_id} at pressure ${hungriest.hunger.pressure.toFixed(2)}`, hungriest.chain_id);
      return phase;
    }
    if (!wants.length) await exit('no active self-wants');
    else if (phase.failures >= maxConsecutiveFailures) await exit(`${phase.failures} consecutive build failures`);
    else if (phase.builds >= maxBuildsPerDay) await exit(`daily build budget (${maxBuildsPerDay}) spent`);
    return phase;
  }

  async function status() {
    const { rows } = await pool.query('SELECT kind, chain_id, payload, created_at FROM self_build_events ORDER BY created_at DESC LIMIT 20');
    const wants = await selfWants().catch(() => []);
    return { phase, permission: await permitted(), selfWants: wants.map(w => ({ chain_id: w.chain_id, description: w.want.description, pressure: w.hunger.pressure, status: w.status, strategy: w.hunger.strategy })),
      constitution: [...CONSTITUTION, ...CONSTITUTION_DIRS], recent: rows,
      policy: { enters_when: `a self-want reaches pressure ${enterPressure}`, exits_when: `no self-wants, ${maxConsecutiveFailures} consecutive failures, or ${maxBuildsPerDay} builds in a phase`,
        edits: 'on a branch in a private worktree; tests must all still pass and none may disappear; constitution untouchable', publishes: 'the branch, always; main only with selfBuildAutoMerge',
        settles: `a merge is observed from ${remote}/${mainBranch}; an introspected defect absent from the risk journal for ${Math.round(quietPeriodMs / 3600_000)} hours after it sates the want, one that recurs reopens it` } };
  }

  // ── the build itself ──
  async function baselineTests(cwd) {
    // The verifier runs the suite the way a clean clone would: no deployment routing (ONEIRO_*/OCA_* point the
    // live daemon at other machines and flip env-sensitive tests), no NODE_TEST_CONTEXT (a child of a test file
    // would silently discover nothing). Only the database location and the path survive.
    const keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'DATABASE_URL', 'OCA_TEST_DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
    const env = Object.fromEntries(keep.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
    const r = await run(process.execPath, ['--test', 'tests/'], { cwd, env: { ...env, OCA_ENABLE_AMBIENT_SIMULATION: '0' }, maxBuffer: 32 * 1024 * 1024 }).catch(e => e);
    const out = (r.stdout || '') + (r.stderr || '');
    // The first failure's own words travel with the result, so a refused build says why in the journal.
    const firstError = (out.match(/^\s+(Error|AssertionError|TypeError|SyntaxError|ReferenceError)[^\n]*/m) || [])[0]?.trim() || '';
    return { ...parseTestOutput(out), firstError: firstError.slice(0, 300) };
  }
  async function writeBrief(dir, ctx, evidence) {
    const brief = `# Self-build brief — want #${ctx.chain.chain_id}\n\nWANT: ${text(ctx.want.description, 800)}\n\nDONE WHEN: ${text(ctx.want.doneWhen, 400)}\n\nOBSERVED FRICTION:\n${evidence.map(e => `- [${e.id}] (${e.source}) ${text(e.observation, 600)}`).join('\n') || '- none recorded'}\n\nRULES:\n- Change only what the friction requires. Explain in your summary.\n- Never modify: ${[...CONSTITUTION, ...CONSTITUTION_DIRS].join(', ')} — these are the constitution.\n- Never delete or weaken a test. Add tests for what you fix. Run \`node --test tests/\` before you report.\n- Do not run git commands; the engine commits and publishes.\n`;
    await writeFile(join(dir, 'SELF-BUILD.md'), brief, { mode: 0o600 });
    return brief;
  }
  // A builder agent: a gateway session the person can open and argue with, working in the same worktree.
  // The engine still runs the tests, commits and publishes — a builder's report is what it says, not proof.
  let agents = null;
  function useAgents(a) { agents = a; }
  async function codeWithAgent(dir, ctx, signal) {
    const chainId = ctx.chain.chain_id;
    const d = await agents.deploy(chainId, { kind: 'builder', task: `Carry out SELF-BUILD.md in ${dir}. Report files_changed, tests_run, ready.`, cwd: dir, firedBy: 'engine' });
    if (!d.id) throw new Error(`builder not deployed: ${d.why || d.decision}`);
    const done = await agents.waitFor(d.id, { timeoutMs: Math.max(120_000, ctx.budget.timeBudgetSeconds * 1000 * 4), signal });
    if (done.status !== 'done') throw new Error(`builder ${done.status}: ${text(done.error || done.report?.summary || done.question || '', 300)}`);
    const r = done.report || {};
    return { coder: 'agent', deployment: d.id, report: { summary: text(r.summary, 600), files_changed: Array.isArray(r.files_changed) ? r.files_changed : [], tests_run: r.tests_run === true, ready: r.ready === true } };
  }
  async function codeWithCodex(dir, ctx, signal) {
    const prompt = `Read SELF-BUILD.md in this directory and carry it out. Report with the structured schema: summary, files_changed, tests_run, ready.`;
    const r = await runner(prompt, { workingDirectory: dir, sandbox: 'workspace-write', timeoutMs: Math.max(120_000, ctx.budget.timeBudgetSeconds * 1000 * 4), signal, outputSchema: coderReportSchema });
    let report; try { report = JSON.parse(r.text); } catch { report = { summary: text(r.text, 600), files_changed: [], tests_run: false, ready: false }; }
    return { coder: 'codex', report };
  }
  async function codeWithLocal(dir, ctx, brief) {
    const files = (ctx.evidence || []).flatMap(e => [...String(e.observation).matchAll(/([\w./-]+\.js)\b/g)].map(m => m[1])).filter((p, i, a) => a.indexOf(p) === i).slice(0, 3);
    const sources = [];
    for (const f of files) { try { sources.push(`=== ${f} ===\n${(await readFile(join(dir, f), 'utf8')).slice(0, 9000)}`); } catch {} }
    const r = await llm.messages.create({ provider, model, system: 'You fix one defect in a Node codebase with exact search-and-replace edits. Each `find` must appear exactly once in the file. Keep edits minimal. Respond with JSON only.',
      messages: [{ role: 'user', content: `${brief}\n\n${sources.join('\n\n') || 'No source excerpts matched; name the file paths you need in the summary and return no edits.'}` }],
      max_tokens: 1800, temperature: 0.1 }, { priority: 10, responseSchema: editsSchema, timeoutMs: 120_000 });
    const raw = String(r.content?.[0]?.text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const plan = JSON.parse(raw);
    const changed = [];
    for (const e of plan.edits || []) {
      const p = join(dir, e.path); const src = await readFile(p, 'utf8');
      const n = src.split(e.find).length - 1;
      if (n !== 1) throw new Error(`edit to ${e.path}: find text occurs ${n} times, must be exactly once`);
      await writeFile(p, src.replace(e.find, e.replace)); changed.push(e.path);
    }
    return { coder: `local:${model}`, report: { summary: text(plan.summary, 600), files_changed: changed, tests_run: false, ready: changed.length > 0 } };
  }

  async function build(ctx) {
    const { enabled, autoMerge } = await permitted();
    if (!enabled || !phase.active) return { status: 'stalled', stopReason: 'self_build_not_active' };
    const chainId = ctx.chain.chain_id, attempt = ctx.state.claimSeq ?? ctx.state.attempts;
    const branch = `self/${chainId}-${slug(ctx.want.description)}`;
    const dir = join(workRoot, String(chainId), String(attempt));
    const evidence = (ctx.evidence || []).slice(-12);
    const result = { branch, dir };
    try {
      await mkdir(dirname(dir), { recursive: true, mode: 0o700 });
      await rm(dir, { recursive: true, force: true });
      await git(['worktree', 'prune']);
      await git(['branch', '-D', branch]).catch(() => {});
      await git(['worktree', 'add', '-b', branch, dir, 'HEAD']);
      // A worktree carries the tree, not the dependencies: share the checkout's node_modules by symlink.
      await stat(join(dir, 'node_modules')).catch(() => symlink(join(repoDir, 'node_modules'), join(dir, 'node_modules'), 'dir').catch(() => {}));
      const before = await baselineTests(dir);
      if (!before.tests) return fail('no tests were discovered; a change proven by zero tests is proven by nothing', 'no_tests');
      if (before.fail) return fail(`baseline tests already failing on main (${before.fail}: ${before.failing.slice(0, 4).join('; ')}); a person should look first`, 'baseline_red');
      const brief = await writeBrief(dir, ctx, evidence);
      let coded;
      const codexOk = !!runner && inferenceMode() !== 'local' && !(await codexBackedOff());
      const agentOk = !!agents && inferenceMode() !== 'local' && await agents.available().catch(() => false);
      try { coded = agentOk ? await codeWithAgent(dir, ctx, AbortSignal.timeout(ctx.budget.timeBudgetSeconds * 1000 * 4)) : codexOk ? await codeWithCodex(dir, ctx, AbortSignal.timeout(ctx.budget.timeBudgetSeconds * 1000 * 4)) : await codeWithLocal(dir, ctx, brief); }
      catch (e) {
        if (codexOk && ENVIRONMENT.test(String(e.message))) { noteCodexDown(e.message); coded = await codeWithLocal(dir, ctx, brief); }
        else throw e;
      }
      result.coder = coded.coder; result.summary = coded.report.summary;
      await rm(join(dir, 'SELF-BUILD.md'), { force: true });
      // An agent runtime that treated the worktree as a workspace may have seeded its own files there; not a change.
      for (const f of ['AGENTS.md', 'IDENTITY.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'MEMORY.md', 'memory']) {
        const tracked = await git(['ls-files', '--error-unmatch', '--', f], dir).then(() => true, () => false);
        if (!tracked) await rm(join(dir, f), { recursive: true, force: true }).catch(() => {});
      }
      // The shared node_modules symlink is not a change (a symlink is not matched by the `node_modules/` ignore rule).
      const changed = (await git(['status', '--porcelain'], dir)).stdout.split('\n').filter(Boolean).map(l => l.slice(3).trim()).filter(f => f !== 'node_modules' && !f.startsWith('node_modules/'));
      if (!changed.length) return fail('the coder changed nothing', 'no_change');
      const forbidden = changed.filter(isConstitutional);
      if (forbidden.length) { await journal('refused', chainId, { branch, forbidden }); return fail(`touched the constitution: ${forbidden.join(', ')}`, 'constitution'); }
      const deletedTests = (await git(['status', '--porcelain'], dir)).stdout.split('\n').filter(l => /^ ?D /.test(l) && / tests\//.test(l));
      if (deletedTests.length) return fail(`deleted tests: ${deletedTests.join(', ')}`, 'tests_deleted');
      let after = await baselineTests(dir);
      // A small red may be a flake under load, not the change: one re-run decides. A green re-run is
      // accepted and the flaky names are recorded in the commit; a second red stands.
      let flaky = [];
      if (after.fail && after.fail <= 2) { const again = await baselineTests(dir); if (!again.fail) { flaky = after.failing; after = again; } }
      const lost = [...before.passing].filter(n => !after.passing.has(n));
      if (after.fail || lost.length) return fail(`tests: ${after.pass}/${after.tests} passing, ${after.fail} failing${lost.length ? `; ${lost.length} previously passing test(s) no longer pass: ${lost.slice(0, 3).join('; ')}` : ''}${after.firstError ? ` — ${after.firstError}` : ''}`, 'tests_red');
      result.tests = { before: before.pass, after: after.pass, added: after.pass - before.pass };
      await git(['add', '-A', '--', '.', ':!node_modules'], dir);
      const message = `self-build: ${text(coded.report.summary, 72) || slug(ctx.want.description)}\n\nWant #${chainId}: ${text(ctx.want.description, 600)}\n\n${text(coded.report.summary, 1200)}\n\nTests: ${after.pass}/${after.tests} passing (${before.pass} before).${flaky.length ? ` Flaky on first run, green on re-run: ${flaky.slice(0, 3).join('; ')}.` : ''} Coder: ${coded.coder}.\n\nSelf-Build: want #${chainId} attempt ${attempt}\nCo-Authored-By: OCA Self-Build <oca@oneiro.local>\n`;
      result.flaky = flaky;
      await git(['-c', 'user.name=OCA Self-Build', '-c', 'user.email=oca@oneiro.local', 'commit', '-q', '-m', message], dir);
      result.sha = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
      await git(['push', '-u', remote, `${branch}:${branch}`, '--force-with-lease'], dir);
      result.pushed = true;
      phase.builds++; phase.failures = 0;
      await journal('build', chainId, { ...result, attempt });
      let deployed = null;
      if (autoMerge) deployed = await deploy(result, chainId).catch(e => ({ ok: false, error: e.message }));
      return { status: 'needs_evidence', conclusion: `Built and published ${branch} (${result.sha.slice(0, 7)}): ${text(coded.report.summary, 300)}. Tests ${after.pass}/${after.tests}.${deployed ? ` ${deployed.ok ? `Merged to main and running (${deployed.sha?.slice(0, 7)}).` : `Deploy failed: ${deployed.error}`}` : ' Awaiting a person\'s merge.'}`,
        missingEvidence: deployed?.ok ? ['24 hours of operation without the same failure'] : [`A person merges ${branch} into main, then 24 hours of operation without the same failure`],
        evidence: [{ id: `self-build-${chainId}-${attempt}`, source: 'self-build runtime: git and test output', observation: `Branch ${branch} at ${result.sha} pushed to ${remote}; tests ${after.pass}/${after.tests} passing (${before.pass} on main); files: ${changed.slice(0, 8).join(', ')}` }],
        commitment: { kind: 'branch', branch, sha: result.sha, deployed: deployed?.ok === true } };
    } catch (e) {
      return fail(text(e.message, 400), 'error');
    } finally {
      await git(['worktree', 'remove', '--force', dir]).catch(() => {});
      if (!result.pushed) await git(['branch', '-D', branch]).catch(() => {});   // nothing published: leave no trace
    }
    async function fail(why, code) {
      phase.failures++;
      // What the refused change was, so the journal explains the refusal without the worktree.
      const diff = await git(['diff', '--stat'], dir).then(r => r.stdout.slice(0, 1200)).catch(() => '');
      const patch = await git(['diff'], dir).then(r => r.stdout.slice(0, 4000)).catch(() => '');
      await journal('build', chainId, { ...result, attempt, failed: why, code, diffStat: diff, patch });
      return { status: 'failed', error: why, stopReason: code };
    }
  }

  let codexDownUntil = 0;
  const codexBackedOff = async () => clock() < codexDownUntil;
  const noteCodexDown = msg => { codexDownUntil = clock() + 15 * 60_000; log.warn?.(`[self-build] Codex unavailable (${text(msg, 120)}); coding locally for 15 min`); };

  // With selfBuildAutoMerge: fast-forward main to the branch and pull the live checkout. The running
  // process keeps its loaded code until it restarts (OCA_LAUNCHD_LABEL set: a restart is scheduled).
  // Health after restart is NOT verified here — the supervisor's KeepAlive catches a crash loop and the
  // next tick's journal shows it; a person reverts. This is why the control defaults to off.
  // The engine merges its own branch: fast-forward when main has not moved, a merge commit when it has — made
  // in a private worktree of main, proven by the whole suite on the merged tree, then pushed, pulled into the
  // live checkout, and the process restarted onto it. A conflict or a red suite leaves main untouched.
  async function deploy(built, chainId) {
    const prev = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const dir = join(workRoot, 'merge', String(chainId));
    let sha = built.sha;
    try {
      await git(['fetch', '-q', remote, mainBranch]);
      await mkdir(dirname(dir), { recursive: true, mode: 0o700 }); await rm(dir, { recursive: true, force: true }); await git(['worktree', 'prune']);
      await git(['worktree', 'add', '--detach', dir, `refs/remotes/${remote}/${mainBranch}`]);
      await stat(join(dir, 'node_modules')).catch(() => symlink(join(repoDir, 'node_modules'), join(dir, 'node_modules'), 'dir').catch(() => {}));
      const ff = await git(['merge-base', '--is-ancestor', `refs/remotes/${remote}/${mainBranch}`, built.sha]).then(() => true, () => false);
      if (ff) await git(['merge', '--ff-only', built.sha], dir);
      else {
        await git(['-c', 'user.name=OCA Self-Build', '-c', 'user.email=oca@oneiro.local', 'merge', '--no-ff', '-m', `self-build: merge ${built.branch || built.sha.slice(0, 7)} into ${mainBranch}`, built.sha], dir);
        const after = await baselineTests(dir);
        if (after.fail || !after.tests) throw new Error(`tests on the merged tree: ${after.pass}/${after.tests} passing, ${after.fail} failing${after.firstError ? ` — ${after.firstError}` : ''}`);
        sha = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
      }
      await git(['push', remote, `${sha}:refs/heads/${mainBranch}`], dir);
      await git(['pull', '--ff-only', remote, mainBranch]);
    } catch (e) {
      await journal('rollback', chainId, { sha: built.sha, prev, reason: `deploy failed before restart: ${text(e.message, 200)}` });
      return { ok: false, error: text(e.message, 200) };
    } finally { await git(['worktree', 'remove', '--force', dir]).catch(() => {}); }
    await journal('deploy', chainId, { sha, branchSha: built.sha, prev, restartScheduled: !!process.env.OCA_LAUNCHD_LABEL });
    if (process.env.OCA_LAUNCHD_LABEL) setTimeout(() => run('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${process.env.OCA_LAUNCHD_LABEL}`]).catch(() => {}), 1500).unref();
    return { ok: true, sha };
  }

  return { introspect, reconcile, tick, enter, exit, status, build, isActive, permitted, selfWants, useAgents };
}
