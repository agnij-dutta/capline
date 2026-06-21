# CAPLINE

### On-chain spend authority for AI agents.

**Jailbreak the model all you want. It still can't pay over its on-chain mandate.**

> The cap isn't in the prompt. It's a contract the LLM can't talk to.

**[▶ Live demo + attack console](https://capline-protocol.vercel.app)** · **[Contract on Snowtrace](https://testnet.snowtrace.io/address/0x40367742b16c3DDa51B123751699032c5E446aF5)** · Avalanche Fuji · x402 + ERC-8004

---

## Would you give an AI agent your wallet?

`x402` gave agents the ability to **pay**. `ERC-8004` gave them an **identity**. Neither answers the question that matters the moment an agent holds a wallet:

> **"How much is this agent allowed to spend, and who says so?"**

Today the answer is a sentence in a system prompt: *"never spend more than $5."* That is not a security control. **The prompt is the attack surface.** One prompt injection and your agent drains the wallet.

Capline moves the limit **out of the prompt and onto the chain.** A principal grants a bounded, revocable spend **mandate** to an agent's on-chain identity. Enforcement lives in a contract the LLM cannot reach. The worst a fully jailbroken brain can do is *ask* to overpay, and the ask is rejected by code that doesn't read prompts.

## Add it in 10 seconds

```ts
import { withCapline } from "capline";

// the agent's brain calls this. it holds NO key.
const xPayment = await withCapline({ signer, mandateId }).pay(paymentRequirements);
//   returns a signed x402 payment ONLY if it fits the on-chain mandate
//   throws MandateExceeded otherwise. the agent physically cannot overspend.
```

No model changes. One wrapper around your existing x402 client.

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
  on-chain,    └──────────── settle ──── Facilitator → USDC moves
  even if the key is stolen
```

**Two layers, both real:**

- **Layer A, the Constrained Signer.** A process that holds the agent's key (the brain doesn't). It reads the mandate and signs the EIP-3009 authorization *only* if `value <= maxPerTx`, the payee is allowed, and the cumulative cap holds. Its logic compares numbers; no prompt changes `1000 > 5`.
- **Layer B, the on-chain backstop.** `MandateRegistry.settle()` re-checks every cap and **reverts** before USDC moves, so the mandate holds **even if the signing key itself is stolen.** That revert, on a public chain, is the unfakeable proof.

## Try the jailbreak locally (about 60 seconds)

```bash
git clone https://github.com/agnij-dutta/capline && cd capline
npm install
npm run demo
```

Boots a local EVM (anvil), deploys the contracts, and runs three scenarios on a real chain. No testnet funds needed:

1. **Legitimate purchase.** Agent buys data for 5 USDC, settles on-chain. ✓
2. **No Capline.** A naive agent reads a poisoned resource and gets drained of 1000 USDC. ✗
3. **With Capline.** *Identical attack*, defeated twice: the signer refuses (Layer A), and even a stolen key is reverted on-chain with `CapExceeded` (Layer B). ✓

```bash
npm run test:contracts   # 16/16 the caps revert (per-tx, cumulative, revoke, expiry, payee)
```

## Repo layout

| Path | What |
|---|---|
| `contracts/` | Foundry. `MandateRegistry.sol` (the primitive) + minimal ERC-8004 `IdentityRegistry.sol` + tests + Fuji deploy script. |
| `src/` | The TypeScript SDK + local demo: `signer.ts` (Layer A), `withCapline.ts` (the adopt API), `seller.ts` (x402 quote + facilitator), `agent.ts` (a deliberately gullible brain), `demo.ts`. |
| `web/` | Next.js landing + dapp (the live site). The interactive attack console lives in `components/AttackConsole.tsx`. |
| `marketing/` | Launch thread, demo-video script, announcement-graphic prompts. |

Payments use the real **x402 v1.2.0** wire format (signed EIP-3009 `X-PAYMENT` headers); the SDK is not yet published to npm, so install from source for now.

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

Built on [x402](https://github.com/coinbase/x402) + [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) + [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009). MIT licensed.

> The model obeyed you. The chain didn't.
