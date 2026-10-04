// withCapline (Solana) — the buyer-side wrapper other builders adopt.
//
//   const client = withCapline({ program, mandate, agent });
//   const sig = await client.pay({ merchant, merchantTokenAccount, amount });
//
// Layer A: an off-chain constrained builder. It reads the mandate's numbers
// (never natural language) and refuses to even build the `settle` instruction
// when out of bounds — so no prompt injection produces a signature. Layer B
// (the program's `settle`) is the backstop: even if this is bypassed and a
// compromised key signs directly, the chain reverts.
import type { Program, BN as AnchorBN } from "@coral-xyz/anchor";
// Anchor is CJS; default-import interop keeps `capline/solana` usable in raw
// node ESM (a bare `import { BN }` throws "Named export not found"). When a
// consumer's toolchain compiles this file back to CJS, the default import comes
// through as the namespace with `default` on it (or undefined), so fall back.
import * as anchorNs from "@coral-xyz/anchor";
import { PublicKey, type TransactionSignature } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

type AnchorModule = typeof import("@coral-xyz/anchor");
const anchor: AnchorModule =
  (anchorNs as unknown as { default?: AnchorModule }).default ?? (anchorNs as AnchorModule);
const { BN } = anchor;

export class MandateExceeded extends Error {
  constructor(
    readonly reason: string,
    readonly detail?: { cap?: string; attempted?: string; merchant?: string },
  ) {
    super(`MandateExceeded: ${reason}${detail ? ` ${JSON.stringify(detail)}` : ""}`);
    this.name = "MandateExceeded";
  }
}

export interface WithCaplineOpts {
  /** the Anchor program (IDL client) */
  program: Program;
  /** the Mandate PDA */
  mandate: PublicKey;
  /** the agent signer — provided via the program's provider wallet */
  agent: PublicKey;
}

export interface PayRequest {
  merchant: PublicKey;
  merchantTokenAccount: PublicKey;
  amount: bigint;
}

export function withCapline(opts: WithCaplineOpts) {
  const { program, mandate, agent } = opts;

  async function preflight(req: PayRequest) {
    // Anchor's generic AccountNamespace doesn't know app-specific accounts.
    const accounts = program.account as unknown as {
      mandate: { fetch(pda: PublicKey): Promise<unknown> };
    };
    const m = (await accounts.mandate.fetch(mandate)) as {
      revoked: boolean;
      notAfter: AnchorBN;
      maxPerTx: AnchorBN;
      spent: AnchorBN;
      totalCap: AnchorBN;
      merchants: PublicKey[];
      vault: PublicKey;
    };
    const amount = req.amount;

    if (m.revoked) throw new MandateExceeded("mandate revoked");

    const now = Math.floor(Date.now() / 1000);
    if (now > Number(m.notAfter)) throw new MandateExceeded("mandate expired");

    const maxPerTx = BigInt(m.maxPerTx.toString());
    if (amount > maxPerTx)
      throw new MandateExceeded("per-tx cap exceeded", {
        cap: maxPerTx.toString(),
        attempted: amount.toString(),
      });

    const spent = BigInt(m.spent.toString());
    const totalCap = BigInt(m.totalCap.toString());
    if (spent + amount > totalCap)
      throw new MandateExceeded("total cap exceeded", {
        cap: (totalCap - spent).toString(),
        attempted: amount.toString(),
      });

    const allowed = m.merchants.some((p) => p.equals(req.merchant));
    if (!allowed)
      throw new MandateExceeded("merchant not on allowlist", { merchant: req.merchant.toBase58() });

    return m;
  }

  return {
    /** Build + send `settle` ONLY if it fits the mandate; else throw. */
    async pay(req: PayRequest): Promise<TransactionSignature> {
      const m = await preflight(req); // Layer A refusal
      return await program.methods
        .settle(new BN(req.amount.toString()))
        .accounts({
          mandate,
          agent,
          vault: m.vault,
          merchant: req.merchant,
          merchantTokenAccount: req.merchantTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    },

    /** For demos: skip Layer A and let the chain be the only guardrail. */
    async payUnchecked(req: PayRequest, vault: PublicKey): Promise<TransactionSignature> {
      return await program.methods
        .settle(new BN(req.amount.toString()))
        .accounts({
          mandate,
          agent,
          vault,
          merchant: req.merchant,
          merchantTokenAccount: req.merchantTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    },

    preflight,
  };
}
