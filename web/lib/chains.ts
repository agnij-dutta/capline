// The multi-chain registry. One place that knows every chain Capline enforces
// on, what kind of VM it is, how its mandate primitive is addressed, and how to
// link into its explorer. Both the browser UI and the server-side coordinator
// import this — so it must stay dependency-light (no node-only imports).
//
// A mandate is a per-chain enforcement primitive (a Solana program, an EVM
// contract, later a Soroban contract). The cross-chain coordinator (see
// lib/coordinator.ts) treats a single AP2 mandate as canonical and syncs
// cumulative spend across every chain listed here.

export type ChainKind = "svm" | "evm";
export type ChainId = "solana" | "avalanche" | "base" | "stellar";
export type SigScheme = "ed25519" | "secp256k1";

export interface ChainConfig {
  id: ChainId;
  kind: ChainKind;
  /** Human label for the UI. */
  label: string;
  /** Short network moniker, also the x402 `network` field. */
  network: string;
  /** Testnet the demo runs against (display only). */
  testnet: string;
  /** Brand accent used for chips/badges in the UI. */
  color: string;
  /** Signature scheme the principal signs the AP2 mandate with on this chain. */
  sigScheme: SigScheme;
  /** RPC endpoint (overridable via env at the call site). */
  rpc: string;
  /** The deployed mandate primitive: program id (svm) or contract addr (evm). */
  mandate: string;
  /** EIP-3009 / SPL USDC used for settlement. */
  usdc: string;
  usdcDecimals: number;
  /** True once the mandate primitive is actually deployed and wired. */
  live: boolean;
  explorerTx: (sig: string) => string;
  explorerAddr: (addr: string) => string;
}

// --- explorer helpers -------------------------------------------------------

const solscan = (kind: "tx" | "account", v: string) =>
  `https://solscan.io/${kind}/${v}?cluster=devnet`;
const evmScan = (base: string, kind: "tx" | "address", v: string) =>
  `${base}/${kind}/${v}`;

// --- env overrides ----------------------------------------------------------
// Public env vars let us repoint RPCs (e.g. Helius) or a freshly deployed
// contract without a code change. All optional.
const env = (k: string, fallback: string) =>
  (typeof process !== "undefined" && process.env?.[k]) || fallback;

// --- the registry -----------------------------------------------------------

export const CHAINS: Record<ChainId, ChainConfig> = {
  solana: {
    id: "solana",
    kind: "svm",
    label: "Solana",
    network: "solana-devnet",
    testnet: "devnet",
    color: "#14F195",
    sigScheme: "ed25519",
    rpc: env("NEXT_PUBLIC_RPC", "https://api.devnet.solana.com"),
    mandate: env(
      "NEXT_PUBLIC_SOLANA_MANDATE",
      "DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp",
    ),
    usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // Circle devnet USDC
    usdcDecimals: 6,
    live: true,
    explorerTx: (s) => solscan("tx", s),
    explorerAddr: (a) => solscan("account", a),
  },
  avalanche: {
    id: "avalanche",
    kind: "evm",
    label: "Avalanche",
    network: "avalanche-fuji",
    testnet: "Fuji",
    color: "#E84142",
    sigScheme: "secp256k1",
    rpc: env("NEXT_PUBLIC_FUJI_RPC", "https://api.avax-test.network/ext/bc/C/rpc"),
    mandate: env(
      "NEXT_PUBLIC_AVALANCHE_MANDATE",
      "0x40367742b16c3DDa51B123751699032c5E446aF5",
    ),
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65", // Circle Fuji USDC (EIP-3009)
    usdcDecimals: 6,
    live: true,
    explorerTx: (s) => evmScan("https://testnet.snowtrace.io", "tx", s),
    explorerAddr: (a) => evmScan("https://testnet.snowtrace.io", "address", a),
  },
  base: {
    id: "base",
    kind: "evm",
    label: "Base",
    network: "base-sepolia",
    testnet: "Sepolia",
    color: "#0052FF",
    sigScheme: "secp256k1",
    rpc: env("NEXT_PUBLIC_BASE_RPC", "https://sepolia.base.org"),
    // Filled in after the Base Sepolia deploy (Task #2). Empty = not yet live.
    mandate: env("NEXT_PUBLIC_BASE_MANDATE", ""),
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Circle Base Sepolia USDC (EIP-3009)
    usdcDecimals: 6,
    live: false,
    explorerTx: (s) => evmScan("https://sepolia.basescan.org", "tx", s),
    explorerAddr: (a) => evmScan("https://sepolia.basescan.org", "address", a),
  },
  stellar: {
    id: "stellar",
    kind: "svm", // Soroban is WASM; ed25519 accounts like Solana. Placeholder.
    label: "Stellar",
    network: "stellar-testnet",
    testnet: "testnet",
    color: "#FDDA24",
    sigScheme: "ed25519",
    rpc: env("NEXT_PUBLIC_STELLAR_RPC", "https://soroban-testnet.stellar.org"),
    mandate: env("NEXT_PUBLIC_STELLAR_MANDATE", ""), // Phase 2
    usdc: "", // Soroban USDC SAC — Phase 2
    usdcDecimals: 7, // Stellar assets are 7-decimal
    live: false,
    explorerTx: (s) => `https://stellar.expert/explorer/testnet/tx/${s}`,
    explorerAddr: (a) => `https://stellar.expert/explorer/testnet/account/${a}`,
  },
};

/** Chains that are actually deployed & wired right now. */
export const LIVE_CHAINS = (Object.values(CHAINS) as ChainConfig[]).filter(
  (c) => c.live,
);

/** All chains in canonical display order. */
export const ALL_CHAINS: ChainConfig[] = [
  CHAINS.solana,
  CHAINS.avalanche,
  CHAINS.base,
  CHAINS.stellar,
];

export function chain(id: ChainId): ChainConfig {
  return CHAINS[id];
}

/** A mandate is "wired" only when the primitive address is non-empty. */
export function isWired(id: ChainId): boolean {
  const c = CHAINS[id];
  return c.live && c.mandate.length > 0;
}

export const USDC = (n: number, decimals = 6): bigint =>
  BigInt(Math.round(n * 10 ** decimals));
export const fmtUSDC = (v: bigint, decimals = 6): string =>
  (Number(v) / 10 ** decimals).toFixed(2);
