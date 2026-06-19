// The primitive other builders adopt.
//
//   const client = withMandate({ signer, mandateId });
//   const xPaymentHeader = await client.pay(paymentRequirements); // or throws
//
// One wrapper around the buyer side of x402: it takes the seller's 402
// PaymentRequirements, runs the proposal through the ConstrainedSigner, and
// returns a real `X-PAYMENT` header ONLY if it fits the on-chain mandate.
// Drop it in front of any x402 client and your agent physically cannot overspend.
import { ConstrainedSigner } from "./signer.js";
import type { PaymentRequirements } from "x402/types";

export class MandateExceeded extends Error {
  constructor(
    readonly reason: string,
    readonly cap?: bigint,
    readonly attempted?: bigint,
  ) {
    super(`MandateExceeded: ${reason} (cap=${cap}, attempted=${attempted})`);
    this.name = "MandateExceeded";
  }
}

export interface MandateClientOpts {
  signer: ConstrainedSigner;
  mandateId: `0x${string}`;
}

export function withMandate(opts: MandateClientOpts) {
  return {
    /** Build an x402 payment header for a 402 within the mandate, or throw. */
    async pay(req: PaymentRequirements, override?: { to?: `0x${string}`; value?: bigint }): Promise<string> {
      const res = await opts.signer.proposePayment({ mandateId: opts.mandateId, req, ...override });
      if (!res.ok) throw new MandateExceeded(res.reason, res.cap, res.attempted);
      return res.header;
    },

    /** Like `pay` but never throws — returns the signer result. */
    async tryPay(req: PaymentRequirements, override?: { to?: `0x${string}`; value?: bigint }) {
      return opts.signer.proposePayment({ mandateId: opts.mandateId, req, ...override });
    },
  };
}
