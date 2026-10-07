// Cross-chain mandate coordinator — the control plane.
//
// A single AP2 mandate is canonical here. Its enforcement primitive is deployed
// natively on each chain (Solana program / EVM contract), and each chain
// enforces its own LOCAL caps at settlement time — that on-chain revert is the
// unfakeable backstop and it never goes away.
//
// What the coordinator adds is a GLOBAL cumulative cap across every chain at
// once. "Spend at most 100 USDC total, whether the agent pays on Solana,
// Avalanche, or Base" is not a property any one contract can see — the
// coordinator holds the shared ledger and authorizes each spend against the
// global remaining budget.
//
// TRUST MODEL (read this before relying on the global cap; SECURITY.md H-2):
// the coordinator is an off-chain, cooperative control. No chain verifies its
// tickets today, and it learns about a settlement only when the client calls
// `commit`. So the global cap binds clients that route through it honestly; it
// does NOT bind a compromised agent key, which can still spend up to each
// chain's LOCAL caps. The hard, key-theft-proof guarantee is per chain.
//
// Persistence is a pluggable async Backend: an Upstash/Vercel-KV REST store when
// KV_REST_API_URL + KV_REST_API_TOKEN are set (durable across serverless
// instances), else an in-memory Map (local + single-instance demos). Every
// read-modify-write goes through `Backend.update`, which is serialized per
// mandate in-process and compare-and-swap'd in KV, so concurrent authorizes
// cannot both spend the last of the budget.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as edSign,
  verify as edVerify,
  timingSafeEqual,
  KeyObject,
} from "node:crypto";
import type { ChainId } from "./chains";

const KNOWN_CHAINS: readonly ChainId[] = ["solana", "avalanche", "base", "stellar"];

// --- canonical mandate ------------------------------------------------------

export interface CanonicalMandate {
  mandateId: string; // the SAME id is referenced on every chain
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
  expiresAt: number; // unix ms; budget frees if not committed by then
}

export interface Ledger {
  committed: number; // spend committed across all chains
  perChain: Record<string, number>;
  reservations: Record<string, Reservation>;
  /** Recently expired reservations, kept so a late commit is still counted. */
  expired?: Record<string, Reservation>;
}

interface Persisted {
  mandate: CanonicalMandate;
  ledger: Ledger;
  /** sha256 of the principal token returned once by `create` (hex). */
  principalTokenHash?: string;
}

export interface AuthTicket {
  ticketId: string;
  mandateId: string;
  chain: ChainId;
  to: string;
  amount: number;
  issuedAt: number;
  expiresAt: number;
  /** ed25519 signature by the coordinator over `ticketMessage(ticket)`. */
  attestation: string;
  /** base64 SPKI public key. Informational only: verifiers must PIN the key. */
  coordinatorKey: string;
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
  | "CHAIN_NOT_PROVISIONED"
  | "INVALID_AMOUNT";

/** A request the coordinator refuses outright (bad input, conflict, auth). */
export class CoordinatorError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "MANDATE_EXISTS" | "UNAUTHORIZED",
    message: string,
  ) {
    super(message);
    this.name = "CoordinatorError";
  }
}

// --- pluggable persistence backend ------------------------------------------

type Mutator<R> = (p: Persisted | undefined) => { next?: Persisted; result: R };

interface Backend {
  get(mandateId: string): Promise<Persisted | undefined>;
  /** Atomic read-modify-write for one mandate. `fn` must be synchronous. */
  update<R>(mandateId: string, fn: Mutator<R>): Promise<R>;
}

/** Per-key promise chain: serializes updates to one mandate within a process. */
class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();
  run<R>(key: string, task: () => Promise<R>): Promise<R> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

class MemoryBackend implements Backend {
  private map: Map<string, string>;
  private lock = new KeyedLock();
  constructor() {
    // Survive HMR / warm-instance reuse via a global singleton. Values are
    // stored serialized so callers can never mutate state outside `update`.
    const g = globalThis as unknown as { __caplineMem2?: Map<string, string> };
    this.map = g.__caplineMem2 ?? (g.__caplineMem2 = new Map());
  }
  async get(id: string) {
    const raw = this.map.get(id);
    return raw ? (JSON.parse(raw) as Persisted) : undefined;
  }
  update<R>(id: string, fn: Mutator<R>): Promise<R> {
    return this.lock.run(id, async () => {
      const raw = this.map.get(id);
      const { next, result } = fn(raw ? (JSON.parse(raw) as Persisted) : undefined);
      if (next) this.map.set(id, JSON.stringify(next));
      return result;
    });
  }
}

// Compare-and-swap in one round trip: write ARGV[2] only if the stored value is
// still ARGV[1] ("" meaning "key absent"). Returns 1 on success, 0 on conflict.
const CAS_LUA = `
local cur = redis.call('GET', KEYS[1])
if (cur == false and ARGV[1] == '') or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0`;

