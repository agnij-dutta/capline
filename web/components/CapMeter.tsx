"use client";

import { fmtUsdc } from "@/lib/format";

/*
  The single most important data-viz: spent vs cumulative cap, with the
  per-tx cap shown as a notch so "one transaction's max" is legible against
  the whole. Crosses to warning/critical color near the ceiling.
*/
export function CapMeter({
  spent,
  cumulativeCap,
  perTxCap,
  revoked = false,
}: {
  spent: bigint;
  cumulativeCap: bigint;
  perTxCap: bigint;
  revoked?: boolean;
}) {
  const ratio = cumulativeCap > 0n ? Number(spent) / Number(cumulativeCap) : 0;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const perTxPct =
    cumulativeCap > 0n ? Math.min(100, (Number(perTxCap) / Number(cumulativeCap)) * 100) : 0;

  const fill = revoked
    ? "bg-faint"
    : pct >= 100
      ? "bg-danger"
      : pct >= 90
        ? "bg-danger"
        : pct >= 75
          ? "bg-accent"
          : "bg-safe";

  return (
    <div>
      <div className="relative h-7 w-full border-2 border-line bg-inset">
        {/* spent fill */}
        <div
          className={`absolute inset-y-0 left-0 ${fill} transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)]`}
          style={{ width: `${pct}%` }}
        />
        {/* per-tx cap notch */}
        <div
          className="absolute inset-y-0 w-[2px] bg-fg/60"
          style={{ left: `${perTxPct}%` }}
          title={`per-tx cap ${fmtUsdc(perTxCap)} USDC`}
        />
        {/* ticks */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-end pr-2">
          <span className="font-mono text-[11px] font-bold mix-blend-difference text-fg">
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[11px]">
        <span className={revoked ? "text-faint line-through" : "text-fg"}>
          {fmtUsdc(spent)} <span className="text-faint">/ {fmtUsdc(cumulativeCap)} USDC</span>
        </span>
        <span className="text-faint">
          per-tx <span className="text-dim">{fmtUsdc(perTxCap)}</span>
        </span>
      </div>
    </div>
  );
}
