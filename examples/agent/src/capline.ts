// The leash. The agent's brain (brain.ts) can PROPOSE any payment; this is the
// only thing that can actually execute one: and it runs every proposal through
// a Capline mandate first. Enforcement here uses the hosted cross-chain
// coordinator (Layer A), so this demo needs ZERO on-chain funds. The same mandate
// is also enforced on-chain (Layer B) when you settle for real: see the README.
import { CoordinatorClient, type AuthResult } from "capline/coordinator";
import { hashIntent } from "capline";

const COORDINATOR_URL =
  process.env.CAPLINE_COORDINATOR_URL || "https://capline-protocol.vercel.app/api/coordinator";

const coord = new CoordinatorClient(COORDINATOR_URL);

// The mandate the agent is bound to.
export const MERCHANT = "DataVendor"; // the one allowlisted payee
export const CAP_PER_TX = 5; // USDC
export const CAP_TOTAL = 20; // USDC (cumulative, across every chain)
export const CHAIN = "solana" as const;

/** Thrown when a proposed payment is outside the mandate. The error is the docs. */
export class MandateExceeded extends Error {
  constructor(
    readonly reason: string,
    readonly cap: number,
    readonly attempted: number,
  ) {
    super(`MandateExceeded: ${reason} (cap=$${cap}, attempted=$${attempted})`);
    this.name = "MandateExceeded";
  }
}

export interface Mandate {
  id: string;
  commitment: string; // sha256(AP2 intent): the on-chain-committed hash
}

/** Provision the signed AP2 mandate the agent will operate under. */
export async function provisionMandate(): Promise<Mandate> {
  const intent = {
    principal: "you",
    agent: "capline-agent",
    merchant: MERCHANT,
    maxPerTx: CAP_PER_TX,
    totalCap: CAP_TOTAL,
  };
  const ap2Json = JSON.stringify(intent);
  const { mandate } = await coord.createMandate({
    principal: "capline-template-" + Math.random().toString(36).slice(2, 8),
    ap2Json,
    maxPerTx: CAP_PER_TX,
    maxCumulative: CAP_TOTAL,
    chains: [CHAIN],
    allowedPayees: [MERCHANT],
  });
  return { id: mandate.mandateId, commitment: hashIntent(intent) };
}

/**
 * The ONLY outward payment capability the agent has. Runs the proposal through
 * the mandate; settles if within bounds, throws MandateExceeded if not. No
 * jailbreak prompt can change these numbers: they aren't natural language.
 */
export async function pay(
  mandate: Mandate,
  to: string,
  amount: number,
): Promise<{ remaining: number }> {
  const auth: AuthResult = await coord.authorize(mandate.id, CHAIN, to, amount);
  if (!auth.ok) {
    const cap =
      auth.reason === "OVER_PER_TX" ? CAP_PER_TX : auth.reason === "OVER_GLOBAL_CAP" ? CAP_TOTAL : 0;
    throw new MandateExceeded(auth.reason, cap, amount);
  }
  await coord.commit(mandate.id, auth.ticket.ticketId);
  return { remaining: auth.remaining };
}