// Upstash / Vercel-KV REST. No SDK dependency — plain fetch against the REST API.
export class KvRestBackend implements Backend {
  private lock = new KeyedLock();
  constructor(
    private url: string,
    private token: string,
    private fetchImpl: typeof fetch = fetch,
    private maxRetries = 8,
  ) {}
  private async cmd(...args: (string | number)[]): Promise<unknown> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`kv ${args[0]} failed: ${res.status}`);
    return ((await res.json()) as { result: unknown }).result;
  }
  async get(id: string) {
    const raw = (await this.cmd("GET", `mandate:${id}`)) as string | null;
    return raw ? (JSON.parse(raw) as Persisted) : undefined;
  }
  update<R>(id: string, fn: Mutator<R>): Promise<R> {
    // in-process lock avoids self-conflicts; CAS handles other instances
    return this.lock.run(id, async () => {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        const raw = (await this.cmd("GET", `mandate:${id}`)) as string | null;
        const { next, result } = fn(raw ? (JSON.parse(raw) as Persisted) : undefined);
        if (!next) return result;
        const ok = await this.cmd("EVAL", CAS_LUA, 1, `mandate:${id}`, raw ?? "", JSON.stringify(next));
        if (Number(ok) === 1) return result;
      }
      throw new Error(`kv update for ${id} lost ${this.maxRetries} CAS races; retry`);
    });
  }
}

function makeBackend(): Backend {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return new KvRestBackend(url, token);
  return new MemoryBackend();
}

const gb = globalThis as unknown as { __caplineBackend2?: Backend };
let backend: Backend = gb.__caplineBackend2 ?? (gb.__caplineBackend2 = makeBackend());

/** Test seam: swap the persistence backend. */
export function __setBackendForTests(b: Backend) {
  backend = b;
}

/** Whether durable KV persistence is active (vs in-memory fallback). */
export const isDurable = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// --- coordinator signing key ------------------------------------------------
// Set CAPLINE_COORDINATOR_SK (base64 PKCS#8 DER ed25519 private key) so the key
// is stable across instances and verifiers can pin it. Without it, each process
// generates an ephemeral key, which makes tickets unverifiable across
// instances: fine for a demo, not for anything that checks attestations.

const gk = globalThis as unknown as { __caplineKey?: { pub: KeyObject; priv: KeyObject } };
function coordinatorKey() {
  if (!gk.__caplineKey) {
    const sk = process.env.CAPLINE_COORDINATOR_SK;
    if (sk) {
      const priv = createPrivateKey({ key: Buffer.from(sk, "base64"), format: "der", type: "pkcs8" });
      gk.__caplineKey = { priv, pub: createPublicKey(priv) };
    } else {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      gk.__caplineKey = { pub: publicKey, priv: privateKey };
    }
  }
  return gk.__caplineKey;
}

/** Base64 SPKI of the key this process signs with (publish this to pin it). */
export function coordinatorPublicKey(): string {
  return coordinatorKey().pub.export({ type: "spki", format: "der" }).toString("base64");
}

/** Domain-separated bytes the attestation signs. */
export function ticketMessage(t: Omit<AuthTicket, "attestation" | "coordinatorKey">): Buffer {
  return Buffer.from(
    JSON.stringify([
      "capline-ticket-v1",
      t.ticketId,
      t.mandateId,
      t.chain,
      t.to,
      t.amount,
      t.issuedAt,
      t.expiresAt,
    ]),
  );
}

function attest(ticket: Omit<AuthTicket, "attestation" | "coordinatorKey">): AuthTicket {
  const { priv } = coordinatorKey();
  const attestation = edSign(null, ticketMessage(ticket), priv).toString("base64");
  return { ...ticket, attestation, coordinatorKey: coordinatorPublicKey() };
}

/**
 * Verify a ticket against a PINNED coordinator key (base64 SPKI). The key on
 * the ticket itself is ignored: anyone can mint a self-consistent ticket with
 * their own key. Also rejects expired tickets. A ticket is a one-shot
 * reservation, so a verifier that acts on it must also record its ticketId
 * as consumed.
 */
export function verifyTicket(t: AuthTicket, pinnedKey: string, nowMs = Date.now()): boolean {
  if (t.expiresAt < nowMs) return false;
  try {
    const pub = createPublicKey({ key: Buffer.from(pinnedKey, "base64"), format: "der", type: "spki" });
    const { attestation, coordinatorKey: _ignored, ...body } = t;
    void _ignored;
    return edVerify(null, ticketMessage(body), pub, Buffer.from(attestation, "base64"));
  } catch {
    return false;
  }
}

// --- helpers ----------------------------------------------------------------

