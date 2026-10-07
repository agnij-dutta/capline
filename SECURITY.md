# Security

Capline is testnet software. It has had one independent review (October 2026, results below) and no formal audit. Do not put mainnet funds behind it.

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting: [github.com/agnij-dutta/capline/security/advisories/new](https://github.com/agnij-dutta/capline/security/advisories/new). Do not open a public issue for anything that could move funds. Expect an acknowledgement within a few days.

**In scope:** the Solana program (`solana/programs/capline`), the EVM contracts (`contracts/src`), the Soroban contract (`soroban/contracts/mandate`), the `capline` SDK (`sdk/`), the coordinator (`web/lib/coordinator.ts`, `web/app/api/coordinator`) and `capline-mcp` (`mcp/`).

**Out of scope:** the marketing site copy, `src/` and `solana/app/` (older demo copies of the SDK), third-party dependencies, and anything requiring a compromised principal key.

## What Capline guarantees, per chain

The threat model is a jailbroken model and, as the stronger case, a stolen agent key.

| | Funds held by | Jailbroken model (no key) | Stolen agent key |
|---|---|---|---|
| **Solana** | a token vault owned by the mandate PDA | bounded by Layer A and on-chain `settle` | can only call `settle`: at most the remaining budget, to allowlisted merchants, before expiry, until revoked |
| **Stellar** | the mandate contract | bounded by `settle` | same bound as Solana |
| **EVM** | the agent's own wallet | bounded by Layer A (the SDK's `ConstrainedSigner`) | **not bounded**: the key controls the wallet (C-2) |
| **Cross-chain cap** | n/a (off-chain ledger) | bounded if the agent routes through the coordinator | **not bounded** beyond each chain's own caps (H-2) |

Known non-goals: protecting against a compromised principal key, against a quorum of the upgrade multisig's members (M-2), or against an allowlisted merchant colluding with a stolen agent key inside the mandate's limits.

## Independent review, October 2026

Reviewed commit `eebbbed` (the code live on devnet, Fuji and Stellar testnet at the time). The devnet program bytecode was dumped and is byte-identical to a build of that commit (sha256 `a09c2ba8...5d79`), so the findings against the program applied to what was deployed then.

### Deployment status (updated 2026-10-07)

| Component | Status |
|---|---|
| Solana program (devnet `DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp`) | **Upgraded in place** on 2026-10-07 to the program code from commit `a686e30` (slot 508428919). The deployed bytes are byte-identical to a build of that commit (sha256 `36e1e70b27cbc159ac9598cde6e8bbbc23a043a1757bd7ffecc8f481d094f9aa`). L-1, L-4 and L-9 are fixed in the live program. Same program id and account layout, so existing mandates keep working. The upgrade authority was then moved to a 2-of-3 Squads v4 multisig (see M-2). |
| Coordinator and web (capline-protocol.vercel.app) | Deployed 2026-10-07 with the H-1, M-4, M-5, M-6 and L-5 fixes and the corrected per-chain claims. |
| `capline` SDK | 0.2.0 on npm (C-1 mitigation, L-6). |
| `capline-mcp` | 0.2.0 on npm (H-3). |
| EVM contracts (Fuji) | No source change. C-1 and C-2 remain open by design until an escrow-based v2. |
| Soroban (Stellar testnet `CAXVTUT6...CCXE`) | **Not redeployed.** M-1 and L-7 are fixed in code, but the contract has no upgrade entry point, so the fix needs a new contract id. The deployed contract still has both. |

See [docs/UPGRADE-PLAN.md](docs/UPGRADE-PLAN.md) for what each change does and how it was rolled out.

Method: line-by-line manual review of every component; Slither on the EVM contracts (4 results, all benign: event-after-call, timestamp comparison, pragma range); `cargo clippy -D warnings` on both Rust contracts; and a regression test written for every fixed finding. Where a fix closes an exploit, the test was first run against the old code to confirm it reproduces.

Severity: **Critical** = direct loss of funds against the stated guarantee; **High** = loss under specific conditions, or a stated control that does not hold; **Medium** = griefing, locked funds, conditional value leakage; **Low** = defense in depth, misleading state; **Info** = notes.

