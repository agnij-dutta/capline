"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WalletGate } from "@/components/app/WalletGate";
import { MandateCard } from "@/components/app/MandateCard";
import { DEMO_MANDATE_ID, MANDATE_REGISTRY, snowtrace } from "@/lib/contracts";
import { shortAddr } from "@/lib/format";

const LS_KEY = "mandate:ids";

export default function Dashboard() {
  const [ids, setIds] = useState<`0x${string}`[]>([]);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || "[]") as string[];
    const all = Array.from(new Set([DEMO_MANDATE_ID, ...saved])) as `0x${string}`[];
    setIds(all);
  }, []);

  return (
    <WalletGate>
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker">// CONTROL ROOM</p>
            <h1 className="mt-2 font-display text-3xl font-bold uppercase tracking-[-0.02em] md:text-4xl">
              Your mandates
            </h1>
          </div>
          <Link
            href="/app/create"
            className="border-2 border-accent bg-accent px-5 py-3 font-mono text-xs font-medium uppercase tracking-[0.08em] text-accent-ink transition-colors hover:bg-bg hover:text-accent"
          >
            + Create mandate
          </Link>
        </div>

        <div className="mt-4 flex items-center gap-2 border-2 border-line bg-inset px-4 py-2.5 font-mono text-[11px] text-dim">
          <span className="inline-block h-1.5 w-1.5 bg-accent" />
          registry{" "}
          <a
            href={snowtrace(MANDATE_REGISTRY)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg hover:text-accent"
          >
            {shortAddr(MANDATE_REGISTRY, 6)} ↗
          </a>
          <span className="text-faint">· a live demo mandate is seeded for you</span>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {ids.map((id) => (
            <MandateCard key={id} mandateId={id} />
          ))}
        </div>
      </div>
    </WalletGate>
  );
}
