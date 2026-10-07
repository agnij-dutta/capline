// Standalone proof of the cross-chain invariant. Run: npx tsx lib/coordinator.smoke.ts
import {
  createMandate,
  authorize,
  commit,
  commitDetailed,
  release,
  revoke,
  status,
  verifyTicket,
  coordinatorPublicKey,
  CoordinatorError,
  KvRestBackend,
  __setBackendForTests,
  type AuthTicket,
} from "./coordinator";
import { generateKeyPairSync, sign as edSign } from "node:crypto";

let pass = 0,
  fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

async function main() {
  // One mandate, GLOBAL cap of 100 USDC, provisioned on three chains.
  const m = await createMandate({
    principal: "demo-principal",
    ap2Json: JSON.stringify({ intent: "buy compute", cap: 100 }),
    maxPerTx: 40,
    maxCumulative: 100,
    chains: ["solana", "avalanche", "base"],
    allowedPayees: ["0xmerchant"],
  });

  console.log("\nGLOBAL cross-chain cap (100 USDC across Solana+Avax+Base):");
  const a1 = await authorize(m.mandateId, "solana", "0xmerchant", 40);
  check("40 on Solana authorized", a1.ok);
  if (a1.ok) await commit(m.mandateId, a1.ticket.ticketId);

  const a2 = await authorize(m.mandateId, "base", "0xmerchant", 40);
  check("40 on Base authorized (different chain, same budget)", a2.ok);
  if (a2.ok) await commit(m.mandateId, a2.ticket.ticketId);

  // Now 40 on Avalanche would push global to 120. Only the coordinator can block this.
  const a3 = await authorize(m.mandateId, "avalanche", "0xmerchant", 40);
  check("40 on Avalanche DENIED (would breach global cap)", !a3.ok && a3.reason === "OVER_GLOBAL_CAP");
  check("  remaining reported as 20", a3.remaining === 20);

  const a4 = await authorize(m.mandateId, "avalanche", "0xmerchant", 20);
  check("20 on Avalanche authorized (exactly fills global cap)", a4.ok);
  if (a4.ok) await commit(m.mandateId, a4.ticket.ticketId);

  const s = (await status(m.mandateId))!;
  check("global committed == 100", s.committed === 100);
  check("remaining == 0", s.remaining === 0);
  check("per-chain split solana40/base40/avax20", s.perChain.solana === 40 && s.perChain.base === 40 && s.perChain.avalanche === 20);

  console.log("\nPer-tx cap + allowlist:");
  const b1 = await authorize(m.mandateId, "solana", "0xmerchant", 50);
  check("50 DENIED (over per-tx cap of 40)", !b1.ok && b1.reason === "OVER_PER_TX");
  const b2 = await authorize(m.mandateId, "solana", "0xscammer", 10);
  check("payment to unlisted payee DENIED", !b2.ok && b2.reason === "PAYEE_NOT_ALLOWED");

  console.log("\nReservation race (no double-spend of the last budget):");
  const m2 = await createMandate({
    principal: "p2", ap2Json: "{}", maxPerTx: 100, maxCumulative: 30, chains: ["solana", "base"],
  });
  const r1 = await authorize(m2.mandateId, "solana", "x", 20); // reserves 20
  const r2 = await authorize(m2.mandateId, "base", "y", 20); // only 10 left -> deny
  check("first reservation ok", r1.ok);
  check("concurrent second DENIED (budget held by pending reservation)", !r2.ok && r2.reason === "OVER_GLOBAL_CAP");
  if (r1.ok) await release(m2.mandateId, r1.ticket.ticketId); // abandon first
  const r3 = await authorize(m2.mandateId, "base", "y", 20); // budget freed
  check("after release, second now authorized", r3.ok);

  console.log("\nRevocation kills all chains at once:");
  const m3 = await createMandate({ principal: "p3", ap2Json: "{}", maxPerTx: 100, maxCumulative: 100, chains: ["solana", "avalanche", "base"] });
  await revoke(m3.mandateId, m3.principalToken);
  const rev = await authorize(m3.mandateId, "avalanche", "x", 1);
  check("post-revoke authorize DENIED on every chain", !rev.ok && rev.reason === "REVOKED");

  await reviewRegressions();
  await kvConcurrency();

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof CoordinatorError ? e.code : String(e);
  }
};

