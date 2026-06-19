"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { WalletConnect } from "./WalletConnect";

const TABS = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/create", label: "Create" },
  { href: "/app/attack", label: "Attack" },
];

export function DappNav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b-2 border-line bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-base">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {TABS.map((t) => {
              const active = path === t.href;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
                    active
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-transparent text-dim hover:text-fg"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <WalletConnect />
      </div>
      {/* mobile tabs */}
      <nav className="flex border-t-2 border-line sm:hidden">
        {TABS.map((t) => {
          const active = path === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex-1 py-2.5 text-center font-mono text-[11px] uppercase tracking-[0.08em] ${
                active ? "bg-accent text-accent-ink" : "text-dim"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
