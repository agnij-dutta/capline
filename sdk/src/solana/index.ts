// capline/solana — Layer-A constrained settle builder for the Anchor program.
export { withCapline, MandateExceeded } from "./withCapline.js";
export type { WithCaplineOpts, PayRequest } from "./withCapline.js";
// AP2 hashing is chain-agnostic; re-export the Solana-friendly array form.
export { ap2HashArray, canonicalize, canonicalizeObject } from "../ap2.js";
