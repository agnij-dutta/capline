// The Constrained Signer — Layer A enforcement (EVM: Avalanche, Base).
//
// This process holds the agent's wallet key. The agent's LLM brain does NOT.
// The brain can only *propose* a payment; this signer decides whether to build
// the x402 payment at all. Its logic reads numbers off-chain (cap comparisons),
// never natural language — so no jailbreak prompt changes `value > maxPerTx`.
//
// In-bounds → a REAL x402 `X-PAYMENT` header (a signed EIP-3009 authorization).
// Out-of-bounds → a structured refusal, and no signature is ever produced.
//
// IMPORTANT (see SECURITY.md, C-1): on EVM the funds sit in the agent's own
// wallet, and a signed EIP-3009 authorization can be redeemed by ANYONE
// directly on the token contract, without going through
// MandateRegistry.settle. So on EVM this signer is the only thing that
// enforces the payee allowlist and the cumulative cap for authorizations that
// leave this process. That is why it (a) checks the payee against the
// mandate's allowlist itself and (b) counts every authorization it has signed
// against the cumulative cap until that authorization provably expired unused.
import { createPaymentHeader } from "x402/client";
import type { PaymentRequirements } from "x402/types";
import { privateKeyToAccount } from "viem/accounts";
import type { Account, PublicClient } from "viem";
import { MANDATE_REGISTRY_ABI } from "./abi.js";
import { decodeAuth } from "./seller.js";
import { payeeMerkleRoot } from "./payees.js";

const ZERO_ROOT = "0x0000000000000000000000000000000000000000000000000000000000000000";

const EIP3009_STATE_ABI = [
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface PaymentProposal {
  mandateId: `0x${string}`;
  req: PaymentRequirements; // the seller's 402
  to?: `0x${string}`; // override payee (e.g. an injected scammer address)
  value?: bigint; // override amount (e.g. an injected 1000 USDC)
}

export type SignerResult =
  | { ok: true; header: string }
  | { ok: false; reason: string; cap?: bigint; attempted?: bigint };

export interface ConstrainedSignerOptions {
  /**
   * The full payee allowlist the mandate's `allowedPayeesRoot` was built from
   * (with `payeeMerkleRoot`). Required whenever the on-chain root is non-zero:
   * without it the signer cannot tell an allowed payee from a scammer, and it
   * refuses rather than signing an authorization the payee could redeem
   * directly.
   */
  allowedPayees?: `0x${string}`[];
  /** Clock override for tests (unix seconds). */
  now?: () => number;
}

interface SignedAuth {
  mandateId: `0x${string}`;
  asset: `0x${string}`;
  value: bigint;
  validBefore: bigint;
}

export class ConstrainedSigner {
  readonly account: Account;
  /** Every authorization this process has signed, by EIP-3009 nonce. */
  private readonly signed = new Map<`0x${string}`, SignedAuth>();
  private readonly now: () => number;
  /** Serializes proposals so two concurrent calls cannot both spend the same headroom. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    privateKey: `0x${string}`,
    private readonly publicClient: PublicClient,
    private readonly registry: `0x${string}`,
    private readonly x402Version = 1,
    private readonly opts: ConstrainedSignerOptions = {},
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * The ONLY outward payment capability the brain has. Gated by the mandate.
   * Returns a structured refusal instead of a payment when out of bounds.
   */
  proposePayment(p: PaymentProposal): Promise<SignerResult> {
    const run = this.queue.then(() => this.propose(p));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async propose(p: PaymentProposal): Promise<SignerResult> {
    const to = p.to ?? (p.req.payTo as `0x${string}`);
    const value = p.value ?? BigInt(p.req.maxAmountRequired);

    if (value <= 0n) return { ok: false, reason: "ZERO_VALUE", attempted: value };

    // 1. the registry's own view: missing / revoked / expired / per-tx / spent
    const [ok, reason] = (await this.publicClient.readContract({
      address: this.registry,
      abi: MANDATE_REGISTRY_ABI,
      functionName: "checkAllowance",
      args: [p.mandateId, value],
    })) as [boolean, string];

    const m = await this.mandate(p.mandateId);
    if (!ok) return { ok: false, reason, cap: m.maxPerTx, attempted: value };

    // 2. only the mandate's agent wallet may sign: any other key would be
    //    authorizing transfers out of a wallet the mandate does not govern
    if (m.agentSigner.toLowerCase() !== this.account.address.toLowerCase())
      return { ok: false, reason: "SIGNER_NOT_AGENT" };

    // 3. payee allowlist (checkAllowance does not check it)
    if (m.allowedPayeesRoot !== ZERO_ROOT) {
      const list = this.opts.allowedPayees;
      if (!list || list.length === 0) return { ok: false, reason: "PAYEE_LIST_REQUIRED" };
      if (payeeMerkleRoot(list) !== m.allowedPayeesRoot.toLowerCase())
        return { ok: false, reason: "PAYEE_LIST_MISMATCH" };
      if (!list.some((a) => a.toLowerCase() === to.toLowerCase()))
        return { ok: false, reason: "PAYEE_NOT_ALLOWED" };
    }

    // 4. cumulative cap, counting authorizations this signer already handed
    //    out that might still be redeemed outside the registry
    const outstanding = await this.outstanding(p.mandateId);
    const used = outstanding > m.spent ? outstanding : m.spent;
    if (used + value > m.maxCumulative)
      return { ok: false, reason: "OVER_CUMULATIVE", cap: m.maxCumulative - used, attempted: value };

    const signedReq: PaymentRequirements = {
      ...p.req,
      payTo: to,
      maxAmountRequired: value.toString(),
    };
    const header = await createPaymentHeader(this.account as never, this.x402Version, signedReq);
    const a = decodeAuth(header);
    this.signed.set(a.nonce, {
      mandateId: p.mandateId,
      asset: p.req.asset as `0x${string}`,
      value: a.value,
      validBefore: a.validBefore,
    });
    return { ok: true, header };
  }

  /**
   * Value of authorizations signed for `mandateId` that are used or may still
   * be used. An authorization stops counting only once it has expired AND the
   * token reports its nonce unused. If the token cannot be queried, it keeps
   * counting (fail closed).
   */
  async outstanding(mandateId: `0x${string}`): Promise<bigint> {
    const now = BigInt(this.now());
    let total = 0n;
    for (const [nonce, s] of this.signed) {
      if (s.mandateId !== mandateId) continue;
      if (s.validBefore <= now) {
        try {
          const used = (await this.publicClient.readContract({
            address: s.asset,
            abi: EIP3009_STATE_ABI,
            functionName: "authorizationState",
            args: [this.account.address, nonce],
          })) as boolean;
          if (!used) {
            this.signed.delete(nonce);
            continue;
          }
        } catch {
          // unknown: keep counting it
        }
      }
      total += s.value;
    }
    return total;
  }

  private async mandate(mandateId: `0x${string}`) {
    const [m, spent] = await Promise.all([
      this.publicClient.readContract({
        address: this.registry,
        abi: MANDATE_REGISTRY_ABI,
        functionName: "mandates",
        args: [mandateId],
      }) as Promise<readonly unknown[]>,
      this.publicClient.readContract({
        address: this.registry,
        abi: MANDATE_REGISTRY_ABI,
        functionName: "spent",
        args: [mandateId],
      }) as Promise<bigint>,
    ]);
    return {
      agentSigner: m[2] as `0x${string}`,
      maxPerTx: m[3] as bigint,
      maxCumulative: m[4] as bigint,
      allowedPayeesRoot: m[6] as `0x${string}`,
      spent,
    };
  }
}