// --- security review regressions (SECURITY.md H-1, M-4, M-5, M-6, L-5) -------
async function reviewRegressions() {
  console.log("\nInput validation (H-1: NaN / negative amounts poisoned the ledger):");
  const m = await createMandate({ principal: "p4", ap2Json: "{}", maxPerTx: 10, maxCumulative: 30, chains: ["solana"] });
  for (const bad of [NaN, -1000, 0, Infinity, "5" as unknown as number]) {
    const r = await authorize(m.mandateId, "solana", "x", bad);
    check(`amount ${String(bad)} DENIED as INVALID_AMOUNT`, !r.ok && r.reason === "INVALID_AMOUNT");
  }
  const s0 = (await status(m.mandateId))!;
  check("ledger untouched by invalid amounts (remaining 30)", s0.remaining === 30 && s0.reserved === 0);

  check(
    "create rejects a negative per-tx cap",
    (await code(createMandate({ principal: "p", ap2Json: "{}", maxPerTx: -5, maxCumulative: 10, chains: ["solana"] }))) === "INVALID_INPUT",
  );
  check(
    "create rejects NaN cap",
    (await code(createMandate({ principal: "p", ap2Json: "{}", maxPerTx: 1, maxCumulative: NaN, chains: ["solana"] }))) === "INVALID_INPUT",
  );
  check(
    "create rejects unknown chain",
    (await code(createMandate({ principal: "p", ap2Json: "{}", maxPerTx: 1, maxCumulative: 2, chains: ["ethereum" as never] }))) === "INVALID_INPUT",
  );

  console.log("\nNo overwrite (H-1: re-create with the same id reset the global ledger):");
  const a = await authorize(m.mandateId, "solana", "x", 10);
  if (a.ok) await commit(m.mandateId, a.ticket.ticketId);
  const over = await code(
    createMandate({ principal: "attacker", ap2Json: "{}", maxPerTx: 1e9, maxCumulative: 1e9, chains: ["solana"], mandateId: m.mandateId }),
  );
  check("re-create with an existing mandateId -> MANDATE_EXISTS", over === "MANDATE_EXISTS");
  const s1 = (await status(m.mandateId))!;
  check("caps and committed spend unchanged", s1.committed === 10 && s1.mandate.maxCumulative === 30);

  console.log("\nRevoke needs the principal token (M-5):");
  check("revoke without token -> UNAUTHORIZED", (await code(revoke(m.mandateId))) === "UNAUTHORIZED");
  check("revoke with wrong token -> UNAUTHORIZED", (await code(revoke(m.mandateId, "00".repeat(32)))) === "UNAUTHORIZED");
  check("still live after failed revokes", !(await status(m.mandateId))!.mandate.revoked);

  console.log("\nCommit semantics (M-6: late commits were silently dropped):");
  const b = await authorize(m.mandateId, "solana", "x", 5);
  check("authorize 5", b.ok);
  if (b.ok) {
    check("first commit counts", await commit(m.mandateId, b.ticket.ticketId));
    check("second commit of the same ticket is a no-op", !(await commit(m.mandateId, b.ticket.ticketId)));
  }
  check("committed == 15 (no double count)", (await status(m.mandateId))!.committed === 15);
  await release(m.mandateId, "ticket_" + "0".repeat(32));
  check("release of an unknown ticket changes nothing", (await status(m.mandateId))!.committed === 15);

  const c = await authorize(m.mandateId, "solana", "x", 5);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 120_000; // the 90s reservation has expired
    check("expired reservation no longer holds budget", (await status(m.mandateId))!.reserved === 0);
    const late = c.ok ? await commitDetailed(m.mandateId, c.ticket.ticketId) : { ok: false };
    check("late commit is still counted, and flagged late", late.ok && (late as { late?: boolean }).late === true);
  } finally {
    Date.now = realNow;
  }
  check("committed == 20 after the late commit", (await status(m.mandateId))!.committed === 20);

  console.log("\nTicket attestation (L-5: self-describing key):");
  const t = await authorize(m.mandateId, "solana", "x", 1);
  if (t.ok) {
    const pinned = coordinatorPublicKey();
    check("genuine ticket verifies against the pinned key", verifyTicket(t.ticket, pinned));
    const tampered: AuthTicket = { ...t.ticket, amount: 1000 };
    check("tampered amount fails", !verifyTicket(tampered, pinned));
    // an attacker mints a self-consistent ticket with their own key
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const forgedBody = { ...t.ticket, amount: 1000 };
    const msg = Buffer.from(
      JSON.stringify(["capline-ticket-v1", forgedBody.ticketId, forgedBody.mandateId, forgedBody.chain, forgedBody.to, forgedBody.amount, forgedBody.issuedAt, forgedBody.expiresAt]),
    );
    const forged: AuthTicket = {
      ...forgedBody,
      attestation: edSign(null, msg, privateKey).toString("base64"),
      coordinatorKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    };
    check("forged ticket verifies against its OWN key (why pinning matters)", verifyTicket(forged, forged.coordinatorKey));
    check("forged ticket fails against the pinned coordinator key", !verifyTicket(forged, pinned));
    check("expired ticket fails", !verifyTicket(t.ticket, pinned, t.ticket.expiresAt + 1));
  }

  console.log("\nConcurrency, in-memory backend (M-4):");
  const m5 = await createMandate({ principal: "p5", ap2Json: "{}", maxPerTx: 20, maxCumulative: 30, chains: ["solana", "base"] });
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => authorize(m5.mandateId, i % 2 ? "base" : "solana", "x", 20)));
  check("10 concurrent 20-unit authorizes on a 30 cap: exactly 1 succeeds", rs.filter((r) => r.ok).length === 1);
}

