"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { avalancheFuji } from "@/lib/wagmi";
import { shortAddr } from "@/lib/format";
import { snowtrace } from "@/lib/contracts";

export function WalletConnect() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  if (!mounted) {
    return <div className="h-9 w-32 border-2 border-line bg-inset" />;
  }

  const wrongNet = isConnected && chainId !== avalancheFuji.id;

  if (!isConnected) {
    const injectedConnector = connectors[0];
    return (
      <button
        onClick={() => connect({ connector: injectedConnector })}
        disabled={isPending}
        className="border-2 border-accent bg-accent px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-ink transition-colors hover:bg-bg hover:text-accent disabled:opacity-60"
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (wrongNet) {
    return (
      <button
        onClick={() => switchChain({ chainId: avalancheFuji.id })}
        className="border-2 border-danger bg-danger/10 px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-danger transition-colors hover:bg-danger hover:text-bg"
      >
        Switch to Fuji
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 border-2 border-line-strong px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg transition-colors hover:border-accent"
      >
        <span className="inline-block h-1.5 w-1.5 bg-safe" />
        {shortAddr(address)}
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-48 border-2 border-line bg-raised">
          <a
            href={snowtrace(address!)}
            target="_blank"
            rel="noopener noreferrer"
            className="block border-b-2 border-line px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-dim hover:text-accent"
          >
            View on Snowtrace ↗
          </a>
          <button
            onClick={() => {
              navigator.clipboard.writeText(address!);
              setOpen(false);
            }}
            className="block w-full border-b-2 border-line px-3 py-2.5 text-left font-mono text-[11px] uppercase tracking-[0.08em] text-dim hover:text-accent"
          >
            Copy address
          </button>
          <button
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="block w-full px-3 py-2.5 text-left font-mono text-[11px] uppercase tracking-[0.08em] text-danger hover:bg-danger/10"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
