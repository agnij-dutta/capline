// Chain config, contract artifacts, and shared constants for Mandate.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defineChain } from "viem";
import { avalancheFuji } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "contracts", "out");

/** Load a compiled Foundry artifact (abi + deployable bytecode). */
export function artifact(name: string): { abi: any; bytecode: `0x${string}` } {
  const j = JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object as `0x${string}` };
}

/** Local anvil chain used by `npx mandate-demo`. */
export const anvilLocal = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export { avalancheFuji };

// Circle's official EIP-3009 testnet USDC on Avalanche Fuji.
export const FUJI_USDC = "0x5425890298aed601595a70AB815c96711a31Bc65" as const;
export const FUJI_RPC = "https://api.avax-test.network/ext/bc/C/rpc" as const;

export const USDC_DECIMALS = 6;
/** Convert a human USDC amount (e.g. 5) to base units (5_000_000). */
export const usdc = (n: number): bigint => BigInt(Math.round(n * 10 ** USDC_DECIMALS));
/** Format base units back to a human string. */
export const fmtUsdc = (v: bigint): string => (Number(v) / 10 ** USDC_DECIMALS).toFixed(2);
