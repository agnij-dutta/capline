// Minimal MandateRegistry ABI — only the surface the SDK reads/writes.
// Full contract: contracts/src/MandateRegistry.sol.
export const MANDATE_REGISTRY_ABI = [
  {
    type: "function",
    name: "checkAllowance",
    stateMutability: "view",
    inputs: [
      { name: "mandateId", type: "bytes32" },
      { name: "value", type: "uint256" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "reason", type: "string" },
    ],
  },
  {
    type: "function",
    name: "mandates",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "principal", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "agentSigner", type: "address" },
      { name: "maxPerTx", type: "uint256" },
      { name: "maxCumulative", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "allowedPayeesRoot", type: "bytes32" },
      { name: "revoked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "spent",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "mandateId", type: "bytes32" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
      { name: "payeeProof", type: "bytes32[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revoke",
    stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [],
  },
] as const;
