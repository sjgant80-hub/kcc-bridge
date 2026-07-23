# kcc-bridge · design note

Version: 1.1.0 · protocol: MCP `2024-11-05` over JSON-RPC 2.0 · runtime: Cloudflare Worker.

## Purpose

`kcc-bridge` is a single stateless HTTP endpoint that adapts a static, public
data estate (a GitHub Pages registry plus per-seed manifests and READMEs) into a
tool interface an LLM agent can call. It speaks the Model Context Protocol so
that Claude Desktop, OpenAI Custom GPTs, and generic JSON-RPC clients can list
and invoke the same twelve tools without bespoke integration code.

The worker holds no user data and no keys. Read tools proxy public content;
generation tools return **unsigned** canonical-JSON templates that the caller
signs locally with their own Ed25519 key.

## Data model

The exported unit is the Worker `fetch` handler. Internally:

- `TOOLS` — an ordered array of tool descriptors, each `{ name, description,
  inputSchema }` where `inputSchema` is a JSON Schema `object`. This array is the
  single source of truth: it is returned by `tools/list`, embedded in
  `/mcp.json`, and rendered into the discovery page, so all three always report
  the same count and names.
- `HANDLERS` — a name → async function map. `tools/call` and the `/tool/<name>`
  convenience route both dispatch through it.
- `KCC_CONST` — frozen protocol constants (primes, primorial, phi, kappa, the
  konomi public key) stamped into every generated template.

A generated template is a `KccProject` object with a `mint` block. Unsigned
templates always carry `mint.minter_sig_b64 === null` and a
`<INSERT_YOUR_PUBLIC_KEY_HERE_BASE64>` placeholder in `mint.minter_pubkey_b64`.

## Transport and routing

- `POST /` — JSON-RPC 2.0. Methods: `initialize`, `tools/list`, `tools/call`,
  `ping`. A JSON array body is a batch and yields an array of responses.
- `GET /` — human discovery page (HTML).
- `GET /mcp.json` — manifest (tools + endpoint metadata).
- `GET /tools` — the tool array as JSON.
- `GET /tool/<name>?...` — invoke a tool with query params, without the JSON-RPC
  envelope. The router coerces query strings to booleans/numbers and splits
  `tags` on commas before dispatch.
- `OPTIONS` — CORS preflight, `204` with `Access-Control-Allow-Origin: *`.

## Invariants

1. `TOOLS.length`, the `tools/list` count, the `/mcp.json` tool count, and the
   `Tools (N)` heading on the discovery page are all equal.
2. Every entry in `TOOLS` has a corresponding key in `HANDLERS`, and every
   descriptor exposes an `inputSchema` of `type: "object"`.
3. `initialize.serverInfo.version` equals `get_hook_config.bridge_version` (both
   read the module `VERSION`).
4. Generation tools are pure and network-free: identical arguments produce
   identical templates. Numeric fields are coerced with `Number()` regardless of
   whether the caller passed a number or a numeric string.
5. `prepare_bid_template` names the bundle `bid-<last 8 chars of job_kpid>`;
   `prepare_job_template` slugifies the title as `toLowerCase()` with every run
   of non-`[a-z0-9]` folded to a single `-`, truncated to 32 characters.
6. Unsigned templates never contain a signature (`minter_sig_b64 === null`).
7. A malformed request never throws to the client: JSON-RPC errors use the
   standard codes (`-32600`, `-32601`, `-32700`); tool-level failures return an
   MCP `isError` envelope (or a `400`/`404` on the GET routes).

## Determinism

The suite in `test.mjs` exercises only invariants 1–7 above, all of which are
network-free, so the tests are hermetic. Tools that fetch the remote registry
(`list_seeds`, `get_estate_overview`, `get_seed_manifest`, `get_seed_readme`,
`read_kcc_mint_spec`, `lookup_kpid`, `get_credentials_and_authority`) depend on
live public content and are out of scope for the offline suite.

## Versioning

The module constant `VERSION` is the release identity and is surfaced through
`initialize` and `get_hook_config`. `package.json` version tracks it. The tool
contract (`TOOLS`) is additive: new tools append to the array; existing tool
names and argument shapes are not repurposed.
