# Capline · Solana launch tweet

**Program (devnet):** DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp
**Explorer:** https://explorer.solana.com/address/DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp?cluster=devnet
**Repo:** https://github.com/agnij-dutta/capline
**Tagging rule:** never start a tweet with @handle (becomes a reply, loses reach). Tags mid/end only. Max ~2 per tweet.

---

## ✅ FINAL — post this (3-tweet thread)

**1/**
> Would you give an AI agent your wallet?
>
> Google's AP2 lets you *sign* a spending intent — "up to $50, these merchants, this week." But nothing forces the payment to obey it.
>
> Capline is now live on @solana. 🧵👇

**2/**
> Capline commits your signed AP2 mandate on-chain and reverts any x402 settlement that breaks it — even if the agent's key is fully compromised.
>
> We jailbroke our own agent and told it to send 1000 USDC to a scammer.
>
> The model complied. The chain didn't.

`[ATTACH to tweet 2: money-shot clip — jailbreak → on-chain revert]`

**3/**
> Per-tx cap, lifetime cap, merchant allowlist, expiry — all enforced at settlement, not in a prompt. The cap isn't a sentence the LLM can override. It's a program it can't talk to.
>
> Live on devnet. Verify it yourself:
> 🔗 explorer.solana.com/address/DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp?cluster=devnet
> ⭐ github.com/agnij-dutta/capline

---

## Single launch tweet (pick one)

### A — the AP2 angle (primary)
> Would you give an AI agent your wallet?
>
> Google's AP2 lets you *sign* a spending intent — "up to $50, only these merchants, this week." But nothing forces a payment to obey it.
>
> Capline is now live on @solana: it commits your signed AP2 mandate on-chain and reverts any x402 settlement that breaks it — even if the agent's key is fully compromised.
>
> Jailbreak the model all you want. It still can't pay outside the mandate. 👇

`[ATTACH: money-shot clip — jailbreak → on-chain revert]`

### B — the jailbreak angle (punchier)
> We jailbroke our own AI agent and told it to send 1000 USDC to a scammer.
>
> The model complied. The chain didn't.
>
> Capline is live on @solana — it hashes your signed AP2 mandate on-chain and reverts any x402 payment that violates it. Per-tx cap, lifetime cap, merchant allowlist, expiry. Enforced at settlement, not in a prompt.
>
> The cap isn't in the prompt. It's a program the LLM can't talk to.

---

## Optional reply (add the receipts under whichever you post)
> Solana shipped a native *numeric* allowance. It enforces one number. It can't read AP2's constraints.
>
> Capline enforces the whole intent. Two walls: the SDK won't even build an out-of-bounds tx (Layer A), and the program reverts before tokens move (Layer B).
>
> Live on devnet, verify it yourself:
> 🔗 explorer.solana.com/address/DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp?cluster=devnet
> ⭐ github.com/agnij-dutta/capline
