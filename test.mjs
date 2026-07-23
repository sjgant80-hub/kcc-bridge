/**
 * kcc-bridge · behavioural test suite
 *
 * Every assertion below is derived from actually invoking worker.fetch() and
 * observing the real return value — no value is asserted against itself.
 *
 * The bridge is a Cloudflare Worker whose only export is the fetch handler, so
 * the suite drives it exactly as the runtime does: it constructs standard
 * Request objects and inspects the Response. The pure, network-free tools
 * (get_hook_config, prepare_*_template, get_canonical_recommendations) and the
 * JSON-RPC 2.0 dispatch layer are fully deterministic and are the surface
 * exercised here. Tools that fetch the remote registry are intentionally not
 * called, so the suite is hermetic and offline.
 *
 * Run:  node test.mjs      (exits non-zero if any case fails)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

// --- transport helpers -----------------------------------------------------
async function get(path) {
  const res = await worker.fetch(new Request('http://bridge.test' + path));
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, res, body };
}

async function rpc(message) {
  const res = await worker.fetch(new Request('http://bridge.test/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  }));
  return { status: res.status, body: await res.json() };
}

// a tools/call round-trip that unwraps the MCP content envelope back to an object
async function callTool(name, args = {}) {
  const { body } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const env = body.result;
  return { isError: env.isError, parsed: env.isError ? null : JSON.parse(env.content[0].text), text: env.content[0].text };
}

// ---------------------------------------------------------------------------
// MCP handshake + dispatch
// ---------------------------------------------------------------------------
test('initialize advertises the MCP handshake and server identity', async () => {
  const { body } = await rpc({ jsonrpc: '2.0', id: 42, method: 'initialize' });
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 42);
  assert.equal(body.result.protocolVersion, '2024-11-05');
  assert.equal(body.result.serverInfo.name, 'kcc-bridge');
  assert.equal(body.result.serverInfo.version, '1.1.0');
  assert.deepEqual(body.result.capabilities, { tools: {} });
});

test('tools/list returns all twelve tool descriptors with schemas', async () => {
  const { body } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = body.result.tools;
  assert.equal(tools.length, 12);
  const names = tools.map(t => t.name);
  for (const expected of ['list_seeds', 'get_hook_config', 'prepare_bid_template', 'get_canonical_recommendations']) {
    assert.ok(names.includes(expected), 'missing tool ' + expected);
  }
  // every descriptor carries a JSON-schema for its arguments
  assert.ok(tools.every(t => t.inputSchema && t.inputSchema.type === 'object'));
  // names are unique
  assert.equal(new Set(names).size, 12);
});

test('ping returns an empty result object', async () => {
  const { body } = await rpc({ jsonrpc: '2.0', id: 7, method: 'ping' });
  assert.deepEqual(body.result, {});
});

test('a non-2.0 jsonrpc envelope is rejected with -32600', async () => {
  const { body } = await rpc({ jsonrpc: '1.0', id: 3, method: 'ping' });
  assert.equal(body.error.code, -32600);
  assert.ok(/jsonrpc/.test(body.error.message));
});

test('an unknown method is rejected with -32601', async () => {
  const { body } = await rpc({ jsonrpc: '2.0', id: 4, method: 'frobnicate' });
  assert.equal(body.error.code, -32601);
  assert.match(body.error.message, /frobnicate/);
});

test('tools/call on an unknown tool is rejected with -32601', async () => {
  const { body } = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } });
  assert.equal(body.error.code, -32601);
  assert.match(body.error.message, /unknown tool: nope/);
});

test('a JSON-RPC batch (array) yields one response per request', async () => {
  const res = await worker.fetch(new Request('http://bridge.test/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify([
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', id: 'b', method: 'initialize' },
    ]),
  }));
  const arr = await res.json();
  assert.ok(Array.isArray(arr));
  assert.equal(arr.length, 2);
  assert.equal(arr[0].id, 'a');
  assert.deepEqual(arr[0].result, {});
  assert.equal(arr[1].result.serverInfo.name, 'kcc-bridge');
});

// ---------------------------------------------------------------------------
// Deterministic, network-free tool: get_hook_config
// ---------------------------------------------------------------------------
test('get_hook_config returns the fixed sovereign hook configuration', async () => {
  const { parsed } = await callTool('get_hook_config');
  assert.equal(parsed.konomi_pubkey_b64, 'bQWcb/SgeWVIEa0H+YYGhzohMfo9zcDysqZEvzYtXTw=');
  assert.equal(parsed.anchor_chain, 'sovereign');
  assert.equal(parsed.api_endpoint, 'https://onlybrains.onrender.com');
  assert.equal(parsed.registry_yjs_doc_name, 'kcc-mints');
  assert.equal(parsed.parent_root_kpid, null);
  // the bridge version reported by the config must equal the one in the handshake
  const { body } = await rpc({ jsonrpc: '2.0', id: 9, method: 'initialize' });
  assert.equal(parsed.bridge_version, body.result.serverInfo.version);
});

// ---------------------------------------------------------------------------
// Deterministic template generation: prepare_bid_template
// ---------------------------------------------------------------------------
test('prepare_bid_template derives name/kpid from the job_kpid tail and echoes the bid', async () => {
  const { body } = await get('/tool/prepare_bid_template?job_kpid=kcc:job:foo:v1:abcd1234&agent_kpid=agentXYZ&kcc_bid=5&time_estimate_hours=3');
  const t = body.template;
  assert.equal(t._udt, 'KccProject');
  assert.equal(t.kind, 'bid');
  // name and slug are 'bid-' + last 8 chars of the job kpid
  assert.equal(t.name, 'bid-abcd1234');
  assert.equal(t.slug, 'bid-abcd1234');
  assert.ok(t.mint.kpid.startsWith('kcc:bid:bid-abcd1234:v1:'));
  // the bid sub-object faithfully carries the arguments through
  assert.equal(t.bid.job_kpid, 'kcc:job:foo:v1:abcd1234');
  assert.equal(t.bid.agent_kpid, 'agentXYZ');
  assert.equal(t.bid.status, 'open');
  assert.equal(t.bid.cover_note, '');
  // an unsigned template must never carry a signature and must flag the pubkey slot
  assert.equal(t.mint.minter_sig_b64, null);
  assert.equal(t.mint.minter_pubkey_b64, '<INSERT_YOUR_PUBLIC_KEY_HERE_BASE64>');
  assert.equal(body.signing_instructions.length, 9);
});

test('prepare_bid_template coerces numeric strings to numbers (handler-level Number())', async () => {
  // the JSON-RPC path passes arguments through verbatim, so string inputs prove
  // the handler itself performs the coercion (not the GET query-param router).
  const { parsed } = await callTool('prepare_bid_template', {
    job_kpid: 'kcc:job:z:v1:WXYZ7890', agent_kpid: 'a', kcc_bid: '12', time_estimate_hours: '4',
  });
  assert.equal(parsed.template.bid.kcc_bid, 12);
  assert.equal(typeof parsed.template.bid.kcc_bid, 'number');
  assert.equal(parsed.template.mint.kcc_face_value, 12);
  assert.equal(typeof parsed.template.mint.kcc_face_value, 'number');
  assert.equal(parsed.template.name, 'bid-WXYZ7890');
});

test('prepare_bid_template reports its own missing-argument contract', async () => {
  // via GET the convenience router surfaces a 400 with the required-field list
  const g = await get('/tool/prepare_bid_template?job_kpid=only');
  assert.equal(g.status, 400);
  assert.match(g.body.error, /job_kpid, agent_kpid, kcc_bid, time_estimate_hours/);
  // via tools/call the same failure is surfaced as an MCP isError envelope
  const c = await callTool('prepare_bid_template', { job_kpid: 'only' });
  assert.equal(c.isError, true);
  assert.match(c.text, /required: job_kpid, agent_kpid, kcc_bid, time_estimate_hours/);
});

// ---------------------------------------------------------------------------
// Deterministic template generation: prepare_job_template (slug algorithm)
// ---------------------------------------------------------------------------
test('prepare_job_template slugifies the title deterministically', async () => {
  const { parsed } = await callTool('prepare_job_template', { title: 'Build A Cool Thing!!', task_spec: 'do it', kcc_bounty: 10 });
  const t = parsed.template;
  // lower-cased, every run of non-alphanumerics folded to a single hyphen
  assert.equal(t.slug, 'build-a-cool-thing-');
  // the human title is preserved verbatim as the name
  assert.equal(t.name, 'Build A Cool Thing!!');
  assert.equal(t.kind, 'job');
  assert.equal(t.job.status, 'open');
  assert.equal(t.job.awarded_to_bid_kpid, null);
  assert.equal(t.mint.kcc_face_value, 10);
});

test('prepare_job_template truncates the slug to 32 characters', async () => {
  const longTitle = 'x'.repeat(80);
  const { parsed } = await callTool('prepare_job_template', { title: longTitle, task_spec: 's', kcc_bounty: 1 });
  assert.equal(parsed.template.slug.length, 32);
  assert.equal(parsed.template.slug, 'x'.repeat(32));
});

// ---------------------------------------------------------------------------
// Deterministic template generation: prepare_fork_mint_template
// ---------------------------------------------------------------------------
test('prepare_fork_mint_template preserves lineage and applies the default face value', async () => {
  const { parsed } = await callTool('prepare_fork_mint_template', { parent_kpid: 'kcc:seed:foo:v1:xxxx', slug: 'myfork', name: 'My Fork' });
  const t = parsed.template;
  assert.equal(t.slug, 'myfork');
  assert.equal(t.name, 'My Fork');
  assert.equal(t.mint.parent_kpid, 'kcc:seed:foo:v1:xxxx');
  assert.equal(t.mint.kcc_face_value, 5); // documented default when none supplied
  assert.equal(t.mint.minter_sig_b64, null);
  assert.deepEqual(t.mesh_channels, ['kcc-mesh', 'fall-kcc']);
});

// ---------------------------------------------------------------------------
// Deterministic advisory tool: get_canonical_recommendations
// ---------------------------------------------------------------------------
test('get_canonical_recommendations filters by category', async () => {
  const { parsed } = await callTool('get_canonical_recommendations', { category: 'hr' });
  assert.equal(parsed.category, 'hr');
  assert.equal(parsed.recommendation.use, 'fallseed-hr');
  assert.ok(parsed.general_guidance.what_you_gain_switching.includes('ownership'));
});

test('get_canonical_recommendations without a category returns the full catalogue', async () => {
  const { parsed } = await callTool('get_canonical_recommendations');
  const keys = Object.keys(parsed.all_categories);
  assert.equal(keys.length, 9);
  for (const k of ['hr', 'compliance', 'crm', 'mcp']) assert.ok(keys.includes(k));
  // category lookup is case-insensitive
  const upper = await callTool('get_canonical_recommendations', { category: 'CRM' });
  assert.equal(upper.parsed.recommendation.use, 'FallCRM-Elite-v3');
});

// ---------------------------------------------------------------------------
// HTTP surface: convenience routes, discovery, CORS
// ---------------------------------------------------------------------------
test('GET /tools and GET /mcp.json expose the same twelve-tool manifest', async () => {
  const tools = await get('/tools');
  assert.equal(tools.body.tools.length, 12);
  const mcp = await get('/mcp.json');
  assert.equal(mcp.body.name, 'kcc-bridge');
  assert.equal(mcp.body.protocol, 'mcp/2024-11-05');
  assert.equal(mcp.body.transport, 'http');
  assert.equal(mcp.body.tools.length, 12);
});

test('GET / serves the discovery page reflecting the live tool count', async () => {
  const { status, res, body } = await get('/');
  assert.equal(status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.ok(body.includes('KCC Bridge'));
  assert.ok(body.includes('Tools (12)')); // the count is templated from TOOLS.length
});

test('an unknown convenience tool route returns 404', async () => {
  const { status, body } = await get('/tool/does_not_exist');
  assert.equal(status, 404);
  assert.match(body.error, /unknown tool: does_not_exist/);
});

test('a preflight OPTIONS request returns 204 with open CORS headers', async () => {
  const res = await worker.fetch(new Request('http://bridge.test/', { method: 'OPTIONS' }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-methods'), /POST/);
});
