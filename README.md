# Capline

[![npm](https://img.shields.io/npm/v/capline)](https://www.npmjs.com/package/capline)

Capline puts an AI agent's spending limit in an on-chain program instead of in its prompt. A principal creates a mandate for an agent key with a per-transaction cap, a total cap, an expiry and a payee allowlist. Payments go through the program's `settle`, which rejects anything outside the mandate before tokens move. On **Solana** (Anchor program) and **Stellar** (Soroban contract) the budget sits in a program-controlled vault, so the limits hold even if the agent key is stolen. On **EVM** the funds stay in the agent's own wallet, so the on-chain check binds only payments routed through it; a stolen EVM key can bypass it. The repo also contains a TypeScript SDK (`capline` on npm), an MCP server (`capline-mcp`) and an off-chain cross-chain budget coordinator, which is advisory.

Status: testnet only (Solana devnet, Stellar testnet, Avalanche Fuji). One independent review (October 2026), no formal audit. Do not use with mainnet funds. See [SECURITY.md](SECURITY.md).

## Install and run

### Use the SDK

```bash
npm install capline @coral-xyz/anchor @solana/web3.js @solana/spl-token
```

`capline/solana` wraps the program's `settle`. `pay` reads the mandate account, refuses (throws `MandateExceeded`) if the payment would fail any on-chain check, and otherwise sends `settle`, which the program checks again. The program IDL is not in the npm package; copy [`web/lib/idl/capline.json`](web/lib/idl/capline.json) from this repo.

```ts
import { readFileSync } from "node:fs";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { withCapline, MandateExceeded } from "capline/solana";

const idl = JSON.parse(readFileSync("./capline.json", "utf8"));
const agentKey = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.AGENT_KEYPAIR!, "utf8"))),
);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const program = new Program(idl, new AnchorProvider(connection, new Wallet(agentKey), {}));

const client = withCapline({
  program,
  mandate: new PublicKey(process.env.MANDATE!), // mandate PDA, created by the principal
  agent: agentKey.publicKey,
});

try {
  const sig = await client.pay({
    merchant: new PublicKey(process.env.MERCHANT!),
    merchantTokenAccount: new PublicKey(process.env.MERCHANT_ATA!),
    amount: 2_000_000n, // base units (2 USDC)
  });
  console.log("settled", sig);
} catch (e) {
  if (e instanceof MandateExceeded) console.log("refused before signing:", e.reason);
  else throw e; // includes an on-chain revert
}
```

Other entry points: `capline/evm` (`ConstrainedSigner`, `withCapline` for x402 EIP-3009 payments, `payeeMerkleRoot`), `capline/coordinator` (`CoordinatorClient`) and `capline` (chain config, AP2 hashing). There is no Stellar client in the SDK yet; the Soroban contract is called directly.

### Run the Solana program tests

Needs Rust, the Solana (Agave) CLI and Anchor 1.1.x.

```bash
cd solana
anchor build --ignore-keys     # the program id is pinned in lib.rs; skip the local keypair check
cargo test --release           # 15 LiteSVM tests + 1 unit test, against the built .so
```

### Run the x402 demo (Solana, local validator)

An x402-style loop: a local seller returns HTTP 402, the agent pays through `settle`, retries with the transaction signature, and gets 200. It then tries to overpay, pay a non-allowlisted address, and call `settle` directly with the agent key for 1000 USDC; the last case is rejected by the program, not by client code.

```bash
cd solana
npm ci
anchor build --ignore-keys
solana-test-validator --reset \
  --bpf-program DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp target/deploy/capline.so &
node x402/demo.mjs
```

The demo's client-side check is inline in `demo.mjs` (per-tx cap and allowlist only), not the SDK's `withCapline`.

### All test suites

| Component | Command | Tests |
|---|---|---|
| Solana program | `cd solana && anchor build --ignore-keys && cargo test --release` | 15 LiteSVM + 1 unit |
| Soroban contract | `cd soroban && cargo test` | 8 |
| EVM contracts | `cd contracts && forge test` | 22 (16 behavior, 6 that pin the known EVM limitations) |
| SDK | `cd sdk && npm test` | 16 |
| MCP server | `cd mcp && npm test` | 3 |
| Coordinator | `cd web && npx tsx lib/coordinator.smoke.ts` | 44 checks |

CI runs all of them (`.github/workflows/ci.yml`).

## What the mandate enforces, per chain

| | Solana | Stellar (Soroban) | EVM (`MandateRegistry`) |
|---|---|---|---|
| Per-tx cap | yes | yes | yes |
| Total cap | yes | yes | yes |
| Expiry | yes (required, must be in the future) | yes (0 = none) | yes (0 = none) |
| Payee allowlist | yes, up to 8 merchants (an empty list means nothing can settle) | yes, optional (empty = any payee) | yes, optional Merkle root (0 = any payee) |
| Revoke by principal | yes | yes | yes |
| Funds held by | vault owned by the mandate PDA | the contract | the agent's own wallet |
| AP2 intent | sha256 stored; optional `attest_ap2` verifies the principal's ed25519 signature over it on-chain | sha256 stored, not verified | not stored |

"Signed" means: on every chain the mandate is created in a transaction the principal signs (on EVM the principal must also own the agent's ERC-8004 identity). Only Solana verifies a signature over the AP2 intent itself, through `attest_ap2`, and `settle` does not require that check to have passed.

Code: [`solana/programs/capline/src/lib.rs`](solana/programs/capline/src/lib.rs), [`soroban/contracts/mandate/src/lib.rs`](soroban/contracts/mandate/src/lib.rs), [`contracts/src/MandateRegistry.sol`](contracts/src/MandateRegistry.sol).

## Security model and limits

Two threat cases: a jailbroken model that holds no key, and a stolen agent key.

- **Solana and Stellar enforce under key theft.** The vault can only be spent through `settle`, so a stolen agent key can spend at most the remaining budget, to allowlisted payees, before expiry, until revoked.
- **EVM does not.** USDC sits in the agent's wallet, and a signed EIP-3009 authorization can be redeemed directly on the USDC contract without going through `settle`. A stolen key can move the wallet's funds. Against a jailbroken model with no key access, the SDK's `ConstrainedSigner` (off-chain) is what bounds payments; it checks the payee and counts every authorization it signs, in process memory. Fund an EVM agent wallet with no more than its mandate's budget. An escrow-based EVM registry is planned, not built.
- **The cross-chain global cap is advisory.** The coordinator is an off-chain ledger. No chain verifies its tickets and it learns of a payment only when the client reports it, so it bounds cooperating clients, not a stolen key. Each chain's own caps still apply.
- **The MCP server does not enforce on-chain.** `capline-mcp` checks payments against the coordinator and records them; it moves no funds. Run it pinned to one mandate (`CAPLINE_MANDATE_ID`) so the model cannot create or revoke mandates.
- The deployed Stellar contract predates the review fixes: it has no `withdraw_unspent` and no cap validation (fixed in code, needs a new contract id).
- The Solana devnet upgrade authority is a 2-of-3 Squads multisig, which can replace the program.

Every finding, its status and its regression test: [SECURITY.md](SECURITY.md). Rollout details: [docs/UPGRADE-PLAN.md](docs/UPGRADE-PLAN.md).

## Deployments

| Chain | Contract | Address |
|---|---|---|
| Solana devnet | Capline program | [`DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp`](https://explorer.solana.com/address/DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp?cluster=devnet) (upgrade authority: Squads vault `Eh4PGgC81KSek38h9SVvKMQuJTXPDTHGmu6TE7kFPEx1`) |
| Stellar testnet | Mandate contract | [`CAXVTUT64BWTPDH3DBSUPAIWCF2WNLXWZVWLT54DPQFFXHAFRU67CCXE`](https://stellar.expert/explorer/testnet/contract/CAXVTUT64BWTPDH3DBSUPAIWCF2WNLXWZVWLT54DPQFFXHAFRU67CCXE) |
| Avalanche Fuji | MandateRegistry | [`0x40367742b16c3DDa51B123751699032c5E446aF5`](https://testnet.snowtrace.io/address/0x40367742b16c3DDa51B123751699032c5E446aF5) |
| Avalanche Fuji | IdentityRegistry (minimal ERC-8004) | [`0xAF379a047DA00D6ea3271F577BEB6D43EB97f8d6`](https://testnet.snowtrace.io/address/0xAF379a047DA00D6ea3271F577BEB6D43EB97f8d6) |

Base Sepolia is configured in the SDK but not deployed. To check the Fuji registry yourself:

```bash
cast call 0x40367742b16c3DDa51B123751699032c5E446aF5 \
  "checkAllowance(bytes32,uint256)(bool,string)" \
  0x72a143ccb480da1190e7d549e2b8f8da2317039f7a13713e7be84b936ec17140 1000000000 \
  --rpc-url https://api.avax-test.network/ext/bc/C/rpc
# false, "OVER_PER_TX"   (1000 USDC against the demo mandate's 5 USDC per-tx cap)
```

## Live demo

[capline-protocol.vercel.app](https://capline-protocol.vercel.app) runs against Solana devnet.

- **Control Room (`/app`):** connect a devnet wallet (Phantom or Solflare) holding devnet SOL. Your wallet becomes the principal: it creates a demo SPL token, opens a mandate for a throwaway agent key, signs the AP2 intent for `attest_ap2`, and mints the budget into the mandate's vault. You then send a legitimate payment, an over-cap payment and a payment to a non-allowlisted address. All three are real devnet `settle` transactions; the last two are reverted by the program. The no-wallet burner mode is disabled on devnet (it needs airdrops) and only works against a local validator.
- **Agent gallery (`/agents`):** LLM agents on different chains share one cross-chain mandate. These payments are checked by the coordinator only; nothing settles on-chain.

## Repo layout

| Path | What |
|---|---|
| `solana/` | Anchor program (`create_mandate`, `settle`, `attest_ap2`, `revoke`, `withdraw_unspent`), LiteSVM tests, x402 demo |
| `soroban/` | Soroban mandate contract and tests |
| `contracts/` | Foundry: `MandateRegistry.sol`, minimal ERC-8004 `IdentityRegistry.sol`, tests, deploy script |
| `sdk/` | The `capline` npm package |
| `mcp/` | The `capline-mcp` npm package |
| `web/` | Next.js site, Control Room, agent gallery, coordinator API (`/api/coordinator`) |
| `examples/agent/` | Terminal demo: an LLM agent with one `pay` tool, checked by the hosted coordinator (off-chain, no funds) |
| `src/` | Original EVM demo on a local anvil chain (`npm install && npm run demo` at the repo root, needs Foundry); older copy of the signer, not maintained |

## Roadmap

- Escrow-based EVM registry, so the EVM guarantee matches Solana and Stellar under key theft (SECURITY.md C-1, C-2, M-3).
- On-chain verification of coordinator tickets, so the cross-chain cap binds more than cooperating clients (H-2).
- Redeploy the Soroban contract with the review fixes.
- `close_mandate` on Solana to reclaim rent; a final multisig-or-immutable decision before any mainnet deploy.

## License and author

MIT. Built by Agnij Dutta ([@0xholmesdev](https://x.com/0xholmesdev)). See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).
