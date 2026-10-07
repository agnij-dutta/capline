# Upgrade plan

Status (2026-10-07): section 1 (Solana devnet) was executed, along with the web redeploy and the npm 0.2.0 releases. Section 2 (Soroban) has not been executed. See the deployment status table in [SECURITY.md](../SECURITY.md). Findings are referenced by their ids in [SECURITY.md](../SECURITY.md).

## 1. Solana program (devnet `DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp`)

Upgradeable (BPF Loader Upgradeable), authority `J2GeZ1D4s2zivFEhgpfrV26DBDGCfrdUqruFpybqgDH9`. The deployed bytecode is byte-identical to a build of commit `eebbbed` (254,424 bytes, sha256 `a09c2ba809e0e2bc7a4fa73a2dbbb03de5eaa8f7d79d29f83bdc4d9621aa5d79`).

### What changes

| | Before | After |
|---|---|---|
| `settle(0)` | succeeds, emits `Settled { amount: 0 }` | fails `ZeroAmount` (6016) |
| `withdraw_unspent(0)` | succeeds (no-op transfer) | fails `ZeroAmount` (6016) |
| `withdraw_unspent` | no event | emits `Withdrawn { mandate, to, amount }` |
| `attest_ap2` with an Ed25519 instruction whose index fields are not all `u16::MAX` | could pass (L-1) | fails `Ap2ProofNotSelfContained` (6017) |
| `attest_ap2` with non-zero padding, a second signature, or out-of-range offsets | some passed | fails `BadAp2Proof` (6013) |
| Error codes 6000 to 6015 | | unchanged (new variants appended) |
| Instruction names, arguments, account lists | | unchanged (IDL instruction section is identical) |
| `Mandate` account layout | | unchanged: existing mandates and vaults keep working |
| Program size | 254,424 bytes | 257,768 bytes (needs +3,344 bytes, see below) |
| CU (LiteSVM, deterministic keys) | create 20,680 · settle 14,589 · attest 6,061 | create 20,680 · settle 14,590 · attest 6,031 |

### Compatibility risk for live integrations

- **the-leash.vercel.app and capline-protocol.vercel.app:** low. They build Ed25519 instructions with `@solana/web3.js` `Ed25519Program.createInstructionWith*`, which sets all index fields to `u16::MAX` and padding to 0, so genuine attestations keep passing. They never settle 0. Error decoding by name keeps working; the web IDL copy should be refreshed after the upgrade so 6016 and 6017 decode by name.
- **Anyone matching on error numbers:** unaffected for 6000 to 6015.
- **Any client that sends `settle(0)` as a probe or keep-alive:** will start failing. None found in this repo.
- **Any client that builds its own Ed25519 instruction pointing at another instruction's data:** will start failing, by design.

### Commands

```bash
source ~/.cargo/env
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
cd solana

# 1. build exactly the reviewed commit and record its hash
anchor build --ignore-keys
shasum -a 256 target/deploy/capline.so
cargo test --release            # 15 LiteSVM tests must pass against this .so

# 2. the new binary is 3,344 bytes larger than the program data account; extend first
# devnet rejects extends smaller than 10,240 bytes ("ExtendProgram requires a minimum
# of 10240 additional bytes"), and the CLI's auto-extend during deploy asks for the
# exact difference and fails the same way, so extend explicitly by 10240.
solana program extend DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp 10240 \
  -u devnet --keypair ~/.config/solana/id.json

# 3. upgrade in place (same program id, signed by the upgrade authority)
solana program deploy target/deploy/capline.so \
  --program-id DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp \
  --upgrade-authority ~/.config/solana/id.json -u devnet

# 4. verify: dumped bytes must hash to the value from step 1
solana program dump DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp /tmp/capline-devnet.so -u devnet
shasum -a 256 /tmp/capline-devnet.so

# 5. refresh the web IDL copy, then redeploy web (separate approval)
cp target/idl/capline.json ../web/lib/idl/capline.json
cp target/types/capline.ts ../web/lib/idl/capline.ts
```

