// Solana program client for Capline. Replaces the old EVM lib/contracts.ts.
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import idl from "./idl/capline.json";

export const PROGRAM_ID = new PublicKey((idl as Idl).address);

// Cluster config. Defaults to the local validator; override with env for devnet.
export const CLUSTER = (process.env.NEXT_PUBLIC_CLUSTER || "localnet") as
  | "localnet"
  | "devnet";
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC ||
  (CLUSTER === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899");

export const connection = () => new Connection(RPC_URL, "confirmed");

/** Explorer link that works for both devnet and the local validator. */
export function explorer(sigOrAddr: string, kind: "tx" | "address" = "address"): string {
  const base = `https://explorer.solana.com/${kind}/${sigOrAddr}`;
  if (CLUSTER === "devnet") return `${base}?cluster=devnet`;
  return `${base}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
}

// --- PDA derivation (mirrors the on-chain seeds) ---
export function mandatePda(principal: PublicKey, nonce: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mandate"), principal.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];
}

export function vaultPda(mandate: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), mandate.toBuffer()], PROGRAM_ID)[0];
}

/** A minimal browser Anchor wallet backed by a Keypair (for the burner-demo flow). */
export function keypairWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else tx.partialSign(kp);
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      txs.forEach((tx) =>
        tx instanceof VersionedTransaction ? tx.sign([kp]) : tx.partialSign(kp),
      );
      return txs;
    },
  };
}

/** An Anchor Program signing as `kp`. */
export function program(conn: Connection, kp: Keypair): Program {
  const provider = new AnchorProvider(conn, keypairWallet(kp) as never, {
    commitment: "confirmed",
  });
  return new Program(idl as Idl, provider);
}

export { BN, PublicKey, Keypair };
