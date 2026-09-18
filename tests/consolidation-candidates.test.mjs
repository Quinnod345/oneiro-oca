import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createEvidenceConsolidator, parseCandidates } from '../memory/consolidation-candidates.js';
const empty = { principles: [], procedures: [], connections: [], contradictions: [] };
const proposal = id => ({ ...empty, principles: [{ concept: 'A supported observation, still only a candidate', category: 'fixture', confidence: 0, evidence_episodes: [id] }] });
async function isolated(fn) {
  const schema = 'consolidation_test_' + randomBytes(6).toString('hex');
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const admin = new pg.Pool({ connectionString: dsn }); let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema });
    // Clone the actual deployed table shape; never inherit its production sequence.
    for (const table of ['episodic_memory', 'consolidation_log']) {
      await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
      await pool.query(`ALTER TABLE ${table} ALTER COLUMN id DROP DEFAULT`);
      await pool.query(`ALTER TABLE ${table} ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY`);
    }
    await pool.query(await readFile(new URL('../migrations/056_consolidation_candidates.sql', import.meta.url), 'utf8'));
    await pool.query("INSERT INTO episodic_memory (content,event_type,emotional_valence) SELECT $1,'fixture',0.9 FROM generate_series(1,200)", ['Observed battery reading. ' + 'detail '.repeat(150)]);
    await fn(pool);
  } finally { await pool?.end(); await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); await admin.end(); }
}

test('only the 20 supplied episodes are reviewed; generated candidates never become accepted knowledge', () => isolated(async pool => {
  let input;
  const run = createEvidenceConsolidator({ pool, generate: async request => { input = request; return JSON.stringify(proposal(request.evidence[0].id)); } });
  const result = await run();
  assert.equal(input.evidence.length, 20);
  assert.equal(input.evidence[0].truncated, true);
  assert.ok(input.system.includes('Do not infer Quinn'));
  assert.equal(input.evidence[0].ocaInternalAffect.valence, 0.9);
  assert.equal(result.episodesReviewed, 20);
  assert.equal(result.candidatesStaged, 1);
  for (const field of ['semanticCreated', 'proceduralUpdated', 'contradictionUpdates', 'episodesPruned']) assert.equal(result[field], 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM episodic_memory WHERE consolidation_status='raw'")).rows[0].n, 180);
  const c = (await pool.query('SELECT * FROM consolidation_candidates')).rows[0];
  assert.equal(c.status, 'unverified'); assert.equal(c.payload.confidence, 0);
  assert.equal(c.evidence[0].id, input.evidence[0].id); assert.equal(c.evidence[0].truncated, true);
  // A replacement worker continues from the untouched batch; no review replay.
  const next = await createEvidenceConsolidator({ pool, generate: async ({evidence}) => JSON.stringify(proposal(evidence[0].id)) })();
  assert.equal(next.episodesReviewed, 20);
  assert.equal((await pool.query("SELECT count(*)::int n FROM episodic_memory WHERE consolidation_status='raw'")).rows[0].n, 160);
}));

test('missing IDs, malformed output and transport failure leave every episode raw and count no review', () => isolated(async pool => {
  for (const answer of ['not JSON', '{}', JSON.stringify(proposal(199)), null]) {
    const result = await createEvidenceConsolidator({ pool, generate: async () => { if (answer === null) throw new Error('provider offline'); return answer; } })();
    assert.equal(result.failed, true); assert.equal(result.episodesReviewed, 0);
  }
  assert.equal((await pool.query("SELECT count(*)::int n FROM episodic_memory WHERE consolidation_status='raw'")).rows[0].n, 200);
  assert.equal((await pool.query('SELECT count(*)::int n FROM consolidation_reviews')).rows[0].n, 0);
  assert.equal((await pool.query('SELECT sum(episodes_reviewed)::int n FROM consolidation_log')).rows[0].n, 0);
}));

test('duplicate workers do not overlap generation; valid empty output is an actual review', () => isolated(async pool => {
  let release, entered; const started = new Promise(r => entered = r);
  const generate = async () => { entered(); await new Promise(r => release = r); return JSON.stringify(empty); };
  const first = createEvidenceConsolidator({ pool, generate })(); await started;
  const concurrent = await createEvidenceConsolidator({ pool, generate: async () => { throw new Error('must not run'); } })();
  assert.equal(concurrent.busy, true); release(); assert.equal((await first).episodesReviewed, 20);
  assert.equal((await pool.query('SELECT count(*)::int n FROM consolidation_reviews')).rows[0].n, 1);
}));

test('changed evidence and failed receipt transaction cannot partially advance the review cursor', () => isolated(async pool => {
  const changed = await createEvidenceConsolidator({ pool, generate: async ({ evidence }) => {
    await pool.query('UPDATE episodic_memory SET content=$1 WHERE id=$2', ['New observation', evidence[0].id]);
    return JSON.stringify(proposal(evidence[0].id));
  } })();
  assert.equal(changed.failed, true); assert.match(changed.error, /changed during review/);
  await pool.query("ALTER TABLE consolidation_candidates ADD CONSTRAINT injected_failure CHECK (kind <> 'principles')");
  const failed = await createEvidenceConsolidator({ pool, generate: async ({evidence}) => JSON.stringify(proposal(evidence[0].id)) })();
  assert.equal(failed.failed, true);
  assert.equal((await pool.query('SELECT count(*)::int n FROM consolidation_reviews')).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM episodic_memory WHERE consolidation_status='raw'")).rows[0].n, 200);
  await pool.query('ALTER TABLE consolidation_candidates DROP CONSTRAINT injected_failure');
  assert.equal((await createEvidenceConsolidator({pool, generate:async()=>JSON.stringify(empty)})()).episodesReviewed, 20, 'lock released after failure');
}));

test('all candidate types require known source IDs and cannot use confidence as authority', () => {
  for (const confidence of [-1, 2, '1', null]) assert.throws(() => parseCandidates(JSON.stringify({ ...empty, principles: [{ ...proposal(1).principles[0], confidence }] }), [1]));
  const payload = { ...empty, procedures:[{trigger:{app:'Editor'},actions:['Try a bounded edit'],domain:'test',confidence:0.5,evidence_episodes:[1]}],
    connections:[{cause:'Edit',effect:'Possible change',mechanism:'Untested',confidence:0.2,evidence_episodes:[1]}],
    contradictions:[{concept:'Earlier report',contradicts:'Later report',reason:'Different observation',confidence:0.3,evidence_episodes:[1]}] };
  assert.equal(parseCandidates(JSON.stringify(payload), [1]).length, 3);
});
