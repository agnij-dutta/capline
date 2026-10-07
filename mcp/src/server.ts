// capline-mcp server construction (transport-agnostic, so it can be tested
// over an in-memory transport). See index.ts for the stdio entry point.
//
// SECURITY MODEL (SECURITY.md H-3). An MCP client exposes every registered tool
// to the model. A tool that creates or revokes mandates therefore hands the
// agent the power to grant ITSELF a bigger budget, which defeats the point. So:
//
//   * Pinned mode (CAPLINE_MANDATE_ID set): the principal provisions the mandate
//     out of band. `pay` and `mandate_status` only accept that mandate, and the
//     admin tools (`create_mandate`, `revoke_mandate`) are NOT registered unless
//     CAPLINE_MCP_ADMIN_TOOLS=1. This is the mode to use with a real agent.
//   * Demo mode (no CAPLINE_MANDATE_ID): every tool is available so you can feel
//     the refusals in one chat. The agent can create its own mandate here, so
//     demo mode is NOT a security boundary, and the tools say so.
//
// What `pay` does: it authorizes and records the payment against the Capline
// coordinator's ledger (the off-chain, cross-chain cap). It does not move funds
// on any chain itself. On-chain enforcement (Layer B) happens when you settle
// through a deployed mandate program/contract with the capline SDK.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CoordinatorClient } from "capline/coordinator";
import { hashIntent } from "capline";
import { z } from "zod";

export const CHAINS = ["solana", "avalanche", "base", "stellar"] as const;

export interface ServerOptions {
  coordinatorUrl: string;
  /** Pin the agent to one principal-provisioned mandate. */
  pinnedMandateId?: string;
  /** principalToken for the pinned mandate (only used by revoke_mandate). */
  principalToken?: string;
  /** Register create_mandate / revoke_mandate even in pinned mode. */
  adminTools?: boolean;
  fetchImpl?: typeof fetch;
}

function text(s: string, isError = false) {
  return { content: [{ type: "text" as const, text: s }], isError };
}

