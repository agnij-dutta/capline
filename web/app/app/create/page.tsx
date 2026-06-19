"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { decodeEventLog, encodeAbiParameters, keccak256 } from "viem";
import { WalletGate } from "@/components/app/WalletGate";
import { TxStatus } from "@/components/app/TxStatus";
import {
  mandateRegistryAbi,
  identityRegistryAbi,
  MANDATE_REGISTRY,
  IDENTITY_REGISTRY,
} from "@/lib/contracts";
import { toUsdc, fmtUsdc, shortAddr } from "@/lib/format";

const ZERO_ROOT = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const EXPIRY_PRESETS = [
  { label: "24h", secs: 86400 },
  { label: "7d", secs: 604800 },
  { label: "30d", secs: 2592000 },
  { label: "Never", secs: 0 },
];

export default function CreatePage() {
  return (
    <WalletGate>
      <CreateForm />
    </WalletGate>
  );
}

function CreateForm() {
  const router = useRouter();
  const { address } = useAccount();

  const [agentId, setAgentId] = useState<string>("");
  const [domain, setDomain] = useState("my-agent.capline.xyz");
  const [perTx, setPerTx] = useState("5");
  const [cumulative, setCumulative] = useState("20");
  const [expirySecs, setExpirySecs] = useState(604800);

  // ---- register a new agent identity ----
  const {
    writeContract: registerWrite,
    data: registerTx,
    isPending: registerPending,
    error: registerErr,
  } = useWriteContract();
  const { data: registerReceipt, isLoading: registering, isSuccess: registered } =
    useWaitForTransactionReceipt({ hash: registerTx });

  useEffect(() => {
    if (!registerReceipt) return;
    for (const log of registerReceipt.logs) {
      try {
        const ev = decodeEventLog({ abi: REG_EVENT_ABI, ...log });
        if (ev.eventName === "AgentRegistered") {
          setAgentId((ev.args as { agentId: bigint }).agentId.toString());
          break;
        }
      } catch {
        /* not our event */
      }
    }
  }, [registerReceipt]);

  // verify ownership of the entered agentId
  const { data: owner } = useReadContract({
    address: IDENTITY_REGISTRY,
    abi: identityRegistryAbi,
    functionName: "ownerOf",
    args: agentId ? [BigInt(agentId)] : undefined,
    query: { enabled: !!agentId },
  });
  const ownsAgent = owner && address && owner.toLowerCase() === address.toLowerCase();

  // ---- create the mandate ----
  const {
    writeContract: createWrite,
    data: createTx,
    isPending: createPending,
    error: createErr,
  } = useWriteContract();
  const { isLoading: creating, isSuccess: created } = useWaitForTransactionReceipt({ hash: createTx });

  const mandateId = useMemo(() => {
    if (!address || !agentId) return undefined;
    return keccak256(
      encodeAbiParameters(
        [{ type: "string" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
        ["mandate.ui.v1", MANDATE_REGISTRY, BigInt(agentId), address],
      ),
    );
  }, [address, agentId]);

  useEffect(() => {
    if (created && mandateId) {
      const saved = JSON.parse(localStorage.getItem("mandate:ids") || "[]");
      localStorage.setItem("mandate:ids", JSON.stringify([mandateId, ...saved]));
      const t = setTimeout(() => router.push("/app"), 900);
      return () => clearTimeout(t);
    }
  }, [created, mandateId, router]);

  const perTxValid = Number(perTx) > 0;
  const cumValid = Number(cumulative) >= Number(perTx) && Number(cumulative) > 0;
  const canCreate = ownsAgent && perTxValid && cumValid && !!mandateId && !!address;

  const submit = () => {
    if (!canCreate || !mandateId || !address) return;
    const expiry = expirySecs === 0 ? 0n : BigInt(Math.floor(Date.now() / 1000) + expirySecs);
    createWrite({
      address: MANDATE_REGISTRY,
      abi: mandateRegistryAbi,
      functionName: "createMandate",
      args: [
        mandateId,
        {
          principal: address,
          agentId: BigInt(agentId),
          agentSigner: address,
          maxPerTx: toUsdc(perTx),
          maxCumulative: toUsdc(cumulative),
          expiry,
          allowedPayeesRoot: ZERO_ROOT,
          revoked: false,
        },
      ],
    });
  };

  const expiryLabel = EXPIRY_PRESETS.find((e) => e.secs === expirySecs)?.label ?? "";

  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <p className="kicker">// GRANT AUTHORITY</p>
      <h1 className="mt-2 font-display text-3xl font-bold uppercase tracking-[-0.02em] md:text-4xl">
        Create a mandate
      </h1>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* form */}
        <div className="space-y-8">
          {/* 1 — identity */}
          <Field n="01" label="Agent identity (ERC-8004)">
            <div className="flex gap-2">
              <input
                value={agentId}
                onChange={(e) => setAgentId(e.target.value.replace(/\D/g, ""))}
                placeholder="agent id"
                className="w-32 border-2 border-line bg-inset px-3 py-2.5 font-mono text-sm text-fg outline-none focus:border-accent"
              />
              <div className="flex flex-1 items-center font-mono text-[11px]">
                {agentId &&
                  (ownsAgent ? (
                    <span className="text-safe">✓ you control agent #{agentId}</span>
                  ) : owner ? (
                    <span className="text-danger">✕ owned by {shortAddr(owner)}</span>
                  ) : (
                    <span className="text-faint">unregistered id</span>
                  ))}
              </div>
            </div>
            <div className="mt-3 border-2 border-dashed border-line p-3">
              <p className="font-mono text-[11px] text-faint">Don&apos;t have one? Register an identity:</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="flex-1 border-2 border-line bg-inset px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
                />
                <button
                  onClick={() =>
                    registerWrite({
                      address: IDENTITY_REGISTRY,
                      abi: identityRegistryAbi,
                      functionName: "register",
                      args: [domain],
                    })
                  }
                  disabled={registerPending || registering}
                  className="border-2 border-line-strong px-4 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {registerPending || registering ? "Registering…" : "Register →"}
                </button>
              </div>
              <div className="mt-2">
                <TxStatus
                  awaitingSignature={registerPending}
                  hash={registerTx}
                  confirming={registering}
                  success={registered}
                  error={registerErr}
                  successLabel={`Registered agent #${agentId}`}
                />
              </div>
            </div>
          </Field>

          {/* 2 — caps */}
          <Field n="02" label="Spend caps">
            <div className="grid grid-cols-2 gap-3">
              <AmountInput label="Per transaction" value={perTx} onChange={setPerTx} />
              <AmountInput label="Cumulative (lifetime)" value={cumulative} onChange={setCumulative} />
            </div>
            {!cumValid && cumulative && (
              <p className="mt-2 font-mono text-[11px] text-danger">
                ⚠ cumulative must be ≥ per-tx and {">"} 0
              </p>
            )}
          </Field>

          {/* 3 — expiry */}
          <Field n="03" label="Expiry">
            <div className="flex flex-wrap gap-2">
              {EXPIRY_PRESETS.map((e) => (
                <button
                  key={e.label}
                  onClick={() => setExpirySecs(e.secs)}
                  className={`border-2 px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] transition-colors ${
                    expirySecs === e.secs
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-line text-dim hover:border-line-strong hover:text-fg"
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* summary */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="border-2 border-line bg-raised">
            <div className="border-b-2 border-line bg-inset px-4 py-2.5">
              <span className="kicker text-faint">Summary</span>
            </div>
            <div className="p-5">
              <p className="font-display text-sm leading-relaxed text-fg">
                This mandate lets{" "}
                <span className="text-accent">
                  {agentId ? `agent #${agentId}` : "·"}
                </span>{" "}
                spend up to{" "}
                <span className="text-accent">{perTxValid ? fmtUsdc(toUsdc(perTx)) : "·"}</span>{" "}
                USDC per transaction,{" "}
                <span className="text-accent">{cumValid ? fmtUsdc(toUsdc(cumulative)) : "·"}</span>{" "}
                USDC total, to any payee, expiring{" "}
                <span className="text-accent">
                  {expirySecs === 0 ? "never" : `in ${expiryLabel}`}
                </span>
                .
              </p>
              <p className="mt-4 border-t-2 border-line pt-3 font-mono text-[11px] text-faint">
                enforced by MandateRegistry.settle(). the agent physically can&apos;t exceed it.
              </p>

              <button
                onClick={submit}
                disabled={!canCreate || createPending || creating}
                className="mt-5 w-full border-2 border-accent bg-accent py-3.5 font-mono text-xs font-bold uppercase tracking-[0.08em] text-accent-ink transition-colors hover:bg-bg hover:text-accent disabled:opacity-40"
              >
                {created ? "Created ✓" : createPending || creating ? "Creating…" : "Sign & create mandate"}
              </button>
              <div className="mt-3">
                <TxStatus
                  awaitingSignature={createPending}
                  hash={createTx}
                  confirming={creating}
                  success={created}
                  error={createErr}
                  successLabel="Mandate created"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const REG_EVENT_ABI = [
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "domain", type: "string", indexed: false },
    ],
  },
] as const;

function Field({ n, label, children }: { n: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-xs text-accent">{n}</span>
        <span className="kicker text-dim">{label}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      {children}
    </div>
  );
}

function AmountInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{label}</label>
      <div className="mt-1 flex items-center border-2 border-line bg-inset focus-within:border-accent">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          className="w-full bg-transparent px-3 py-2.5 font-mono text-sm text-fg outline-none"
        />
        <span className="px-3 font-mono text-xs text-faint">USDC</span>
      </div>
    </div>
  );
}