// Fake Upstash REST: GET / SET / EVAL(CAS) with per-call latency, shared by two
// KvRestBackend instances that stand in for two serverless instances.
async function kvConcurrency() {
  console.log("\nConcurrency across two KV-backed instances (M-4: read-modify-write was not atomic):");
  const store = new Map<string, string>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const fakeFetch = (async (_url: string, init: { body: string }) => {
    const args = JSON.parse(init.body) as (string | number)[];
    await sleep(Math.random() * 5);
    let result: unknown = null;
    if (args[0] === "GET") result = store.get(String(args[1])) ?? null;
    else if (args[0] === "SET") {
      store.set(String(args[1]), String(args[2]));
      result = "OK";
    } else if (args[0] === "EVAL") {
      const [, , , key, expected, next] = args.map(String);
      const cur = store.get(key);
      if ((cur === undefined && expected === "") || cur === expected) {
        store.set(key, next);
        result = 1;
      } else result = 0;
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as unknown as typeof fetch;

  const instA = new KvRestBackend("https://kv.test", "t", fakeFetch, 50);
  const instB = new KvRestBackend("https://kv.test", "t", fakeFetch, 50);
  __setBackendForTests(instA);
  const m = await createMandate({ principal: "kv", ap2Json: "{}", maxPerTx: 10, maxCumulative: 50, chains: ["solana", "base"] });
  const runOn = async (b: KvRestBackend, chain: "solana" | "base") => {
    __setBackendForTests(b);
    return authorize(m.mandateId, chain, "x", 10);
  };
  // interleave 12 authorizes across both "instances" against a 50 cap
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => runOn(i % 2 ? instB : instA, i % 2 ? "base" : "solana")));
  const okCount = results.filter((r) => r.ok).length;
  const s = JSON.parse(store.get(`mandate:${m.mandateId}`)!) as { ledger: { reservations: Record<string, { amount: number }> } };
  const held = Object.values(s.ledger.reservations).reduce((x, r) => x + r.amount, 0);
  check(`12 concurrent 10-unit authorizes on a 50 cap: exactly 5 succeed (got ${okCount})`, okCount === 5);
  check(`reserved budget never exceeds the cap (held ${held})`, held === 50);
}

main();
