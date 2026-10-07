// Layer A (Solana) unit tests: preflight must refuse everything `settle`
// refuses on-chain (same rules, same order of concern), and must not refuse
// anything `settle` accepts. The program account fetch and the token account
// read are mocked; the rules are the real code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchorNs from "@coral-xyz/anchor";
import { withCapline } from "../src/solana/index.js";

type AnchorModule = typeof import("@coral-xyz/anchor");
const anchor: AnchorModule = (anchorNs as unknown as { default?: AnchorModule }).default ?? (anchorNs as AnchorModule);
const { BN } = anchor;

const U = 1_000_000n;
const pk = () => Keypair.generate().publicKey;

function tokenAccountData(mint: PublicKey, owner: PublicKey): Buffer {
  const buf = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount: 0n,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    buf,
  );
  return buf;
}

function fixture(over: Record<string, unknown> = {}) {
  const agent = pk();
  const mint = pk();
  const merchant = pk();
  const merchantAta = pk();
  const tokenAccounts = new Map<string, { owner: PublicKey; data: Buffer }>();
  tokenAccounts.set(merchantAta.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccountData(mint, merchant) });
  const state = {
    agent,
    mint,
    revoked: false,
    notAfter: new BN(Math.floor(Date.now() / 1000) + 3600),
    maxPerTx: new BN((10n * U).toString()),
    spent: new BN(0),
    totalCap: new BN((50n * U).toString()),
    merchants: [merchant],
    vault: pk(),
    ...over,
  };
  const program = {
    account: { mandate: { fetch: async () => state } },
    provider: {
      connection: {
        getAccountInfo: async (k: PublicKey) => {
          const a = tokenAccounts.get(k.toBase58());
          return a ? { ...a, lamports: 1, executable: false, rentEpoch: 0 } : null;
        },
      },
    },
  };
  const client = withCapline({ program: program as never, mandate: pk(), agent });
  return { client, state, agent, mint, merchant, merchantAta, tokenAccounts };
}

async function refused(p: Promise<unknown>, re: RegExp) {
  await assert.rejects(p, (e: Error) => e.name === "MandateExceeded" && re.test(e.message));
}

test("accepts an in-bounds payment, including exact cap boundaries", async () => {
  const f = fixture({ spent: new BN((40n * U).toString()) });
  await f.client.preflight({ merchant: f.merchant, merchantTokenAccount: f.merchantAta, amount: 10n * U });
});

test("refuses zero, negative and > u64 amounts (chain: ZeroAmount / unencodable)", async () => {
  const f = fixture();
  const base = { merchant: f.merchant, merchantTokenAccount: f.merchantAta };
  await refused(f.client.preflight({ ...base, amount: 0n }), /positive/);
  await refused(f.client.preflight({ ...base, amount: -5n }), /positive/);
  await refused(f.client.preflight({ ...base, amount: 1n << 64n }), /u64/);
});

test("refuses over per-tx and over total cap (chain: 6003 / 6004)", async () => {
  const f = fixture({ spent: new BN((45n * U).toString()) });
  const base = { merchant: f.merchant, merchantTokenAccount: f.merchantAta };
  await refused(f.client.preflight({ ...base, amount: 10n * U + 1n }), /per-tx/);
  await refused(f.client.preflight({ ...base, amount: 6n * U }), /total cap/);
});

test("refuses revoked and expired mandates (chain: 6000 / 6001)", async () => {
  const r = fixture({ revoked: true });
  await refused(r.client.preflight({ merchant: r.merchant, merchantTokenAccount: r.merchantAta, amount: U }), /revoked/);
  const e = fixture({ notAfter: new BN(Math.floor(Date.now() / 1000) - 1) });
  await refused(e.client.preflight({ merchant: e.merchant, merchantTokenAccount: e.merchantAta, amount: U }), /expired/);
});

test("refuses when the configured agent is not the mandate's agent (chain: 6002)", async () => {
  const f = fixture({ agent: pk() });
  await refused(f.client.preflight({ merchant: f.merchant, merchantTokenAccount: f.merchantAta, amount: U }), /agent/);
});

test("refuses off-allowlist merchants (chain: 6005)", async () => {
  const f = fixture();
  await refused(f.client.preflight({ merchant: pk(), merchantTokenAccount: f.merchantAta, amount: U }), /allowlist/);
});

test("refuses a destination not owned by the merchant, of the wrong mint, or missing (chain: 6006)", async () => {
  const f = fixture();
  const scamAta = pk();
  f.tokenAccounts.set(scamAta.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccountData(f.mint, pk()) });
  await refused(f.client.preflight({ merchant: f.merchant, merchantTokenAccount: scamAta, amount: U }), /does not match/);
  const wrongMint = pk();
  f.tokenAccounts.set(wrongMint.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccountData(pk(), f.merchant) });
  await refused(f.client.preflight({ merchant: f.merchant, merchantTokenAccount: wrongMint, amount: U }), /does not match/);
  await refused(f.client.preflight({ merchant: f.merchant, merchantTokenAccount: pk(), amount: U }), /missing/);
});
