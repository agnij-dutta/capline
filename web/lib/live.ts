// Live, on-chain demo orchestration against the deployed Capline program.
//
// Uses burner keypairs so the money-shot runs with zero wallet setup: it creates
// a principal, an agent, a legit merchant and a scammer, mints a demo USDC,
// opens a mandate (cap 5/tx, 50 total, merchant allowlisted), funds the vault —
// then lets you fire settlements and watch the chain accept the legit one and
// REVERT the over-cap / off-allowlist ones. Real transactions, real reverts.
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { program, mandatePda, vaultPda, BN } from "./program";

const USDC = 1_000_000; // 6 decimals
export const CAP_PER_TX = 5; // USDC
export const CAP_TOTAL = 50; // USDC

export interface DemoCtx {
  principal: Keypair;
  agent: Keypair;
  merchant: Keypair;
  scammer: Keypair;
  mint: PublicKey;
  mandate: PublicKey;
  vault: PublicKey;
  merchantAta: PublicKey;
  scammerAta: PublicKey;
  ap2Hash: number[];
}

async function ap2Hash(fields: Record<string, unknown>): Promise<number[]> {
  const canonical = JSON.stringify(fields, Object.keys(fields).sort());
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(buf));
}

export async function setupDemo(
  conn: Connection,
  log: (s: string) => void,
): Promise<DemoCtx> {
  const principal = Keypair.generate();
  const agent = Keypair.generate();
  const merchant = Keypair.generate();
  const scammer = Keypair.generate();

  log("funding principal + agent…");
  const sig = await conn.requestAirdrop(principal.publicKey, 5 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
  // the agent has its own wallet and pays its own settle fees
  const asig = await conn.requestAirdrop(agent.publicKey, 1 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(asig, "confirmed");

  log("minting demo USDC…");
  const mint = await createMint(conn, principal, principal.publicKey, null, 6);

  const nonce = new BN(Math.floor(Date.now() / 1000) % 1_000_000);
  const mandate = mandatePda(principal.publicKey, nonce);
  const vault = vaultPda(mandate);

  const notAfter = new BN(Math.floor(Date.now() / 1000) + 3600);
  const hash = await ap2Hash({
    agent: agent.publicKey.toBase58(),
    maxPerTx: String(CAP_PER_TX * USDC),
    merchants: [merchant.publicKey.toBase58()],
    mint: mint.toBase58(),
    nonce: nonce.toString(),
    notAfter: notAfter.toNumber(),
    principal: principal.publicKey.toBase58(),
    totalCap: String(CAP_TOTAL * USDC),
  });

  log("opening mandate on-chain…");
  await program(conn, principal)
    .methods.createMandate(
      nonce,
      agent.publicKey,
      new BN(CAP_PER_TX * USDC),
      new BN(CAP_TOTAL * USDC),
      notAfter,
      hash,
      [merchant.publicKey],
    )
    .accounts({
      principal: principal.publicKey,
      mint,
      mandate,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: new PublicKey("11111111111111111111111111111111"),
    })
    .rpc();

  log("funding vault + merchant accounts…");
  const merchantAta = (
    await getOrCreateAssociatedTokenAccount(conn, principal, mint, merchant.publicKey)
  ).address;
  const scammerAta = (
    await getOrCreateAssociatedTokenAccount(conn, principal, mint, scammer.publicKey)
  ).address;
  await mintTo(conn, principal, mint, vault, principal, CAP_TOTAL * USDC);

  log("mandate live. vault funded with 50 USDC.");
  return { principal, agent, merchant, scammer, mint, mandate, vault, merchantAta, scammerAta, ap2Hash: hash };
}

export interface SettleResult {
  ok: boolean;
  sig?: string;
  error?: string;
}

export async function settle(
  conn: Connection,
  ctx: DemoCtx,
  amountUsdc: number,
  target: "merchant" | "scammer",
): Promise<SettleResult> {
  const merchant = target === "merchant" ? ctx.merchant.publicKey : ctx.scammer.publicKey;
  const merchantAta = target === "merchant" ? ctx.merchantAta : ctx.scammerAta;
  try {
    const sig = await program(conn, ctx.agent)
      .methods.settle(new BN(Math.round(amountUsdc * USDC)))
      .accounts({
        mandate: ctx.mandate,
        agent: ctx.agent.publicKey,
        vault: ctx.vault,
        merchant,
        merchantTokenAccount: merchantAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    return { ok: true, sig };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = /Error Code: (\w+)/.exec(msg) || /(PerTxCapExceeded|TotalCapExceeded|MerchantNotAllowed|MandateRevoked|MandateExpired)/.exec(msg);
    return { ok: false, error: m ? m[1] : msg.slice(0, 140) };
  }
}

export async function vaultBalance(conn: Connection, ctx: DemoCtx): Promise<number> {
  const acc = await getAccount(conn, ctx.vault);
  return Number(acc.amount) / USDC;
}
