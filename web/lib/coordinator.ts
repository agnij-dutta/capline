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
// Persistence is a pluggable async Backend: an Upstash/Vercel-KV REST store when
// KV_REST_API_URL + KV_REST_API_TOKEN are set (durable across serverless
// instances), else an in-memory Map (fine for local + single-instance demos).
// The `MandateTransport` seam is Wormhole-swappable: Phase 2 replaces the
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

interface Persisted {
  mandate: CanonicalMandate;
  ledger: Ledger;
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

// --- pluggable persistence backend ------------------------------------------

interface Backend {
  get(mandateId: string): Promise<Persisted | undefined>;
  set(mandateId: string, value: Persisted): Promise<void>;
}

class MemoryBackend implements Backend {
  private map: Map<string, Persisted>;
  constructor() {
    // Survive HMR / warm-instance reuse via a global singleton.
    const g = globalThis as unknown as { __caplineMem?: Map<string, Persisted> };
    this.map = g.__caplineMem ?? (g.__caplineMem = new Map());
  }
  async get(id: string) {
    return this.map.get(id);
  }
  async set(id: string, v: Persisted) {
    this.map.set(id, v);
  }
}

// Upstash / Vercel-KV REST. No SDK dependency — plain fetch against the REST API.
// NOTE: read-modify-write is not atomic across truly-concurrent requests; for a
// demo (sequential clicks) this is fine. Production hardening = an Upstash Lua
// EVAL for the reserve step. Durability across instances is the win here.
class KvRestBackend implements Backend {
  constructor(private url: string, private token: string) {}
  private async cmd(...args: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`kv ${args[0]} failed: ${res.status}`);
    return (await res.json()).result;
  }
  async get(id: string) {
    const raw = (await this.cmd("GET", `mandate:${id}`)) as string | null;
    return raw ? (JSON.parse(raw) as Persisted) : undefined;
  }
  async set(id: string, v: Persisted) {
    await this.cmd("SET", `mandate:${id}`, JSON.stringify(v));
  }
}

function makeBackend(): Backend {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return new KvRestBackend(url, token);
  return new MemoryBackend();
}

const gb = globalThis as unknown as { __caplineBackend?: Backend };
const backend: Backend = gb.__caplineBackend ?? (gb.__caplineBackend = makeBackend());

/** Whether durable KV persistence is active (vs in-memory fallback). */
export const isDurable = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// --- coordinator signing key ------------------------------------------------
// One ed25519 key per process. Attestations are self-describing (the pub key
// rides on every ticket), so multi-instance signing keys verify independently.

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
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Sweep expired reservations (mutates in place) so their budget frees up. */
function sweep(l: Ledger): Ledger {
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
  broadcastRevocation(m: CanonicalMandate): Promise<void>;
  syncSpend(mandateId: string, chain: ChainId, delta: number): Promise<void>;
}

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
  ap2Json: string;
  maxPerTx: number;
  maxCumulative: number;
  expiry?: number;
  allowedPayees?: string[];
  chains: ChainId[];
  mandateId?: string;
}

export async function createMandate(input: CreateMandateInput): Promise<CanonicalMandate> {
  const mandateId = input.mandateId ?? randId("mandate");
  const mandate: CanonicalMandate = {
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
  await backend.set(mandateId, { mandate, ledger: { committed: 0, perChain: {}, reservations: {} } });
  return mandate;
}

export async function getMandate(mandateId: string): Promise<CanonicalMandate | undefined> {
  return (await backend.get(mandateId))?.mandate;
}

/**
 * Authorize a proposed spend against the GLOBAL budget before it ever hits a
 * chain. Reserves the amount (so two chains can't both spend the last of the
 * budget) and returns a signed ticket the facilitator presents at settle time.
 */
export async function authorize(
  mandateId: string,
  chainId: ChainId,
  to: string,
  amount: number,
): Promise<AuthResult> {
  const p = await backend.get(mandateId);
  const now = Date.now();
  if (!p) return { ok: false, reason: "MANDATE_MISSING", remaining: 0 };

  const { mandate: m } = p;
  const l = sweep(p.ledger);
  const remaining = Math.max(0, m.maxCumulative - l.committed - reserved(l));

  if (m.revoked) return { ok: false, reason: "REVOKED", remaining };
  if (m.expiry !== 0 && now / 1000 > m.expiry) return { ok: false, reason: "EXPIRED", remaining };
  if (!m.chains.includes(chainId)) return { ok: false, reason: "CHAIN_NOT_PROVISIONED", remaining };
  if (amount > m.maxPerTx) return { ok: false, reason: "OVER_PER_TX", remaining };
  if (m.allowedPayees.length > 0 && !m.allowedPayees.includes(to.toLowerCase()))
    return { ok: false, reason: "PAYEE_NOT_ALLOWED", remaining };
  // The cross-chain invariant: committed + already-reserved + this ≤ global cap.
  if (l.committed + reserved(l) + amount > m.maxCumulative)
    return { ok: false, reason: "OVER_GLOBAL_CAP", remaining };

  const ticketId = randId("ticket");
  const expiresAt = now + 90_000; // 90s to settle or the budget frees again
  l.reservations[ticketId] = { ticketId, chain: chainId, to, amount, expiresAt };
  await backend.set(mandateId, p);

  const ticket = attest({ ticketId, mandateId, chain: chainId, to, amount, issuedAt: now, expiresAt });
  return { ok: true, ticket, remaining: remaining - amount };
}

/** Commit a reserved spend after the chain settle confirmed. */
export async function commit(mandateId: string, ticketId: string): Promise<boolean> {
  const p = await backend.get(mandateId);
  if (!p) return false;
  const l = sweep(p.ledger);
  const r = l.reservations[ticketId];
  if (!r) return false;
  delete l.reservations[ticketId];
  l.committed += r.amount;
  l.perChain[r.chain] = (l.perChain[r.chain] ?? 0) + r.amount;
  await backend.set(mandateId, p);
  void transport.syncSpend(mandateId, r.chain, r.amount);
  return true;
}

/** Release a reservation if the chain settle failed/was abandoned. */
export async function release(mandateId: string, ticketId: string): Promise<void> {
  const p = await backend.get(mandateId);
  if (!p) return;
  delete p.ledger.reservations[ticketId];
  await backend.set(mandateId, p);
}

export async function revoke(mandateId: string): Promise<boolean> {
  const p = await backend.get(mandateId);
  if (!p) return false;
  p.mandate.revoked = true;
  await backend.set(mandateId, p);
  await transport.broadcastRevocation(p.mandate);
  return true;
}

export interface MandateStatus {
  mandate: CanonicalMandate;
  committed: number;
  reserved: number;
  remaining: number;
  perChain: Record<string, number>;
}

export async function status(mandateId: string): Promise<MandateStatus | undefined> {
  const p = await backend.get(mandateId);
  if (!p) return undefined;
  const l = sweep(p.ledger);
  const res = reserved(l);
  return {
    mandate: p.mandate,
    committed: l.committed,
    reserved: res,
    remaining: Math.max(0, p.mandate.maxCumulative - l.committed - res),
    perChain: l.perChain,
  };
}
