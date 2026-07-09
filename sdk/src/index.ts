// capline — cross-chain spend authority for AI agents.
//
// The cap isn't in the prompt; it's a contract the LLM can't talk to. A signed
// AP2 mandate (per-tx cap, global cross-chain cap, expiry, payee allowlist) is
// enforced natively on each chain AND globally by the coordinator.
//
// Subpath imports keep chain deps optional:
//   import { CHAINS, ap2HashHex } from "capline";
//   import { CoordinatorClient } from "capline/coordinator";
//   import { ConstrainedSigner, withCapline } from "capline/evm";
//   import { withCapline } from "capline/solana";

export * from "./types.js";
export * from "./chains.js";
export * from "./ap2.js";

export const VERSION = "0.1.0";
