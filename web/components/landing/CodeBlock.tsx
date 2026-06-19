"use client";

import { useState } from "react";

type Tab = { label: string; code: string };

export function CodeBlock({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(tabs[active].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="border-2 border-line bg-inset">
      <div className="flex items-center justify-between border-b-2 border-line">
        <div className="flex">
          {tabs.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setActive(i)}
              className={`border-r-2 border-line px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
                active === i ? "bg-accent text-accent-ink" : "text-dim hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-dim transition-colors hover:text-accent"
        >
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-fg">
        <code dangerouslySetInnerHTML={{ __html: highlight(tabs[active].code) }} />
      </pre>
    </div>
  );
}

// Tiny brutalist syntax tint: keywords lime, strings dim, comments faint.
// Processed per line, code-before-comment, so inserted span attributes are
// never re-scanned by later passes (the bug that leaked raw style="..." text).
const KEYWORDS = /\b(const|let|await|async|function|import|from|return|new|export)\b/g;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function highlight(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      const ci = line.indexOf("//");
      const codePart = ci >= 0 ? line.slice(0, ci) : line;
      const comment = ci >= 0 ? line.slice(ci) : "";
      let out = esc(codePart)
        // strings first (raw code has no spans yet)
        .replace(/(["'])(.*?)\1/g, '<span style="color:#8a8a8a">$1$2$1</span>')
        // then keywords (won't match inside the hex/style of inserted spans)
        .replace(KEYWORDS, '<span style="color:#c6f806">$1</span>');
      if (comment) out += `<span style="color:#5a5a5a">${esc(comment)}</span>`;
      return out;
    })
    .join("\n");
}
