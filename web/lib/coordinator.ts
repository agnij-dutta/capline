// Cross-chain mandate coordinator — the control plane.
//
// A single AP2 mandate is canonical here. Its enforcement primitive is deployed
// natively on each chain (Solana program / EVM contract), and each chain
// enforces its own LOCAL caps at settlement time — that on-chain revert is the
// unfakeable backstop and it never goes away.
//
// What the coordinator adds is the one guarantee no single chain can make on its
// own: a GLOBAL cumulative cap across every chain at once. "Spend at most 100
// USDC total, whether the agent pays on Solana, Avalanche, or Base" is not a
// property any one contract can see — the coordinator holds the shared ledger,
// authorizes each spend against the global remaining budget, and broadcasts
// revocation to all chains.
//
// Phase 1 the transport is signed attestations over an in-memory ledger. The
// `MandateTransport` seam below is Wormhole-swappable: Phase 2 replaces the
// AttestationTransport with real cross-chain messaging without touching the
// authorize/commit/revoke logic.

import { createHash, generateKeyPairSync, sign as edSign, KeyObject } from "node:crypto";
import type { ChainId } from "./chains";

// --- canonical mandate ------------------------------------------------------

export interface CanonicalMandate {
  mandateId: string; // hex; the SAME id is referenced on every chain
  principal: string; // principal identity (label or pubkey, chain-agnostic)
  ap2Hash: string; // sha256 of the canonical AP2 intent JSON
  maxPerTx: number; // per-transaction ceiling (USDC, human units)
  maxCumulative: number; // GLOBAL lifetime ceiling across ALL chains
  expiry: number; // unix seconds; 0 = no expiry
  allowedPayees: string[]; // lowercased; empty = any payee
  chains: ChainId[]; // chains this mandate is provisioned on
  createdAt: number;
  revoked: boolean;
}

export interface Reservation {
  ticketId: string;
  chain: ChainId;
  to: string;
  amount: number;
  expiresAt: number; // unix ms; auto-released if not committed
}

export interface Ledger {
  committed: number; // spend committed across all chains
  perChain: Record<string, number>;
  reservations: Record<string, Reservation>;
}

export interface AuthTicket {
  ticketId: string;
  mandateId: string;
  chain: ChainId;
  to: string;
  amount: number;
  issuedAt: number;
  expiresAt: number;
  /** ed25519 signature by the coordinator over the ticket's canonical bytes. */
  attestation: string;
  coordinatorKey: string; // base64 spki public key, so anyone can verify
}

export type AuthResult =
  | { ok: true; ticket: AuthTicket; remaining: number }
  | { ok: false; reason: AuthDenyReason; remaining: number };

export type AuthDenyReason =
  | "MANDATE_MISSING"
  | "REVOKED"
  | "EXPIRED"
  | "OVER_PER_TX"
  | "OVER_GLOBAL_CAP" // <-- the cross-chain money shot
  | "PAYEE_NOT_ALLOWED"
  | "CHAIN_NOT_PROVISIONED";

// --- pluggable store (in-memory now, Vercel KV later) -----------------------

interface Store {
  mandates: Map<string, CanonicalMandate>;
  ledgers: Map<string, Ledger>;
}

// Module-level singleton. Survives within a warm serverless instance; a real
// deployment swaps this for Vercel KV / a DB behind the same shape.
const g = globalThis as unknown as { __caplineStore?: Store };
const store: Store =
  g.__caplineStore ??
  (g.__caplineStore = { mandates: new Map(), ledgers: new Map() });

// --- coordinator signing key ------------------------------------------------
// One ed25519 key per process. Attestations are verifiable by anyone (the pub
// key rides along on every ticket). An on-chain verifier could check these the
// same way the Solana program already verifies AP2 signatures.

const gk = globalThis as unknown as { __caplineKey?: { pub: KeyObject; priv: KeyObject } };
function coordinatorKey() {
  if (!gk.__caplineKey) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    gk.__caplineKey = { pub: publicKey, priv: privateKey };
  }
  return gk.__caplineKey;
}

function attest(ticket: Omit<AuthTicket, "attestation" | "coordinatorKey">): AuthTicket {
  const { priv, pub } = coordinatorKey();
  const bytes = Buffer.from(
    `${ticket.ticketId}|${ticket.mandateId}|${ticket.chain}|${ticket.to}|${ticket.amount}|${ticket.expiresAt}`,
  );
  const attestation = edSign(null, bytes, priv).toString("base64");
  const coordinatorKey_ = pub.export({ type: "spki", format: "der" }).toString("base64");
  return { ...ticket, attestation, coordinatorKey: coordinatorKey_ };
}

// --- helpers ----------------------------------------------------------------

export function sha256Hex(s: string): string {
  return "0x" + createHash("sha256").update(s).digest("hex");
}

