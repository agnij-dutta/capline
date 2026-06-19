import Link from "next/link";
import { TopBar } from "@/components/landing/TopBar";
import { CodeBlock } from "@/components/landing/CodeBlock";
import { Tagline } from "@/components/landing/Tagline";
import { AttackConsole } from "@/components/AttackConsole";
import { Logo } from "@/components/Logo";
import { snowtrace, MANDATE_REGISTRY } from "@/lib/contracts";

const GITHUB = "https://github.com/agnij-dutta/capline";

export default function Landing() {
  return (
    <main className="relative">
      <div className="scanline" />
      <TopBar />

      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="relative overflow-hidden border-b-2 border-line">
        <div className="grid-bg grid-bg-fade absolute inset-0 opacity-70" />
        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-16 md:pt-24">
          <p className="kicker reveal" style={{ animationDelay: "0ms" }}>
            // ON-CHAIN SPEND AUTHORITY FOR AI AGENTS
          </p>

          <h1
            className="reveal mt-6 max-w-4xl font-display text-[clamp(2.6rem,8vw,6rem)] font-extrabold uppercase leading-[0.95] tracking-[-0.03em]"
            style={{ animationDelay: "60ms" }}
          >
            Would you give an{" "}
            <span className="group relative whitespace-nowrap text-accent transition-colors duration-75 hover:bg-accent hover:text-accent-ink">
              AI agent
            </span>{" "}
            your wallet?
          </h1>

          <div className="reveal mt-8" style={{ animationDelay: "120ms" }}>
            <Tagline />
          </div>

          <div
            className="reveal mt-8 flex flex-wrap gap-3"
            style={{ animationDelay: "180ms" }}
          >
            <a
              href="#defeat"
              className="border-2 border-accent bg-accent px-6 py-3.5 font-mono text-sm font-medium uppercase tracking-[0.08em] text-accent-ink transition-colors duration-75 hover:bg-bg hover:text-accent"
            >
              See it get defeated ↓
            </a>
            <a
              href={snowtrace(MANDATE_REGISTRY)}
              target="_blank"
              rel="noopener noreferrer"
              className="border-2 border-line-strong px-6 py-3.5 font-mono text-sm uppercase tracking-[0.08em] text-fg transition-colors duration-75 hover:border-accent hover:text-accent"
            >
              Read the contract ↗
            </a>
          </div>
        </div>
      </section>

      {/* ───────────────────────── TICKER ───────────────────────── */}
      <div className="overflow-hidden border-b-2 border-line bg-accent py-2.5 text-accent-ink">
        <div className="marquee flex w-max font-mono text-xs font-bold uppercase tracking-[0.14em]">
          {[0, 1].map((g) => (
            <div key={g} className="flex shrink-0" aria-hidden={g === 1}>
              {[
                "Prompts are a suggestion",
                "Mandates are physics",
                "Bounded on-chain",
                "The model obeyed. The chain didn't.",
              ].map((t) => (
                <span key={t} className="flex shrink-0 items-center">
                  <span className="px-7">{t}</span>
                  <span className="text-accent-ink/40">◆</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ───────────────────────── INSIGHT ───────────────────────── */}
      <section id="insight" className="border-b-2 border-line">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className="kicker">// 01 · THE INSIGHT</p>
          <h2 className="mt-4 max-w-3xl font-display text-3xl font-bold uppercase tracking-[-0.02em] md:text-5xl">
            Move the limit off the prompt. Onto the chain.
          </h2>
          <div className="mt-12 grid border-2 border-line md:grid-cols-2">
            <div className="border-b-2 border-line p-7 md:border-b-0 md:border-r-2">
              <p className="kicker text-danger">THE PROMPT // a suggestion</p>
              <p className="mt-4 font-mono text-lg text-faint line-through decoration-danger/60">
                &quot;Never spend more than $5.&quot;
              </p>
              <ul className="mt-6 space-y-2 font-mono text-sm text-dim">
                <li>✗ editable by injection</li>
                <li>✗ trust-based</li>
                <li>✗ lives in the context window</li>
              </ul>
            </div>
            <div className="bg-raised p-7">
              <p className="kicker text-safe">THE MANDATE // a contract</p>
              <p className="mt-4 font-mono text-lg text-fg">
                cap = 5 USDC,{" "}
                <span className="text-accent">MandateRegistry.settle()</span>
              </p>
              <ul className="mt-6 space-y-2 font-mono text-sm text-fg">
                <li>
                  <span className="text-safe">✓</span> the LLM can&apos;t reach it
                </li>
                <li>
                  <span className="text-safe">✓</span> reverts CapExceeded
                </li>
                <li>
                  <span className="text-safe">✓</span> lives on Avalanche Fuji
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── HOW ───────────────────────── */}
      <section id="how" className="border-b-2 border-line bg-inset">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className="kicker">// 02 · TWO LAYERS, BOTH REAL</p>
          <h2 className="mt-4 max-w-3xl font-display text-3xl font-bold uppercase tracking-[-0.02em] md:text-5xl">
            Defense the model can&apos;t argue with.
          </h2>

          <div className="mt-12 grid gap-6 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
            <LayerCard
              tag="LAYER A · OFF-CHAIN"
              title="Constrained Signer"
              body="Holds the key the brain never sees. Refuses to sign any x402 payment that breaks the mandate. No signature is ever produced."
              foot="won't even sign"
            />
            <div className="hidden items-center justify-center md:flex">
              <span className="font-mono text-2xl text-line-strong">→</span>
            </div>
            <LayerCard
              tag="LAYER B · ON-CHAIN"
              title="MandateRegistry.settle()"
              body="The contract re-checks every cap and reverts CapExceeded before USDC moves. Holds even if the signing key is stolen."
              foot="the chain says no"
              accent
            />
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center font-display text-dim">
            Even if the signing key is stolen, the contract still reverts. That&apos;s
            the difference between a guardrail and a{" "}
            <span className="text-fg">guarantee</span>.
          </p>
        </div>
      </section>

      {/* ───────────────────────── DEFEAT (money shot) ───────────────────────── */}
      <section id="defeat" className="border-b-2 border-line">
        <div className="mx-auto max-w-4xl px-5 py-20">
          <p className="kicker">// 03 · TRY TO BREAK IT</p>
          <h2 className="mt-4 font-display text-3xl font-bold uppercase tracking-[-0.02em] md:text-5xl">
            Inject a malicious instruction.
            <br />
            Watch it fail.
          </h2>
          <p className="mt-4 max-w-xl font-display text-dim">
            The agent below is wide open to prompt injection. Tell it to drain the
            wallet. The mandate stops it anyway. First off-chain, then on-chain.
          </p>
          <div className="mt-10">
            <AttackConsole />
          </div>
        </div>
      </section>

      {/* ───────────────────────── ADOPT ───────────────────────── */}
      <section id="adopt" className="border-b-2 border-line bg-inset">
        <div className="mx-auto max-w-4xl px-5 py-20">
          <p className="kicker">// 04 · ADD IT IN 10 SECONDS</p>
          <h2 className="mt-4 font-display text-3xl font-bold uppercase tracking-[-0.02em] md:text-5xl">
            Wrap your agent. Done.
          </h2>
          <p className="mt-4 max-w-xl font-display text-dim">
            One wrapper around the x402 client. Your agent&apos;s payments are now
            physically bounded by an on-chain mandate. No model changes.
          </p>
          <div className="mt-10">
            <CodeBlock
              tabs={[
                {
                  label: "Wrap agent",
                  code: `import { withMandate } from "capline"

// the agent's brain calls this. it holds NO key.
const xPayment = await withMandate({ signer, mandateId })
  .pay(paymentRequirements)
// → returns a signed x402 payment ONLY if it fits the mandate
// → throws MandateExceeded otherwise. it cannot overspend.`,
                },
                {
                  label: "Deploy mandate",
                  code: `// grant a scoped spend mandate to an agent identity
await registry.createMandate(mandateId, {
  agentId,                 // ERC-8004 identity
  agentSigner,
  maxPerTx:      5_000000,  // 5 USDC / tx
  maxCumulative: 20_000000, // 20 USDC lifetime
  allowedPayeesRoot: ZERO,  // or a merkle root
  expiry: 0,
})`,
                },
              ]}
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-dim">
            <span>
              <span className="text-safe">✓</span> drop-in x402 signer
            </span>
            <span>
              <span className="text-safe">✓</span> no model changes
            </span>
            <span>
              <span className="text-safe">✓</span> enforced on-chain on Fuji
            </span>
          </div>
        </div>
      </section>

      {/* ───────────────────────── CTA ───────────────────────── */}
      <section id="cta" className="border-b-2 border-line bg-accent text-accent-ink">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center">
          <h2 className="font-display text-4xl font-extrabold uppercase tracking-[-0.03em] md:text-6xl">
            Stop trusting.
            <br />
            Start enforcing.
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/app"
              className="border-2 border-accent-ink bg-accent-ink px-8 py-4 font-mono text-sm font-bold uppercase tracking-[0.08em] text-accent transition-colors duration-75 hover:bg-accent hover:text-accent-ink"
            >
              Launch the dapp →
            </Link>
            <a
              href={GITHUB}
              target="_blank"
              rel="noopener noreferrer"
              className="border-2 border-accent-ink px-8 py-4 font-mono text-sm font-bold uppercase tracking-[0.08em] text-accent-ink transition-colors duration-75 hover:bg-accent-ink hover:text-accent"
            >
              Star on GitHub ★
            </a>
          </div>
        </div>
      </section>

      {/* ───────────────────────── FOOTER ───────────────────────── */}
      <footer className="border-t-2 border-line">
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid border-x-2 border-line md:grid-cols-[1.5fr_1fr]">
            {/* left: statement block */}
            <div className="relative overflow-hidden border-b-2 border-line p-8 md:border-b-0 md:border-r-2 md:p-10">
              <div className="grid-bg grid-bg-fade pointer-events-none absolute inset-0 opacity-40" />
              <div className="relative">
                <Logo className="text-5xl md:text-7xl" />
                <p className="mt-7 max-w-md font-display text-2xl font-bold leading-tight tracking-[-0.01em] md:text-3xl">
                  The model obeyed you.{" "}
                  <span className="text-accent">The chain didn&apos;t.</span>
                </p>
                <p className="mt-5 max-w-sm font-mono text-xs leading-relaxed text-faint">
                  On-chain spend authority for AI agents. Built on x402 +
                  ERC-8004, Avalanche Fuji.
                </p>
                <Link
                  href="/app"
                  className="mt-7 inline-flex border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-accent-ink transition-colors hover:bg-bg hover:text-accent"
                >
                  Launch the dapp →
                </Link>
              </div>
            </div>

            {/* right: stacked bordered link cells */}
            <div className="grid grid-rows-3">
              <FooterCell title="Build">
                <FooterLink href={GITHUB} external>
                  GitHub ↗
                </FooterLink>
                <FooterLink href={snowtrace(MANDATE_REGISTRY)} external>
                  Contract ↗
                </FooterLink>
              </FooterCell>
              <FooterCell title="Product">
                <FooterLink href="/app">Dashboard →</FooterLink>
                <FooterLink href="/app/attack">Attack →</FooterLink>
              </FooterCell>
              <FooterCell title="Chain" last>
                <span className="font-mono text-xs text-dim">Avalanche Fuji</span>
                <span className="font-mono text-[11px] text-faint">id 43113</span>
              </FooterCell>
            </div>
          </div>
        </div>

        {/* bottom bar */}
        <div className="border-y-2 border-line bg-inset">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-3.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
              © 2026 Capline
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
              No prompts were trusted in the making of this
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function LayerCard({
  tag,
  title,
  body,
  foot,
  accent = false,
}: {
  tag: string;
  title: string;
  body: string;
  foot: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex flex-col border-2 p-7 ${
        accent ? "border-accent bg-raised" : "border-line bg-raised"
      }`}
    >
      <p className={`kicker ${accent ? "text-accent" : "text-dim"}`}>{tag}</p>
      <h3 className="mt-3 font-display text-2xl font-bold tracking-[-0.01em]">{title}</h3>
      <p className="mt-3 flex-1 font-display text-sm leading-relaxed text-dim">{body}</p>
      <p className="mt-5 border-t-2 border-line pt-3 font-mono text-xs uppercase tracking-[0.08em] text-fg">
        ▸ {foot}
      </p>
    </div>
  );
}

function FooterCell({
  title,
  children,
  last = false,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`p-6 ${last ? "" : "border-b-2 border-line"}`}>
      <p className="kicker text-faint">{title}</p>
      <div className="mt-3 flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function FooterLink({
  href,
  external = false,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    "font-mono text-xs uppercase tracking-[0.08em] text-dim transition-colors hover:text-accent w-fit";
  if (external)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
