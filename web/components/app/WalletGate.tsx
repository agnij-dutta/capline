"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useSwitchChain } from "wagmi";
import { avalancheFuji } from "@/lib/wagmi";

export function WalletGate({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain } = useSwitchChain();

  if (!mounted)
    return (
      <div className="mx-auto max-w-md px-5 py-32 text-center font-mono text-sm text-faint">
        loading…
      </div>
    );

  if (!isConnected)
    return (
      <Centered
        title="Connect to continue"
        sub="Capline runs on Avalanche Fuji testnet."
      >
        <button
          onClick={() => connect({ connector: connectors[0] })}
          disabled={isPending}
          className="border-2 border-accent bg-accent px-6 py-3.5 font-mono text-sm font-medium uppercase tracking-[0.08em] text-accent-ink transition-colors hover:bg-bg hover:text-accent"
        >
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
      </Centered>
    );

  if (chainId !== avalancheFuji.id)
    return (
      <Centered title="Wrong network" sub="Capline lives on Avalanche Fuji." danger>
        <button
          onClick={() => switchChain({ chainId: avalancheFuji.id })}
          className="border-2 border-danger bg-danger/10 px-6 py-3.5 font-mono text-sm font-medium uppercase tracking-[0.08em] text-danger transition-colors hover:bg-danger hover:text-bg"
        >
          Switch to Fuji
        </button>
      </Centered>
    );

  return <>{children}</>;
}

function Centered({
  title,
  sub,
  children,
  danger,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="mx-auto max-w-md px-5 py-28">
      <div
        className={`border-2 ${
          danger ? "border-danger" : "border-line"
        } bg-raised p-8 text-center`}
      >
        <h2 className="font-display text-2xl font-bold uppercase tracking-[-0.01em]">
          {title}
        </h2>
        <p className="mt-2 font-mono text-xs text-dim">{sub}</p>
        <div className="mt-6 flex justify-center">{children}</div>
      </div>
    </div>
  );
}
