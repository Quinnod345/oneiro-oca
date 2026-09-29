import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCodexArgs,
  buildCodexEnvironment,
  parseCodexEvent,
  selfBuildCodexOptions,
} from '../codex-cli.js';

test('Codex child environment strips metered provider credentials', () => {
  const environment = buildCodexEnvironment({
    HOME: '/tmp/oneiro-home',
    OPENAI_API_KEY: 'do-not-forward',
    ANTHROPIC_API_KEY: 'do-not-forward',
    OPENAI_BASE_URL: 'https://example.invalid',
    DATABASE_URL: 'postgres://localhost/oneiro',
  });

  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(environment.OPENAI_BASE_URL, undefined);
  assert.equal(environment.DATABASE_URL, 'postgres://localhost/oneiro');
  assert.match(environment.PATH, /\/opt\/homebrew\/bin/);
});

test('Codex execution is ephemeral, non-interactive, and read-only', () => {
  const args = buildCodexArgs({ workingDirectory: '/tmp/oneiro', model: 'gpt-5.6-sol' });

  assert.deepEqual(args.slice(0, 3), ['exec', '--json', '--ephemeral']);
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(!args.includes('--ignore-rules'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('--config') + 1], 'approval_policy="never"');
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-5.6-sol');
  assert.equal(args.at(-1), '-');
});

test('the reasoning effort is stated explicitly, since the user config is ignored; unknown efforts are dropped', () => {
  const args = buildCodexArgs({ model: 'gpt-6-astra', reasoningEffort: 'high' });
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-astra');
  assert.ok(args.includes('model_reasoning_effort="high"'), args.join(' '));
  assert.equal(args[args.indexOf('model_reasoning_effort="high"') - 1], '--config');
  assert.ok(!buildCodexArgs({ reasoningEffort: 'absurd' }).some(a => a.includes('model_reasoning_effort')));
  assert.ok(!buildCodexArgs({}).some(a => a.includes('model_reasoning_effort')));
});

test('every Codex run is offered Aside as read-only MCP tools, auto-approved, and survives a resume', () => {
  const args = buildCodexArgs({ model: 'gpt-6-astra' });
  const i = args.indexOf('mcp_servers.aside.command=' + JSON.stringify(process.execPath));
  assert.ok(i > 0, args.join(' ')); assert.equal(args[i - 1], '-c');
  assert.ok(args.some(a => /^mcp_servers\.aside\.args=\["\/.*aside-mcp\.js"\]$/.test(a)));
  for (const t of ['aside_read', 'aside_search', 'aside_snapshot', 'aside_open', 'aside_tabs']) assert.ok(args.includes(`mcp_servers.aside.tools.${t}.approval_mode="approve"`), t);
  assert.ok(!buildCodexArgs({ aside: false }).some(a => a.includes('mcp_servers.aside')));
  for (const t of ['apple_call', 'apple_status', 'apple_ads_setup']) assert.ok(args.includes(`mcp_servers.apple.tools.${t}.approval_mode="approve"`), `Apple tool ${t} is offered beside Aside`);
  assert.ok(!buildCodexArgs({ aside: false }).some(a => a.includes('mcp_servers.apple')));
  // A plain answer has no tools at all: no shell, no code mode, no browser, no tool servers.
  const answer = buildCodexArgs({ answerOnly: true });
  for (const f of ['shell_tool', 'code_mode_host', 'browser_use', 'computer_use', 'multi_agent']) assert.ok(answer.join(' ').includes(`--disable ${f}`), f);
  assert.ok(!answer.some(a => a.includes('mcp_servers.')), 'no tool servers for a plain answer');
  const resumed = buildCodexArgs({ threadId: '11111111-2222-3333-4444-555555555555', persistent: true, sandbox: 'workspace-write' });
  assert.equal(resumed[1], 'resume'); assert.ok(resumed.some(a => a.startsWith('mcp_servers.aside.command=')));
});

test('Codex JSONL parser extracts assistant text and usage', () => {
  assert.deepEqual(
    parseCodexEvent('{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}'),
    { type: 'text', text: 'hello' },
  );
  assert.deepEqual(
    parseCodexEvent('{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}'),
    { type: 'usage', usage: { input_tokens: 12, output_tokens: 3 } },
  );
  assert.equal(parseCodexEvent('not json'), null);
});

test('structured Codex result excludes preceding user-visible progress messages', async () => {
  const { mkdtemp, writeFile, chmod, rm } = await import('node:fs/promises');
  const { runCodex } = await import('../codex-cli.js');
  const dir = await mkdtemp('/private/tmp/codex-result-test-');
  try {
    const cli = dir + '/codex-fixture';
    await writeFile(cli, '#!/usr/bin/env node\n' + [
      {type:'item.completed',item:{type:'agent_message',text:'I will inspect the sources.'}},
      {type:'item.completed',item:{type:'agent_message',text:'{"summary":"Evidence found"}'}},
      {type:'turn.completed',usage:{output_tokens:10}}
    ].map(event=>'console.log('+JSON.stringify(JSON.stringify(event))+');').join('\n'));
    await chmod(cli,0o700);
    const result=await runCodex('test',{workingDirectory:dir,env:{...process.env,ONEIRO_CODEX_CLI:cli}});
    assert.deepEqual(JSON.parse(result.text),{summary:'Evidence found'});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('self-build coder options come from the self-build lane, never the thinker policy', () => {
  const asked = { workingDirectory: '/tmp/w', sandbox: 'workspace-write', timeoutMs: 1000 };
  assert.deepEqual(selfBuildCodexOptions(asked, {}), asked, 'unset variables change nothing');
  assert.deepEqual(selfBuildCodexOptions(asked, { OCA_SELF_BUILD_MODEL: 'gpt-6-sol', OCA_SELF_BUILD_EFFORT: 'XHigh', OCA_SELF_BUILD_SANDBOX: 'danger-full-access' }),
    { ...asked, model: 'gpt-6-sol', reasoningEffort: 'xhigh', sandbox: 'danger-full-access' });
  assert.equal(selfBuildCodexOptions(asked, { OCA_SELF_BUILD_EFFORT: 'ludicrous' }).reasoningEffort, undefined);
  assert.deepEqual(selfBuildCodexOptions(asked, { OCA_SELF_BUILD_MODEL: 'bad model; rm -rf', OCA_SELF_BUILD_SANDBOX: 'yolo' }), asked, 'invalid values are ignored');
  assert.equal(selfBuildCodexOptions(asked, { OCA_SELF_BUILD_MODEL: 'gpt-6-sol' }).sandbox, 'workspace-write');
});
