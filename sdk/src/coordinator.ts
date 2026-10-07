// Client for the cross-chain mandate coordinator.
//
// One canonical AP2 mandate governs spend across every chain at once. The
// coordinator enforces the GLOBAL cumulative cap — the one invariant no single
// chain can see — and hands out signed authorization tickets. Point this at a
// running coordinator endpoint (the reference server is `/api/coordinator`).
//
//   const coord = new CoordinatorClient("https://your.app/api/coordinator");
//   const { mandate } = await coord.createMandate({ ... });
//   const auth = await coord.authorize(mandate.mandateId, "base", payee, 25);
//   if (auth.ok) { /* settle on-chain */ await coord.commit(mandate.mandateId, auth.ticket.ticketId); }
//
// Trust model: the coordinator is an off-chain, cooperative control. No chain
// verifies its tickets, and it only learns about a settlement when the client
// commits. It bounds honest clients across chains; it does NOT bound a stolen
// agent key, which is limited by each chain's own on-chain caps instead.
import type { ChainId } from "./types.js";

export interface CanonicalMandate {
  mandateId: string;
  principal: string;
  ap2Hash: string;
  maxPerTx: number;
  maxCumulative: number;
  expiry: number;
  allowedPayees: string[];
  chains: ChainId[];
  createdAt: number;
  revoked: boolean;
}

export interface AuthTicket {
  ticketId: string;
  mandateId: string;
  chain: ChainId;
  to: string;
  amount: number;
  issuedAt: number;
  expiresAt: number;
  attestation: string;
  coordinatorKey: string;
}

export type AuthDenyReason =
  | "MANDATE_MISSING"
  | "REVOKED"
  | "EXPIRED"
  | "OVER_PER_TX"
  | "OVER_GLOBAL_CAP"
  | "PAYEE_NOT_ALLOWED"
  | "CHAIN_NOT_PROVISIONED"
  | "INVALID_AMOUNT";

export type AuthResult =
  | { ok: true; ticket: AuthTicket; remaining: number }
  | { ok: false; reason: AuthDenyReason; remaining: number };

export interface MandateStatus {
  mandate: CanonicalMandate;
  committed: number;
  reserved: number;
  remaining: number;
  perChain: Record<string, number>;
}

export interface CreateMandateInput {
  principal: string;
  ap2Json: string;
  maxPerTx: number;
  maxCumulative: number;
  expiry?: number;
  allowedPayees?: string[];
  chains: ChainId[];
  mandateId?: string;
}

export class CoordinatorClient {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async post<T>(action: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    if (!res.ok) throw new Error(`coordinator ${action} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /**
   * Create a mandate. `principalToken` is returned exactly once and is required
   * by `revoke`; keep it with the principal, never give it to the agent.
   */
  createMandate(
    input: CreateMandateInput,
  ): Promise<{ mandate: CanonicalMandate; principalToken: string; status: MandateStatus }> {
    return this.post("create", input as unknown as Record<string, unknown>);
  }

  authorize(mandateId: string, chain: ChainId, to: string, amount: number): Promise<AuthResult> {
    return this.post("authorize", { mandateId, chain, to, amount });
  }

  /** `late` = the reservation had expired; the spend is still counted. */
  commit(mandateId: string, ticketId: string): Promise<{ ok: boolean; late?: boolean; status: MandateStatus }> {
    return this.post("commit", { mandateId, ticketId });
  }

  release(mandateId: string, ticketId: string): Promise<{ ok: boolean }> {
    return this.post("release", { mandateId, ticketId });
  }

  revoke(mandateId: string, principalToken?: string): Promise<{ ok: boolean; status: MandateStatus }> {
    return this.post("revoke", { mandateId, principalToken });
  }

  async status(mandateId: string): Promise<MandateStatus> {
    const res = await this.fetchImpl(`${this.baseUrl}?mandateId=${encodeURIComponent(mandateId)}`);
    if (!res.ok) throw new Error(`coordinator status failed: ${res.status}`);
    return (await res.json()) as MandateStatus;
  }
}
