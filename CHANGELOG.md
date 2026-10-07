# Changelog

All notable changes to this repo. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Packages are versioned separately; on-chain programs are listed by what is deployed.

## [Unreleased]

Fixes from the October 2026 independent security review. Finding ids refer to [SECURITY.md](SECURITY.md). None of this is deployed or published yet; see [docs/UPGRADE-PLAN.md](docs/UPGRADE-PLAN.md).

### Solana program
- `settle` and `withdraw_unspent` reject a zero amount with the new error `ZeroAmount` (6016) (L-4).
- `attest_ap2` requires the Ed25519 instruction to reference only its own data (all three index fields `u16::MAX`) and bounds-checks the full header and every offset, including the signature's. New error `Ap2ProofNotSelfContained` (6017) (L-1).
- `withdraw_unspent` emits a `Withdrawn` event (L-9).
- Error codes 6000 to 6015 are unchanged; new variants are appended.
- LiteSVM suite grows from 2 to 15 tests; the CU benchmark uses deterministic keys.

### Soroban contract
- New `withdraw_unspent` so the principal can reclaim unspent funds (M-1).
- `create_mandate` rejects zero, negative or inverted caps with `InvalidMandate` (10); spend addition is checked (L-7).
- Test lockfile pinned to `ed25519-dalek` 2.2 so `cargo test` compiles. Tests grow from 2 to 8.

### EVM contracts
- No source change (keeps matching the verified Fuji bytecode).
- `KnownLimitations.t.sol` pins C-1, C-2, M-3, L-2 and L-3 as executable tests (16 to 22 tests).

### capline (SDK), next: 0.2.0
- EVM `ConstrainedSigner`: checks the payee against the mandate's allowlist (new `allowedPayees` option), refuses a key that is not the mandate's `agentSigner`, counts every authorization it signed against the cumulative cap until it provably expired unused, and serializes concurrent proposals (C-1 mitigation).
- New `payeeMerkleRoot` and `payeeProof` helpers matching `MandateRegistry._verifyPayee`.
- Solana `preflight` mirrors `settle`: refuses zero, negative and over-u64 amounts, a non-agent signer, and a destination not owned by the merchant or of the wrong mint (L-6).
- `CoordinatorClient.createMandate` returns `principalToken`; `revoke` accepts it.
- First test suite (16 tests, `npm test`).

### capline-mcp, next: 0.2.0
- Pinned mode: `CAPLINE_MANDATE_ID` pins the server to one principal-provisioned mandate and hides `create_mandate` / `revoke_mandate` unless `CAPLINE_MCP_ADMIN_TOOLS=1` (H-3).
- `pay` reports `AUTHORIZED` and states that it moves no funds on-chain, instead of `SETTLED. Paid`.
- First test suite (3 tests).

### Coordinator (web)
- Validates amounts and inputs; refuses to overwrite an existing mandate id (H-1).
- Atomic per-mandate updates: in-process lock plus KV compare-and-swap (M-4).
- `revoke` requires the `principalToken` returned by `create`; ids are 128-bit random (M-5).
- Late commits are counted and flagged (M-6).
- Domain-separated ticket attestations, optional stable key `CAPLINE_COORDINATOR_SK`, `verifyTicket` against a pinned key (L-5).
- Smoke checks grow from 14 to 44.

### Docs and repo
- SECURITY.md, CONTRIBUTING.md, this changelog, the upgrade plan, CI, issue and PR templates.
- README, landing copy and the anvil demo state the per-chain security model honestly (C-2, H-2).

## capline-mcp [0.1.1]
- Published to npm. Not tagged in git, and `mcp/package.json` still reads 0.1.0; reconcile before the next release.

## capline-mcp [0.1.0]
- First release: `create_mandate`, `pay`, `mandate_status`, `revoke_mandate` against the hosted coordinator.

## capline [0.1.2]
- Fix `@coral-xyz/anchor` default-import interop when `capline/solana` is compiled to CommonJS.
- Ship the LICENSE file in the package.

## capline [0.1.1]
- Published to npm (no separate git commit recorded).

## capline [0.1.0]
- First release with `capline`, `capline/coordinator`, `capline/evm` and `capline/solana` entry points.

## [0.1.0]
- Solana program deployed to devnet (`DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp`).
- `MandateRegistry` and `IdentityRegistry` deployed to Avalanche Fuji.
- Soroban mandate contract deployed to Stellar testnet.
- Cross-chain coordinator and agent gallery at capline-protocol.vercel.app.
