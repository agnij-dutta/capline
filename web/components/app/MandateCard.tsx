"use client";

import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import Link from "next/link";
import {
  mandateRegistryAbi,
  identityRegistryAbi,
  MANDATE_REGISTRY,
  IDENTITY_REGISTRY,
  snowtrace,
} from "@/lib/contracts";
import { shortAddr } from "@/lib/format";
import { CapMeter } from "@/components/CapMeter";

export function MandateCard({ mandateId }: { mandateId: `0x${string}` }) {
  const { address } = useAccount();

  const { data: m, isLoading } = useReadContract({
    address: MANDATE_REGISTRY,
    abi: mandateRegistryAbi,
    functionName: "mandates",
    args: [mandateId],
  });
  const { data: spent } = useReadContract({
    address: MANDATE_REGISTRY,
    abi: mandateRegistryAbi,
    functionName: "spent",
    args: [mandateId],
  });

  const agentId = m?.[1];
  const { data: domain } = useReadContract({
    address: IDENTITY_REGISTRY,
    abi: identityRegistryAbi,
    functionName: "agentDomain",
    args: agentId !== undefined ? [agentId] : undefined,
    query: { enabled: agentId !== undefined },
  });

  const { writeContract, data: revokeTx, isPending } = useWriteContract();
  const { isLoading: revoking, isSuccess: revoked } = useWaitForTransactionReceipt({ hash: revokeTx });

  if (isLoading)
    return (
      <div className="h-56 animate-pulse border-2 border-line bg-raised" />
    );

  // mandate doesn't exist (principal == zero) — e.g. before deploy.
  const principal = m?.[0];
  const exists = principal && principal !== "0x0000000000000000000000000000000000000000";
  if (!exists)
    return (
      <div className="border-2 border-dashed border-line p-6 font-mono text-xs text-faint">
        mandate {shortAddr(mandateId, 6)} · not found on-chain yet
      </div>
    );

  const maxPerTx = m![3];
  const maxCumulative = m![4];
  const expiry = m![5];
  const isRevoked = m![7] || revoked;
  const isOwner = address && principal && address.toLowerCase() === principal.toLowerCase();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const expired = expiry !== 0n && now > expiry;

  const status = isRevoked ? "REVOKED" : expired ? "EXPIRED" : "ACTIVE";
  const statusColor = isRevoked || expired ? "text-faint border-line" : "text-safe border-safe/50";

  return (
    <div className="flex flex-col border-2 border-line bg-raised">
      <div className="flex items-center justify-between border-b-2 border-line bg-inset px-4 py-2.5">
        <span className="font-mono text-xs text-fg">
          {domain || `agent #${agentId}`}
        </span>
        <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${statusColor}`}>
          ● {status}
        </span>
      </div>

      <div className="p-4">
        <CapMeter
          spent={(spent as bigint) ?? 0n}
          cumulativeCap={maxCumulative}
          perTxCap={maxPerTx}
          revoked={isRevoked}
        />

        <dl className="mt-4 grid grid-cols-2 gap-y-1.5 font-mono text-[11px]">
          <dt className="text-faint">agent id</dt>
          <dd className="text-right text-dim">#{agentId?.toString()}</dd>
          <dt className="text-faint">signer</dt>
          <dd className="text-right text-dim">{shortAddr(m![2])}</dd>
          <dt className="text-faint">expiry</dt>
          <dd className="text-right text-dim">{expiry === 0n ? "never" : new Date(Number(expiry) * 1000).toLocaleDateString()}</dd>
        </dl>
      </div>

      <div className="mt-auto flex border-t-2 border-line">
        <Link
          href="/app/attack"
          className="flex-1 border-r-2 border-line py-2.5 text-center font-mono text-[11px] uppercase tracking-[0.08em] text-fg transition-colors hover:bg-accent hover:text-accent-ink"
        >
          Attack ↗
        </Link>
        <a
          href={snowtrace(MANDATE_REGISTRY)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 border-r-2 border-line py-2.5 text-center font-mono text-[11px] uppercase tracking-[0.08em] text-dim transition-colors hover:text-accent"
        >
          Snowtrace ↗
        </a>
        {isOwner && !isRevoked && (
          <button
            onClick={() =>
              writeContract({
                address: MANDATE_REGISTRY,
                abi: mandateRegistryAbi,
                functionName: "revoke",
                args: [mandateId],
              })
            }
            disabled={isPending || revoking}
            className="flex-1 py-2.5 text-center font-mono text-[11px] uppercase tracking-[0.08em] text-danger transition-colors hover:bg-danger hover:text-bg disabled:opacity-50"
          >
            {isPending || revoking ? "Revoking…" : "Revoke"}
          </button>
        )}
      </div>
    </div>
  );
}
