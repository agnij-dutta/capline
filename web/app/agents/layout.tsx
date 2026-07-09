import Link from "next/link";
import { Logo } from "@/components/Logo";
import { BufferPolyfill } from "../app/polyfill";
import { WalletProviders } from "../app/wallet-providers";
import { WalletBar } from "../app/wallet-bar";

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProviders>
      <BufferPolyfill />
      <nav className="sticky top-0 z-40 flex items-center justify-between border-b-2 border-line bg-bg/90 px-5 py-3 backdrop-blur">
        <Link href="/" className="flex items-center gap-3">
          <Logo className="text-xl" />
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/app" className="font-mono text-[11px] uppercase tracking-[0.08em] text-dim hover:text-accent">
            Control Room
          </Link>
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-dim">
            <span className="inline-block h-1.5 w-1.5 bg-accent" />
            cross-chain
          </span>
          <WalletBar />
        </div>
      </nav>
      <div className="min-h-[calc(100vh-58px)]">{children}</div>
    </WalletProviders>
  );
}