function randId(prefix: string): string {
  // Non-crypto id for tickets/mandates; uniqueness, not secrecy.
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function ledgerOf(mandateId: string): Ledger {
  let l = store.ledgers.get(mandateId);
  if (!l) {
    l = { committed: 0, perChain: {}, reservations: {} };
    store.ledgers.set(mandateId, l);
  }
  // Sweep expired reservations so their budget frees up.
  const now = Date.now();
  for (const [id, r] of Object.entries(l.reservations)) {
    if (r.expiresAt < now) delete l.reservations[id];
  }
  return l;
}

/** Budget currently held by live (un-expired) reservations. */
function reserved(l: Ledger): number {
  return Object.values(l.reservations).reduce((s, r) => s + r.amount, 0);
}

// --- transport seam (Wormhole-swappable) ------------------------------------

export interface MandateTransport {
  /** Push a revocation to every chain the mandate lives on. */
  broadcastRevocation(m: CanonicalMandate): Promise<void>;
  /** Reflect a committed spend delta to peers (no-op for in-memory). */
  syncSpend(mandateId: string, chain: ChainId, delta: number): Promise<void>;
}

// Phase 1: the coordinator IS the source of truth, so broadcasting is a logged
// intent. Phase 2 swaps this for a WormholeTransport that emits VAAs the chains
// verify. The authorize/commit/revoke logic below does not change.
class AttestationTransport implements MandateTransport {
  async broadcastRevocation(m: CanonicalMandate): Promise<void> {
    // In a real deploy: submit revoke() to each chain's contract via a relayer.
    // Here the coordinator's own state is authoritative and already flipped.
    void m;
  }
  async syncSpend(): Promise<void> {}
}

export const transport: MandateTransport = new AttestationTransport();

// --- the API ----------------------------------------------------------------

export interface CreateMandateInput {
  principal: string;
  ap2Json: string; // canonical AP2 intent; hashed and committed
  maxPerTx: number;
  maxCumulative: number;
  expiry?: number;
  allowedPayees?: string[];
  chains: ChainId[];
  mandateId?: string; // caller may pin the id (mirrors on-chain createMandate)
}

export function createMandate(input: CreateMandateInput): CanonicalMandate {
  const mandateId = input.mandateId ?? randId("mandate");
  const m: CanonicalMandate = {
    mandateId,
    principal: input.principal,
    ap2Hash: sha256Hex(input.ap2Json),
    maxPerTx: input.maxPerTx,
    maxCumulative: input.maxCumulative,
    expiry: input.expiry ?? 0,
    allowedPayees: (input.allowedPayees ?? []).map((p) => p.toLowerCase()),
    chains: input.chains,
    createdAt: Date.now(),
    revoked: false,
  };
  store.mandates.set(mandateId, m);
  store.ledgers.set(mandateId, { committed: 0, perChain: {}, reservations: {} });
  return m;
}

export function getMandate(mandateId: string): CanonicalMandate | undefined {
  return store.mandates.get(mandateId);
}

/**
 * Authorize a proposed spend against the GLOBAL budget before it ever hits a
 * chain. Reserves the amount (so two chains can't both spend the last of the
 * budget concurrently) and returns a signed ticket the facilitator presents at
 * settle time. The on-chain contract still enforces its own local caps — this
 * is the layer above that, enforcing the one invariant spanning all chains.
 */
export function authorize(
  mandateId: string,
  chainId: ChainId,
  to: string,
  amount: number,
): AuthResult {
  const m = store.mandates.get(mandateId);
  const now = Date.now();
  if (!m) return { ok: false, reason: "MANDATE_MISSING", remaining: 0 };

  const l = ledgerOf(mandateId);
  const remaining = Math.max(0, m.maxCumulative - l.committed - reserved(l));

  if (m.revoked) return { ok: false, reason: "REVOKED", remaining };
  if (m.expiry !== 0 && now / 1000 > m.expiry)
    return { ok: false, reason: "EXPIRED", remaining };
  if (!m.chains.includes(chainId))
    return { ok: false, reason: "CHAIN_NOT_PROVISIONED", remaining };
  if (amount > m.maxPerTx) return { ok: false, reason: "OVER_PER_TX", remaining };
  if (
    m.allowedPayees.length > 0 &&
    !m.allowedPayees.includes(to.toLowerCase())
  )
    return { ok: false, reason: "PAYEE_NOT_ALLOWED", remaining };
  // The cross-chain invariant: committed + already-reserved + this ≤ global cap.
  if (l.committed + reserved(l) + amount > m.maxCumulative)
    return { ok: false, reason: "OVER_GLOBAL_CAP", remaining };

  const ticketId = randId("ticket");
  const expiresAt = now + 90_000; // 90s to settle or the budget frees again
  l.reservations[ticketId] = { ticketId, chain: chainId, to, amount, expiresAt };
  const ticket = attest({
    ticketId,
    mandateId,
    chain: chainId,
    to,
    amount,
    issuedAt: now,
    expiresAt,
  });
  return { ok: true, ticket, remaining: remaining - amount };
}

/** Commit a reserved spend after the chain settle confirmed. */
export function commit(mandateId: string, ticketId: string): boolean {
  const l = ledgerOf(mandateId);
  const r = l.reservations[ticketId];
  if (!r) return false;
  delete l.reservations[ticketId];
  l.committed += r.amount;
  l.perChain[r.chain] = (l.perChain[r.chain] ?? 0) + r.amount;
  void transport.syncSpend(mandateId, r.chain, r.amount);
  return true;
}

/** Release a reservation if the chain settle failed/was abandoned. */
export function release(mandateId: string, ticketId: string): void {
  const l = ledgerOf(mandateId);
  delete l.reservations[ticketId];
}

export async function revoke(mandateId: string): Promise<boolean> {
  const m = store.mandates.get(mandateId);
  if (!m) return false;
  m.revoked = true;
  await transport.broadcastRevocation(m);
  return true;
}

export interface MandateStatus {
  mandate: CanonicalMandate;
  committed: number;
  reserved: number;
  remaining: number;
  perChain: Record<string, number>;
}

export function status(mandateId: string): MandateStatus | undefined {
  const m = store.mandates.get(mandateId);
  if (!m) return undefined;
  const l = ledgerOf(mandateId);
  const res = reserved(l);
  return {
    mandate: m,
    committed: l.committed,
    reserved: res,
    remaining: Math.max(0, m.maxCumulative - l.committed - res),
    perChain: l.perChain,
  };
}
