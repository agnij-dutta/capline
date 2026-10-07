# CAPLINE

[![npm](https://img.shields.io/npm/v/capline)](https://www.npmjs.com/package/capline)

### Cross-chain spend authority for AI agents.

**Jailbreak the model all you want. It still can't pay over its signed mandate.**

> The cap isn't in the prompt. It's a contract the LLM can't talk to.

**[▶ Live demo](https://capline-protocol.vercel.app)** · **[🤖 Agent gallery](https://capline-protocol.vercel.app/agents)** · **[📦 `npm i capline`](https://www.npmjs.com/package/capline)** · Solana · Avalanche · Stellar · x402 + AP2

---

## See it stop a jailbreak: clone and run, no funds

![An AI agent gets jailbroken and still can't overspend](examples/agent/attack.gif)

```bash
git clone https://github.com/agnij-dutta/capline && cd capline/examples/agent
npm install && npm run attack
```

A real AI agent with one payment tool and a `$5/tx · $20 total` mandate. Try to jailbreak it into overspending, every attack is refused in your terminal, **zero on-chain funds required**. → [`examples/agent`](examples/agent)

---

## Would you give an AI agent your wallet?

`x402` gave agents the ability to **pay**. `ERC-8004` gave them an **identity**. Neither answers the question that matters the moment an agent holds a wallet:

> **"How much is this agent allowed to spend, and who says so?"**

Today the answer is a sentence in a system prompt: *"never spend more than $5."* That is not a security control. **The prompt is the attack surface.** One prompt injection and your agent drains the wallet.

Capline moves the limit **out of the prompt and onto the chain.** A principal grants a bounded, revocable spend **mandate** to an agent's on-chain identity. Enforcement lives in a contract the LLM cannot reach. The worst a fully jailbroken brain can do is *ask* to overpay, and the ask is rejected by code that doesn't read prompts.

## Add it in 10 seconds

```ts
import { withCapline } from "capline/evm";

// the agent's brain calls this. it holds NO key.
const xPayment = await withCapline({ signer, mandateId }).pay(paymentRequirements);
//   returns a signed x402 payment ONLY if it fits the on-chain mandate
//   throws MandateExceeded otherwise. the agent physically cannot overspend.
```

No model changes. One wrapper around your existing x402 client. Also `capline/solana`, `capline/coordinator` (the cross-chain global cap), and `capline` (chains + AP2 hashing).

## It's live on Avalanche Fuji

Not a mockup. Deployed and verifiable. Query the contract yourself:

```bash
cast call 0x40367742b16c3DDa51B123751699032c5E446aF5 \
  "checkAllowance(bytes32,uint256)(bool,string)" \
  0x72a143ccb480da1190e7d549e2b8f8da2317039f7a13713e7be84b936ec17140 1000000000 \
  --rpc-url https://api.avax-test.network/ext/bc/C/rpc
# -> false, "OVER_PER_TX"   (1000 USDC against a 5 USDC/tx mandate)
```

| | Address (Fuji, chain 43113) |
|---|---|
| **MandateRegistry** | [`0x40367742b16c3DDa51B123751699032c5E446aF5`](https://testnet.snowtrace.io/address/0x40367742b16c3DDa51B123751699032c5E446aF5) |
| **IdentityRegistry** (ERC-8004) | [`0xAF379a047DA00D6ea3271F577BEB6D43EB97f8d6`](https://testnet.snowtrace.io/address/0xAF379a047DA00D6ea3271F577BEB6D43EB97f8d6) |
| USDC (Circle, EIP-3009) | [`0x5425890298aed601595a70AB815c96711a31Bc65`](https://testnet.snowtrace.io/address/0x5425890298aed601595a70AB815c96711a31Bc65) |

The [live dapp](https://capline-protocol.vercel.app/app) lets you grant a mandate, watch the cap meter, and **prompt-inject the agent yourself** to see it refused off-chain and reverted on-chain.

## How it works

```
  Principal (you)                                    The LLM sits OUTSIDE
       │ grants scoped mandate                       the trust boundary.
       │ (cap / payee / expiry)                      Prompt injection changes
       ▼                                             the agent's intent,
  ┌─────────────────┐   controls    ┌──────────────┐ never its authority.
  │ ERC-8004        │◄──────────────│ Agent Brain  │  ← can be jailbroken
  │ Identity (NFT)  │               │  (LLM)       │  ← holds no key
  └─────────────────┘               └──────┬───────┘
       │ bound to                          │ proposePayment(to, value)
       ▼                                   ▼
  ┌───────────────────────────┐    ┌───────────────────┐
  │ MandateRegistry           │    │ Constrained Signer│  LAYER A
  │  maxPerTx / maxCumulative  │◄───│ signs ONLY if     │  refuses to sign
  │  payee allowlist / expiry  │    │ in-bounds         │  out-of-bounds
  │  settle() REVERTS if over  │    └─────────┬─────────┘
  └────────────▲──────────────┘              │ x402 payment (EIP-3009)
     LAYER B   │                             ▼
  on-chain     └──────────── settle ──── Facilitator → USDC moves
```

**Two layers, both real:**

- **Layer A, the Constrained Signer.** A process that holds the agent's key (the brain doesn't). It reads the mandate and signs the EIP-3009 authorization *only* if `value <= maxPerTx`, the payee is allowed, and the cumulative cap holds, counting every authorization it has already signed. Its logic compares numbers; no prompt changes `1000 > 5`.
- **Layer B, the on-chain backstop.** `settle` re-checks every cap and **reverts** before the money moves. How far that reaches depends on where the money sits:

| | Funds held by | A stolen agent key can... |
|---|---|---|
| **Solana** | a vault owned by the mandate PDA | only call `settle`, so at most the remaining budget, to allowlisted merchants |
| **Stellar** | the mandate contract | only call `settle`, same bound |
| **EVM** (Avalanche, Base) | the agent's own wallet | move that wallet's USDC directly, bypassing the registry |

On EVM the registry binds settlements routed through it, and Layer A is what keeps signed authorizations in bounds. Fund the EVM agent wallet with no more than the mandate's budget. An escrow-based EVM registry that closes this gap is the planned v2. Details, and every other finding from the independent review: **[SECURITY.md](SECURITY.md)**.

## Try the jailbreak locally (about 60 seconds)

```bash
git clone https://github.com/agnij-dutta/capline && cd capline
npm install
npm run demo
```

Boots a local EVM (anvil), deploys the contracts, and runs three scenarios on a real chain. No testnet funds needed:

1. **Legitimate purchase.** Agent buys data for 5 USDC, settles on-chain. ✓
2. **No Capline.** A naive agent reads a poisoned resource and gets drained of 1000 USDC. ✗
3. **With Capline.** *Identical attack*, defeated twice: the signer refuses (Layer A), and a 1000 USDC authorization signed with the stolen key and settled through the mandate is reverted on-chain with `CapExceeded` (Layer B). ✓ (On EVM a stolen key could also skip the registry and move the wallet's USDC directly; see the table above.)

```bash
npm run test:contracts   # 22 forge tests: 16 behavior (per-tx, cumulative, revoke, expiry, payee)
                         # + 6 that pin the known EVM limitations (SECURITY.md)
```

## Repo layout

| Path | What |
|---|---|
| `sdk/` | The published **`capline`** npm package. Subpath exports: `capline`, `capline/coordinator`, `capline/evm`, `capline/solana`. |
| `examples/agent/` | **Clone-and-run reference agent** (the GIF above). Real Groq brain + one payment tool, gated by a mandate. Zero funds. |
| `contracts/` | Foundry (EVM). `MandateRegistry.sol` (the primitive) + minimal ERC-8004 `IdentityRegistry.sol` + tests + deploy script. |
| `solana/` | Anchor program (Solana). `create_mandate` / `settle` / `revoke` / on-chain ed25519 AP2 attestation. LiteSVM tests. |
| `soroban/` | Soroban contract (Stellar). Mirrors the enforcement primitive; deployed to testnet. |
| `web/` | Next.js landing + Control Room + the **cross-chain agent gallery** (`/agents`) + the coordinator API (`/api/coordinator`). |
| `mcp/` | The published **`capline-mcp`** server (pinned mode for real agents, demo mode for trying it). |
| `src/` | Original EVM TS SDK + local `npm run demo` (anvil). Demo code; the maintained SDK is `sdk/`. |

Payments use the real **x402 v1.2.0** wire format (signed EIP-3009 `X-PAYMENT` headers). **The SDK is published:** `npm i capline`.

## Tests

| Component | Command | Tests |
|---|---|---|
| Solana program | `cd solana && anchor build --ignore-keys && cargo test --release` | 15 LiteSVM + 1 unit |
| EVM contracts | `cd contracts && forge test` | 22 |
| Soroban contract | `cd soroban && cargo test` | 8 |
| SDK | `cd sdk && npm test` | 16 |
| Coordinator | `cd web && npx tsx lib/coordinator.smoke.ts` | 44 checks |
| MCP server | `cd mcp && npm test` | 3 |

CI runs all of them (`.github/workflows/ci.yml`). See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md).

## Deploy your own to Fuji

```bash
cd contracts
cp ../.env.example .env     # add a funded testnet PRIVATE_KEY
forge script script/Deploy.s.sol --rpc-url $FUJI_RPC --broadcast
cp ../deployments/fuji.json ../web/lib/deployments.json   # point the dapp at it
```

One broadcast deploys the IdentityRegistry and MandateRegistry, registers a demo agent, seeds a demo mandate (5 USDC/tx, 20 lifetime), and writes `deployments/fuji.json`. Fund a burner from the [Avalanche faucet](https://faucet.avax.network); test USDC from the [Circle faucet](https://faucet.circle.com).

## Why this is a primitive, not an app

The standardization surface is tiny. Three additions another agent builder can adopt in an afternoon:

1. **The `MandateRegistry` contract**, an *Authority Registry* that slots beside ERC-8004's Identity / Reputation / Validation registries.
2. **One x402 header field**, `mandateId` in the `X-PAYMENT` payload, so sellers can require mandate-backed buyers.
3. **One ERC-8004 agent-card field**, `authority: { mandateRegistry, mandates }`, resolvable on-chain.

Built on [x402](https://github.com/coinbase/x402) + [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) + [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009), and Google's [AP2](https://github.com/google-agentic-commerce/AP2) for the signed intent.

## Roadmap

- **Escrow-based EVM registry (v2).** Hold the budget in the registry instead of the agent's wallet, so the EVM guarantee matches Solana and Stellar against a stolen key (SECURITY.md C-1, C-2, M-3).
- **On-chain ticket verification.** Have each chain's `settle` check a coordinator attestation, so the cross-chain cap binds more than cooperative clients (H-2).
- **Upgrade authority** on a multisig, or an immutable program, before any mainnet deploy (M-2).
- **`close_mandate`** on Solana to reclaim rent.

The fixes from the October 2026 review are in the repo but not yet deployed: see [docs/UPGRADE-PLAN.md](docs/UPGRADE-PLAN.md).

## License and author

MIT. Built by Agnij Dutta ([@0xholmesdev](https://x.com/0xholmesdev)). Contributions welcome: [CONTRIBUTING.md](CONTRIBUTING.md).

> The model obeyed you. The chain didn't.
