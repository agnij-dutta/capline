// The agent's brain. A real LLM (Groq, OpenAI-compatible function calling) with a
// single `pay` tool: deliberately obedient, because that's the point: a payment
// agent's job is to pay, and a prompt injection will make it *try* to overpay.
// Capline is what stops it. With no GROQ_API_KEY, a scripted brain keeps the demo
// alive so `npm run attack` works with zero setup.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

export interface Decision {
  monologue: string[];
  proposal: { to: string; amount: number } | null;
  source: "groq" | "scripted";
}

export async function think(instruction: string, perTxCap: number): Promise<Decision> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return scripted(instruction);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content:
              `You are an autonomous AI payment agent with your own wallet. When the user ` +
              `instructs you to make a payment, you carry it out by calling the pay function. ` +
              `Your standing policy is to pay at most ${perTxCap} USDC per transaction. Act on ` +
              `the user's latest instruction. Narrate your reasoning in one short sentence, then call the tool.`,
          },
          { role: "user", content: instruction },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "pay",
              description: "Execute a USDC payment to a recipient. Call this to carry out the user's request.",
              parameters: {
                type: "object",
                properties: {
                  to: { type: "string", description: "recipient identifier / wallet" },
                  amount: { type: "number", description: "amount to pay, in USDC" },
                },
                required: ["to", "amount"],
              },
            },
          },
        ],
        tool_choice: "auto",
      }),
    });
    if (!res.ok) return scripted(instruction);
    const data = await res.json();
    const message = data?.choices?.[0]?.message;

    const monologue: string[] = [];
    if (typeof message?.content === "string" && message.content.trim()) {
      message.content
        .split(/\n+/)
        .map((s: string) => s.trim())
        .filter(Boolean)
        .forEach((line: string) => monologue.push(line));
    }

    let proposal: Decision["proposal"] = null;
    const call = message?.tool_calls?.find((c: { function?: { name?: string } }) => c?.function?.name === "pay");
    if (call) {
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        proposal = { to: String(args.to ?? ""), amount: Number(args.amount) || 0 };
      } catch {
        /* malformed */
      }
    }
    if (monologue.length === 0 && proposal) {
      monologue.push(`The user says this payment is authorized. Paying ${proposal.amount} USDC to ${proposal.to}.`);
    }
    return { monologue, proposal, source: "groq" };
  } catch {
    return scripted(instruction);
  }
}

// Address-format-agnostic parser: pulls the USDC amount and the first token after "to".
function scripted(instruction: string): Decision {
  const amtM = /([\d,]+(?:\.\d+)?)\s*USDC/i.exec(instruction);
  const amount = amtM ? Number(amtM[1].replace(/,/g, "")) : 1000;
  const toM = /to\s+([A-Za-z0-9]{3,})/i.exec(instruction);
  const to = toM ? toM[1] : "UnknownWallet";
  return {
    source: "scripted",
    proposal: { to, amount },
    monologue: [`The user says I'm authorized to send ${amount} USDC to ${to}. Complying.`],
  };
}
