// Contract addresses (from the Fuji deploy) + the ABIs the dapp actually uses.
import deployments from "./deployments.json";

export const DEPLOY = deployments;
export const MANDATE_REGISTRY = deployments.mandateRegistry as `0x${string}`;
export const IDENTITY_REGISTRY = deployments.identityRegistry as `0x${string}`;
export const USDC = deployments.usdc as `0x${string}`;
export const DEMO_MANDATE_ID = deployments.demoMandateId as `0x${string}`;
export const DEMO_AGENT_ID = BigInt(deployments.demoAgentId);
export const FUJI_CHAIN_ID = deployments.chainId;
export const FUJI_RPC = deployments.rpcUrl;

export const snowtrace = (addrOrTx: string, kind: "address" | "tx" = "address") =>
  `https://testnet.snowtrace.io/${kind}/${addrOrTx}`;

export const mandateRegistryAbi = [
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
    name: "createMandate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "mandateId", type: "bytes32" },
      {
        name: "m",
        type: "tuple",
        components: [
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
  { type: "error", name: "CapExceeded", inputs: [] },
  { type: "error", name: "Revoked", inputs: [] },
  { type: "error", name: "Expired", inputs: [] },
  { type: "error", name: "PayeeNotAllowed", inputs: [] },
  { type: "error", name: "NotController", inputs: [] },
  {
    type: "event",
    name: "MandateCreated",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentSigner", type: "address", indexed: false },
      { name: "maxPerTx", type: "uint256", indexed: false },
      { name: "maxCumulative", type: "uint256", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
    ],
  },
] as const;

export const identityRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentDomain", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "agentDomain",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const usdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
