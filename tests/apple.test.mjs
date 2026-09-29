import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createAppleBroker, NOT_INSTALLED } from '../apple/broker.js';
import { callAppleTool, asText, APPLE_TOOL_NAMES } from '../apple-mcp.js';

function fakeRun(answers) {
  const calls = [];
  const run = async (bin, args, input) => { calls.push({ bin, args, input }); const a = answers.shift(); return typeof a === 'string' ? { stdout: a, stderr: '' } : a; };
  return { run, calls };
}

test('the engine reaches Apple only by handing the broker one JSON request; it never holds a key', async () => {
  const f = fakeRun(['{"ok":true,"decision":"read","status":200,"body":{"data":[]}}\n', '{"ok":true,"ads":{"committed":42.5}}', '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\n', '{"ok":true}']);
  const apple = createAppleBroker({ bin: '/x/oneiro-apple', run: f.run, installed: () => true });
  const r = await apple.call({ api: 'asc', method: 'GET', path: '/v1/apps' });
  assert.equal(r.decision, 'read');
  assert.deepEqual(f.calls[0].args, ['call']); assert.deepEqual(JSON.parse(f.calls[0].input), { api: 'asc', method: 'GET', path: '/v1/apps' });
  assert.equal(await apple.committedSpend(), 42.5, 'the charter counts what Apple Ads has committed this month');
  assert.match((await apple.adsKeygen()).publicKey, /^-----BEGIN PUBLIC KEY-----/);
  await apple.adsConfigure({ clientId: 'SEARCHADS.a', adAccountId: 7 });
  assert.deepEqual(f.calls[3].args, ['ads-configure', '--client-id', 'SEARCHADS.a', '--ad-account-id', '7']);
});

test('before the broker is installed nothing is sent and Apple spends nothing; an installed broker that fails leaves the cap unknown', async () => {
  const absent = createAppleBroker({ run: async () => { throw new Error('should not run'); }, installed: () => false });
  assert.deepEqual(await absent.status(), { ok: false, decision: 'error', error: NOT_INSTALLED });
  assert.equal(await absent.committedSpend(), 0);
  const broken = createAppleBroker({ run: async () => ({ stdout: '{"ok":false,"error":"custody unreadable"}', stderr: '' }), installed: () => true });
  await assert.rejects(broken.committedSpend(), /custody unreadable/);
  const garbled = createAppleBroker({ run: async () => ({ stdout: 'sudo: a password is required', stderr: '' }), installed: () => true });
  assert.match((await garbled.status()).error, /without JSON: sudo: a password is required/);
});

test('the agent tools translate to broker requests: the pursuit becomes the journal\'s chain, an approval rides along, big reports are clipped', async () => {
  const seen = [];
  const apple = { call: async r => { seen.push(r); return { ok: true, decision: 'dry_run' }; }, status: async () => ({ ok: true }), journal: async () => [], reconcile: async () => ({ ok: true }),
    adsKeygen: async () => ({ ok: true, publicKey: 'PEM' }), adsConfigure: async a => ({ ok: true, a }), verify: async () => ({ ok: true }) };
  await callAppleTool('apple_call', { api: 'ads', method: 'POST', path: '/v1/keywords/bulk-update', body: { items: [] }, reason: 'raise a converting bid', pursuit: 27, approval: 'abcd1234' }, apple);
  assert.deepEqual(seen[0], { api: 'ads', method: 'POST', path: '/v1/keywords/bulk-update', query: {}, reason: 'raise a converting bid', body: { items: [] }, chainId: 27, approval: 'abcd1234' });
  assert.deepEqual((await callAppleTool('apple_ads_setup', { step: 'configure', teamId: 'SEARCHADS.t' }, apple)).a, { clientId: undefined, teamId: 'SEARCHADS.t', keyId: undefined, adAccountId: undefined });
  await assert.rejects(callAppleTool('apple_ads_setup', { step: 'replace' }, apple), /keygen, configure or verify/);
  assert.match(asText({ body: 'x'.repeat(70_000) }), /clipped at 60000 characters/);
  assert.deepEqual(APPLE_TOOL_NAMES, ['apple_call', 'apple_status', 'apple_journal', 'apple_reconcile', 'apple_ads_setup']);
});

test('the MCP server lists the Apple tools and answers a call, even before the broker exists', async () => {
  const child = spawn(process.execPath, [new URL('../apple-mcp.js', import.meta.url).pathname], { env: { ...process.env, OCA_APPLE_BROKER: '/nowhere/oneiro-apple' } });
  let out = ''; child.stdout.on('data', d => { out += d; });
  for (const m of [{ id: 1, method: 'initialize', params: {} }, { id: 2, method: 'tools/list' }, { id: 3, method: 'tools/call', params: { name: 'apple_status', arguments: {} } }])
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  child.stdin.end(); await new Promise(r => child.on('close', r));
  const messages = out.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(messages.find(m => m.id === 1).result.serverInfo.name, 'apple');
  assert.equal(messages.find(m => m.id === 2).result.tools.length, 5);
  const status = messages.find(m => m.id === 3).result;
  assert.equal(status.isError, true); assert.match(status.content[0].text, /not installed yet/);
});
