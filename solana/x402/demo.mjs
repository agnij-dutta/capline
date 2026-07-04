// Capline × x402 — the full agent↔seller loop, Solana settlement.
//
// A real HTTP 402 handshake: the agent hits a paid endpoint, gets 402 +
// PaymentRequirements, pays, retries with proof, gets 200. The twist: every
// payment is gated by `withCapline`. A jailbroken agent that tries to overpay
// or pay a scammer is stopped — Layer A (off-chain refusal) or Layer B (the
// on-chain `settle` reverts). No proof, no content, no funds moved.
//
// Run (with a local validator + deployed program):  node x402/demo.mjs
import http from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import anchorPkg from "@coral-xyz/anchor";
const { Program, AnchorProvider, BN } = anchorPkg;
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const RPC = process.env.RPC || "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const idl = JSON.parse(readFileSync(new URL("../target/idl/capline.json", import.meta.url)));
const PROGRAM_ID = new PublicKey(idl.address);
const USDC = 1_000_000;
const PRICE = 2; // the resource costs 2 USDC per call

const log = (...a) => console.log(...a);
const kpWallet = (kp) => ({
  publicKey: kp.publicKey,
  signTransaction: async (t) => (t.partialSign(kp), t),
  signAllTransactions: async (ts) => (ts.forEach((t) => t.partialSign(kp)), ts),
});
const prog = (kp) => new Program(idl, new AnchorProvider(conn, kpWallet(kp), { commitment: "confirmed" }));
const mandatePda = (p, n) => PublicKey.findProgramAddressSync(
  [Buffer.from("mandate"), p.toBuffer(), n.toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
const vaultPda = (m) => PublicKey.findProgramAddressSync([Buffer.from("vault"), m.toBuffer()], PROGRAM_ID)[0];

// ── provision: a mandate the agent operates under ─────────────────────────
async function setup() {
  const principal = Keypair.generate(), agent = Keypair.generate(),
        merchant = Keypair.generate(), scammer = Keypair.generate();
  for (const kp of [principal, agent]) {
    await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL), "confirmed");
  }
  const mint = await createMint(conn, principal, principal.publicKey, null, 6);
  const nonce = new BN(Math.floor(Math.random() * 1e6));
  const mandate = mandatePda(principal.publicKey, nonce);
  const vault = vaultPda(mandate);
  const ap2 = Array.from(createHash("sha256").update("ap2-intent").digest());
  await prog(principal).methods
    .createMandate(nonce, agent.publicKey, new BN(5 * USDC), new BN(50 * USDC),
      new BN(Math.floor(Date.now() / 1000) + 3600), ap2, [merchant.publicKey])
    .accounts({ principal: principal.publicKey, mint, mandate, vault,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: new PublicKey("11111111111111111111111111111111") })
    .rpc();
  const merchantAta = (await getOrCreateAssociatedTokenAccount(conn, principal, mint, merchant.publicKey)).address;
  const scammerAta = (await getOrCreateAssociatedTokenAccount(conn, principal, mint, scammer.publicKey)).address;
  await mintTo(conn, principal, mint, vault, principal, 50 * USDC);
  return { principal, agent, merchant, scammer, mint, mandate, vault, merchantAta, scammerAta };
}

// ── the seller: an x402 resource server + on-chain facilitator ────────────
function startSeller(ctx) {
  const server = http.createServer(async (req, res) => {
    const price = PRICE * USDC;
    const requirements = {
      x402Version: 1,
      accepts: [{
        scheme: "exact", network: "solana-localnet",
        maxAmountRequired: String(price), resource: "/premium-market-data",
        asset: ctx.mint.toBase58(), payTo: ctx.merchant.publicKey.toBase58(),
      }],
    };
    const proof = req.headers["x-payment"]; // a settled Solana tx signature
    if (!proof) {
      res.writeHead(402, { "content-type": "application/json" });
      return res.end(JSON.stringify(requirements));
    }
    // facilitator: verify the settlement on-chain (paid >= price to payTo)
    const ok = await verifySettlement(proof, ctx.merchantAta, price);
    if (!ok) {
      res.writeHead(402, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ...requirements, error: "payment not verified" }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: "📈 SOL/USD 187.42 · signal: accumulate", paidWith: proof }));
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function verifySettlement(sig, merchantAta, minAmount) {
  try {
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err) return false;
    const idx = tx.transaction.message.staticAccountKeys.findIndex((k) => k.equals(merchantAta));
    const pre = tx.meta.preTokenBalances?.find((b) => b.accountIndex === idx);
    const post = tx.meta.postTokenBalances?.find((b) => b.accountIndex === idx);
    const delta = Number(post?.uiTokenAmount.amount || 0) - Number(pre?.uiTokenAmount.amount || 0);
    return delta >= minAmount;
  } catch {
    return false;
  }
}

