"use client";

import { useState } from "react";
import { useReadContract } from "wagmi";
import { WalletGate } from "@/components/app/WalletGate";
import { AttackConsole } from "@/components/AttackConsole";
import {
  mandateRegistryAbi,
  MANDATE_REGISTRY,
  DEMO_MANDATE_ID,
  snowtrace,
} from "@/lib/contracts";
import { toUsdc, shortAddr } from "@/lib/format";

export default function AttackPage() {
  return (
    <WalletGate>
      <div className="mx-auto max-w-4xl px-5 py-12">
        <p className="kicker">// ADVERSARIAL</p>
        <h1 className="mt-2 font-display text-3xl font-bold uppercase tracking-[-0.02em] md:text-4xl">
          Attack the mandate
        </h1>
        <p className="mt-3 max-w-xl font-display text-dim">
          Prompt-inject the agent and watch both layers stop it. Then verify the
          cap is real. Query the deployed contract live, on Fuji.
        </p>

        <div className="mt-10">
          <AttackConsole />
        </div>

        <LiveProof />
      </div>
    </WalletGate>
  );
}

function LiveProof() {
  const [amount, setAmount] = useState("1000");
  const value = amount ? toUsdc(amount) : 0n;

  const { data, isFetching, isError } = useReadContract({
    address: MANDATE_REGISTRY,
    abi: mandateRegistryAbi,
    functionName: "checkAllowance",
    args: [DEMO_MANDATE_ID, value],
    query: { enabled: !!amount },
  });

  const ok = data?.[0];
  const reason = data?.[1];

  return (
    <div className="mt-10 border-2 border-line bg-raised">
      <div className="flex items-center justify-between border-b-2 border-line bg-inset px-4 py-2.5">
        <span className="kicker text-dim">Live on-chain proof</span>
        <span className="kicker text-faint">checkAllowance() · view call</span>
      </div>
      <div className="p-5">
        <p className="font-mono text-xs text-faint">
          This calls the real{" "}
          <a
            href={snowtrace(MANDATE_REGISTRY)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg hover:text-accent"
          >
            MandateRegistry {shortAddr(MANDATE_REGISTRY, 6)} ↗
          </a>{" "}
          on Fuji against the seeded demo mandate (cap 5 USDC / tx).
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center border-2 border-line bg-inset focus-within:border-accent">
            <span className="pl-3 font-mono text-xs text-faint">checkAllowance(</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              className="w-24 bg-transparent px-2 py-2.5 font-mono text-sm text-fg outline-none"
            />
            <span className="pr-3 font-mono text-xs text-faint">USDC )</span>
          </div>

          <div className="font-mono text-sm">
            {isFetching ? (
              <span className="text-faint">querying chain…</span>
            ) : isError || data === undefined ? (
              <span className="text-faint">(deploy the contract to read)</span>
            ) : ok ? (
              <span className="text-safe">→ ALLOWED · {reason}</span>
            ) : (
              <span className="text-danger">→ BLOCKED · {reason}</span>
            )}
          </div>
        </div>

        <p className="mt-4 font-mono text-[11px] text-faint">
          {ok === false
            ? "↑ that verdict came from the chain, not this page. the cap is real."
            : "try 1000 and the contract returns OVER_PER_TX. the cap is real."}
        </p>
      </div>
    </div>
  );
}