Rollback: redeploy the previous binary (`solana program dump` it to a file before step 3, then `solana program deploy` that file with the same flags).

Before any mainnet deploy, decide on M-2: move the upgrade authority to a multisig (`solana program set-upgrade-authority ... --new-upgrade-authority <squads vault>`) or make the program immutable (`--final`).

## 2. Soroban (Stellar testnet `CAXVTUT64BWTPDH3DBSUPAIWCF2WNLXWZVWLT54DPQFFXHAFRU67CCXE`)

The contract has no upgrade entry point, so the fixes (M-1 `withdraw_unspent`, L-7 cap validation, `InvalidMandate = 10`) need a **new contract id**. Error codes 1 to 9 are unchanged.

Risk: funds already funded into mandates on the old contract cannot be withdrawn (that is M-1) and stay there; testnet only. Callers must switch to the new id.

```bash
cd soroban
cargo test                                   # 8 tests
stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/capline_mandate.wasm \
  --source <deployer identity> --network testnet
# then update soroban/deployments.json, sdk/src/chains.ts (CHAINS.stellar.mandate)
# and web/lib/chains.ts with the new contract id
```

## 3. EVM (Avalanche Fuji)

No contract change. `contracts/src` is untouched so it still matches the verified bytecode at `0x40367742...6aF5` and `0xAF379a04...f8d6`. C-1, C-2, M-3 and L-2 need a new escrow-based registry (v2): the principal deposits into the registry per mandate, `settle` pays out of escrow on an agent signature over `(mandateId, to, value, nonce)`, and mandate ids are keyed by creator. That is a new deployment at new addresses and an SDK change, to be designed separately.

## 4. Coordinator and web (Vercel)

Code changes in `web/lib/coordinator.ts`, `web/app/api/coordinator/route.ts`, `web/lib/live.ts` and landing copy in `web/app/page.tsx`.

API changes:

- `create` returns `principalToken` (once) next to `mandate`; it returns **409 `MANDATE_EXISTS`** instead of overwriting an existing `mandateId`, and **400 `INVALID_INPUT`** for bad caps or chains.
- `authorize` can return `{ ok: false, reason: "INVALID_AMOUNT" }`.
- `revoke` needs `principalToken` for mandates created after the upgrade (403 otherwise). Mandates already in KV have no token and stay revocable without one.
- `commit` returns `late: true` when it counted a reservation that had expired.
- Ticket attestation bytes changed (domain-separated JSON). No verifier existed, so nothing breaks.

In-memory state uses new global keys, so a warm instance starts clean after deploy. KV records are read as before.

Optional env: `CAPLINE_COORDINATOR_SK` (base64 PKCS#8 DER ed25519 key) for a stable, pinnable attestation key. Generate with:

```bash
node -e 'const {generateKeyPairSync}=require("crypto");const k=generateKeyPairSync("ed25519");console.log(k.privateKey.export({type:"pkcs8",format:"der"}).toString("base64"))'
```

Verify before deploying: `cd web && npx tsc --noEmit && npx tsx lib/coordinator.smoke.ts && npm run build`.

## 5. npm

- `capline` **0.2.0** (behavior change, so a minor bump): the EVM `ConstrainedSigner` now refuses `PAYEE_LIST_REQUIRED` when the mandate has a payee root and no `allowedPayees` option is passed, refuses `SIGNER_NOT_AGENT`, and counts its own signed authorizations against the cumulative cap. Solana `preflight` refuses more inputs. New exports: `payeeMerkleRoot`, `payeeProof`. Bump `VERSION` in `sdk/src/index.ts` with `package.json`.
- `capline-mcp` **0.2.0**: pinned mode, admin tools hidden in pinned mode, `pay` output wording changed (anything parsing "SETTLED" must switch to "AUTHORIZED"). Works against both the old and new coordinator.

```bash
cd sdk && npm test && npm run build && npm version minor && npm publish
cd ../mcp && npm test && npm run build && npm version minor && npm publish
```
