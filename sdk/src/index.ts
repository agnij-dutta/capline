// capline: spend authority for AI agents.
//
// A mandate (per-tx cap, total cap, expiry, payee allowlist) is enforced by an
// on-chain program at settlement. On Solana the budget sits in a program-owned
// vault, so it holds even if the agent key is stolen; on EVM the check binds
// only payments routed through settle. The cross-chain coordinator is advisory.
// See SECURITY.md for the full model.
//
// Subpath imports keep chain deps optional:
//   import { CHAINS, ap2HashHex } from "capline";
//   import { CoordinatorClient } from "capline/coordinator";
//   import { ConstrainedSigner, withCapline } from "capline/evm";
//   import { withCapline } from "capline/solana";

export * from "./types.js";
export * from "./chains.js";
export * from "./ap2.js";

export const VERSION = "0.2.1";
