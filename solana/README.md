# Capline — Solana

**On-chain spend authority for AI agents.** Jailbreak the model all you want — it still can't pay outside its signed mandate.

> The cap isn't in the prompt. It's a contract the LLM can't talk to.

This is the Solana port of Capline, moved **up-stack** from the EVM original. Where Solana's native allowance primitive enforces a single number, Capline enforces the whole **AP2 Intent Mandate** the number came from: a per-transaction cap, a cumulative cap, an expiry window, and a merchant allowlist — all committed on-chain and enforced at settlement.

## Why this, why now

- `x402` gave agents the ability to **pay**. Google's **AP2** gave a user the ability to **sign** a spending intent ("up to $50, only these merchants, only this week"). But AP2 is a permission framework, not a rail — **nothing forces a payment to obey the signed intent.**
- On Solana (June 2026) the Foundation shipped a native *numeric* allowance. It can't read AP2's constraints.
- **Capline is the missing enforcement.** It hashes the signed AP2 mandate, commits it on-chain, and rejects any `x402` settlement that violates it — before the money moves.

## The program (`programs/capline`)

A single Anchor program. State is a `Mandate` PDA that owns a token vault the agent can only spend *through* `settle`:

| Instruction | Who | What it enforces |
|---|---|---|
| `create_mandate` | principal | binds `ap2_hash`, caps, expiry, merchant allowlist; opens a vault PDA |
| `settle` | agent (key may be compromised) | **not revoked · not expired · amount ≤ max_per_tx · spent+amount ≤ total_cap · merchant ∈ allowlist**, then CPI-transfers from the vault |
| `revoke` | principal | flips the mandate dead; next `settle` reverts |
| `withdraw_unspent` | principal | reclaims whatever the agent didn't spend |

Enforcement is **Layer B** — even a fully compromised agent key, prompt-injected to pay 1000 USDC to a scammer, is reverted on-chain. The SDK's `withCapline` is **Layer A** — it refuses to even build the transaction off-chain. Two independent walls.

## The SDK (`app/`)

```ts
import { withCapline } from "./app/withCapline";

const client = withCapline({ program, mandate, agent });
const sig = await client.pay({ merchant, merchantTokenAccount, amount });
//   sends x402 settlement ONLY if it fits the on-chain mandate
//   throws MandateExceeded otherwise — the agent physically cannot overspend
```

`app/ap2.ts` builds and hashes the AP2 Intent Mandate that the on-chain policy is bound to.

## Build & test

```bash
# toolchain: Rust, Solana (Agave) CLI, Anchor 1.1.x via avm
anchor build
cargo test           # Rust + LiteSVM: 4-scenario enforcement + ed25519 AP2 attestation + CU bench

# live x402 loop (needs a running validator + deployed program):
solana-test-validator &                 # local cluster
anchor deploy                           # deploy the program
node x402/demo.mjs                       # agent↔seller: 402 → pay → 200, jailbreaks blocked
```

## The x402 loop (`x402/demo.mjs`)

A real HTTP 402 handshake with Solana settlement: the agent hits a paid endpoint,
gets `402 Payment Required` + x402 `PaymentRequirements`, pays **through
`withCapline`**, retries with the settled tx signature as proof, and gets `200`.
A jailbroken agent told to overpay or pay a scammer is stopped (Layer A refusal
or on-chain `settle` revert) — no proof, no content, no funds moved.

## What's inherited from the EVM original vs new

- **Reused:** the whole thesis + brand, the `withCapline` wrapper shape, the 3-scenario attack demo, the AP2/x402 framing.
- **New for Solana:** the Anchor program (Rust rewrite), multi-dimensional AP2 enforcement (vs a single cap), and the plan to *consume* Solana's official Agent Registry (identity) and compose with the native allowance primitive rather than reimplement them.

Program ID (localnet/devnet): `DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp`
