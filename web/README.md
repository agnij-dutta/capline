# Capline · web

Landing page + dapp for Mandate. Next.js 16 (App Router, Turbopack) · Tailwind v4 · wagmi/viem · Avalanche Fuji.

Brutalist-dev brand: near-black `#0a0a0a` + acid-lime `#c6f806`, Archivo + JetBrains Mono, zero-radius hard borders, the "cap line" motif.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
```

## Routes
- `/` — landing. Hero, the insight, the 2-layer model, the interactive **AttackConsole** (jailbreak → refuse → on-chain revert), the 10-second adopt snippet.
- `/app` — dashboard: live on-chain mandate cards with cap-meters + revoke.
- `/app/create` — grant a scoped mandate to an ERC-8004 agent (with an inline identity-register helper).
- `/app/attack` — the AttackConsole + a **live `checkAllowance()` read** against the deployed contract on Fuji.

## Config
Contract addresses come from `lib/deployments.json` (copied from `../deployments/fuji.json`). After a fresh Fuji deploy, re-copy it:

```bash
cp ../deployments/fuji.json lib/deployments.json
```

The deploy uses deterministic addresses (burner at nonce 0), so the predicted values in `deployments.json` are correct as long as the broadcast is the deployer's first transaction.