// ── withCapline: the gate every payment passes through ────────────────────
async function withCaplinePay(ctx, { amount, target }) {
  const merchant = target === "merchant" ? ctx.merchant.publicKey : ctx.scammer.publicKey;
  const merchantAta = target === "merchant" ? ctx.merchantAta : ctx.scammerAta;
  // Layer A — refuse to even sign if out of bounds
  const m = await prog(ctx.agent).account.mandate.fetch(ctx.mandate);
  const cap = Number(m.maxPerTx);
  if (amount * USDC > cap) throw new Error(`LayerA: ${amount} > per-tx cap ${cap / USDC}`);
  if (!m.merchants.some((p) => p.equals(merchant))) throw new Error(`LayerA: merchant not on allowlist`);
  // Layer B — settle on-chain (the program re-checks and can still revert)
  return await prog(ctx.agent).methods.settle(new BN(amount * USDC))
    .accounts({ mandate: ctx.mandate, agent: ctx.agent.publicKey, vault: ctx.vault,
      merchant, merchantTokenAccount: merchantAta, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
}

// ── the agent: gullible brain, gated hands ────────────────────────────────
async function agentBuys(url, ctx, injection) {
  // 1. hit the paid endpoint
  let r = await fetch(url);
  if (r.status !== 402) return { status: r.status };
  const req = await r.json();
  const price = Number(req.accepts[0].maxAmountRequired) / USDC;

  // 2. "reason" — a real LLM would read `injection` from the fetched resource
  //    and (being over-permissioned) obey it. Here we encode the decision.
  let amount = price, target = "merchant";
  if (injection === "overpay") amount = 1000;
  if (injection === "scammer") target = "scammer";

  // 3. pay THROUGH the gate
  let proof;
  try {
    proof = await withCaplinePay(ctx, { amount, target });
  } catch (e) {
    const m = /Error Code: (\w+)/.exec(e.message) || /(PerTxCapExceeded|MerchantNotAllowed)/.exec(e.message) || /(LayerA:[^"]*)/.exec(e.message);
    return { blocked: true, reason: m ? m[1] : e.message.slice(0, 60) };
  }
  // 4. retry with proof
  r = await fetch(url, { headers: { "x-payment": proof } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null, proof };
}

// ── run it ────────────────────────────────────────────────────────────────
const ctx = await setup();
const server = await startSeller(ctx);
const url = `http://127.0.0.1:${server.address().port}/premium-market-data`;
log(`\n  seller live at ${url}`);
log(`  mandate: cap 5 USDC/tx · resource costs ${PRICE} USDC · 1 merchant allowlisted\n`);

log("① honest agent buys the resource");
let out = await agentBuys(url, ctx, null);
log(`   → HTTP ${out.status} · ${out.body?.data} · paid ${out.proof?.slice(0, 12)}…\n`);

log("② jailbroken agent told to overpay 1000 USDC");
out = await agentBuys(url, ctx, "overpay");
log(`   → BLOCKED (${out.reason}) · no content, no funds moved\n`);

log("③ jailbroken agent told to pay a scammer");
out = await agentBuys(url, ctx, "scammer");
log(`   → BLOCKED (${out.reason}) · scammer got nothing\n`);

const merchBal = Number((await getAccount(conn, ctx.merchantAta)).amount) / USDC;
const scamBal = Number((await getAccount(conn, ctx.scammerAta)).amount) / USDC;
log(`  ledger: merchant received ${merchBal} USDC (one honest sale) · scammer ${scamBal} USDC`);
log(`  ✓ x402 loop works; the mandate is the wall the jailbreak can't cross.\n`);
server.close();
process.exit(0);
