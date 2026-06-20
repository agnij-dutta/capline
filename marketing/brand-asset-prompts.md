# Capline · brand asset prompts (logo, X cover, OG/thumbnail)

Ready-to-paste AI image prompts for the logo **mark**, the **X header (1500×500)**, and a reusable **OG/thumbnail background (1200×630)**. Same brutalist-dev system as the site.

**Golden rules:** the **CAPLINE wordmark is always set in Figma/CSS** (Archivo heavy uppercase, `#EDEDED`, 2px lime `#C6F806` rule through the cap-height) — never let AI render the text. Generate clean plates, overlay all type yourself. Pin the exact hexes in every prompt or generators drift to generic neon-green. Use MJ `--style raw` / full `--no`, or paste the negatives into Flux/Ideogram's negative field. Generate at 2× then downscale for crisp 1px lines.

---

## 1. LOGO / MARK (square, avatar + favicon)

The AI makes only the **square mark**; it locks up left of the wordmark: `[ MARK ]  CAPLINE`, the mark's lime line colinear with the wordmark's cap-line rule, gap = cap-height of the C. Mark alone = avatar/favicon. **Best tool: Ideogram** (cleanest hard-edged flat vector; Flux second; avoid MJ here — it adds grain/bloom). Trace the output to true vector in Figma before shipping as a 16px favicon.

### Variant A — "Clipped Overage" glyph (primary)
```
Brutalist engineering glyph icon, flat 2D vector, dead-center on a pure near-black background #0A0A0A. A single thick horizontal bar in acid lime #C6F806 spanning the middle of the frame — this is a hard "cap line". Below it, two vertical bars rise upward like a bar chart; one bar stops cleanly BELOW the lime line and stays off-white #EDEDED; the second bar pushes ABOVE the lime line and its overage — the portion above the line — is sliced flat by the lime line and rendered in danger red #FF2D2D, a guillotine clip, hard flat top exactly on the line. Schematic blueprint aesthetic, 1px to 2px raw strokes, perfectly orthogonal, zero rounded corners, hairline registration ticks at the ends of the lime line. High contrast, mechanical, technical-diagram feel. Flat, no shading, no gradient, no glow, no perspective, no 3D. Negative space heavy, single icon centered, symmetrical margins.
--ar 1:1 --style raw
```
Negative: `rounded corners, gradient, glow, drop shadow, 3D, bevel, glossy, reflection, purple, blue, neon bloom, photorealism, robot, mascot, texture, paper grain, watermark, signature, multiple icons, busy background`

### Variant B — "Leash Anchor" node (favicon-first alt)
```
Minimal brutalist mark, flat 2D vector, centered on pure near-black #0A0A0A. A short thick horizontal line in acid lime #C6F806 running left-to-right across the middle, terminating at its right end in a small solid filled lime square node — like a schematic anchor point or contract terminal: a line ending in a square. The square is sharp-cornered, hard-edged. Tiny perpendicular registration tick where the line meets the square. Engineering-blueprint / circuit-trace aesthetic, 2px stroke weight, absolute right angles, zero curves, zero rounded corners. Flat color blocks only. No shading, no gradient, no glow, no 3D, no perspective. Heavy negative space, dead-center composition, generous symmetric padding.
--ar 1:1 --style raw
```
Negative: `rounded corners, gradient, glow, shadow, 3D, bevel, gloss, purple, blue, neon, photoreal, robot, texture, noise, watermark, text, letters, multiple shapes, clutter`

---

## 2. X COVER / HEADER (1500×500, ar 3:1)

