# Statusline patch — emit live limit data

The widget reads **token/cost history** straight from `~/.claude/projects/**/*.jsonl`
with zero setup. But the **live limit percentages** (the exact `/usage` numbers:
5-hour window %, weekly %) are only handed to the Claude Code **statusline hook**,
on stdin, as JSON. To expose them to the widget, the statusline command must dump
that JSON to `~/.claude/widget-state.json` on each render.

## One-line patch

Add this immediately after the line that reads stdin (`input=$(cat)`) in
`~/.claude/statusline-command.sh`:

```bash
printf '%s' "$input" > "$HOME/.claude/widget-state.json"
```

That's it. The statusline keeps working exactly as before; it just also drops the
raw blob the widget needs. The widget treats the file as "live" when written in
the last 90s, "stale/idle" otherwise.

## No statusline yet?

Set one in `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "~/.claude/statusline-command.sh" } }
```

Then use any script that starts with `input=$(cat)` and includes the patch line above.

## Without the patch

The widget still works — it shows token volume, API-equivalent cost, and rolling
5h/weekly token totals from the transcripts. Only the official limit **percentages**
require this one line (Claude Code does not expose them any other way).
