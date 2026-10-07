// capline-mcp tool-surface tests over an in-memory MCP transport, against the
// REAL reference coordinator logic (web/lib/coordinator.ts) behind a fetch shim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, type ServerOptions } from "../src/server.js";
import * as coordinator from "../../web/lib/coordinator.js";

const URL_ = "https://coordinator.test/api/coordinator";

// minimal HTTP shim mirroring web/app/api/coordinator/route.ts
const fakeFetch = (async (input: string, init?: { body?: string }) => {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  if (!init?.body) {
    const id = new URL(input).searchParams.get("mandateId")!;
    const s = await coordinator.status(id);
    return s ? json(s) : json({ error: "MANDATE_MISSING" }, 404);
  }
  const b = JSON.parse(init.body);
  try {
    switch (b.action) {
      case "create": {
        const { principalToken, ...mandate } = await coordinator.createMandate(b);
        return json({ mandate, principalToken, status: await coordinator.status(mandate.mandateId) });
      }
      case "authorize":
        return json(await coordinator.authorize(b.mandateId, b.chain, b.to, b.amount));
      case "commit":
        return json(await coordinator.commitDetailed(b.mandateId, b.ticketId));
      case "revoke":
        return json({ ok: await coordinator.revoke(b.mandateId, b.principalToken) });
    }
  } catch (e) {
    if (e instanceof coordinator.CoordinatorError) return json({ error: e.code }, e.code === "UNAUTHORIZED" ? 403 : 400);
    throw e;
  }
  return json({ error: "unknown" }, 400);
}) as unknown as typeof fetch;

async function connect(opts: Partial<ServerOptions> = {}) {
  const { server } = buildServer({ coordinatorUrl: URL_, fetchImpl: fakeFetch, ...opts });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0]?.text ?? "", isError: !!r.isError };
  };
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  return { client, call, tools };
}

test("demo mode: all tools, refusals work, and nothing claims an on-chain settlement", async () => {
  const { call, tools } = await connect();
  assert.deepEqual(tools, ["create_mandate", "mandate_status", "pay", "revoke_mandate"]);
  const created = await call("create_mandate", { maxPerTx: 5, maxTotal: 20, allowedPayees: ["DataVendor"] });
  assert.match(created.text, /Demo mode/);
  const id = /id: (\S+)/.exec(created.text)![1];

  const ok = await call("pay", { mandateId: id, to: "DataVendor", amount: 5 });
  assert.equal(ok.isError, false);
  assert.match(ok.text, /^AUTHORIZED/);
  assert.match(ok.text, /no on-chain transfer/);
  assert.doesNotMatch(ok.text, /SETTLED|Paid \$/);

  assert.match((await call("pay", { mandateId: id, to: "DataVendor", amount: 1000 })).text, /REFUSED \(OVER_PER_TX\)/);
  assert.match((await call("pay", { mandateId: id, to: "Scammer", amount: 3 })).text, /REFUSED \(PAYEE_NOT_ALLOWED\)/);

  // revoke works with the token this server captured at create time
  assert.match((await call("revoke_mandate", { mandateId: id })).text, /revoked/);
  assert.match((await call("pay", { mandateId: id, to: "DataVendor", amount: 1 })).text, /REFUSED \(REVOKED\)/);
});

test("pinned mode: the agent cannot mint or revoke mandates, or spend under another one", async () => {
  // the principal provisions the mandate out of band
  const m = await coordinator.createMandate({
    principal: "human",
    ap2Json: "{}",
    maxPerTx: 5,
    maxCumulative: 10,
    chains: ["solana"],
    allowedPayees: ["datavendor"],
  });
  const other = await coordinator.createMandate({ principal: "x", ap2Json: "{}", maxPerTx: 1e6, maxCumulative: 1e6, chains: ["solana"] });

  const { call, tools } = await connect({ pinnedMandateId: m.mandateId });
  assert.deepEqual(tools, ["mandate_status", "pay"], "no create_mandate / revoke_mandate exposed to the model");

  // an injected instruction to use a looser mandate is refused
  const evil = await call("pay", { mandateId: other.mandateId, to: "Scammer", amount: 1000 });
  assert.equal(evil.isError, true);
  assert.match(evil.text, /pinned to mandate/);

  // the pinned mandate is used when no id is given
  assert.match((await call("pay", { to: "DataVendor", amount: 5 })).text, /^AUTHORIZED/);
  assert.match((await call("pay", { to: "DataVendor", amount: 5 })).text, /^AUTHORIZED/);
  assert.match((await call("pay", { to: "DataVendor", amount: 5 })).text, /REFUSED \(OVER_GLOBAL_CAP\)/);
  assert.match((await call("mandate_status", {})).text, /committed: \$10/);
});

test("pinned mode with admin tools: revoke needs the principal token", async () => {
  const m = await coordinator.createMandate({ principal: "human", ap2Json: "{}", maxPerTx: 5, maxCumulative: 10, chains: ["solana"] });
  const noToken = await connect({ pinnedMandateId: m.mandateId, adminTools: true });
  assert.ok(noToken.tools.includes("revoke_mandate"));
  const denied = await noToken.call("revoke_mandate", {});
  assert.equal(denied.isError, true);
  assert.match(denied.text, /Not authorized/);
  assert.equal((await coordinator.status(m.mandateId))!.mandate.revoked, false);

  const withToken = await connect({ pinnedMandateId: m.mandateId, adminTools: true, principalToken: m.principalToken });
  assert.match((await withToken.call("revoke_mandate", {})).text, /revoked/);
  assert.equal((await coordinator.status(m.mandateId))!.mandate.revoked, true);
});
