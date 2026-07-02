// AP2 Intent Mandate — the signed intent the on-chain policy is bound to.
//
// Google's Agent Payments Protocol (AP2) has the *user* sign an Intent Mandate:
// "spend up to X, only these merchants, only until T." AP2 is a permission
// framework, not a rail — nothing forces a payment to obey it. Capline is the
// missing enforcement: we hash the signed mandate and commit that hash on-chain,
// then enforce its constraints at settlement. `ap2Hash` produces the 32-byte
// commitment stored in the Mandate account's `ap2_hash`.
import { createHash } from "node:crypto";

export interface AP2IntentMandate {
  /** base58 pubkey of the human granting authority */
  principal: string;
  /** base58 pubkey of the agent wallet being authorized */
  agent: string;
  /** payment token mint (e.g. devnet USDC) */
  mint: string;
  /** per-transaction ceiling, in token base units */
  maxPerTx: string;
  /** cumulative budget, in token base units */
  totalCap: string;
  /** unix seconds; the mandate is dead after this */
  notAfter: number;
  /** allowed merchant pubkeys (base58) */
  merchants: string[];
  /** disambiguates multiple mandates for one principal */
  nonce: string;
}

/** Deterministic canonical serialization — key order fixed so the hash is stable. */
export function canonicalize(m: AP2IntentMandate): string {
  const merchants = [...m.merchants].sort();
  return JSON.stringify({
    agent: m.agent,
    maxPerTx: m.maxPerTx,
    merchants,
    mint: m.mint,
    nonce: m.nonce,
    notAfter: m.notAfter,
    principal: m.principal,
    totalCap: m.totalCap,
  });
}

/** sha256 of the canonical mandate → the 32-byte on-chain commitment. */
export function ap2Hash(m: AP2IntentMandate): number[] {
  const h = createHash("sha256").update(canonicalize(m), "utf8").digest();
  return Array.from(h);
}
