// The Constrained Signer — Layer A enforcement.
//
// This process holds the agent's wallet key. The agent's LLM brain does NOT.
// The brain can only *propose* a payment; this signer decides whether to build
// the x402 payment at all. Its logic reads numbers off-chain (cap comparisons),
// never natural language — so no jailbreak prompt changes `value > maxPerTx`.
//
// When in-bounds, it produces a REAL x402 `X-PAYMENT` header via the x402
// client (a signed EIP-3009 authorization). When out-of-bounds, it returns a
// structured refusal and no signature is ever produced.
import { createPaymentHeader } from "x402/client";
import type { PaymentRequirements } from "x402/types";
import { privateKeyToAccount } from "viem/accounts";
import type { Account, PublicClient } from "viem";

export interface PaymentProposal {
  mandateId: `0x${string}`;
  req: PaymentRequirements; // the seller's 402
  to?: `0x${string}`; // override payee (e.g. an injected scammer address)
  value?: bigint; // override amount (e.g. an injected 1000 USDC)
}

export type SignerResult =
  | { ok: true; header: string }
  | { ok: false; reason: string; cap?: bigint; attempted?: bigint };

export class ConstrainedSigner {
  readonly account: Account;
  constructor(
    privateKey: `0x${string}`,
    private readonly publicClient: PublicClient,
    private readonly registry: { address: `0x${string}`; abi: any },
    private readonly x402Version = 1,
  ) {
    this.account = privateKeyToAccount(privateKey);
  }

  /**
   * The ONLY outward payment capability the brain has. Gated by the mandate.
   * Returns a structured refusal instead of a payment when out of bounds.
   */
  async proposePayment(p: PaymentProposal): Promise<SignerResult> {
    const to = p.to ?? (p.req.payTo as `0x${string}`);
    const value = p.value ?? BigInt(p.req.maxAmountRequired);

    // Authoritative check against on-chain mandate state (caps, revoked, expiry).
    const [ok, reason] = (await this.publicClient.readContract({
      address: this.registry.address,
      abi: this.registry.abi,
      functionName: "checkAllowance",
      args: [p.mandateId, value],
    })) as [boolean, string];

    if (!ok) {
      const cap = await this.perTxCap(p.mandateId);
      return { ok: false, reason, cap, attempted: value };
    }

    // In bounds → produce a real x402 payment header for the proposed transfer.
    const signed: PaymentRequirements = { ...p.req, payTo: to, maxAmountRequired: value.toString() };
    const header = await createPaymentHeader(this.account as any, this.x402Version, signed);
    return { ok: true, header };
  }

  private async perTxCap(mandateId: `0x${string}`): Promise<bigint> {
    const m = (await this.publicClient.readContract({
      address: this.registry.address,
      abi: this.registry.abi,
      functionName: "mandates",
      args: [mandateId],
    })) as any[];
    return m[3] as bigint; // maxPerTx
  }
}
