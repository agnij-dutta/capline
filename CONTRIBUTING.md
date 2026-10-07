# Contributing

Thanks for looking. Capline is small on purpose: one enforcement primitive per chain, one SDK, one coordinator. Security reports go through [SECURITY.md](SECURITY.md), not issues.

## Layout

| Path | What | Toolchain |
|---|---|---|
| `solana/programs/capline` | Anchor program + LiteSVM tests | Rust 1.89+, Agave CLI, Anchor 1.1.2 (`avm`) |
| `contracts/` | `MandateRegistry` + `IdentityRegistry` + Foundry tests | Foundry |
| `soroban/contracts/mandate` | Soroban contract + tests | Rust, `stellar` CLI for wasm builds |
| `sdk/` | the `capline` npm package | Node 18+ (22 recommended) |
| `mcp/` | the `capline-mcp` npm package | Node 18+ |
| `web/` | Next.js app, coordinator (`lib/coordinator.ts`), API routes | Node 20+. This Next.js version has breaking changes: read `web/node_modules/next/dist/docs/` before editing app code |
| `examples/agent/` | clone-and-run reference agent | Node 18+ |
| `src/` | original EVM demo (`npm run demo`, needs `anvil`) | Node + Foundry |

## Build, test, lint

```bash
# Solana (rebuild the .so before testing: the tests load target/deploy/capline.so)
cd solana
anchor build --ignore-keys
cargo test --release -- --nocapture
cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings

# EVM
cd contracts
forge test
forge fmt --check test script        # src/ is left as deployed, see below

# Soroban
cd soroban
cargo test
cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings

# SDK
cd sdk && npm ci && npm run typecheck && npm test && npm run build

# MCP (its tests import web/lib/coordinator.ts, so install web too if you want typecheck there)
cd mcp && npm ci && npm run typecheck && npm test && npm run build

# Coordinator + web
cd web && npm ci && npx tsc --noEmit && npx tsx lib/coordinator.smoke.ts && npm run build
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push and pull request.

## Rules that keep live integrations working

- **Solana error codes are an interface.** Integrations match on `6000` to `6017`. Only ever append variants to the end of `CaplineError`; never reorder or remove.
- **Instruction arguments and accounts are an interface.** Changing them breaks every deployed client. Prefer a new instruction.
- **`contracts/src` matches verified bytecode on Fuji.** Even a formatting change alters the metadata hash. Changes there mean a new deployment; put them in a new contract.
- **Soroban error numbers are explicit**; append new ones with the next number.
- Every behavior change to a contract, SDK refusal rule or coordinator rule needs a test, and an entry in `CHANGELOG.md` under Unreleased.
- Do not deploy or publish from a PR. Deploys follow `docs/UPGRADE-PLAN.md` and are done by the maintainer.

## Adding a chain

1. Implement the primitive natively: a mandate with principal, agent, per-tx cap, total cap, expiry, payee allowlist and `ap2_hash`, with funds escrowed by the program (not the agent's wallet), and `settle` checking every rule before moving funds.
2. Port the Solana test list (`solana/programs/capline/tests/test_mandate.rs`) as the minimum test set.
3. Add the chain to `sdk/src/types.ts` (`ChainId`), `sdk/src/chains.ts` and `web/lib/chains.ts`, and a Layer A builder under `sdk/src/<chain>/` whose checks mirror `settle` one for one.
4. Add a row to the per-chain table in `SECURITY.md`.

## Style

- No em dashes in code, comments or docs. Commas, colons or a middle dot.
- Comments explain why, not what.
- Commit messages: short imperative subject, plain body.
