import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as https from "https";

interface Win {
  utilization?: number;
  resets_at?: string;
}
interface UsageResp {
  five_hour?: Win;
  seven_day?: Win;
  seven_day_sonnet?: Win | null;
  seven_day_opus?: Win | null;
}

let item: vscode.StatusBarItem;
let timer: NodeJS.Timeout | undefined;
let last: UsageResp | undefined; // last good payload (kept across failures)
let lastErr = "";
let backoff = 0; // extra seconds added after a 429, doubled each time

/** OAuth access token written by Claude Code. */
function token(): string | undefined {
  try {
    const p = path.join(os.homedir(), ".claude", ".credentials.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return j?.claudeAiOauth?.accessToken;
  } catch {
    return undefined;
  }
}

/** Same endpoint Claude Code uses for /usage (metadata, not inference).
 *  Node `https` — the extension host may not expose global fetch. */
function fetchUsage(): Promise<UsageResp | undefined> {
  return new Promise((resolve) => {
    const t = token();
    if (!t) {
      lastErr = "credentials não encontradas";
      resolve(undefined);
      return;
    }
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/api/oauth/usage",
        method: "GET",
        headers: {
          Authorization: `Bearer ${t}`,
          "anthropic-beta": "oauth-2025-04-20",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
          "User-Agent": "claude-usage-statusbar/0.1",
        },
        timeout: 8000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          const code = res.statusCode ?? 0;
          if (code >= 200 && code < 300) {
            try {
              lastErr = "";
              resolve(JSON.parse(d) as UsageResp);
            } catch {
              lastErr = "resposta inválida";
              resolve(undefined);
            }
          } else if (code === 429) {
            lastErr = "HTTP 429 (rate limited — aguardando)";
            resolve(undefined);
          } else {
            lastErr = `HTTP ${code}` + (code === 401 ? " (token expirado — rode o Claude Code)" : "");
            resolve(undefined);
          }
        });
      },
    );
    req.on("error", (e) => {
      lastErr = e.message;
      resolve(undefined);
    });
    req.on("timeout", () => {
      lastErr = "timeout";
      req.destroy();
      resolve(undefined);
    });
    req.end();
  });
}

// Brasília (GMT-3) clock + countdown.
const clock = (iso?: string, withDay = false): string => {
  if (!iso) return "—";
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (withDay) opts.weekday = "short";
  return new Intl.DateTimeFormat("pt-BR", opts).format(new Date(iso));
};
const until = (iso?: string): string => {
  if (!iso) return "";
  let s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return "agora";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

function render(u: UsageResp, stale: boolean): void {
  const fh = Math.round(u.five_hour?.utilization ?? 0);
  const wk = Math.round(u.seven_day?.utilization ?? 0);
  const worst = Math.max(fh, wk);
  const icon = stale ? "$(history)" : worst >= 90 ? "$(flame)" : worst >= 70 ? "$(warning)" : "$(pulse)";
  item.text = `${icon} 5h ${fh}% · sem ${wk}%`;
  item.backgroundColor =
    !stale && worst >= 90
      ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : !stale && worst >= 70
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;

  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Claude — limites da assinatura**\n\n`);
  if (stale) md.appendMarkdown(`_⚠ valores anteriores — ${lastErr}_\n\n`);
  md.appendMarkdown(
    `Sessão (5h): **${fh}%** · reinicia ${clock(u.five_hour?.resets_at)} (${until(u.five_hour?.resets_at)})\n\n`,
  );
  md.appendMarkdown(
    `Semanal: **${wk}%** · reinicia ${clock(u.seven_day?.resets_at, true)} (${until(u.seven_day?.resets_at)})\n\n`,
  );
  const s3 = u.seven_day_sonnet?.utilization;
  const o3 = u.seven_day_opus?.utilization;
  if (s3 != null) md.appendMarkdown(`Semanal · Sonnet: ${Math.round(s3)}%\n\n`);
  if (o3 != null) md.appendMarkdown(`Semanal · Opus: ${Math.round(o3)}%\n\n`);
  md.appendMarkdown(`_clique para detalhes_`);
  item.tooltip = md;
}

async function update(): Promise<void> {
  const u = await fetchUsage();
  if (u) {
    last = u;
    backoff = 0;
    render(u, false);
    return;
  }
  // Failure: keep showing the last good value (don't blank on a transient 429).
  if (lastErr.includes("429")) {
    backoff = Math.min(backoff ? backoff * 2 : 60, 300);
  }
  if (last) {
    render(last, true);
  } else {
    item.text = "$(error) Claude —";
    item.tooltip = `Sem dados${lastErr ? ` — ${lastErr}` : ""}`;
    item.backgroundColor = undefined;
  }
}

function baseSeconds(): number {
  return Math.max(
    15,
    vscode.workspace.getConfiguration("claudeUsage").get<number>("refreshSeconds", 60),
  );
}

function loop(): void {
  void update().finally(() => {
    const sec = backoff ? Math.max(baseSeconds(), backoff) : baseSeconds();
    timer = setTimeout(loop, sec * 1000);
  });
}

export function activate(ctx: vscode.ExtensionContext): void {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = "$(sync~spin) Claude…";
  item.command = "claudeUsage.details";
  item.show();
  ctx.subscriptions.push(item);
  ctx.subscriptions.push({ dispose: () => timer && clearTimeout(timer) });

  ctx.subscriptions.push(
    vscode.commands.registerCommand("claudeUsage.refresh", () => void update()),
    vscode.commands.registerCommand("claudeUsage.details", async () => {
      await update();
      if (!last) {
        vscode.window.showWarningMessage(`Claude Usage: sem dados${lastErr ? ` — ${lastErr}` : ""}.`);
        return;
      }
      const fh = Math.round(last.five_hour?.utilization ?? 0);
      const wk = Math.round(last.seven_day?.utilization ?? 0);
      vscode.window.showInformationMessage(
        `Claude — Sessão 5h ${fh}% (reinicia ${clock(last.five_hour?.resets_at)}) · ` +
          `Semanal ${wk}% (reinicia ${clock(last.seven_day?.resets_at, true)})`,
      );
    }),
  );

  loop();
}

export function deactivate(): void {
  if (timer) clearTimeout(timer);
}
