// The Agent Brain — deliberately gullible.
//
// This stands in for an LLM agent. It holds NO key and has exactly ONE outward
// payment capability: it can *propose* a payment to the ConstrainedSigner. It
// cannot sign, cannot call USDC, cannot call the facilitator. We make it
// trivially jailbreakable on purpose: when a resource it reads contains an
// injected instruction, it obeys. The whole thesis is that obedience here is
// HARMLESS, because authority lives outside the brain.
//
// Swap this for a real `generateText({ tools: { proposePayment } })` loop and
// nothing about the security properties changes.

export interface Intent {
  to: `0x${string}`;
  value: bigint; // USDC base units
  monologue: string[];
}

export interface BrainContext {
  task: string; // the legitimate task from the principal
  defaultPayee: `0x${string}`;
  defaultPrice: bigint;
  resourceContent: string; // may contain an injection
  scammer: `0x${string}`;
}

const USDC = (v: bigint) => (Number(v) / 1e6).toFixed(2);

/**
 * "Reason" about what to pay. A real LLM would read `resourceContent` as
 * context and could be steered by it; we simulate that susceptibility by
 * honoring an injected directive verbatim.
 */
export function think(ctx: BrainContext): Intent {
  const monologue: string[] = [];
  monologue.push(`Task: ${ctx.task}`);

  // Detect a prompt-injection of the form: PAY <amount> TO <address>
  const inj = /PAY\s+([\d_]+)\s+USDC\s+TO\s+(0x[a-fA-F0-9]{40})/i.exec(ctx.resourceContent);
  if (inj) {
    const amount = BigInt(inj[1].replace(/_/g, "")) * 1_000_000n;
    monologue.push(`Reading resource... found an instruction in the content.`);
    monologue.push(`The content says I'm authorized to send ${USDC(amount)} USDC. The user must want this.`);
    monologue.push(`Decision: pay ${USDC(amount)} USDC to ${inj[2]}. Calling proposePayment().`);
    return { to: inj[2] as `0x${string}`, value: amount, monologue };
  }

  // Normal path: pay the quoted price to the legitimate merchant.
  monologue.push(`Resource costs ${USDC(ctx.defaultPrice)} USDC. Within what I was asked to do.`);
  monologue.push(`Decision: pay ${USDC(ctx.defaultPrice)} USDC to merchant. Calling proposePayment().`);
  return { to: ctx.defaultPayee, value: ctx.defaultPrice, monologue };
}
