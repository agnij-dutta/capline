export const runtime = "nodejs";

// HTTP surface for the cross-chain mandate coordinator (lib/coordinator.ts).
// One canonical AP2 mandate governs spend across every chain; this endpoint is
// where agents authorize a spend against the GLOBAL budget before touching a
// chain, and where settles get committed/released. GET returns live status.
//
// Trust model: this is a cooperative, off-chain control (see SECURITY.md H-2).
// It is unauthenticated except for `revoke`, which needs the principalToken
// returned once by `create`.

import {
  createMandate,
  authorize,
  commitDetailed,
  release,
  revoke,
  status,
  CoordinatorError,
  type CreateMandateInput,
} from "@/lib/coordinator";
import type { ChainId } from "@/lib/chains";

const HTTP: Record<CoordinatorError["code"], number> = {
  INVALID_INPUT: 400,
  MANDATE_EXISTS: 409,
  UNAUTHORIZED: 403,
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mandateId = url.searchParams.get("mandateId");
  if (!mandateId) return Response.json({ error: "mandateId required" }, { status: 400 });
  const s = await status(mandateId);
  if (!s) return Response.json({ error: "MANDATE_MISSING" }, { status: 404 });
  return Response.json(s);
}

export async function POST(req: Request) {
  let body: { action?: string } & Record<string, unknown>;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "invalid body" }, { status: 400 });
  try {
    switch (body.action) {
      case "create": {
        const { principalToken, ...mandate } = await createMandate(body as unknown as CreateMandateInput);
        // principalToken is shown exactly once; it is required to revoke.
        return Response.json({ mandate, principalToken, status: await status(mandate.mandateId) });
      }
      case "authorize": {
        const { mandateId, chain, to, amount } = body as unknown as {
          mandateId: string;
          chain: ChainId;
          to: string;
          amount: number;
        };
        return Response.json(await authorize(String(mandateId), chain, to, amount));
      }
      case "commit": {
        const { mandateId, ticketId } = body as unknown as { mandateId: string; ticketId: string };
        const r = await commitDetailed(String(mandateId), String(ticketId));
        return Response.json({ ...r, status: await status(String(mandateId)) });
      }
      case "release": {
        const { mandateId, ticketId } = body as unknown as { mandateId: string; ticketId: string };
        await release(String(mandateId), String(ticketId));
        return Response.json({ ok: true });
      }
      case "revoke": {
        const { mandateId, principalToken } = body as unknown as { mandateId: string; principalToken?: string };
        const ok = await revoke(String(mandateId), principalToken);
        return Response.json({ ok, status: await status(String(mandateId)) });
      }
      default:
        return Response.json({ error: `unknown action: ${String(body.action)}` }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof CoordinatorError) return Response.json({ error: e.code, message: e.message }, { status: HTTP[e.code] });
    throw e;
  }
}