export function sha256Hex(s: string): string {
  return "0x" + createHash("sha256").update(s).digest("hex");
}

/** Unguessable ids: ticket ids double as capabilities for commit/release. */
function randId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

const MAX_EXPIRED_KEPT = 64;

/** Move expired reservations out of the live set so their budget frees up. */
function sweep(l: Ledger, now = Date.now()): Ledger {
  for (const [id, r] of Object.entries(l.reservations)) {
    if (r.expiresAt < now) {
      delete l.reservations[id];
      l.expired = l.expired ?? {};
      l.expired[id] = r;
    }
  }
  if (l.expired) {
    const ids = Object.keys(l.expired);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_EXPIRED_KEPT))) delete l.expired[id];
  }
  return l;
}

/** Budget currently held by live (un-expired) reservations. */
function reserved(l: Ledger): number {
  return Object.values(l.reservations).reduce((s, r) => s + r.amount, 0);
}

const isPosFinite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

// --- transport seam (Wormhole-swappable) ------------------------------------

export interface MandateTransport {
  broadcastRevocation(m: CanonicalMandate): Promise<void>;
  syncSpend(mandateId: string, chain: ChainId, delta: number): Promise<void>;
}

class AttestationTransport implements MandateTransport {
  async broadcastRevocation(m: CanonicalMandate): Promise<void> {
    // NOT IMPLEMENTED: this does not revoke anything on-chain. A coordinator
    // revoke stops future coordinator authorizations only; the principal must
    // still call revoke() on each chain's contract (SECURITY.md H-2).
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

function validateCreate(input: CreateMandateInput) {
  const bad = (m: string) => new CoordinatorError("INVALID_INPUT", m);
  if (!input || typeof input !== "object") throw bad("body required");
  if (typeof input.principal !== "string" || !input.principal) throw bad("principal required");
  if (typeof input.ap2Json !== "string") throw bad("ap2Json must be a string");
  if (!isPosFinite(input.maxPerTx)) throw bad("maxPerTx must be a positive number");
  if (!isPosFinite(input.maxCumulative)) throw bad("maxCumulative must be a positive number");
  // maxPerTx > maxCumulative is redundant (the cumulative cap binds first) but harmless
  if (input.expiry !== undefined && !(Number.isInteger(input.expiry) && input.expiry >= 0))
    throw bad("expiry must be a non-negative integer (unix seconds)");
  if (!Array.isArray(input.chains) || input.chains.length === 0) throw bad("chains required");
  if (!input.chains.every((c) => KNOWN_CHAINS.includes(c))) throw bad("unknown chain");
  if (input.allowedPayees !== undefined) {
    if (!Array.isArray(input.allowedPayees) || !input.allowedPayees.every((p) => typeof p === "string" && p))
      throw bad("allowedPayees must be an array of non-empty strings");
  }
  if (input.mandateId !== undefined && !(typeof input.mandateId === "string" && /^[\w-]{1,128}$/.test(input.mandateId)))
    throw bad("mandateId must be 1-128 chars of [A-Za-z0-9_-]");
}

/**
 * Create a mandate. Returns the mandate plus a `principalToken`, shown ONCE:
 * it is required to revoke the mandate. Never overwrites an existing id.
 */
export async function createMandate(
  input: CreateMandateInput,
): Promise<CanonicalMandate & { principalToken: string }> {
  validateCreate(input);
  const mandateId = input.mandateId ?? randId("mandate");
  const principalToken = randomBytes(32).toString("hex");
  const mandate: CanonicalMandate = {
    mandateId,
    principal: input.principal,
    ap2Hash: sha256Hex(input.ap2Json),
    maxPerTx: input.maxPerTx,
    maxCumulative: input.maxCumulative,
    expiry: input.expiry ?? 0,
    allowedPayees: (input.allowedPayees ?? []).map((p) => p.toLowerCase()),
    chains: [...new Set(input.chains)],
    createdAt: Date.now(),
    revoked: false,
  };
  const created = await backend.update(mandateId, (cur) =>
    cur
      ? { result: false }
      : {
          next: {
            mandate,
            ledger: { committed: 0, perChain: {}, reservations: {} },
            principalTokenHash: sha256Hex(principalToken),
          },
          result: true,
        },
  );
  if (!created) throw new CoordinatorError("MANDATE_EXISTS", `mandate ${mandateId} already exists`);
  return { ...mandate, principalToken };
}

export async function getMandate(mandateId: string): Promise<CanonicalMandate | undefined> {
  return (await backend.get(mandateId))?.mandate;
}

/**
 * Authorize a proposed spend against the GLOBAL budget before it hits a chain.
 * Reserves the amount (so two chains can't both spend the last of the budget)
 * and returns a signed ticket. Reservations free up after 90s if not committed.
 */
export async function authorize(
  mandateId: string,
  chainId: ChainId,
  to: string,
  amount: number,
): Promise<AuthResult> {
  const now = Date.now();
  // NaN or negative amounts would poison the ledger arithmetic (every later
  // comparison against NaN is false; a negative reservation adds headroom).
  if (!isPosFinite(amount)) return { ok: false, reason: "INVALID_AMOUNT", remaining: 0 };
  if (typeof to !== "string" || !to) return { ok: false, reason: "PAYEE_NOT_ALLOWED", remaining: 0 };

  return backend.update<AuthResult>(mandateId, (p) => {
    if (!p) return { result: { ok: false, reason: "MANDATE_MISSING", remaining: 0 } };
    const { mandate: m } = p;
    const l = sweep(p.ledger, now);
    const remaining = Math.max(0, m.maxCumulative - l.committed - reserved(l));
    // denials do not write (sweeping is idempotent and redone on every read)
    const deny = (reason: AuthDenyReason) => ({ result: { ok: false as const, reason, remaining } });

    if (m.revoked) return deny("REVOKED");
    if (m.expiry !== 0 && now / 1000 > m.expiry) return deny("EXPIRED");
    if (!m.chains.includes(chainId)) return deny("CHAIN_NOT_PROVISIONED");
    if (amount > m.maxPerTx) return deny("OVER_PER_TX");
    if (m.allowedPayees.length > 0 && !m.allowedPayees.includes(to.toLowerCase())) return deny("PAYEE_NOT_ALLOWED");
    // The cross-chain invariant: committed + already-reserved + this <= global cap.
    if (l.committed + reserved(l) + amount > m.maxCumulative) return deny("OVER_GLOBAL_CAP");

    const ticketId = randId("ticket");
    const expiresAt = now + 90_000;
    l.reservations[ticketId] = { ticketId, chain: chainId, to, amount, expiresAt };
    const ticket = attest({ ticketId, mandateId, chain: chainId, to, amount, issuedAt: now, expiresAt });
    return { next: p, result: { ok: true, ticket, remaining: remaining - amount } };
  });
}

/**
 * Commit a reserved spend after the chain settle confirmed. A commit that
 * arrives after the reservation expired is still counted (the money moved on
 * chain either way); `late` tells the caller the budget had been released in
 * the meantime, so the ledger may now exceed the cap.
 */
export async function commit(mandateId: string, ticketId: string): Promise<boolean> {
  return (await commitDetailed(mandateId, ticketId)).ok;
}

export async function commitDetailed(
  mandateId: string,
  ticketId: string,
): Promise<{ ok: boolean; late?: boolean }> {
  type Out = { ok: false } | { ok: true; late: boolean; r: Reservation };
  const out = await backend.update<Out>(mandateId, (p) => {
    if (!p) return { result: { ok: false } };
    const l = sweep(p.ledger);
    const live = l.reservations[ticketId];
    const late = live ? undefined : l.expired?.[ticketId];
    const r = live ?? late;
    if (!r) return { result: { ok: false } };
    if (live) delete l.reservations[ticketId];
    else delete l.expired![ticketId];
    l.committed += r.amount;
    l.perChain[r.chain] = (l.perChain[r.chain] ?? 0) + r.amount;
    return { next: p, result: { ok: true, late: !live, r } };
  });
  if (!out.ok) return { ok: false };
  void transport.syncSpend(mandateId, out.r.chain, out.r.amount);
  return { ok: true, late: out.late };
}

/** Release a live reservation if the chain settle failed/was abandoned. */
export async function release(mandateId: string, ticketId: string): Promise<void> {
  await backend.update(mandateId, (p) => {
    if (!p || !p.ledger.reservations[ticketId]) return { result: undefined };
    delete p.ledger.reservations[ticketId];
    return { next: p, result: undefined };
  });
}

/**
 * Revoke. Requires the `principalToken` returned by `create` (mandates created
 * before tokens existed have none, and stay revocable without one).
 */
export async function revoke(mandateId: string, principalToken?: string): Promise<boolean> {
  const out = await backend.update(mandateId, (p) => {
    if (!p) return { result: "missing" as const };
    if (p.principalTokenHash) {
      const given = Buffer.from(sha256Hex(principalToken ?? ""));
      const want = Buffer.from(p.principalTokenHash);
      if (given.length !== want.length || !timingSafeEqual(given, want)) return { result: "unauthorized" as const };
    }
    p.mandate.revoked = true;
    return { next: p, result: "ok" as const };
  });
  if (out === "unauthorized") throw new CoordinatorError("UNAUTHORIZED", "principalToken required to revoke");
  if (out === "missing") return false;
  const m = await getMandate(mandateId);
  if (m) await transport.broadcastRevocation(m);
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
