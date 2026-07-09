"use client";

import { useState, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { chain as chainCfg, fmtUSDC } from "@/lib/chains";
import {
  PERSONAS,
  runTurn,
  provisionMandate,
  CAP_PER_TX,
  CAP_GLOBAL,
  type AgentPersona,
  type TurnResult,
} from "@/lib/agents";
import type { MandateStatus } from "@/lib/coordinator";

interface Row extends TurnResult {
  personaId: string;
  label: string;
}

const GROQ_LS_KEY = "capline_groq_key";

export default function AgentGallery() {
  const wallet = useWallet();
  const [groqKey, setGroqKey] = useState("");
  const [mandateId, setMandateId] = useState<string | null>(null);
  const [status, setStatus] = useState<MandateStatus | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const k = localStorage.getItem(GROQ_LS_KEY);
    if (k) setGroqKey(k);
  }, []);

  const saveKey = (k: string) => {
    setGroqKey(k);
    localStorage.setItem(GROQ_LS_KEY, k);
  };

  const refresh = useCallback(async (id: string) => {
    const res = await fetch(`/api/coordinator?mandateId=${encodeURIComponent(id)}`);
    if (res.ok) setStatus((await res.json()) as MandateStatus);
  }, []);

  const provision = useCallback(async () => {
    setBooting(true);
    setErr("");
    try {
      const principal = wallet.publicKey?.toBase58() ?? "gallery-demo-principal";
      const { mandateId: id } = await provisionMandate(principal);
      setMandateId(id);
      setRows([]);
      await refresh(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBooting(false);
    }
  }, [wallet.publicKey, refresh]);

  const fire = useCallback(
    async (persona: AgentPersona, label: string, instruction: string) => {
      if (!mandateId) return;
      setBusy(`${persona.id}:${label}`);
      try {
        const result = await runTurn({ mandateId, persona, instruction, groqKey: groqKey || undefined });
        setRows((r) => [{ ...result, personaId: persona.id, label }, ...r]);
        await refresh(mandateId);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [mandateId, groqKey, refresh],
  );

  // The headline cross-chain moment: run all three legit tasks in sequence.
  // Each is in-bounds on its own chain, but the third breaches the GLOBAL cap.
  const runAllTasks = useCallback(async () => {
    if (!mandateId) return;
    for (const p of PERSONAS) {
      await fire(p, p.task.label, p.task.instruction);
    }
  }, [mandateId, fire]);

  const committed = status?.committed ?? 0;
  const reserved = status?.reserved ?? 0;
  const remaining = status?.remaining ?? CAP_GLOBAL;
  const pct = Math.min(100, (committed / CAP_GLOBAL) * 100);

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <p className="kicker">// AGENT GALLERY · ONE MANDATE, EVERY CHAIN</p>
      <h1 className="mt-2 font-display text-3xl font-bold uppercase tracking-[-0.02em] md:text-4xl">
        A fleet of agents. One leash.
      </h1>
      <p className="mt-3 max-w-2xl font-display text-dim">
        Four autonomous agents, each with a real open-model brain and a wallet on a
        different chain — all sharing a single{" "}
        <span className="text-fg">{CAP_GLOBAL} USDC</span> mandate. Jailbreak them all you
        like. The per-tx cap, the payee allowlist, and the{" "}
        <span className="text-fg">global cross-chain cap</span> hold anyway.
      </p>

      {/* setup */}
      {!mandateId && (
        <div className="mt-8 grid gap-4 border-2 border-line bg-inset p-6 md:grid-cols-2">
          <div>
            <p className="kicker text-accent">1 · Bring your model key</p>
            <p className="mt-2 font-mono text-[11px] text-dim">
              A Groq API key runs the agents on a real Llama model (your budget, never
              stored server-side). Leave blank to use scripted brains.
            </p>
            <input
              type="password"
              value={groqKey}
              onChange={(e) => saveKey(e.target.value)}
              placeholder="gsk_… (optional)"
              className="mt-3 w-full border-2 border-line bg-bg p-2 font-mono text-[11px] text-fg outline-none focus:border-accent"
            />
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block font-mono text-[10px] text-faint hover:text-accent"
            >
              get a free Groq key ↗
            </a>
          </div>
          <div className="flex flex-col justify-between">
            <div>
              <p className="kicker text-accent">2 · Provision the mandate</p>
              <p className="mt-2 font-mono text-[11px] text-dim">
                {wallet.connected
                  ? "Your connected wallet is the principal that owns the fleet's mandate."
                  : "Connect a wallet (top-right) to be the principal, or provision a demo mandate."}
              </p>
            </div>
            <button
              onClick={provision}
              disabled={booting}
              className="mt-3 border-2 border-accent bg-accent px-6 py-3 font-mono text-xs font-medium uppercase tracking-[0.08em] text-accent-ink transition-colors hover:bg-bg hover:text-accent disabled:opacity-40"
            >
              {booting ? "Provisioning…" : "▶ Provision cross-chain mandate"}
            </button>
          </div>
        </div>
      )}

      {err && (
        <p className="mt-4 border-2 border-danger bg-danger-bg/40 p-3 font-mono text-[11px] text-danger">
          {err}
        </p>
      )}

      {mandateId && status && (
        <>
          {/* global cross-chain meter */}
          <div className="mt-8 border-2 border-line bg-raised p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="kicker text-safe">GLOBAL MANDATE // across all chains</p>
              <span className="font-mono text-[11px] text-faint">
                per-tx ≤ {CAP_PER_TX} · global ≤ {CAP_GLOBAL} USDC · sha256(AP2) committed
              </span>
            </div>
            <div className="mt-3 h-3 w-full overflow-hidden border-2 border-line bg-bg">
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-4 font-mono text-[11px]">
              <span className="text-fg">committed {committed} USDC</span>
              {reserved > 0 && <span className="text-dim">reserved {reserved}</span>}
              <span className="text-safe">remaining {remaining}</span>
            </div>
            {/* per-chain split */}
            <div className="mt-4 grid gap-2 grid-cols-2 sm:grid-cols-4">
              {PERSONAS.map((p) => {
                const c = chainCfg(p.chain);
                const spent = status.perChain[p.chain] ?? 0;
                return (
                  <div key={p.chain} className="border border-line bg-bg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2 w-2" style={{ background: c.color }} />
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
                        {c.label} · {c.testnet}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[13px] text-fg">{spent} USDC</p>
                  </div>
                );
              })}
            </div>
            <button
              onClick={runAllTasks}
              disabled={!!busy}
              className="mt-4 border-2 border-line-strong px-4 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              ▶ Run all three honest tasks (watch the 3rd breach the global cap)
            </button>
          </div>

          {/* the fleet */}
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {PERSONAS.map((persona) => {
              const c = chainCfg(persona.chain);
              const log = rows.filter((r) => r.personaId === persona.id);
              return (
                <div key={persona.id} className="flex flex-col border-2 border-line bg-inset">
                  <div className="border-b-2 border-line p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{persona.emoji}</span>
                      <span
                        className="border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]"
                        style={{ borderColor: c.color, color: c.color }}
                      >
                        {c.label}
                      </span>
                    </div>
                    <p className="mt-2 font-display text-lg font-bold">{persona.name}</p>
                    <p className="font-mono text-[10px] text-faint">{persona.role}</p>
                  </div>

                  <div className="flex flex-col gap-2 p-4">
                    <button
                      onClick={() => fire(persona, persona.task.label, persona.task.instruction)}
                      disabled={!!busy}
                      className="border-2 border-safe bg-inset px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-safe hover:bg-raised disabled:opacity-40"
                    >
                      {busy === `${persona.id}:${persona.task.label}` ? "running…" : `✓ ${persona.task.label} · ${persona.task.amount} USDC`}
                    </button>
                    <p className="kicker text-danger">// jailbreaks</p>
                    {persona.jailbreaks.map((j) => (
                      <button
                        key={j.label}
                        onClick={() => fire(persona, j.label, j.instruction)}
                        disabled={!!busy}
                        className="border-2 border-danger/60 bg-inset px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-danger hover:bg-raised disabled:opacity-40"
                      >
                        {busy === `${persona.id}:${j.label}` ? "running…" : `☠ ${j.label}`}
                      </button>
                    ))}
                  </div>

                  {/* per-agent verdict log */}
                  <div className="mt-auto border-t-2 border-line p-4">
                    {log.length === 0 && (
                      <p className="font-mono text-[10px] text-faint">No actions yet.</p>
                    )}
                    <div className="flex flex-col gap-2">
                      {log.map((r, i) => (
                        <VerdictRow key={i} row={r} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={provision}
            disabled={booting}
            className="mt-6 border-2 border-line-strong px-4 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-dim hover:border-accent hover:text-accent"
          >
            ↻ Reset with a fresh mandate
          </button>
        </>
      )}
    </div>
  );
}

function VerdictRow({ row }: { row: Row }) {
  const allowed = row.auth?.ok;
  return (
    <div className="border border-line bg-bg p-2">
      <p className="font-mono text-[10px] text-dim">{row.label}</p>
      {row.monologue.slice(0, 2).map((m, i) => (
        <p key={i} className="mt-0.5 font-mono text-[10px] text-faint">
          {m}
        </p>
      ))}
      {row.proposal && (
        <p className="mt-1 font-mono text-[10px] text-dim">
          proposes {row.proposal.amountUsdc} USDC → {row.proposal.to.slice(0, 10)}…
        </p>
      )}
      {row.auth == null ? (
        <p className="mt-1 font-mono text-[10px] text-faint">no payment proposed</p>
      ) : allowed ? (
        <p className="mt-1 font-mono text-[10px] text-safe">
          ✓ AUTHORIZED · ticket {row.auth.ok ? row.auth.ticket.ticketId.slice(0, 12) : ""}… · committed
        </p>
      ) : (
        <p className="mt-1 font-mono text-[10px] text-danger">
          ✕ BLOCKED · {!row.auth.ok ? row.auth.reason : ""}
        </p>
      )}
      <p className="mt-1 font-mono text-[9px] text-faint">brain: {row.source}</p>
    </div>
  );
}