export function buildServer(opts: ServerOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const coord = new CoordinatorClient(opts.coordinatorUrl, fetchImpl);
  const pinned = opts.pinnedMandateId?.trim() || undefined;
  const demoMode = !pinned;
  const adminTools = demoMode || !!opts.adminTools;
  // principal tokens for mandates created through this server (never shown to the model)
  const tokens = new Map<string, string>();
  if (pinned && opts.principalToken) tokens.set(pinned, opts.principalToken);

  const server = new McpServer({ name: "capline-mcp", version: "0.2.0" });

  const resolveMandate = (requested?: string): { id: string } | { error: string } => {
    if (pinned) {
      if (requested && requested !== pinned)
        return { error: `REFUSED: this server is pinned to mandate ${pinned}; it will not spend under ${requested}.` };
      return { id: pinned };
    }
    if (!requested) return { error: "mandateId is required (no mandate is pinned on this server)." };
    return { id: requested };
  };

  const demoNote = demoMode
    ? " DEMO MODE: no mandate is pinned, so the agent can also create its own mandate; this is not a security boundary. Pin one with CAPLINE_MANDATE_ID for real use."
    : "";

  if (adminTools) {
    server.tool(
      "create_mandate",
      "Provision a spend mandate: a per-transaction cap, a cumulative cap enforced across every chain, and an optional payee allowlist. Returns a mandateId to pass to `pay`. This is a PRINCIPAL action." +
        demoNote,
      {
        maxPerTx: z.number().positive().describe("per-transaction ceiling, in USDC"),
        maxTotal: z.number().positive().describe("cumulative ceiling in USDC, across every chain combined"),
        chains: z.array(z.enum(CHAINS)).default(["solana"]).describe("chains this mandate is provisioned on"),
        allowedPayees: z.array(z.string()).default([]).describe("allowed payee identities; empty = any payee"),
        principal: z.string().default("mcp-principal").describe("identity granting the authority"),
      },
      async ({ maxPerTx, maxTotal, chains, allowedPayees, principal }) => {
        const intent = { principal, maxPerTx, totalCap: maxTotal, chains, allowedPayees };
        // principalToken is returned by coordinators that support revoke auth;
        // typed loosely so this builds against older capline clients too
        const out = (await coord.createMandate({
          principal,
          ap2Json: JSON.stringify(intent),
          maxPerTx,
          maxCumulative: maxTotal,
          chains,
          allowedPayees,
        })) as Awaited<ReturnType<typeof coord.createMandate>> & { principalToken?: string };
        if (out.principalToken) tokens.set(out.mandate.mandateId, out.principalToken);
        return text(
          `Mandate created.\n` +
            `  id: ${out.mandate.mandateId}\n` +
            `  cap: $${maxPerTx}/tx · $${maxTotal} total (global, across chains)\n` +
            `  chains: ${chains.join(", ")}\n` +
            `  allowlist: ${allowedPayees.length ? allowedPayees.join(", ") : "(any payee)"}\n` +
            `  sha256(AP2): ${hashIntent(intent)}\n` +
            `Pass this id to \`pay\`.` +
            (demoMode ? `\n(Demo mode: an agent could create a looser mandate the same way.)` : ""),
        );
      },
    );
  }

  server.tool(
    "pay",
    "Request a payment on behalf of the agent. It is checked against the mandate and REFUSED if it exceeds the per-transaction cap, the payee is not on the allowlist, or it would breach the cross-chain cap. Approved payments are authorized and recorded on the Capline coordinator ledger; this tool does not itself move funds on-chain." +
      demoNote,
    {
      mandateId: z.string().optional().describe(pinned ? "ignored: this server is pinned to one mandate" : "the mandate to spend under (from create_mandate)"),
      chain: z.enum(CHAINS).default("solana").describe("chain to settle on"),
      to: z.string().describe("recipient identity / wallet"),
      amount: z.number().positive().describe("amount to pay, in USDC"),
    },
    async ({ mandateId, chain, to, amount }) => {
      const m = resolveMandate(mandateId);
      if ("error" in m) return text(m.error, true);
      const auth = await coord.authorize(m.id, chain, to, amount);
      if (!auth.ok) {
        return text(
          `REFUSED (${auth.reason}). Tried to pay $${amount} to ${to} on ${chain}, but that is outside the mandate. It was NOT authorized. Remaining budget: $${auth.remaining}.`,
          true,
        );
      }
      await coord.commit(m.id, auth.ticket.ticketId);
      return text(
        `AUTHORIZED. $${amount} to ${to} on ${chain} is within the mandate and recorded against its budget. Remaining budget: $${auth.remaining}. (ticket ${auth.ticket.ticketId}; no on-chain transfer was made by this server)`,
      );
    },
  );

  server.tool(
    "mandate_status",
    "Read a mandate's current state: committed spend, reserved, remaining budget, and the per-chain breakdown.",
    { mandateId: z.string().optional().describe(pinned ? "ignored: this server is pinned to one mandate" : "the mandate to inspect") },
    async ({ mandateId }) => {
      const m = resolveMandate(mandateId);
      if ("error" in m) return text(m.error, true);
      const s = await coord.status(m.id);
      const per =
        Object.entries(s.perChain)
          .map(([c, v]) => `${c}: $${v}`)
          .join(", ") || "(nothing spent yet)";
      return text(
        `Mandate ${m.id}\n` +
          `  committed: $${s.committed}\n` +
          `  reserved:  $${s.reserved}\n` +
          `  remaining: $${s.remaining} of $${s.mandate.maxCumulative}\n` +
          `  per-chain: ${per}\n` +
          `  revoked: ${s.mandate.revoked}`,
      );
    },
  );

  if (adminTools) {
    server.tool(
      "revoke_mandate",
      "Revoke a mandate. After this the coordinator refuses every payment under it. (On-chain mandates must also be revoked on each chain by the principal.) This is a PRINCIPAL action." +
        demoNote,
      { mandateId: z.string().optional().describe("the mandate to revoke") },
      async ({ mandateId }) => {
        const m = resolveMandate(mandateId);
        if ("error" in m) return text(m.error, true);
        // POST directly so the principal token is sent even with older capline clients
        const res = await fetchImpl(opts.coordinatorUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "revoke", mandateId: m.id, principalToken: tokens.get(m.id) }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.status === 403) return text(`Not authorized to revoke ${m.id} (principal token missing or wrong).`, true);
        return text(
          body.ok ? `Mandate ${m.id} revoked. The coordinator will refuse all future payments under it.` : `Mandate ${m.id} not found.`,
          !body.ok,
        );
      },
    );
  }

  return { server, demoMode, adminTools, pinned };
}
