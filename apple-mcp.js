#!/usr/bin/env node
// Apple, as an MCP tool server for the engine's agents. Every call goes to the Apple broker, the separate program
// that holds the keys and decides writes; this server only translates. So there is nothing here to get around:
// an agent can ask for anything, and the broker answers with Apple's reply or its own decision.
//
// Protocol: MCP over stdio, newline-delimited JSON-RPC 2.0 (initialize, tools/list, tools/call, ping).
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createAppleBroker } from './apple/broker.js';

const broker = createAppleBroker();
const MAX_TEXT = 60_000;

const HOW = 'Reads always work. A write needs pursuit and a one-line reason, and the broker decides it: in dry-run it answers dry_run with what would happen (wouldNeedApproval says whether Quinn would be asked); '
  + 'a write that needs Quinn answers needs_approval with a Terminal command for him. End your turn with needs_person asking him to run exactly that command and reply done, then retry the same call with approval set to the approvalId. '
  + 'A denied write says why; never work around it in the browser. Apple\'s own error bodies come back as body.';

export const TOOLS = [
  { name: 'apple_call',
    description: 'Call Apple through the Apple broker, the only path to its APIs. api "asc": App Store Connect (paths /v1/…, e.g. GET /v1/apps, GET /v1/salesReports, GET /v1/customerReviews). '
      + 'api "ads": the Apple Ads Platform API (paths /v1/…; queries and reports are POSTs ending in /query, e.g. POST /v1/campaigns/query, POST /v1/reports/apps/searchterms/query). '
      + 'api "storekit": the App Store Server API (paths /inApps/…, e.g. POST /inApps/v1/notifications/history for renewals and refunds). ' + HOW,
    inputSchema: { type: 'object', properties: {
      api: { type: 'string', enum: ['asc', 'ads', 'storekit'] },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      path: { type: 'string', description: 'the path only, starting with /; put query parameters in query' },
      query: { type: 'object', description: 'query parameters, e.g. {"filter[frequency]":"DAILY"}', additionalProperties: { type: 'string' } },
      body: { type: 'object', description: 'the JSON body, exactly as Apple documents it' },
      reason: { type: 'string', description: 'why, in a sentence (required for writes)' },
      pursuit: { type: 'integer', description: 'the pursuit #id this serves' },
      approval: { type: 'string', description: 'the approvalId Quinn approved, when retrying a write that needed him' },
    }, required: ['api', 'method', 'path'], additionalProperties: false } },
  { name: 'apple_status', description: 'What the Apple broker has set up (keys, write mode), the Apple Ads caps and this month\'s commitment, and writes waiting on Quinn.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'apple_journal', description: 'The last 20 writes the Apple broker decided: what each changed from and to, and why.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'apple_reconcile', description: 'Refresh Apple Ads campaign budgets and this month\'s actual spend from Apple, so the caps count what was really spent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'apple_ads_setup',
    description: 'First-time Apple Ads API setup, which the broker lets the engine do on its own. keygen: makes the key pair inside the broker, once, and returns only the public key, for Apple Ads → Account Settings → API, signed in as the API user. '
      + 'configure: records the client, team and key IDs Apple shows after the public key is saved, and later the ad account (only IDs that aren\'t set yet; changing one is Quinn\'s). verify: one read call per API that has a key; for Apple Ads it lists the ad accounts.',
    inputSchema: { type: 'object', properties: {
      step: { type: 'string', enum: ['keygen', 'configure', 'verify'] },
      clientId: { type: 'string' }, teamId: { type: 'string' }, keyId: { type: 'string' }, adAccountId: { type: 'integer' },
    }, required: ['step'], additionalProperties: false } },
];
export const APPLE_TOOL_NAMES = TOOLS.map(t => t.name);

export async function callAppleTool(name, args = {}, apple = broker) {
  switch (name) {
    case 'apple_call': {
      const request = { api: args.api, method: args.method, path: args.path, query: args.query || {}, reason: String(args.reason || ''),
        ...(args.body !== undefined ? { body: args.body } : {}), ...(args.pursuit ? { chainId: Number(args.pursuit) } : {}), ...(args.approval ? { approval: String(args.approval) } : {}) };
      return apple.call(request);
    }
    case 'apple_status': return apple.status();
    case 'apple_journal': return apple.journal();
    case 'apple_reconcile': return apple.reconcile();
    case 'apple_ads_setup':
      if (args.step === 'keygen') return apple.adsKeygen();
      if (args.step === 'configure') return apple.adsConfigure({ clientId: args.clientId, teamId: args.teamId, keyId: args.keyId, adAccountId: args.adAccountId });
      if (args.step === 'verify') return apple.verify();
      throw new Error('step is keygen, configure or verify');
    default: throw new Error(`unknown tool ${name}`);
  }
}

// A result an agent can read: the broker's JSON, clipped when a report is too large to be useful whole.
export function asText(result) {
  const text = JSON.stringify(result);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}… [clipped at ${MAX_TEXT} characters; narrow the query or the date range]` : text;
}

const out = msg => process.stdout.write(JSON.stringify(msg) + '\n');
let pending = 0;
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const rl = isMain ? createInterface({ input: process.stdin, crlfDelay: Infinity }) : null;
rl?.on('line', async line => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.id === undefined) return;
  const reply = result => out({ jsonrpc: '2.0', id: req.id, result });
  const fail = (code, message) => out({ jsonrpc: '2.0', id: req.id, error: { code, message } });
  try {
    switch (req.method) {
      case 'initialize': return reply({ protocolVersion: req.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'apple', version: '1.0.0' } });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        const { name, arguments: args } = req.params || {};
        if (!TOOLS.some(t => t.name === name)) return fail(-32602, `unknown tool ${name}`);
        pending++;
        try {
          const result = await callAppleTool(name, args || {});
          if (result?.decision && result.decision !== 'read') process.stderr.write(`[apple-mcp] ${args?.method || name} ${args?.path || ''}: ${result.decision}\n`);
          return reply({ content: [{ type: 'text', text: asText(result) }], isError: result?.ok === false });
        } catch (e) { return reply({ content: [{ type: 'text', text: `Apple broker: ${e.message}` }], isError: true }); }
        finally { pending--; }
      }
      default: return fail(-32601, `method not found: ${req.method}`);
    }
  } catch (e) { fail(-32603, e.message); }
});
rl?.on('close', () => { const wait = () => (pending > 0 ? setTimeout(wait, 100) : process.exit(0)); wait(); });
