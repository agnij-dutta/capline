# 🔒 Capline

**On-chain spend authority for AI agents. Your agent can be fully jailbroken and still can't pay a cent over its mandate.**

> Try the jailbreak yourself — **time-to-first-revert ≈ 60 seconds:**
> ```bash
> git clone https://github.com/agnij-dutta/capline && cd capline && npm install && npm run demo
> ```
> Boots a local EVM, deploys the contracts, prompt-injects an agent into sending 1000 USDC to a scammer, and shows the chain reject it. No testnet funds needed.

---

`x402` gave agents the ability to **pay**. `ERC-8004` gave them an **identity**. Neither answers the question that actually keeps you up at night once your agent holds a wallet:

> **"How much is this agent allowed to spend, and who says so?"**

Today the answer is a sentence in a system prompt — *"never spend more than $5."* **That's not a security control. The prompt is the attack surface.** One prompt injection and your agent drains the wallet.

Capline moves the limit **out of the prompt and onto the chain.** A principal grants a bounded, revocable spend **mandate** to an agent's on-chain identity. Enforcement lives in a contract the LLM cannot talk to. The worst a fully jailbroken brain can do is *ask* to overpay — and the ask is rejected by code that doesn't read prompts.

## The 10-second version

```ts
import { withMandate } from "capline";

// the agent's brain calls this. it holds NO key.
const auth = await withMandate({ signer, mandateId }).pay(paymentRequirements);
//   → returns a signed x402 payment ONLY if it fits the on-chain mandate
//   → throws MandateExceeded otherwise. the agent physically cannot overspend.
```

## How it works

```
  Principal (you)                                    The LLM sits OUTSIDE
       │ grants scoped mandate                       the trust boundary.
       │ (cap / payee / expiry)                      Prompt injection changes
       ▼                                             the agent's intent —
  ┌─────────────────┐   controls    ┌──────────────┐ never its authority.
  │ ERC-8004        │◄──────────────│ Agent Brain  │  ← can be jailbroken
  │ Identity (NFT)  │               │  (LLM)       │  ← holds no key
  └─────────────────┘               └──────┬───────┘
       │ bound to                          │ proposePayment(to, value)
       ▼                                   ▼
  ┌──────────────────────────┐     ┌───────────────────┐
  │ MandateRegistry          │     │ Constrained Signer│  LAYER A
  │  maxPerTx / maxCumulative │◄────│ signs ONLY if     │  refuses to sign
  │  payee allowlist / expiry │     │ in-bounds         │  out-of-bounds
  │  settle() REVERTS if over │     └─────────┬─────────┘
  └────────────▲─────────────┘               │ x402 payment (EIP-3009)
     LAYER B   │                              ▼
  on-chain,    └──────────── settle ──── Facilitator → USDC moves
  even if the key is stolen
```

**Two layers, both real:**

- **Layer A — Constrained Signer.** A process that holds the agent's key (the brain doesn't). It reads the mandate and signs the EIP-3009 authorization *only* if `value ≤ maxPerTx`, the payee is allowed, and the cumulative cap holds. Its logic compares numbers; no prompt changes `1000 > 5`.
- **Layer B — On-chain backstop.** `MandateRegistry.settle()` re-checks every cap and **reverts** before USDC moves — so the mandate holds **even if the signing key itself is compromised.** This revert, on a public chain, is the unfakeable proof.

## What's in the box

| Path | What |
|---|---|
| `contracts/src/MandateRegistry.sol` | The primitive. `createMandate` (controller-gated via ERC-8004), `revoke`, `settle` (reverts `CapExceeded`). |
| `contracts/test/MandateRegistry.t.sol` | 10 tests proving the caps revert on per-tx, cumulative, revoke, expiry, payee. |
| `src/signer.ts` | The Constrained Signer (Layer A). |
| `src/withMandate.ts` | The buyer-side primitive other builders adopt. |
| `src/seller.ts` | x402 seller (402 quote) + facilitator (settles via the registry). |
| `src/agent.ts` | A deliberately gullible LLM-style brain with one payment tool. |
| `src/demo.ts` | `npm run demo` — the self-contained jailbreak-and-revert. |

## Run it

```bash
npm install
npm run test:contracts   # 10/10 — the caps revert
npm run demo             # the full contrast on a local EVM
```

The demo runs three scenarios on a real EVM:
1. **Legitimate purchase** — agent buys data for 5 USDC, settles on-chain. ✓
2. **No Mandate** — a naive agent reads a poisoned resource and gets drained of 1000 USDC. ✗
3. **With Mandate** — *identical attack*, defeated twice: the signer refuses (Layer A), and even a stolen key is reverted on-chain with `CapExceeded` (Layer B). ✓

## Deploy to Avalanche Fuji

```bash
cp .env.example .env   # add PRIVATE_KEY, IDENTITY_REGISTRY (ERC-8004 ref)
cd contracts
forge script script/Deploy.s.sol --rpc-url $FUJI_RPC --broadcast
```

USDC on Fuji is Circle's EIP-3009 testnet token `0x5425890298aed601595a70AB815c96711a31Bc65` ([faucet](https://faucet.circle.com)). Deploy the [ERC-8004 reference registries](https://github.com/erc-8004/erc-8004-contracts) for identity, then point `IDENTITY_REGISTRY` at them.

## Why this is a primitive, not an app

The standardization surface is tiny — three additions another agent builder can adopt in an afternoon:

1. **`MandateRegistry` contract** — an *Authority Registry* that slots beside ERC-8004's Identity / Reputation / Validation registries.
2. **One x402 header field** — `mandateId` in the `X-PAYMENT` payload, so sellers can require mandate-backed buyers.
3. **One ERC-8004 agent-card field** — `authority: { mandateRegistry, mandates }`, resolvable on-chain.

Built on [x402](https://github.com/coinbase/x402) + [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) + [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009). MIT licensed.

> The cap isn't in the prompt. It's a contract the LLM can't talk to.
