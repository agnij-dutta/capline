import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    coordinator: "src/coordinator.ts",
    "evm/index": "src/evm/index.ts",
    "solana/index": "src/solana/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // Chain SDKs stay external (peer deps) so the core install is light.
  external: [
    "viem",
    "x402",
    "@coral-xyz/anchor",
    "@solana/web3.js",
    "@solana/spl-token",
  ],
});
