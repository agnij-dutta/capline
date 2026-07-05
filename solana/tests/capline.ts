// The proof. Three scenarios on a real SVM, mirroring the EVM demo:
//   1. A legitimate purchase settles.
//   2. A COMPROMISED agent key is prompt-injected to drain 1000 USDC —
//      Layer A is bypassed (payUnchecked), and the CHAIN reverts it anyway.
//   3. The identical attack redirected to an injected scammer merchant —
//      reverted on-chain: not on the signed allowlist.
//   + revoke kills a live mandate instantly.
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import { withCapline, MandateExceeded } from "../app/withCapline";
import { ap2Hash, AP2IntentMandate } from "../app/ap2";

const USDC = (n: number) => new BN(n * 1_000_000); // 6 decimals

describe("capline — AP2 mandate enforcement", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: any = (anchor.workspace as any).Capline ?? (anchor.workspace as any).capline;

  const principal = provider.wallet as anchor.Wallet;
  const agent = Keypair.generate();
  const merchant = Keypair.generate(); // the legitimate seller
  const scammer = Keypair.generate(); // the injected payee

  const nonce = new BN(1);
  let mint: PublicKey;
  let mandate: PublicKey;
  let vault: PublicKey;
  let merchantAta: PublicKey;
  let scammerAta: PublicKey;

  before(async () => {
    // fund the agent so it can pay tx fees as a signer
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(agent.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL),
    );

    mint = await createMint(
      provider.connection,
      (principal as any).payer,
      principal.publicKey,
      null,
      6,
    );

    [mandate] = PublicKey.findProgramAddressSync(
      [Buffer.from("mandate"), principal.publicKey.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), mandate.toBuffer()],
      program.programId,
    );

    merchantAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (principal as any).payer,
        mint,
        merchant.publicKey,
      )
    ).address;
    scammerAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (principal as any).payer,
        mint,
        scammer.publicKey,
      )
    ).address;
  });

  it("creates a mandate bound to a signed AP2 intent", async () => {
    const now = Math.floor(Date.now() / 1000);
    const intent: AP2IntentMandate = {
      principal: principal.publicKey.toBase58(),
      agent: agent.publicKey.toBase58(),
      mint: mint.toBase58(),
      maxPerTx: USDC(10).toString(),
      totalCap: USDC(50).toString(),
      notAfter: now + 3600,
      merchants: [merchant.publicKey.toBase58()],
      nonce: nonce.toString(),
    };

    await program.methods
      .createMandate(
        nonce,
        agent.publicKey,
        USDC(10),
        USDC(50),
        new BN(now + 3600),
        ap2Hash(intent),
        [merchant.publicKey],
      )
      .accounts({
        principal: principal.publicKey,
        mint,
        mandate,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // fund the vault with 50 USDC
    await mintTo(provider.connection, (principal as any).payer, mint, vault, principal.publicKey, 50_000_000);

    const m = await program.account.mandate.fetch(mandate);
    assert.equal(m.spent.toString(), "0");
    assert.deepEqual(Array.from(m.ap2Hash), ap2Hash(intent));
    const bal = await getAccount(provider.connection, vault);
    assert.equal(bal.amount.toString(), "50000000");
  });

  it("1. legitimate purchase settles", async () => {
    const client = clientFor();
    await client.pay({ merchant: merchant.publicKey, merchantTokenAccount: merchantAta, amount: 5_000_000n });

    const m = await program.account.mandate.fetch(mandate);
    assert.equal(m.spent.toString(), "5000000");
    const bal = await getAccount(provider.connection, merchantAta);
    assert.equal(bal.amount.toString(), "5000000");
  });

  it("2. compromised key + prompt injection to overpay is reverted ON-CHAIN", async () => {
    const client = clientFor();
    // bypass Layer A entirely — simulate a fully compromised signer
    let reverted = false;
    try {
      await client.payUnchecked(
        { merchant: merchant.publicKey, merchantTokenAccount: merchantAta, amount: 1_000_000_000n },
        vault,
      );
    } catch (e: any) {
      reverted = true;
      assert.match(e.toString(), /PerTxCapExceeded|exceeds the per-transaction cap/);
    }
    assert.isTrue(reverted, "chain must reject the over-cap drain");

    // spend is untouched
    const m = await program.account.mandate.fetch(mandate);
    assert.equal(m.spent.toString(), "5000000");
  });

  it("3. injected scammer merchant is reverted (not on the signed allowlist)", async () => {
    const client = clientFor();

    // Layer A refuses before signing
    let layerA = false;
    try {
      await client.pay({ merchant: scammer.publicKey, merchantTokenAccount: scammerAta, amount: 5_000_000n });
    } catch (e) {
      layerA = e instanceof MandateExceeded;
    }
    assert.isTrue(layerA, "Layer A must refuse an off-allowlist merchant");

    // and even bypassed, Layer B reverts
    let reverted = false;
    try {
      await client.payUnchecked(
        { merchant: scammer.publicKey, merchantTokenAccount: scammerAta, amount: 5_000_000n },
        vault,
      );
    } catch (e: any) {
      reverted = true;
      assert.match(e.toString(), /MerchantNotAllowed|not on the signed allowlist/);
    }
    assert.isTrue(reverted, "chain must reject an off-allowlist merchant");
  });

  it("4. revoke kills the mandate instantly", async () => {
    await program.methods
      .revoke()
      .accounts({ principal: principal.publicKey, mandate })
      .rpc();

    const client = clientFor();
    let reverted = false;
    try {
      await client.payUnchecked(
        { merchant: merchant.publicKey, merchantTokenAccount: merchantAta, amount: 1_000_000n },
        vault,
      );
    } catch (e: any) {
      reverted = true;
      assert.match(e.toString(), /MandateRevoked|has been revoked/);
    }
    assert.isTrue(reverted, "revoked mandate must reject all settlement");
  });

  // build a withCapline client whose provider signs as the agent
  function clientFor() {
    const agentProvider = new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(agent),
      {},
    );
    const agentProgram = new anchor.Program(program.idl, agentProvider);
    return withCapline({ program: agentProgram, mandate, agent: agent.publicKey });
  }
});
