export const runtime = "nodejs";

// HTTP surface for the cross-chain mandate coordinator (lib/coordinator.ts).
// One canonical AP2 mandate governs spend across every chain; this endpoint is
// where agents authorize a spend against the GLOBAL budget before touching a
// chain, and where settles get committed/released. GET returns live status.

import {
  createMandate,
  authorize,
  commit,
  release,
  revoke,
  status,
  type CreateMandateInput,
} from "@/lib/coordinator";
import type { ChainId } from "@/lib/chains";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mandateId = url.searchParams.get("mandateId");
  if (!mandateId) return Response.json({ error: "mandateId required" }, { status: 400 });
  const s = await status(mandateId);
  if (!s) return Response.json({ error: "MANDATE_MISSING" }, { status: 404 });
  return Response.json(s);
}

export async function POST(req: Request) {
  const body = (await req.json()) as { action: string } & Record<string, unknown>;
  switch (body.action) {
    case "create": {
      const m = await createMandate(body as unknown as CreateMandateInput);
      return Response.json({ mandate: m, status: await status(m.mandateId) });
    }
    case "authorize": {
      const { mandateId, chain, to, amount } = body as unknown as {
        mandateId: string;
        chain: ChainId;
        to: string;
        amount: number;
      };
      return Response.json(await authorize(mandateId, chain, to, amount));
    }
    case "commit": {
      const { mandateId, ticketId } = body as unknown as {
        mandateId: string;
        ticketId: string;
      };
      return Response.json({ ok: await commit(mandateId, ticketId), status: await status(mandateId) });
    }
    case "release": {
      const { mandateId, ticketId } = body as unknown as {
        mandateId: string;
        ticketId: string;
      };
      await release(mandateId, ticketId);
      return Response.json({ ok: true });
    }
    case "revoke": {
      const { mandateId } = body as unknown as { mandateId: string };
      return Response.json({ ok: await revoke(mandateId), status: await status(mandateId) });
    }
    default:
      return Response.json({ error: `unknown action: ${body.action}` }, { status: 400 });
  }
}
