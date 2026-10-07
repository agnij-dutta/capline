// Layer A (EVM) unit tests. The registry and token are mocked at the
// publicClient.readContract boundary; signing is real (viem local account +
// x402 createPaymentHeader), so the nonce/validBefore bookkeeping is exercised
// on genuine X-PAYMENT headers.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublicClient } from "viem";
import { keccak256, concatHex, encodePacked, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentRequirements } from "x402/types";
import { ConstrainedSigner, payeeMerkleRoot, payeeProof } from "../src/evm/index.js";
import { decodeAuth } from "../src/evm/seller.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const; // anvil #1, public test key
const AGENT = privateKeyToAccount(KEY).address;
const REGISTRY = "0x40367742b16c3DDa51B123751699032c5E446aF5" as const;
const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65" as const;
const MERCHANT = "0x1111111111111111111111111111111111111111" as const;
const SCAMMER = "0x000000000000000000000000000000000000dEaD" as const;
const MID = ("0x" + "11".repeat(32)) as `0x${string}`;
const ZERO = ("0x" + "00".repeat(32)) as `0x${string}`;
const U = 1_000_000n;

interface Chain {
  agentSigner: `0x${string}`;
  maxPerTx: bigint;
  maxCumulative: bigint;
  root: `0x${string}`;
  spent: bigint;
  revoked: boolean;
  usedNonces: Set<string>;
  tokenThrows?: boolean;
}

function mockClient(c: Chain): PublicClient {
  return {
    async readContract(args: { functionName: string; args: readonly unknown[] }) {
      switch (args.functionName) {
        case "checkAllowance": {
          const v = args.args[1] as bigint;
          if (c.revoked) return [false, "REVOKED"];
          if (v > c.maxPerTx) return [false, "OVER_PER_TX"];
          if (c.spent + v > c.maxCumulative) return [false, "OVER_CUMULATIVE"];
          return [true, "OK"];
        }
        case "mandates":
          return [AGENT, 1n, c.agentSigner, c.maxPerTx, c.maxCumulative, 0n, c.root, c.revoked];
        case "spent":
          return c.spent;
        case "authorizationState":
          if (c.tokenThrows) throw new Error("rpc down");
          return c.usedNonces.has(args.args[1] as string);
        default:
          throw new Error(`unexpected ${args.functionName}`);
      }
    },
  } as unknown as PublicClient;
}

const req = (payTo: `0x${string}`, amount: bigint): PaymentRequirements => ({
  scheme: "exact",
  network: "avalanche-fuji",
  maxAmountRequired: amount.toString(),
  resource: "https://seller.example/data",
  description: "data",
  mimeType: "application/json",
  payTo,
  maxTimeoutSeconds: 600,
  asset: USDC,
  extra: { name: "USD Coin", version: "2" },
});

const chain = (over: Partial<Chain> = {}): Chain => ({
  agentSigner: AGENT,
  maxPerTx: 5n * U,
  maxCumulative: 20n * U,
  root: ZERO,
  spent: 0n,
  revoked: false,
  usedNonces: new Set(),
  ...over,
});

