# Capline · announcement graphic prompts (AI image-gen)

> Brand/wordmark overlay = **CAPLINE**. In-schematic "mandate" labels (ANCHOR MANDATE, MANDATE ENFORCED, etc.) refer to the on-chain primitive and can stay — Capline is the brand, a "mandate" is the thing it grants.

Brand-faithful prompts for the X launch graphic. Lead with **#1 (Hero / Cap Line)** for the pinned post; use **#3 (Diptych)** as a follow-up.

**Golden rule:** generate clean plates with empty negative space, then overlay the real headline in Figma/Photoshop (Archivo for the hero line, JetBrains Mono uppercase for labels). Only let Ideogram/Flux attempt short mono stamps (`REVERTED`, `CapExceeded`, `1000 USDC`, `402`).

---

## 1. PRIMARY HERO — "The Cap Line" (16:9, X card) ★ lead with this

```
Brutalist engineering schematic poster, 16:9. Pure near-black background #0A0A0A with faint 1px off-white technical grid, blueprint feel. Centered: a single bold horizontal acid-lime line (#C6F806) spanning the full width — a hard mechanical "cap line", razor-sharp, 2px, no glow. Rising from the bottom, a tall vertical bar made of stacked monospace value increments climbs upward in danger red (#FF2D2D); the bar SLAMS into the lime line and is sliced perfectly flat at that exact height — the overage above the line is guillotined off, clipped to a clean hard edge, scattered into a few sheared red fragments above the cut. Below the line the bar reads as contained and ordered; at the cut, a small hard-edged red callout block. UPPERCASE monospace technical labels float in the margins like an oscilloscope readout: tick marks, value gradations, a measurement axis on the left. High contrast, hard edges, zero rounded corners, raw thin 1-2px borders, flat matte print texture, no gradients, no soft light. Off-white #EDEDED for any structural lines. Mechanical, loud, engineered, schematic. Strong empty negative space in the upper-left third reserved for a headline. Risograph-flat ink, screenprint grain, technical drawing aesthetic.
```
- **Aspect:** 16:9 (X card). 1:1 crop: regenerate `--ar 1:1`, push cap line above center, fragments in top third.
- **Negative:** `rounded corners, soft glow, bloom, gradients, purple, violet, neon haze, 3D render, glossy, chrome, stock robot, humanoid AI, brain icon, circuit-board cliché, lens flare, bokeh, drop shadows, pastel, watercolor, hand-drawn sketchiness, clutter, busy background, photorealism, depth-of-field blur`
- **Tool:** Flux (cleanest flat schematic) or Midjourney v6.1 (richer grain).
- **Overlay:** `THE MODEL OBEYED. THE CHAIN DIDN'T.` top-left.

---

## 2. ALT A — "The Leash" (4:5, vertical / pinned or IG)

```
Brutalist schematic poster, vertical 4:5, near-black #0A0A0A background with faint 1px technical grid. A small angular off-white #EDEDED agent glyph — an abstract geometric node, hard polygon, NOT a humanoid robot — strains rightward toward a glowing-hot red money target (#FF2D2D), a hard-edged stack labeled "1000 USDC" pulling away. Tethered to the agent: a taut acid-lime (#C6F806) leash rendered as a rigid mechanical line / chain of monospace dashes, snapped absolutely tight, anchored to a heavy off-white anchor block on the left stamped with a small lime mandate seal. The lime tether does NOT break — it holds, vibrating with tension, tiny stress ticks where it strains. The red target stays just out of reach. UPPERCASE monospace labels: a small red "CapExceeded" stamp near the target, "REVERTED" struck across it. Flat matte risograph ink, screenprint grain, hard edges, zero rounded corners, raw 1-2px borders, high contrast, no glow, no gradient. Mechanical, taut, engineered tension. Negative space at top for headline.
```
- **Aspect:** 4:5 (or 1:1).
- **Negative:** `cute robot, humanoid, dog leash photo, realistic chain photo, rounded corners, glow, gradient, purple, 3D render, glossy, chrome, lens flare, drop shadow, pastel, soft lighting, photorealism, mascot, friendly character, smooth bokeh`
- **Tool:** Midjourney v6.1, add `--style raw --s 50`.
- **Overlay:** `WOULD YOU GIVE AN AI AGENT YOUR WALLET?` top.

---

> ⚠️ CHAIN ACCURACY: any network label in these graphics MUST read **AVALANCHE FUJI** (testnet, chain id 43113). Never "ETH", "Ethereum", or "mainnet" — Capline is deployed only on Avalanche Fuji. Use a plausible Fuji-style block number, not an Ethereum one.

## 3. ALT B — "Agent vs Chain" diptych (16:9, typographic) ★ use as follow-up

```
Brutalist diptych poster, two hard-divided vertical panels split by a single razor 2px acid-lime #C6F806 seam, near-black #0A0A0A. LEFT PANEL labeled top-left in uppercase mono "THE MODEL": a calm ordered terminal/log readout in off-white #EDEDED monospace, a prompt-injection attack glowing faint safe-green #00E599, the agent obediently complying — a green "200 OK / TRANSFER 1000 USDC" line, everything looks like it succeeded. RIGHT PANEL labeled "THE CHAIN": the same transaction SLAMMED with a massive hard-edged danger-red #FF2D2D stamp "REVERTED — CapExceeded", a red horizontal cap line clipping the transaction flat, a 402 / on-chain block, value sheared off at the lime mandate height. Stark visual rhyme between panels: left feels permitted, right feels physically impossible. Flat matte risograph ink, screenprint grain, technical schematic grid, hard edges, zero rounded corners, raw 1-2px borders, high contrast, no glow, no gradient, no purple. Loud, mechanical, engineered. Reserved negative space band across the bottom for a headline.
```
- **Aspect:** 16:9 (or 1:1).
- **Negative:** `rounded corners, glow, bloom, gradient, purple, violet, 3D render, glossy, chrome, stock robot, humanoid, brain, generic crypto coins, gold bitcoin, lens flare, drop shadow, soft lighting, pastel, busy clutter, photorealism`
- **Tool:** Ideogram (best legible text). Fall back to Flux + overlay.
- **Overlay:** let Ideogram attempt the panel labels; overlay `THE MODEL OBEYED. THE CHAIN DIDN'T.` in the bottom band.

---

## Headline / type notes
- Hero line font: **Archivo** (condensed/expanded grotesque), `#EDEDED`. Labels: **JetBrains Mono** UPPERCASE.
- Before posting, reject any output with rounded corners, a glow, a gradient, or purple. The cap-line motif should survive in the hero + diptych — it's the signature.
