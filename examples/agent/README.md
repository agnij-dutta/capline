# capline-agent-template

**Give an AI agent a wallet it cannot drain, in 10 minutes, with zero on-chain funds.**

This is a clone-and-run reference agent. It has a real LLM brain (Llama via Groq) and one payment tool. You'll try to jailbreak it into overspending, and watch a [Capline](https://www.npmjs.com/package/capline) mandate stop every attack, right in your terminal.

![Capline attack demo, an AI agent gets jailbroken and still can't overspend](./attack.gif)

## Quickstart (5 steps)

```bash
# 1. clone + enter
git clone https://github.com/agnij-dutta/capline && cd capline/examples/agent

# 2. install
npm install

# 3. (optional) use a real model: paste a free Groq key
cp .env.example .env    # then add GROQ_API_KEY (or skip; a scripted brain works too)

# 4. run the attack
npm run attack

# 5. read the terminal. Your agent tried to overspend. It couldn't.
```

That's it, **no wallet, no testnet funds, no RPC.** Enforcement runs against the hosted Capline coordinator (Layer A).

## What just happened

Your agent's brain can *propose* any payment a prompt injection talks it into. But the only function that can *execute* one runs every proposal through a **signed AP2 mandate** first:

- **per-tx cap**: `$5`; a `$1000` "admin override" reverts `OVER_PER_TX`
- **payee allowlist**: only `DataVendor`; a new payee reverts `PAYEE_NOT_ALLOWED`
- **cumulative cap**: `$20` total; the slow-drain stops at the ceiling `OVER_GLOBAL_CAP`

The mandate is a `sha256`-committed protocol object, **not an editable setting**: so no jailbreak changes `value > maxPerTx`. That's the whole idea:

> The cap isn't in the prompt, it's a mandate the LLM can't talk to.

## The code (three files)

- **`src/brain.ts`**: the agent. A real Groq function-calling model with one `pay` tool. Deliberately obedient (a payment agent's job is to pay) so injections *land*, and get stopped anyway.
- **`src/capline.ts`**: the leash. Uses [`capline`](https://www.npmjs.com/package/capline): provisions the mandate and exposes the guarded `pay()`. This is the integration surface, ~40 lines.
- **`src/attack.ts`**: the runnable story you just saw.

Wiring Capline into *your* agent is this:

```ts
import { CoordinatorClient } from "capline/coordinator";
const coord = new CoordinatorClient("https://capline-protocol.vercel.app/api/coordinator");

// before your agent's payment tool actually sends:
const auth = await coord.authorize(mandateId, "solana", to, amount);
if (!auth.ok) throw new Error(auth.reason);   // OVER_PER_TX | PAYEE_NOT_ALLOWED | OVER_GLOBAL_CAP …
// …settle for real, then:
await coord.commit(mandateId, auth.ticket.ticketId);
```

## Level 2: enforce on-chain (Layer B)

The coordinator is Layer A (fast, off-chain refusal, and a cooperative control: it binds an agent that routes payments through it, not a stolen key). The **on-chain** mandate is the backstop. On Solana and Stellar the funds sit in a program-owned vault, so it holds even if the agent's key is compromised; on EVM it binds settlements routed through the registry only (see [SECURITY.md](../../SECURITY.md)). To settle a real payment through a deployed mandate contract, use `capline/solana` or `capline/evm` with a funded testnet key, see the [main README](../../README.md) and the live [Control Room](https://capline-protocol.vercel.app/app).

## Links

- SDK: [`capline` on npm](https://www.npmjs.com/package/capline)
- Live demo: [capline-protocol.vercel.app/agents](https://capline-protocol.vercel.app/agents)
- Repo: [github.com/agnij-dutta/capline](https://github.com/agnij-dutta/capline)

MIT
