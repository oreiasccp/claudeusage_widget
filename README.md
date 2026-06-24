# Claude Usage — Windows tray widget

A tiny always-on system-tray widget showing your **Claude Code subscription limits**
in real time: the 5-hour session window and the 7-day window, with reset times.
Dark, warm, Claude clay-orange. Tauri v2 (Rust + web) — small binary, low RAM.

![mascot](claudecode-color.png)

## What it shows

- **Session (5h)** — hero gauge: live `utilization %` + reset clock/countdown.
- **Weekly (all models)** — bar: live `%` + reset.
- **Weekly per model** — Sonnet / Opus utilization.
- Gauge color shifts **clay → amber (≥70%) → red (≥90%)**.

## How it works

The only data source is the endpoint Claude Code itself uses for `/usage`:

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <claudeAiOauth.accessToken>   # from ~/.claude/.credentials.json
anthropic-beta: oauth-2025-04-20
```

Returns real-time `five_hour` / `seven_day` (+ per-model) `utilization` and ISO
`resets_at`. A background thread polls it every **N seconds** (default 20,
configurable), caches the result, and pushes it to the popup. The UI never makes
the network call itself, so it never blocks.

- **No token counting, no transcript scanning, no cost math** — pure subscription usage.
- **Zero cost:** this is a usage-metadata endpoint, not inference. No tokens, no `$`.
- **Works anywhere** (terminal *or* VS Code) — unlike the statusline, which only
  renders in the terminal.
- **Fallback:** if the endpoint is unreachable / token expired, it falls back to
  `~/.claude/widget-state.json` (written by an optional statusline patch —
  see [`scripts/statusline-patch.md`](scripts/statusline-patch.md)).

> ⚠️ The endpoint is **undocumented** (reverse-engineered from the Claude Code
> bundle) and may change in a future release. The fallback covers that.

## Interaction

- **Left-click** tray icon → popup (positioned above the icon).
- **Right-click** tray icon → menu:
  - **Open Claude Usage**
  - **Refresh interval** → 10s / 20s / 30s / 1m / 2m (persisted)
  - **Start with Windows** → autostart (registry Run key)
  - **Quit**
- Closing the popup / clicking away → hides to tray (app stays resident).

> Windows can't let an app force "always visible" in the tray — drag the icon onto
> the visible area once (Taskbar settings → tray overflow).

## Build & run

Prereqs: Rust (MSVC), Node, WebView2 (ships with Win11).

```bash
npm install                                          # Tauri CLI
npm run fonts                                         # self-hosted woff2 → ui/fonts
cp claudecode-color.png icons/source.png && npm run icon   # app/tray icons
npm run dev                                           # launch (debug)
npm run build                                         # MSI + NSIS installers
```

## Layout

```
ui/                 popup (index.html, styles.css, app.js, fonts/, mascot.png)
src-tauri/src/
  lib.rs            tray, menu, autostart, popup, poll loop, cache
  usage_api.rs      GET /api/oauth/usage → live limits payload
  state.rs          statusline-file fallback reader
  config.rs         persisted refresh interval
DESIGN.md           design system (tokens, type, motion)
scripts/            icon generator, font fetcher, statusline patch
```

## Privacy

Everything runs locally. The OAuth token is read from `~/.claude/.credentials.json`
(written by Claude Code) and sent only to `api.anthropic.com`. Nothing is stored or
sent anywhere else.
