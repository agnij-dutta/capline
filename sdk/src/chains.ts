// The multi-chain registry: every chain Capline enforces on, and how each one's
// mandate primitive is addressed and linked. Dependency-light + isomorphic.
import type { ChainConfig, ChainId } from "./types.js";

const evmScan = (base: string, kind: "tx" | "address", v: string) => `${base}/${kind}/${v}`;
const solscan = (kind: "tx" | "account", v: string) =>
  `https://solscan.io/${kind}/${v}?cluster=devnet`;

/** Default testnet registry. Override addresses/RPCs with `configureChain`. */
export const CHAINS: Record<ChainId, ChainConfig> = {
  solana: {
    id: "solana",
    kind: "svm",
    label: "Solana",
    network: "solana-devnet",
    testnet: "devnet",
    color: "#14F195",
    sigScheme: "ed25519",
    rpc: "https://api.devnet.solana.com",
    mandate: "DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp",
    usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
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
    rpc: "https://api.avax-test.network/ext/bc/C/rpc",
    mandate: "0x40367742b16c3DDa51B123751699032c5E446aF5",
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
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
    rpc: "https://sepolia.base.org",
    mandate: "", // set via configureChain after deploy
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    usdcDecimals: 6,
    live: false,
    explorerTx: (s) => evmScan("https://sepolia.basescan.org", "tx", s),
    explorerAddr: (a) => evmScan("https://sepolia.basescan.org", "address", a),
  },
  stellar: {
    id: "stellar",
    kind: "svm",
    label: "Stellar",
    network: "stellar-testnet",
    testnet: "testnet",
    color: "#FDDA24",
    sigScheme: "ed25519",
    rpc: "https://soroban-testnet.stellar.org",
    mandate: "",
    usdc: "",
    usdcDecimals: 7,
    live: false,
    explorerTx: (s) => `https://stellar.expert/explorer/testnet/tx/${s}`,
    explorerAddr: (a) => `https://stellar.expert/explorer/testnet/account/${a}`,
  },
};

/** Merge overrides (address, rpc, live flag, …) into a chain's config. */
export function configureChain(id: ChainId, patch: Partial<ChainConfig>): ChainConfig {
  CHAINS[id] = { ...CHAINS[id], ...patch };
  return CHAINS[id];
}

export function chain(id: ChainId): ChainConfig {
  return CHAINS[id];
}

export function isWired(id: ChainId): boolean {
  const c = CHAINS[id];
  return c.live && c.mandate.length > 0;
}

export const ALL_CHAINS: ChainConfig[] = [
  CHAINS.solana,
  CHAINS.avalanche,
  CHAINS.base,
  CHAINS.stellar,
];

export const liveChains = (): ChainConfig[] =>
  (Object.values(CHAINS) as ChainConfig[]).filter((c) => c.live);

export const toBaseUnits = (n: number, decimals = 6): bigint =>
  BigInt(Math.round(n * 10 ** decimals));
export const fromBaseUnits = (v: bigint, decimals = 6): string =>
  (Number(v) / 10 ** decimals).toFixed(2);
