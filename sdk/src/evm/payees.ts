// Payee allowlist merkle tree for MandateRegistry.allowedPayeesRoot.
//
// Matches MandateRegistry._verifyPayee exactly: leaf = keccak256(abi.encodePacked(address)),
// internal node = keccak256 of the two children in ascending order (commutative
// pair hashing), so a proof is just the list of siblings. Leaves are sorted and
// de-duplicated; an odd node at the end of a level is promoted unchanged.
import { keccak256, encodePacked, concatHex, getAddress } from "viem";

type Hex = `0x${string}`;

const leaf = (addr: Hex): Hex => keccak256(encodePacked(["address"], [getAddress(addr)]));
const pair = (a: Hex, b: Hex): Hex =>
  BigInt(a) <= BigInt(b) ? keccak256(concatHex([a, b])) : keccak256(concatHex([b, a]));

function leaves(addresses: Hex[]): Hex[] {
  if (addresses.length === 0) throw new Error("payee list is empty");
  const uniq = [...new Set(addresses.map(leaf))];
  return uniq.sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0));
}

function levels(addresses: Hex[]): Hex[][] {
  const out: Hex[][] = [leaves(addresses)];
  while (out[out.length - 1].length > 1) {
    const cur = out[out.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? pair(cur[i], cur[i + 1]) : cur[i]);
    out.push(next);
  }
  return out;
}

/** Root to store as `allowedPayeesRoot` (lowercase hex). */
export function payeeMerkleRoot(addresses: Hex[]): Hex {
  const ls = levels(addresses);
  return ls[ls.length - 1][0].toLowerCase() as Hex;
}

/** Proof for `payee`, to pass as `payeeProof` to MandateRegistry.settle. */
export function payeeProof(addresses: Hex[], payee: Hex): Hex[] {
  const ls = levels(addresses);
  let idx = ls[0].indexOf(leaf(payee));
  if (idx < 0) throw new Error(`payee ${payee} is not in the allowlist`);
  const proof: Hex[] = [];
  for (let l = 0; l < ls.length - 1; l++) {
    const sib = idx ^ 1;
    if (sib < ls[l].length) proof.push(ls[l][sib]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}
