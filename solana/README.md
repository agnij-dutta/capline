# Capline: Solana

**On-chain spend authority for AI agents.** Jailbreak the model all you want, it still can't pay outside its signed mandate.

> The cap isn't in the prompt. It's a contract the LLM can't talk to.

This is the Solana port of Capline, moved **up-stack** from the EVM original. Where Solana's native allowance primitive enforces a single number, Capline enforces the whole **AP2 Intent Mandate** the number came from: a per-transaction cap, a cumulative cap, an expiry window, and a merchant allowlist, all committed on-chain and enforced at settlement.

## Why this, why now

- `x402` gave agents the ability to **pay**. Google's **AP2** gave a user the ability to **sign** a spending intent ("up to $50, only these merchants, only this week"). But AP2 is a permission framework, not a rail, **nothing forces a payment to obey the signed intent.**
- On Solana (June 2026) the Foundation shipped a native *numeric* allowance. It can't read AP2's constraints.
- **Capline is the missing enforcement.** It hashes the signed AP2 mandate, commits it on-chain, and rejects any `x402` settlement that violates it, before the money moves.

## The program (`programs/capline`)

A single Anchor program. State is a `Mandate` PDA that owns a token vault the agent can only spend *through* `settle`:

| Instruction | Who | What it enforces |
|---|---|---|
| `create_mandate` | principal | binds `ap2_hash`, caps, expiry, merchant allowlist (max 8); opens a vault PDA owned by the mandate PDA. Classic SPL Token mints only (Token-2022 is rejected). |
| `settle` | agent (key may be compromised) | **amount > 0 · not revoked · not expired · signer is the agent · amount ≤ max_per_tx · spent+amount ≤ total_cap · merchant ∈ allowlist · destination owned by that merchant, same mint**, then CPI-transfers from the mandate's own vault |
| `attest_ap2` | principal | verifies (via the native Ed25519 program, introspected) that the principal ed25519-signed the AP2 message whose sha256 is `ap2_hash`; sets `ap2_verified`. Informational: `settle` does not depend on it. |
| `revoke` | principal | flips the mandate dead; next `settle` reverts |
| `withdraw_unspent` | principal | reclaims whatever the agent didn't spend (any time, to any token account the principal chooses) |

Enforcement is **Layer B**: the money sits in a vault owned by the mandate PDA, so even a fully compromised agent key, prompt-injected to pay 1000 USDC to a scammer, is reverted on-chain. The most a stolen agent key can do is spend the remaining budget to allowlisted merchants, which is what the mandate allows. The SDK's `withCapline` is **Layer A**: it mirrors the on-chain checks and refuses to even build the transaction off-chain.

Error codes are stable and append-only (`6000` MandateRevoked through `6015` Ap2HashMismatch; `6016` ZeroAmount and `6017` Ap2ProofNotSelfContained were added by the security review and are live only after the next upgrade, see [`docs/UPGRADE-PLAN.md`](../docs/UPGRADE-PLAN.md)).

## The SDK (`app/`)

```ts
import { withCapline } from "./app/withCapline";

const client = withCapline({ program, mandate, agent });
const sig = await client.pay({ merchant, merchantTokenAccount, amount });
//   sends x402 settlement ONLY if it fits the on-chain mandate
//   throws MandateExceeded otherwise; the agent physically cannot overspend
```

`app/ap2.ts` builds and hashes the AP2 Intent Mandate that the on-chain policy is bound to.

## Build & test

```bash
# toolchain: Rust, Solana (Agave) CLI, Anchor 1.1.x via avm
anchor build --ignore-keys   # program ID is pinned in lib.rs; a locally generated target/deploy keypair won't match it
cargo test --release -- --nocapture   # 15 LiteSVM tests + CU bench (deterministic keys)

# live x402 loop (needs a running validator + deployed program):
solana-test-validator &                 # local cluster
anchor deploy                           # deploy the program
node x402/demo.mjs                       # agent↔seller: 402 → pay → 200, jailbreaks blocked
```

Compute units, measured by the LiteSVM tests (release build of the program, deterministic test keys, Anchor 1.1.2): `create_mandate` 20,680 · `settle` 14,590 · `attest_ap2` 6,031. `create_mandate` depends on the principal key and nonce: it searches for two PDA bumps, and each extra search iteration costs about 1,500 CU (random keys have produced 20,680 to 31,180). `settle` and `attest_ap2` use the stored bump and do not vary. These are for the code in this repo; the build currently deployed on devnet measured `settle` 14,589 and `attest_ap2` 6,061 under the same conditions.

## The x402 loop (`x402/demo.mjs`)

A real HTTP 402 handshake with Solana settlement: the agent hits a paid endpoint,
gets `402 Payment Required` + x402 `PaymentRequirements`, pays **through
`withCapline`**, retries with the settled tx signature as proof, and gets `200`.
A jailbroken agent told to overpay or pay a scammer is stopped (Layer A refusal
or on-chain `settle` revert), no proof, no content, no funds moved.

## What's inherited from the EVM original vs new

- **Reused:** the whole thesis + brand, the `withCapline` wrapper shape, the 3-scenario attack demo, the AP2/x402 framing.
- **New for Solana:** the Anchor program (Rust rewrite), multi-dimensional AP2 enforcement (vs a single cap), and the plan to *consume* Solana's official Agent Registry (identity) and compose with the native allowance primitive rather than reimplement them.

## Live on devnet

Program `DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp` is deployed to **devnet**:
[view on Solana Explorer](https://explorer.solana.com/address/DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp?cluster=devnet).
The web app's Control Room has two paths: an **instant burner demo** (localnet,
zero setup) and **"provision with my wallet"** (connect Phantom/Solflare, your
wallet becomes the mandate principal and ed25519-signs the AP2 intent). Point the
app at devnet via `NEXT_PUBLIC_CLUSTER=devnet` (see `web/.env.example`).

Program ID (localnet/devnet): `DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp`
