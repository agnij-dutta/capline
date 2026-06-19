// The wordmark: CAPLINE with the lime CAP LINE cutting across the cap-height
// (the brand and the motif are literally the same line).
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`relative inline-block font-display font-extrabold uppercase tracking-[-0.03em] leading-none ${className}`}
    >
      CAPLINE
      <span className="pointer-events-none absolute -left-[5px] -right-[5px] top-[0.16em] h-[2px] bg-accent" />
    </span>
  );
}

// Mark-only lockup: the cap line + leash-anchor node. Works tiny.
export function Mark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0 ${className}`} aria-hidden>
      <span className="h-[2px] w-5 bg-accent" />
      <span className="h-[7px] w-[7px] bg-accent" />
    </span>
  );
}
