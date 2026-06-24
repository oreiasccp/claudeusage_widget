# claudeUsage — Design System

Dark, warm, technical. Claude's clay-orange on a near-black warm scale. Numbers are the hero. Tray popup card ≈ 360px wide, generous radius, soft depth — inspired by a polished widget card.

> Not the Claude.ai cream/editorial look. User direction: **black scale + Claude orange + white/gray.** Warm-neutral dark, not blue-gray.

## Aesthetic direction

**Refined technical instrument.** A precision gauge for a developer tool. Quiet surfaces, one loud accent (the clay-orange gauge ring), monospace numerals doing the talking. Calm until you're near a limit — then the ring warms toward red.

## Color tokens

Warm near-black scale (slight red-brown undertone, matching Anthropic's dark), clay-orange accent, neutral grays for text. Hex + OKLCH.

```css
:root {
  /* Surfaces — warm near-black scale */
  --bg-void:        #0F0E0D;  /* window/transparent backdrop edge */
  --bg-base:        #16100E;  /* card base, deepest */ /* near oklch(0.18 0.012 40) */
  --surface:        #1E1815;  /* primary card surface */
  --surface-raised: #272019;  /* raised rows, badges */
  --surface-sunken: #120D0B;  /* gauge track, wells */
  --hairline:       #34291F;  /* 1px borders / dividers */
  --hairline-soft:  rgba(255,255,255,0.06);

  /* Claude clay-orange accent */
  --clay:           #D97757;  /* PRIMARY — Claude orange */
  --clay-bright:    #E8916F;  /* hover / highlight */
  --clay-deep:      #B85C3C;  /* pressed / gradient tail */
  --clay-glow:      rgba(217,119,87,0.28); /* ring glow, focus */

  /* State (gauge crosses these as % climbs) */
  --ok:    #D97757;  /* normal = clay */
  --warn:  #E0A33E;  /* amber, >=70% */
  --crit:  #E5544B;  /* red, >=90% */

  /* Text — white/gray */
  --text:        #F5F3F0;  /* primary, near-white warm */
  --text-dim:    #B8B0A8;  /* secondary labels */
  --text-mute:   #7E756C;  /* tertiary / units */
  --text-faint:  #564E47;  /* disabled / ghost */

  /* Effects */
  --radius-card: 20px;
  --radius-row:  13px;
  --radius-pill: 999px;
  --shadow-card: 0 18px 50px -12px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.4);
  --edge-top:    inset 0 1px 0 rgba(255,255,255,0.07);  /* top highlight */
  --gradient-clay: linear-gradient(135deg, var(--clay-bright), var(--clay-deep));
  --gradient-surface: linear-gradient(180deg, #221B17 0%, #19130F 100%);
}
```

## Typography

Avoid Inter/Roboto/system. Three roles:

- **Wordmark** — `Fraunces` (opsz serif), italic, for the "Claude" title only. Adds the editorial warmth of the brand without the cream.
- **UI / labels** — `Hanken Grotesk` (humanist grotesque, distinctive but quiet). Uppercase micro-labels with `letter-spacing: 0.12em`.
- **Numerals** — `JetBrains Mono`, `font-variant-numeric: tabular-nums`. Every metric. The data is the design.

Bundle as local woff2 in `src/fonts/` (offline app — no CDN at runtime).

```css
--font-mark: "Fraunces", Georgia, serif;
--font-ui:   "Hanken Grotesk", system-ui, sans-serif;
--font-num:  "JetBrains Mono", ui-monospace, monospace;
```

Scale: gauge % = 40px/600 mono · section labels = 10.5px/600 uppercase grotesk · row values = 14px mono · captions = 11px grotesk dim.

## Components

- **Card** — `--surface` over `--gradient-surface`, `--radius-card`, `--shadow-card` + `--edge-top`. 1px `--hairline` border. ~360px wide.
- **Gauge ring (hero)** — SVG conic/stroke ring, `--surface-sunken` track, `--gradient-clay` progress, soft `--clay-glow` drop. Big tabular % in center, "5h window" micro-label under. Color shifts ok→warn→crit by threshold.
- **Weekly bar** — slim horizontal track, clay fill, tick marks. % + reset countdown.
- **Stat rows** — `label · value` lines on `--surface-raised`, `--radius-row`. Tokens (in/out/cache), cost, model. Mono values right-aligned.
- **Pill badge** — `--radius-pill`, `--surface-raised`, dim text, e.g. live "● active" (clay dot) vs "idle" (mute dot).
- **Tray icon** — dynamic: clay ring arc reflecting 5h%, turns amber/red near limit.

## Motion

Restrained, high-impact. On popup open: card fades+rises 8px (180ms ease-out), gauge ring sweeps from 0→value (520ms cubic-bezier(0.22,1,0.36,1)), stat rows stagger in (40ms each). Number tween on update (count-up). Respect `prefers-reduced-motion` → snap, no sweep. No idle/scattered animation — it's a glanceable instrument.

## State semantics

| Gauge color | Trigger | Feeling |
|---|---|---|
| clay `#D97757` | < 70% | normal, on-brand |
| amber `#E0A33E` | ≥ 70% | heads-up |
| red `#E5544B` | ≥ 90% | back off |

Stale data (no live state file, session idle): gauge desaturates to `--text-mute`, "stale" pill shows.
