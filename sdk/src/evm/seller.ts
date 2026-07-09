// Seller (x402 resource server) + Facilitator (settles on-chain) for EVM chains.
//
// Real x402 wire format (v1.2.0): the seller emits standard `PaymentRequirements`
// (the HTTP 402 body); the facilitator decodes the `X-PAYMENT` header and settles
// the EIP-3009 authorization by calling MandateRegistry.settle — where Layer-B
// enforcement reverts an out-of-mandate payment even if the signer is compromised.
import { decodePayment } from "x402/schemes";
import type { PaymentRequirements } from "x402/types";
import { type PublicClient, type WalletClient, type Account, parseSignature } from "viem";
import { MANDATE_REGISTRY_ABI } from "./abi.js";

/** Build a standard x402 PaymentRequirements (the 402 body). */
export class Seller {
  constructor(
    public readonly payTo: `0x${string}`,
    public readonly agentId: bigint,
    public readonly asset: `0x${string}`,
    /** EIP-712 domain of the asset, carried in `extra` so clients sign offline. */
    public readonly assetDomain: { name: string; version: string },
    public readonly network = "avalanche-fuji",
  ) {}

  /** Step (2) of x402: respond 402 with what payment is required. */
  quote(resource: string, price: bigint, description: string): PaymentRequirements {
    return {
      scheme: "exact",
      network: this.network as PaymentRequirements["network"],
      maxAmountRequired: price.toString(),
      resource: resource as `${string}://${string}`,
      description,
      mimeType: "application/json",
      payTo: this.payTo,
      maxTimeoutSeconds: 600,
      asset: this.asset,
      extra: this.assetDomain,
    };
  }
}

/** Decode an x402 X-PAYMENT header into the fields MandateRegistry.settle wants. */
export function decodeAuth(header: string) {
  const decoded = decodePayment(header) as {
    payload: { authorization: Record<string, string>; signature: `0x${string}` };
  };
  const a = decoded.payload.authorization;
  const sig = parseSignature(decoded.payload.signature);
  const v = sig.v ?? (sig.yParity === 1 ? 28n : 27n);
  return {
    from: a.from as `0x${string}`,
    to: a.to as `0x${string}`,
    value: BigInt(a.value),
    validAfter: BigInt(a.validAfter),
    validBefore: BigInt(a.validBefore),
    nonce: a.nonce as `0x${string}`,
    v: Number(v),
    r: sig.r,
    s: sig.s,
  };
}

/** Settles a signed x402 payment through the mandate contract (Layer B). */
export class Facilitator {
  constructor(
    private readonly wallet: WalletClient,
    private readonly account: Account,
    private readonly publicClient: PublicClient,
    private readonly registry: `0x${string}`,
  ) {}

  /**
   * Settle an x402 payment header THROUGH the mandate. Returns the tx hash on
   * success. An out-of-mandate payment reverts (CapExceeded / PayeeNotAllowed /
   * Revoked / Expired) and this throws — the unfakeable proof.
   */
  async settleViaMandate(
    mandateId: `0x${string}`,
    header: string,
    payeeProof: `0x${string}`[] = [],
  ): Promise<`0x${string}`> {
    const a = decodeAuth(header);
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: this.registry,
      abi: MANDATE_REGISTRY_ABI,
      functionName: "settle",
      args: [mandateId, a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s, payeeProof],
    });
    const hash = await this.wallet.writeContract(request);
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
}
