# CLAUDE.md · kcc-bridge

## What this is

A single Cloudflare Worker (`worker.js`) that exposes a static public data estate
as MCP tools over JSON-RPC 2.0. The only export is the `fetch` handler; there is
no build step. `SPEC.md` is the authoritative design note — read it before
changing behaviour.

## Layout

- `worker.js` — the entire server: `TOOLS` (descriptors), `HANDLERS` (impls),
  `KCC_CONST`, the JSON-RPC dispatcher, the HTTP router, and the embedded
  discovery HTML.
- `test.mjs` — hermetic behavioural suite; imports `worker.js` and drives it
  through `worker.fetch(new Request(...))`.
- `SPEC.md` — data model, routing, invariants, versioning.
- `manifest.json` / `wrangler.toml` — estate metadata and deploy config.

## Invariants an agent must preserve

1. `TOOLS` is the single source of truth for the tool list; its length must stay
   equal to the `tools/list` count, the `/mcp.json` count, and the `Tools (N)`
   heading in the discovery HTML.
2. Every `TOOLS` entry has a matching `HANDLERS` key and an `inputSchema` object.
3. `initialize.serverInfo.version` and `get_hook_config.bridge_version` both read
   the module `VERSION` and must remain equal.
4. Bundle-generation tools stay pure, deterministic, and network-free, and never
   emit a signature: unsigned templates keep `mint.minter_sig_b64 === null`.
5. JSON-RPC errors keep their standard codes (`-32600`, `-32601`, `-32700`);
   tool failures surface as an MCP `isError` envelope, never an uncaught throw.

Do not add a key-custody path, server-side state, or a runtime dependency: the
sovereignty contract in `README.md` is a hard constraint.

## How to run the tests

```
npm test
```

or directly:

```
node test.mjs
```

The suite exits non-zero if any case fails. It is offline — it never touches the
remote registry — so it needs no network access. Tools that fetch live public
content are intentionally not covered by the offline suite; verify those against
the deployed endpoint.
