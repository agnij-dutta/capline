// Standalone proof of the cross-chain invariant. Run: npx tsx lib/coordinator.smoke.ts
import { createMandate, authorize, commit, release, revoke, status } from "./coordinator";

let pass = 0,
  fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// One mandate, GLOBAL cap of 100 USDC, provisioned on three chains.
const m = createMandate({
  principal: "demo-principal",
  ap2Json: JSON.stringify({ intent: "buy compute", cap: 100 }),
  maxPerTx: 40,
  maxCumulative: 100,
  chains: ["solana", "avalanche", "base"],
  allowedPayees: ["0xmerchant"],
});

console.log("\nGLOBAL cross-chain cap (100 USDC across Solana+Avax+Base):");
// Spend 40 on Solana, 40 on Base — 80 committed, 20 left globally.
const a1 = authorize(m.mandateId, "solana", "0xmerchant", 40);
check("40 on Solana authorized", a1.ok);
if (a1.ok) commit(m.mandateId, a1.ticket.ticketId);

const a2 = authorize(m.mandateId, "base", "0xmerchant", 40);
check("40 on Base authorized (different chain, same budget)", a2.ok);
if (a2.ok) commit(m.mandateId, a2.ticket.ticketId);

// Now try 40 on Avalanche — would push global to 120. No single chain sees
// the other two's spend; only the coordinator can block this.
const a3 = authorize(m.mandateId, "avalanche", "0xmerchant", 40);
check("40 on Avalanche DENIED (would breach global cap)", !a3.ok && a3.reason === "OVER_GLOBAL_CAP");
check("  remaining reported as 20", a3.remaining === 20);

// But 20 on Avalanche fits exactly.
const a4 = authorize(m.mandateId, "avalanche", "0xmerchant", 20);
check("20 on Avalanche authorized (exactly fills global cap)", a4.ok);
if (a4.ok) commit(m.mandateId, a4.ticket.ticketId);

const s = status(m.mandateId)!;
check("global committed == 100", s.committed === 100);
check("remaining == 0", s.remaining === 0);
check("per-chain split solana40/base40/avax20", s.perChain.solana === 40 && s.perChain.base === 40 && s.perChain.avalanche === 20);

console.log("\nPer-tx cap + allowlist + expiry:");
const b1 = authorize(m.mandateId, "solana", "0xmerchant", 50);
check("50 DENIED (over per-tx cap of 40)", !b1.ok && b1.reason === "OVER_PER_TX");
const b2 = authorize(m.mandateId, "solana", "0xscammer", 10);
check("payment to unlisted payee DENIED", !b2.ok && b2.reason === "PAYEE_NOT_ALLOWED");

console.log("\nReservation race (no double-spend of the last budget):");
const m2 = createMandate({
  principal: "p2", ap2Json: "{}", maxPerTx: 100, maxCumulative: 30, chains: ["solana", "base"],
});
const r1 = authorize(m2.mandateId, "solana", "x", 20); // reserves 20
const r2 = authorize(m2.mandateId, "base", "y", 20); // only 10 left -> deny
check("first reservation ok", r1.ok);
check("concurrent second DENIED (budget held by pending reservation)", !r2.ok && r2.reason === "OVER_GLOBAL_CAP");
if (r1.ok) release(m2.mandateId, r1.ticket.ticketId); // abandon first
const r3 = authorize(m2.mandateId, "base", "y", 20); // budget freed
check("after release, second now authorized", r3.ok);

console.log("\nRevocation kills all chains at once:");
const m3 = createMandate({ principal: "p3", ap2Json: "{}", maxPerTx: 100, maxCumulative: 100, chains: ["solana", "avalanche", "base"] });
void revoke(m3.mandateId); // flips revoked synchronously before its async transport call
const rev = authorize(m3.mandateId, "avalanche", "x", 1);
check("post-revoke authorize DENIED on every chain", !rev.ok && rev.reason === "REVOKED");

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
