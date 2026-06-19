"use client";

import { snowtrace } from "@/lib/contracts";

export function TxStatus({
  awaitingSignature,
  hash,
  confirming,
  success,
  error,
  successLabel = "Confirmed",
}: {
  awaitingSignature?: boolean;
  hash?: `0x${string}`;
  confirming?: boolean;
  success?: boolean;
  error?: Error | null;
  successLabel?: string;
}) {
  if (!awaitingSignature && !hash && !error) return null;

  let tone = "border-line text-dim";
  let label = "";
  if (awaitingSignature) {
    label = "Awaiting signature in wallet…";
  } else if (confirming) {
    label = "Pending on-chain…";
    tone = "border-accent text-accent";
  } else if (success) {
    label = `✓ ${successLabel}`;
    tone = "border-safe text-safe";
  } else if (error) {
    label = `✕ ${cleanError(error)}`;
    tone = "border-danger text-danger";
  }

  return (
    <div className={`flex items-center justify-between gap-3 border-2 ${tone} bg-inset px-4 py-3 font-mono text-xs`}>
      <span>{label}</span>
      {hash && (
        <a
          href={snowtrace(hash, "tx")}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 uppercase tracking-[0.08em] underline-offset-2 hover:underline"
        >
          View tx ↗
        </a>
      )}
    </div>
  );
}

function cleanError(e: Error): string {
  const m = e.message || String(e);
  if (/User rejected|denied/i.test(m)) return "Rejected in wallet";
  if (/NotController/.test(m)) return "You don't control that agent identity";
  if (/insufficient funds/i.test(m)) return "Insufficient AVAX for gas";
  return m.split("\n")[0].slice(0, 80);
}