| ID | Sev | Component | Finding | Status | Test |
|---|---|---|---|---|---|
| C-1 | Critical | EVM | Signed EIP-3009 authorizations can be redeemed by anyone directly on USDC, skipping `MandateRegistry.settle`, so the payee allowlist, cumulative cap, expiry and revoke never apply to them. The old Layer A signer did not check the payee and only counted registry-settled spend, so a prompt-injected agent (no key theft) could pay a scammer repeatedly in per-tx-sized chunks. | **Mitigated** in SDK Layer A (payee check, signed-authorization ledger). Contract fix needs v2. | `KnownLimitations.t.sol: test_KnownLimitation_C1_*`; `sdk/test/evm-signer.test.ts` |
| C-2 | Critical | EVM | Funds sit in the agent's EOA, so a stolen agent key can move them directly. The README, landing page and demo claimed the registry holds "even if the signing key is stolen". | **Open** (design). Claims corrected. Fix = escrow v2. | `test_KnownLimitation_C2_stolenAgentKeyDrainsWalletDirectly` |
| H-1 | High | Coordinator | No input validation: `NaN` amounts made every later cap comparison false (cap disabled for the mandate), negative amounts added headroom, and `create` with an existing `mandateId` overwrote the mandate and reset its ledger. All unauthenticated. | **Fixed** | smoke: "Input validation", "No overwrite" |
| H-2 | High | Coordinator | The global cross-chain cap is advisory. No chain verifies tickets, the coordinator learns of a settlement only when the client commits, `broadcastRevocation` does nothing on-chain, and clients fail open when it is unreachable. A stolen key is bounded only by each chain's local caps. | **Open** (design). Documented in code, SDK and READMEs. | n/a |
| H-3 | High | MCP | `create_mandate` and `revoke_mandate` were exposed to the model, so an injected agent could mint itself a looser mandate and pay under it. `pay` replied "SETTLED. Paid" while moving no funds. | **Fixed**: pinned mode (`CAPLINE_MANDATE_ID`) hides admin tools and rejects other mandates; output says AUTHORIZED and that no on-chain transfer happened. Demo mode remains and says it is not a boundary. | `mcp/test/server.test.ts` |
| M-1 | Medium | Soroban | No way to withdraw funded tokens: unspent balance of a revoked or expired mandate was locked in the contract forever. | **Fixed** (`withdraw_unspent`) | `principal_reclaims_unspent_after_revoke` |
| M-2 | Medium | Solana | The devnet program's upgrade authority was a single hot key (`J2GeZ1...gDH9`). Whoever held it could replace the program and drain every vault. | **Fixed on devnet (2026-10-07)**: the upgrade authority is now the vault of a 2-of-3 Squads v4 multisig (multisig `GRBBcirMUrykvcMx2xNKTyTCh7gu7pvKmxt4JevfQwXy`, vault `Eh4PGgC81KSek38h9SVvKMQuJTXPDTHGmu6TE7kFPEx1`). Verified: an upgrade signed by the old key alone is rejected, and an upgrade proposal executes only after 2 of 3 members approve. Before mainnet, decide again between a multisig and an immutable program. | n/a |
| M-3 | Medium | EVM | Mandate ids are global and first-come; anyone controlling any agent identity can squat an id another principal has published. | **Open** (needs v2: key ids by `msg.sender`). | `test_KnownLimitation_M3_mandateIdSquatting` |
| M-4 | Medium | Coordinator | KV read-modify-write was not atomic across serverless instances: concurrent authorizes could all pass. Reproduced: 9 of 12 ten-unit tickets issued on a 50 cap. | **Fixed**: per-mandate lock plus Lua compare-and-swap. | smoke: "Concurrency across two KV-backed instances" |
| M-5 | Medium | Coordinator | Anyone could revoke any mandate (griefing); ticket ids used `Math.random`. | **Fixed**: `revoke` needs the `principalToken` from `create`; ids are 128-bit random. Legacy mandates without a token stay revocable without one. | smoke: "Revoke needs the principal token" |
| M-6 | Medium | Coordinator | A commit arriving after the 90s reservation expired was silently dropped, so real on-chain spend went uncounted. | **Fixed**: late commits are counted and flagged `late`. | smoke: "Commit semantics" |
| L-1 | Low | Solana | `attest_ap2` read the pubkey and message from the Ed25519 instruction without checking its instruction-index fields, so the native program could verify bytes from another instruction (classic introspection spoof). Impact is limited because `attest_ap2` also requires the principal as a transaction signer, so only the principal could forge it; it weakens the `ap2_verified` claim ("the principal signed these AP2 bytes"), and `settle` never reads that flag. The same bug would be critical in a program without that signer check. Reproduced against the devnet binary. | **Fixed**: all three index fields must be `u16::MAX`, full header and every offset bounds-checked. | `ap2_rejects_cross_instruction_spoof`, `ap2_rejects_each_non_self_index_field`, `ap2_rejects_malformed_headers`, `ap2_attestation` |
| L-2 | Low | EVM | No field validation on `createMandate` (e.g. `maxPerTx > maxCumulative`, zero signer); a zero-value `settle` succeeds and emits `Settled`. | **Open** (v2) | `test_KnownLimitation_L2_*` |
| L-3 | Low | EVM | `checkAllowance` ignores the payee, so it is not a complete pre-check. | **Mitigated** in SDK Layer A | `test_KnownLimitation_L3_*` |
| L-4 | Low | Solana | `settle` accepted `amount = 0` and emitted a `Settled` event indexers could read as a payment. | **Fixed** (`ZeroAmount`, 6016, also on `withdraw_unspent`) | `settle_rejects_zero_amount`, `revoke_and_withdraw_are_principal_only` |
| L-5 | Low | Coordinator | Ticket attestations carried their own public key and used a per-process ephemeral key, so they proved nothing to a verifier. | **Fixed**: domain-separated message, `CAPLINE_COORDINATOR_SK` for a stable key, `verifyTicket` checks against a pinned key. Still no on-chain verifier (H-2). | smoke: "Ticket attestation" |
| L-6 | Low | SDK (Solana) | `preflight` diverged from `settle`: it allowed 0 and negative amounts, a non-agent signer, and a destination not owned by the merchant or of the wrong mint. Each became a failed transaction rather than a refusal. | **Fixed** | `sdk/test/solana-preflight.test.ts` |
| L-7 | Low | Soroban | `create_mandate` accepted zero, negative or inverted caps; spend addition unchecked (release profile has overflow checks). | **Fixed** (`InvalidMandate = 10`, `checked_add`) | `create_validates_caps`, `zero_and_negative_amounts_rejected` |
| L-8 | Low | Web | `/api/agent` is an unauthenticated proxy that spends the server's `GROQ_API_KEY` if set (cost abuse). | **Open**: rate-limit or require the visitor's own key. | n/a |
| L-9 | Low | Solana | `withdraw_unspent` emitted no event. | **Fixed** (`Withdrawn`) | n/a |
| I-1 | Info | Solana | Token-2022 mints are rejected at `create_mandate` (Anchor `Account<Mint>` owner check), so transfer hooks and transfer fees cannot interfere. Intended. | By design | `token_2022_mints_are_rejected_at_create` |
| I-2 | Info | All | The agent can front-run `revoke` and spend the remaining budget. Inherent to any revocable allowance; bounded by the caps. Keep budgets small. | By design | n/a |
| I-3 | Info | Solana | `ap2_verified` is informational; `settle` does not require it. | Documented | n/a |
| I-4 | Info | Solana | No instruction to close the mandate and vault, so their rent is not reclaimable. An empty merchant list creates a mandate that can never settle. | Open (future `close_mandate`) | n/a |
| I-5 | Info | Solana | Account constraints verified: `settle` pins the vault by `address = mandate.vault`, the mandate by seeds and stored bump, the agent by key equality, the destination by owner and mint; revoke and withdraw require the principal by address; `init` prevents nonce re-use. Anchor rejects pre-funded PDA griefing. | Verified | `settle_rejects_a_vault_that_is_not_the_mandates`, `settle_rejects_wrong_agent`, `settle_rejects_merchant_token_account_*`, `nonce_reuse_cannot_reinitialize_a_mandate` |
| I-6 | Info | EVM | `IdentityRegistry.safeTransferFrom` skips the ERC-721 receiver check; transferring an agent identity does not affect existing mandates (the old principal can still revoke, the new owner cannot). | Documented | n/a |
| I-7 | Info | EVM | The live Fuji demo mandate uses `allowedPayeesRoot = 0` (any payee). | Documented | n/a |
| I-8 | Info | EVM | No reentrancy exposure (state written before the single call to an immutable USDC); fee-on-transfer tokens not applicable (token fixed at deploy). | Verified | n/a |
| I-9 | Info | Soroban | Persistent entries are never TTL-extended and no events are emitted. | Open | n/a |
| I-10 | Info | Build | `soroban/Cargo.lock` resolved `ed25519-dalek 3.0.0`, so `cargo test` did not compile. `anchor build` refuses because the local `target/deploy` keypair does not match the pinned program id; use `--ignore-keys`. | Lockfile fixed; documented | CI |
| I-11 | Info | Repo | `src/` and `solana/app/` are older demo copies of Layer A without these fixes; the root `package.json` was named `capline` and publishable. | Root marked private; copies documented as demo-only | n/a |

## Secrets scan

`gitleaks git` over the full history (32 commits up to `eebbbed`): no leaks. Manual greps for private keys, seed phrases, base58 secret arrays, API key prefixes and `.env` files: none. `contracts/.env` and `contracts/broadcast/` have never been committed (gitignored from the first commit). The only key-like strings in history are Foundry's and Anvil's published test keys.
