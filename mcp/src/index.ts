// capline-mcp — an MCP server that gives an AI agent a spending tool bounded by
// a Capline mandate. See server.ts for the security model (pinned vs demo mode).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

const COORDINATOR_URL =
  process.env.CAPLINE_COORDINATOR_URL || "https://capline-protocol.vercel.app/api/coordinator";

const { server, demoMode, adminTools, pinned } = buildServer({
  coordinatorUrl: COORDINATOR_URL,
  pinnedMandateId: process.env.CAPLINE_MANDATE_ID,
  principalToken: process.env.CAPLINE_PRINCIPAL_TOKEN,
  adminTools: process.env.CAPLINE_MCP_ADMIN_TOOLS === "1",
});

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout is the JSON-RPC channel — diagnostics MUST go to stderr.
console.error(
  `capline-mcp ready · coordinator ${COORDINATOR_URL} · ` +
    (demoMode
      ? "DEMO MODE (no CAPLINE_MANDATE_ID): the agent can create its own mandate; not a security boundary"
      : `pinned to mandate ${pinned}${adminTools ? " · admin tools ON" : ""}`),
);
