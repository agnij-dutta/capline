// Live, on-chain demo orchestration against the deployed Capline program.
//
// Uses burner keypairs so the money-shot runs with zero wallet setup: it creates
// a principal, an agent, a legit merchant and a scammer, mints a demo USDC,
// opens a mandate (cap 5/tx, 50 total, merchant allowlisted), funds the vault —
// then lets you fire settlements and watch the chain accept the legit one and
// REVERT the over-cap / off-allowlist ones. Real transactions, real reverts.
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { program, programFromWallet, mandatePda, vaultPda, BN, type WalletLike } from "./program";
import type { AuthResult } from "./coordinator";

const USDC = 1_000_000; // 6 decimals
export const CAP_PER_TX = 5; // USDC
export const CAP_TOTAL = 50; // USDC

// --- cross-chain coordinator (Layer A) --------------------------------------
// Best-effort client. If the coordinator is UNREACHABLE we fail open to the
// chain: Layer B (the on-chain `settle`) still enforces this chain's caps, so
// no out-of-mandate payment gets through on this chain. What is lost while it
// is down is only the cross-chain global cap (here the coordinator budget
// equals the on-chain total_cap on a single chain, so nothing is lost).
async function coord<T>(action: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch("/api/coordinator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Provision the canonical cross-chain mandate for this Control-Room session.
 *  Left permissive on per-tx/payee so the ON-CHAIN program stays the enforcer
 *  (and visible reverter) for those; the coordinator owns the global cap that
 *  spans chains — the invariant no single chain can see. */
async function provisionCoordinator(principal: string, ap2Json: string): Promise<string> {
  const out = await coord<{ mandate: { mandateId: string } }>("create", {
    principal,
    ap2Json,
    maxPerTx: CAP_TOTAL, // permissive: the chain enforces the 5-USDC per-tx cap
    maxCumulative: CAP_TOTAL, // the shared global budget
    chains: ["solana"],
    allowedPayees: [], // permissive: the chain enforces the merchant allowlist
  });
  return out?.mandate.mandateId ?? "";
}

export interface DemoCtx {
  principalPubkey: PublicKey;
  agent: Keypair;
  merchant: Keypair;
  scammer: Keypair;
  mint: PublicKey;
  mandate: PublicKey;
  vault: PublicKey;
  merchantAta: PublicKey;
  scammerAta: PublicKey;
  ap2Hash: number[];
  ap2Verified: boolean;
  /** canonical cross-chain mandate id (coordinator); "" if unreachable. */
  coordinatorId: string;
}

/** Canonical AP2 message bytes + its sha256 (the on-chain commitment). */
async function ap2(fields: Record<string, unknown>): Promise<{ message: Uint8Array; hash: number[] }> {
  const canonical = JSON.stringify(fields, Object.keys(fields).sort());
  const message = new TextEncoder().encode(canonical);
  const buf = await crypto.subtle.digest("SHA-256", message);
  return { message, hash: Array.from(new Uint8Array(buf)) };
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
  const { message, hash } = await ap2({
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

  // prove the principal actually ed25519-signed the AP2 intent, bound on-chain
  log("attesting AP2 signature on-chain…");
  let ap2Verified = false;
  try {
    const edIx = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: principal.secretKey,
      message,
    });
    await program(conn, principal)
      .methods.attestAp2()
      .accounts({
        principal: principal.publicKey,
        mandate,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .preInstructions([edIx])
      .rpc();
    ap2Verified = true;
  } catch {
    /* attestation is best-effort in the demo; mandate still enforces */
  }

  log("funding vault + merchant accounts…");
  const merchantAta = (
    await getOrCreateAssociatedTokenAccount(conn, principal, mint, merchant.publicKey)
  ).address;
  const scammerAta = (
    await getOrCreateAssociatedTokenAccount(conn, principal, mint, scammer.publicKey)
  ).address;
  await mintTo(conn, principal, mint, vault, principal, CAP_TOTAL * USDC);

  log("registering with the cross-chain coordinator…");
  const coordinatorId = await provisionCoordinator(
    principal.publicKey.toBase58(),
    new TextDecoder().decode(message),
  );

  log(`mandate live · ap2_verified=${ap2Verified} · vault funded with 50 USDC.`);
  return { principalPubkey: principal.publicKey, agent, merchant, scammer, mint, mandate, vault, merchantAta, scammerAta, ap2Hash: hash, ap2Verified, coordinatorId };
}

/**
 * Same demo, but the CONNECTED WALLET is the principal — it pays, opens the
 * mandate, and ed25519-signs the AP2 intent via `signMessage`. Best run on a
 * cluster where the wallet holds SOL (e.g. devnet). The agent stays an app
 * burner (the AI's ephemeral wallet), funded by a transfer from your wallet.
 */
export async function setupDemoWithWallet(
  conn: Connection,
  wallet: WalletLike,
  log: (s: string) => void,
): Promise<DemoCtx> {
  const principalPubkey = wallet.publicKey;
  const agent = Keypair.generate();
  const merchant = Keypair.generate();
  const scammer = Keypair.generate();

  log("creating a demo token (your wallet pays)…");
  const mintKp = Keypair.generate();
  const rent = await getMinimumBalanceForRentExemptMint(conn);
  const mintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: principalPubkey,
      newAccountPubkey: mintKp.publicKey,
      space: MINT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mintKp.publicKey, 6, principalPubkey, null),
  );
  await conn.confirmTransaction(await wallet.sendTransaction(mintTx, conn, { signers: [mintKp] }), "confirmed");
  const mint = mintKp.publicKey;

  log("funding the agent wallet…");
  await conn.confirmTransaction(
    await wallet.sendTransaction(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: principalPubkey,
          toPubkey: agent.publicKey,
          lamports: Math.floor(0.05 * LAMPORTS_PER_SOL),
        }),
      ),
      conn,
    ),
    "confirmed",
  );

  const nonce = new BN(Math.floor(Date.now() / 1000) % 1_000_000);
  const mandate = mandatePda(principalPubkey, nonce);
  const vault = vaultPda(mandate);
  const notAfter = new BN(Math.floor(Date.now() / 1000) + 3600);
  const { message, hash } = await ap2({
    agent: agent.publicKey.toBase58(),
    maxPerTx: String(CAP_PER_TX * USDC),
    merchants: [merchant.publicKey.toBase58()],
    mint: mint.toBase58(),
    nonce: nonce.toString(),
    notAfter: notAfter.toNumber(),
    principal: principalPubkey.toBase58(),
    totalCap: String(CAP_TOTAL * USDC),
  });

  log("opening mandate — approve in your wallet…");
  await programFromWallet(conn, wallet)
    .methods.createMandate(nonce, agent.publicKey, new BN(CAP_PER_TX * USDC), new BN(CAP_TOTAL * USDC), notAfter, hash, [merchant.publicKey])
    .accounts({ principal: principalPubkey, mint, mandate, vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .rpc();

  log("attesting AP2 signature — sign the intent in your wallet…");
  let ap2Verified = false;
  try {
    if (!wallet.signMessage) throw new Error("wallet has no signMessage");
    const signature = await wallet.signMessage(message);
    const edIx = Ed25519Program.createInstructionWithPublicKey({ publicKey: principalPubkey.toBytes(), message, signature });
    await programFromWallet(conn, wallet)
      .methods.attestAp2()
      .accounts({ principal: principalPubkey, mandate, instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY })
      .preInstructions([edIx])
      .rpc();
    ap2Verified = true;
  } catch {
    /* best-effort: some wallets lack signMessage; the mandate still enforces */
  }

  log("funding vault + merchant accounts…");
  const merchantAta = getAssociatedTokenAddressSync(mint, merchant.publicKey);
  const scammerAta = getAssociatedTokenAddressSync(mint, scammer.publicKey);
  await conn.confirmTransaction(
    await wallet.sendTransaction(
      new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(principalPubkey, merchantAta, merchant.publicKey, mint),
        createAssociatedTokenAccountIdempotentInstruction(principalPubkey, scammerAta, scammer.publicKey, mint),
        createMintToInstruction(mint, vault, principalPubkey, CAP_TOTAL * USDC),
      ),
      conn,
    ),
    "confirmed",
  );

  log("registering with the cross-chain coordinator…");
  const coordinatorId = await provisionCoordinator(
    principalPubkey.toBase58(),
    new TextDecoder().decode(message),
  );

  log(`mandate live · ap2_verified=${ap2Verified} · your wallet is the principal.`);
  return { principalPubkey, agent, merchant, scammer, mint, mandate, vault, merchantAta, scammerAta, ap2Hash: hash, ap2Verified, coordinatorId };
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

  // Layer A — cross-chain global cap. If this spend would breach the shared
  // budget across chains, refuse before spending gas (the on-chain program
  // can't see spend on other chains; the coordinator can). Best-effort: if the
  // coordinator is unreachable we fall through to Layer B, which still enforces.
  let ticketId: string | undefined;
  if (ctx.coordinatorId) {
    const auth = await coord<AuthResult>("authorize", {
      mandateId: ctx.coordinatorId,
      chain: "solana",
      to: merchant.toBase58(),
      amount: amountUsdc,
    });
    // Honour the coordinator's budget-level denies. Per-tx and payee denies
    // are deliberately left to the chain (the visible on-chain revert is the
    // demo), and MANDATE_MISSING is treated like "unreachable" because a
    // non-durable (in-memory) coordinator can lose state between serverless
    // instances.
    if (auth && auth.ok === false && (auth.reason === "REVOKED" || auth.reason === "EXPIRED")) {
      return { ok: false, error: auth.reason };
    }
    if (auth && auth.ok === false && auth.reason === "OVER_GLOBAL_CAP") {
      return { ok: false, error: "GlobalCapExceeded" };
    }
    if (auth && auth.ok) ticketId = auth.ticket.ticketId;
  }

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
    // Layer B accepted → commit the reserved spend to the global ledger.
    if (ctx.coordinatorId && ticketId) await coord("commit", { mandateId: ctx.coordinatorId, ticketId });
    return { ok: true, sig };
  } catch (e: unknown) {
    // Layer B reverted → release the reservation so the global budget isn't leaked.
    if (ctx.coordinatorId && ticketId) await coord("release", { mandateId: ctx.coordinatorId, ticketId });
    const msg = e instanceof Error ? e.message : String(e);
    const m = /Error Code: (\w+)/.exec(msg) || /(PerTxCapExceeded|TotalCapExceeded|MerchantNotAllowed|MandateRevoked|MandateExpired)/.exec(msg);
    return { ok: false, error: m ? m[1] : msg.slice(0, 140) };
  }
}

export async function vaultBalance(conn: Connection, ctx: DemoCtx): Promise<number> {
  const acc = await getAccount(conn, ctx.vault);
  return Number(acc.amount) / USDC;
}