```
Brutalist engineering schematic banner, ultra-wide 3:1 horizontal composition, pure near-black background #0A0A0A. The hero element is one long thin horizontal "cap line" in acid lime #C6F806 running edge to edge across the full width of the frame, positioned slightly above vertical center. Rising up to meet it from below: a sparse row of vertical bars like a bar chart spread across the width; most bars stop cleanly just under the lime line in off-white #EDEDED; a few bars push above it and their overage — the slice above the line — is guillotined flat exactly on the lime line and turns danger red #FF2D2D, hard flat clipped tops. Faint blueprint grid of 1px border-grey #2A2A2A lines in the far background, technical registration ticks and small monospace-style measurement notches along the lime line. Schematic, mechanical, high-contrast, flat 2D, orthogonal, zero rounded corners, raw 1px–2px strokes. Wide clean empty negative space in the center and right third for text. No shading, no gradient, no glow, no 3D, no perspective, no glossy.
--ar 3:1 --style raw
```
Negative: `rounded corners, gradient, glow, bloom, drop shadow, 3D, bevel, glossy, reflection, purple, blue, neon, vignette, photorealism, robot, mascot, people, stock imagery, heavy texture, paper grain, lens flare, watermark, signature, real text, gibberish letters, busy clutter`

**Safe zones (critical):**
- **Avatar:** bottom-left ~180–200px square is covered by the profile pic — keep it empty (mask any bar that lands there in Figma).
- **Mobile crop:** X trims ~60px top & bottom on mobile — keep the lime line + red clipped tops inside the central ~380px vertical band.
- **Overlay (Figma):** wordmark **CAPLINE** + tagline `THE MODEL OBEYED. THE CHAIN DIDN'T.` (JetBrains Mono) centered-right; optional lime mono kicker top-right `x402 · ERC-8004 · AVALANCHE`. Bake no text.

**Best tool:** Flux (cleanest wide schematic, holds 1px grid). Export exactly 1500×500.

---

## 3. OG / THUMBNAIL BACKGROUND (1200×630, ar 1.91:1)

```
Brutalist engineering schematic background plate, 1200x630 landscape, pure near-black background #0A0A0A. A single bold horizontal "cap line" in acid lime #C6F806 cutting straight across the frame in the lower-middle third. One prominent vertical bar rises from the bottom and slams into the lime line: the portion below the line is off-white #EDEDED, and the overage above the line is sliced flat exactly on the line and rendered danger red #FF2D2D — a hard guillotine clip, perfectly flat top on the lime line. A couple of shorter off-white bars nearby stop safely below the line. Faint 1px blueprint grid in border-grey #2A2A2A behind everything, small monospace measurement ticks and registration marks along the lime line. The entire UPPER HALF of the frame is intentionally empty clean negative space for a headline. Flat 2D, schematic, high-contrast, orthogonal, zero rounded corners, raw 1–2px strokes, mechanical engineered look. No shading, no gradient, no glow, no 3D, no perspective, no gloss.
--ar 1.91:1 --style raw
```
Negative: `rounded corners, gradient, glow, bloom, shadow, 3D, bevel, glossy, reflection, purple, blue, neon, vignette, photoreal, robot, mascot, people, stock photo, heavy texture, paper grain, lens flare, watermark, signature, real text, gibberish letters, clutter, centered text`

**Overlay (Figma):** headline in the empty upper half — `THE CAP ISN'T IN THE PROMPT.` / `IT'S A CONTRACT THE LLM CAN'T TALK TO.` (one lime word for accent); MARK + CAPLINE lockup bottom-right; optional lime mono kicker `ON-CHAIN SPEND AUTHORITY FOR AI AGENTS`. Keep one overlay template so every OG/thumbnail reads as a series.

**Best tool:** Flux (primary), Ideogram if you want baked tick "numbers". Export exactly 1200×630.

---

## Consistency
One lime line, one red clip, one anchor node — that's the whole language. Same five hexes everywhere (`#0A0A0A`, `#EDEDED`, `#C6F806`, `#FF2D2D`, `#2A2A2A`). Always `--style raw` + the full negative list (the killers: gradient, glow, 3D, purple, rounded corners, robot). Type is always overlaid in Figma, never generated.
