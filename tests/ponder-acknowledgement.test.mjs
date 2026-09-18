import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { createPonderQueue } from '../reasoning/ponder-queue.js';

test('mutations acknowledge committed state without needing a second pool connection', async () => {
  const schema = `oca_test_${randomBytes(6).toString('hex')}`;
  const connectionString = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const admin = new pg.Pool({ connectionString });
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 1500,
      options: `-c search_path=${schema},public` });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL,
      priority FLOAT8 DEFAULT .5, status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    const queue = createPonderQueue({ pool, reason: async () => { throw Error('No inference expected'); } });
    const a = await queue.enqueue({ seed: 'Isolated cancellation acknowledgement', learning: false });
    const b = await queue.enqueue({ seed: 'Another isolated cancellation', learning: false });
    const saved = await Promise.all([queue.cancel(a.chain_id), queue.cancel(b.chain_id)]);
    assert.deepEqual(saved.map(x => x.status), ['cancelled', 'cancelled']);
    assert.ok(saved.every(x => x.want.status === 'cancelled' && x.want.progress === 0));
    assert.equal((await queue.get(a.chain_id)).status, 'cancelled');
    assert.equal(pool.waitingCount, 0);
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
