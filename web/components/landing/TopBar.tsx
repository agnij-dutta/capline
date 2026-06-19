"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";

const LINKS = [
  { href: "#how", label: "How" },
  { href: "#defeat", label: "Defeat" },
  { href: "#adopt", label: "Adopt" },
];

export function TopBar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b-2 border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link href="/" className="text-lg">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="kicker text-dim transition-colors hover:text-accent"
            >
              {l.label}
            </a>
          ))}
          <Link
            href="/app"
            className="border-2 border-accent bg-accent px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-ink transition-colors hover:bg-bg hover:text-accent"
          >
            Launch app →
          </Link>
        </nav>
        <button
          onClick={() => setOpen((o) => !o)}
          className="kicker text-fg md:hidden"
          aria-label="menu"
        >
          {open ? "✕ close" : "≡ menu"}
        </button>
      </div>
      {open && (
        <div className="border-t-2 border-line bg-bg px-5 py-4 md:hidden">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-2 font-mono text-sm uppercase tracking-[0.08em] text-dim"
            >
              {l.label}
            </a>
          ))}
          <Link
            href="/app"
            className="mt-2 block border-2 border-accent bg-accent px-4 py-3 text-center font-mono text-xs font-medium uppercase tracking-[0.08em] text-accent-ink"
          >
            Launch app →
          </Link>
        </div>
      )}
    </header>
  );
}