test("in-bounds payment produces a real, decodable X-PAYMENT header", async () => {
  const s = new ConstrainedSigner(KEY, mockClient(chain()), REGISTRY);
  const r = await s.proposePayment({ mandateId: MID, req: req(MERCHANT, 5n * U) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = decodeAuth(r.header);
  assert.equal(a.from.toLowerCase(), AGENT.toLowerCase());
  assert.equal(a.to.toLowerCase(), MERCHANT.toLowerCase());
  assert.equal(a.value, 5n * U);
});

test("zero value and over per-tx are refused without signing", async () => {
  const s = new ConstrainedSigner(KEY, mockClient(chain()), REGISTRY);
  const z = await s.proposePayment({ mandateId: MID, req: req(MERCHANT, 0n) });
  assert.deepEqual([z.ok, !z.ok && z.reason], [false, "ZERO_VALUE"]);
  const o = await s.proposePayment({ mandateId: MID, req: req(MERCHANT, 1000n * U) });
  assert.deepEqual([o.ok, !o.ok && o.reason, !o.ok && o.cap], [false, "OVER_PER_TX", 5n * U]);
  assert.equal(await s.outstanding(MID), 0n);
});

test("C-1 mitigation: signed-but-unsettled authorizations count against the cumulative cap", async () => {
  // spent on the registry stays 0 because the payee redeems each header
  // directly on the token; before the fix the signer kept saying yes forever
  const c = chain();
  const s = new ConstrainedSigner(KEY, mockClient(c), REGISTRY);
  for (let i = 0; i < 4; i++) {
    const r = await s.proposePayment({ mandateId: MID, req: req(MERCHANT, 5n * U) });
    assert.equal(r.ok, true, `payment ${i + 1} within the 20 USDC cap`);
  }
  const fifth = await s.proposePayment({ mandateId: MID, req: req(MERCHANT, 5n * U) });
  assert.deepEqual([fifth.ok, !fifth.ok && fifth.reason], [false, "OVER_CUMULATIVE"]);
  assert.equal(await s.outstanding(MID), 20n * U);
});

test("concurrent proposals cannot both take the last headroom", async () => {
  const s = new ConstrainedSigner(KEY, mockClient(chain({ maxCumulative: 5n * U })), REGISTRY);
  const rs = await Promise.all([
    s.proposePayment({ mandateId: MID, req: req(MERCHANT, 5n * U) }),
    s.proposePayment({ mandateId: MID, req: req(MERCHANT, 5n * U) }),
  ]);
  assert.equal(rs.filter((r) => r.ok).length, 1);
});

test("expired AND unused authorizations release their budget; used or unknown ones do not", async () => {
  let now = 1_000;
  const c = chain({ maxCumulative: 5n * U });
  const s = new ConstrainedSigner(KEY, mockClient(c), REGISTRY, 1, { now: () => now });
  const r = await s.proposePayment({ mandateId: MID, req: req(MERCHANT, 5n * U) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = decodeAuth(r.header);

  // not expired yet: still counted
  assert.equal(await s.outstanding(MID), 5n * U);
  now = Number(a.validBefore) + 1;
  // expired but the token cannot be queried: fail closed, still counted
  c.tokenThrows = true;
  assert.equal(await s.outstanding(MID), 5n * U);
  // expired and the nonce WAS used (redeemed somewhere): still counted
  c.tokenThrows = false;
  c.usedNonces.add(a.nonce);
  assert.equal(await s.outstanding(MID), 5n * U);
  // expired and never used: released
  c.usedNonces.clear();
  assert.equal(await s.outstanding(MID), 0n);
});

test("on-chain spent is honoured when it exceeds this process's ledger (e.g. after a restart)", async () => {
  const s = new ConstrainedSigner(KEY, mockClient(chain({ spent: 18n * U })), REGISTRY);
  const r = await s.proposePayment({ mandateId: MID, req: req(MERCHANT, 5n * U) });
  // checkAllowance already refuses 18 + 5 > 20
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "OVER_CUMULATIVE"]);
});

test("payee allowlist: enforced off-chain when the mandate has a root", async () => {
  const list = [MERCHANT, "0x2222222222222222222222222222222222222222" as const];
  const root = payeeMerkleRoot(list);
  const c = chain({ root });

  const noList = new ConstrainedSigner(KEY, mockClient(c), REGISTRY);
  const a = await noList.proposePayment({ mandateId: MID, req: req(MERCHANT, U) });
  assert.deepEqual([a.ok, !a.ok && a.reason], [false, "PAYEE_LIST_REQUIRED"]);

  const wrongList = new ConstrainedSigner(KEY, mockClient(c), REGISTRY, 1, { allowedPayees: [MERCHANT, SCAMMER] });
  const b = await wrongList.proposePayment({ mandateId: MID, req: req(MERCHANT, U) });
  assert.deepEqual([b.ok, !b.ok && b.reason], [false, "PAYEE_LIST_MISMATCH"]);

  const s = new ConstrainedSigner(KEY, mockClient(c), REGISTRY, 1, { allowedPayees: list });
  const scam = await s.proposePayment({ mandateId: MID, req: req(MERCHANT, U), to: SCAMMER });
  assert.deepEqual([scam.ok, !scam.ok && scam.reason], [false, "PAYEE_NOT_ALLOWED"]);
  const ok = await s.proposePayment({ mandateId: MID, req: req(MERCHANT, U) });
  assert.equal(ok.ok, true);
});

test("a key that is not the mandate's agentSigner is refused", async () => {
  const c = chain({ agentSigner: "0x3333333333333333333333333333333333333333" });
  const s = new ConstrainedSigner(KEY, mockClient(c), REGISTRY);
  const r = await s.proposePayment({ mandateId: MID, req: req(MERCHANT, U) });
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "SIGNER_NOT_AGENT"]);
});

// Mirror of MandateRegistry._verifyPayee, to prove SDK roots/proofs verify on-chain.
function verifyLikeSolidity(proof: `0x${string}`[], root: `0x${string}`, addr: `0x${string}`) {
  let h = keccak256(encodePacked(["address"], [getAddress(addr)]));
  for (const p of proof) h = BigInt(h) <= BigInt(p) ? keccak256(concatHex([h, p])) : keccak256(concatHex([p, h]));
  return h.toLowerCase() === root.toLowerCase();
}

test("payee merkle root + proofs verify with the contract's algorithm, for 1..9 payees", () => {
  const addrs = Array.from({ length: 9 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "a")}` as `0x${string}`);
  for (let n = 1; n <= addrs.length; n++) {
    const list = addrs.slice(0, n);
    const root = payeeMerkleRoot(list);
    for (const a of list) assert.ok(verifyLikeSolidity(payeeProof(list, a), root, a), `n=${n} ${a}`);
    assert.ok(!verifyLikeSolidity(payeeProof(list, list[0]), root, SCAMMER));
  }
  // single payee: root is just the leaf, empty proof
  assert.equal(payeeMerkleRoot([MERCHANT]), keccak256(encodePacked(["address"], [MERCHANT])).toLowerCase());
  assert.deepEqual(payeeProof([MERCHANT], MERCHANT), []);
});
