// AP2 Intent Mandate hashing — the signed intent the on-chain policy binds to.
//
// Google's Agent Payments Protocol (AP2) has the *user* sign an Intent Mandate:
// "spend up to X, only these merchants, only until T." AP2 is a permission
// framework, not a rail — nothing forces a payment to obey it. Capline is the
// enforcement: we hash the signed mandate, commit that hash on-chain, then
// enforce its constraints at settlement.
//
// Isomorphic (browser + node): uses @noble/hashes, no node:crypto.
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils";
import type { AP2IntentMandate } from "./types.js";

/** Deterministic canonical serialization of an arbitrary intent object. Keys
 *  are sorted so the digest is stable regardless of property order. */
export function canonicalizeObject(fields: Record<string, unknown>): string {
  return JSON.stringify(fields, Object.keys(fields).sort());
}

/** Canonical serialization of a typed AP2 Intent Mandate (merchants sorted). */
export function canonicalize(m: AP2IntentMandate): string {
  return JSON.stringify({
    agent: m.agent,
    maxPerTx: m.maxPerTx,
    merchants: [...m.merchants].sort(),
    mint: m.mint,
    nonce: m.nonce,
    notAfter: m.notAfter,
    principal: m.principal,
    totalCap: m.totalCap,
  });
}

/** Raw 32-byte sha256 of the canonical mandate. */
export function ap2HashBytes(m: AP2IntentMandate): Uint8Array {
  return sha256(utf8ToBytes(canonicalize(m)));
}

/** `0x`-prefixed hex commitment (EVM-friendly). */
export function ap2HashHex(m: AP2IntentMandate): string {
  return "0x" + bytesToHex(ap2HashBytes(m));
}

/** number[] commitment (Solana/Anchor-friendly). */
export function ap2HashArray(m: AP2IntentMandate): number[] {
  return Array.from(ap2HashBytes(m));
}

/** Hash an arbitrary canonicalized intent object → hex. */
export function hashIntent(fields: Record<string, unknown>): string {
  return "0x" + bytesToHex(sha256(utf8ToBytes(canonicalizeObject(fields))));
}
