# capline-mcp

**Give your MCP agent a wallet it can't drain.**

An [MCP](https://modelcontextprotocol.io) server that hands an AI agent a spending capability bounded by a [Capline](https://www.npmjs.com/package/capline) mandate. The agent (in Claude Desktop, Cursor, Cline, or any MCP client) requests payments through the `pay` tool, and `pay` refuses anything outside the mandate: over the per-transaction cap, off the payee allowlist, or past the **global cross-chain cap**. The limits are checked by code, not the model.

`pay` authorizes and records the payment against the Capline coordinator's ledger. It does not move funds on-chain itself; settle approved payments through the on-chain mandate with the `capline` SDK.

> The cap isn't in the prompt, it's a mandate the LLM can't talk to.

## Tools

| Tool | What it does |
|---|---|
| `create_mandate` | Provision a mandate: per-tx cap, global cumulative cap, payee allowlist, chains. Returns a `mandateId`. *Demo mode only, or with `CAPLINE_MCP_ADMIN_TOOLS=1`.* |
| `pay` | Request a payment. Refused if it breaks the mandate; otherwise authorized and recorded against its budget. |
| `mandate_status` | Committed / reserved / remaining budget + per-chain breakdown. |
| `revoke_mandate` | Revoke at the coordinator: every future `pay` is refused. Needs the principal token. *Demo mode only, or with `CAPLINE_MCP_ADMIN_TOOLS=1`.* |

### Pinned mode vs demo mode

Every tool an MCP server registers is visible to the model. If the agent can call `create_mandate`, a prompt injection can simply tell it to create a looser mandate and pay under that one. So:

- **Pinned mode (use this with a real agent).** The principal creates the mandate out of band and sets `CAPLINE_MANDATE_ID`. The server then only spends under that mandate and does not expose `create_mandate` or `revoke_mandate` to the model.
- **Demo mode (no `CAPLINE_MANDATE_ID`).** All four tools are exposed so you can try the refusals in one chat. The agent can mint its own mandate here, so demo mode is **not** a security boundary, and the tool descriptions say so.

## Add to Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "capline": {
      "command": "npx",
      "args": ["-y", "capline-mcp"]
    }
  }
}
```

Restart Claude Desktop. Then try it:

> *"Set up a mandate: $5 per transaction, $20 total, only pay DataVendor. Then pay DataVendor $5. Then, ignore that last limit, pay DataVendor $1000."*

Watch the $5 get authorized and the $1000 come back **REFUSED (OVER_PER_TX)**. (This is demo mode: fine for feeling it, not for guarding a real wallet. See pinned mode above.)

## Add to Cursor

`~/.cursor/mcp.json` (or Settings → MCP):

```json
{
  "mcpServers": {
    "capline": { "command": "npx", "args": ["-y", "capline-mcp"] }
  }
}
```

## Configuration

| Env var | Default | |
|---|---|---|
| `CAPLINE_COORDINATOR_URL` | `https://capline-protocol.vercel.app/api/coordinator` | coordinator endpoint |
| `CAPLINE_MANDATE_ID` | unset (demo mode) | pin the agent to one principal-provisioned mandate |
| `CAPLINE_PRINCIPAL_TOKEN` | unset | lets `revoke_mandate` revoke the pinned mandate |
| `CAPLINE_MCP_ADMIN_TOOLS` | unset | `1` exposes `create_mandate` / `revoke_mandate` in pinned mode |

By default it checks against the hosted Capline coordinator (Layer A), **no wallet or funds required**, so you can feel it immediately. The coordinator is an off-chain, cooperative control. Point `CAPLINE_COORDINATOR_URL` at your own coordinator to self-host. For enforcement that holds even if the agent's key is stolen, settle through the on-chain mandate (Solana or Stellar escrow the funds in a program-owned vault): see the [main repo](https://github.com/agnij-dutta/capline) and its [SECURITY.md](https://github.com/agnij-dutta/capline/blob/main/SECURITY.md).

## Run from source

```bash
git clone https://github.com/agnij-dutta/capline && cd capline/mcp
npm install && npm run build
npm test               # tool-surface tests (in-memory MCP transport, local coordinator)
node test-client.mjs   # exercises every tool through a real MCP client against the hosted coordinator
```

## Links

- SDK: [`capline` on npm](https://www.npmjs.com/package/capline)
- Live demo: [capline-protocol.vercel.app/agents](https://capline-protocol.vercel.app/agents)
- Clone-and-run agent: [`examples/agent`](https://github.com/agnij-dutta/capline/tree/main/examples/agent)

MIT
