"use client";

import { useEffect, useRef, useState } from "react";

const FULL = "The cap isn't in the prompt. It's a contract the LLM can't talk to.";

// Types itself out the first time it scrolls into view. The one line of copy
// that earns its place, delivered like a terminal.
export function Tagline() {
  const [n, setN] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!started || n >= FULL.length) return;
    const t = setTimeout(() => setN((v) => v + 1), 20);
    return () => clearTimeout(t);
  }, [started, n]);

  return (
    <div
      ref={ref}
      className="inline-block border-l-2 border-accent bg-inset px-4 py-3 font-mono text-[clamp(0.85rem,1.5vw,1.05rem)] text-fg"
    >
      <span className="text-accent">{">"}</span>{" "}
      <span>{FULL.slice(0, n)}</span>
      <span className="cursor" />
    </div>
  );
}
