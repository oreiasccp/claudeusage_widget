# Claude Usage — VS Code status bar

Embeds your **Claude Code subscription limits** in the VS Code status bar (bottom
right): `⟳ 5h 45% · sem 75%`. Color turns amber ≥70%, red ≥90%. Hover for resets
(GMT-3) and per-model weekly; click for a details popup.

Same data source as the tray widget — `GET /api/oauth/usage` with the OAuth token
from `~/.claude/.credentials.json` (usage metadata, **zero cost**, not inference).
Works inside VS Code, where the terminal statusline doesn't run.

## Install (dev)

```bash
cd vscode-extension
npm install
npm run compile
```

Then in VS Code: **F5** (Run Extension) — opens an Extension Development Host with
the status bar item live. Or package it:

```bash
npm i -g @vscode/vsce
vsce package        # → claude-usage-statusbar-0.1.0.vsix
# VS Code → Extensions → ⋯ → Install from VSIX
```

## Settings

- `claudeUsage.refreshSeconds` — poll interval (default 30, min 10).

## Notes

- The Claude chat panel is a closed webview — can't inject there. The status bar is
  the embeddable surface inside VS Code.
- `/usage` in chat remains the built-in on-demand view.
- Endpoint is undocumented (reverse-engineered); may change across Claude Code versions.
