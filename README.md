# kcc-bridge · v1.0.0

> MCP server exposing the AI Native Solutions estate as a toolbelt for any compatible LLM agent. Phase D of the provenance economy.

**Worker endpoint:** https://kcc-bridge.sjgant80.workers.dev/
**Docs + discovery:** https://sjgant80-hub.github.io/kcc-bridge/
**Source:** https://github.com/sjgant80-hub/kcc-bridge
**Spec:** https://sjgant80-hub.github.io/kcc-mint/SPEC-KCC-MINT-001.md

## What it is

A Cloudflare Worker implementing MCP-over-HTTP (Model Context Protocol). Exposes the entire AI Native Solutions estate (~100 sovereign seeds + provenance economy + agent marketplace) as 10 callable tools to any MCP-compatible LLM agent.

## The 10 tools

| Tool | What |
|---|---|
| `list_seeds` | Every seed in the estate · filter by category / level / tags |
| `get_seed_manifest` | Full KccProject UDT manifest for one seed |
| `get_seed_readme` | README.md fetched from GitHub |
| `get_estate_overview` | High-level summary (thesis, kcc stack, attribution, next steps for new users) |
| `read_kcc_mint_spec` | Full KCC-MINT-001 spec markdown |
| `prepare_bid_template` | Unsigned bid bundle template (caller signs locally) |
| `prepare_fork_mint_template` | Unsigned fork-mint bundle template |
| `prepare_job_template` | Unsigned job bundle template |
| `lookup_kpid` | Resolve a kpid in the public registry |
| `get_hook_config` | Current KCC hook configuration (pubkey, parent_root_kpid, anchor_chain, api_endpoint, mesh_lib) |

## Connect Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "kcc-bridge": {
      "url": "https://kcc-bridge.sjgant80.workers.dev/"
    }
  }
}
```

Restart Claude Desktop. The 10 tools appear in the tool picker. Try asking:

- *"What's in the AI Native Solutions estate?"*
- *"Find me a sovereign seed for compliance posture"*
- *"Generate a bid template for job kpid X with my agent kpid Y at 5 KCC"*
- *"Show me the KCC-MINT-001 spec"*
- *"What's the current hook configuration?"*

## Connect OpenAI Custom GPT

GPT Builder → Actions → Add Action. Point at `/mcp.json` for the manifest, or use `/tools` to inspect the schemas.

## Connect n8n / Zapier / make / curl

HTTP Request node → POST to the endpoint → body is a JSON-RPC 2.0 envelope:

```bash
curl -X POST https://kcc-bridge.sjgant80.workers.dev/ \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Or simpler · GET convenience routes:

```bash
curl https://kcc-bridge.sjgant80.workers.dev/tool/get_estate_overview
curl 'https://kcc-bridge.sjgant80.workers.dev/tool/list_seeds?level=0'
curl 'https://kcc-bridge.sjgant80.workers.dev/tool/get_seed_manifest?name=fallnote'
curl 'https://kcc-bridge.sjgant80.workers.dev/tool/list_seeds?tags=compliance,uk'
```

## What it does NOT do

- **Hold your keys.** Bundle-generation tools return UNSIGNED templates. You sign locally with your own Ed25519 key.
- **Read user IndexedDB.** User-minted bundles live in browser-local storage. The bridge only sees public registry. Cross-user lookup will work when kp2p mesh sync activates.
- **Settle KCC.** Settlement happens via acceptance signatures in kcc-jobs (human-in-the-middle still, by design).

## Sovereignty contract

- **Stateless** · Worker holds no user data
- **No key custody** · bundle-generation returns unsigned templates
- **CORS open** · any origin can call
- **MIT** · fork worker.js for your own estate (replace `ESTATE_ORIGIN`)
- **No auth** · everything exposed is public · Cloudflare free tier (100k req/day)
- **No telemetry** · only Cloudflare's standard request log

## Deploy your own fork

```bash
cd kcc-bridge/
npm install -g wrangler
wrangler login
wrangler deploy
```

Edit `ESTATE_ORIGIN` constant in `worker.js` to point at your own estate's GitHub Pages registry.

## License

MIT. Fork freely.

## Built by

Simon Gant · prime 1327 · part of the AI Native Solutions estate · ◊·κ=1
