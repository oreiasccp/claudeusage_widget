import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as https from "https";

let lastErr = "";

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
let last: UsageResp | undefined;

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

/** Same endpoint Claude Code uses for /usage. Usage metadata — not inference.
 *  Uses Node `https` (not global fetch — the extension host may not expose it). */
function fetchUsage(): Promise<UsageResp | undefined> {
  return new Promise((resolve) => {
    const t = token();
    if (!t) {
      lastErr = "credentials não encontradas (~/.claude/.credentials.json)";
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

async function update(): Promise<void> {
  const u = await fetchUsage();
  last = u;
  if (!u) {
    item.text = "$(error) Claude —";
    item.tooltip = `Sem dados de uso${lastErr ? ` — ${lastErr}` : ""}`;
    item.backgroundColor = undefined;
    return;
  }
  const fh = Math.round(u.five_hour?.utilization ?? 0);
  const wk = Math.round(u.seven_day?.utilization ?? 0);
  const worst = Math.max(fh, wk);
  const icon = worst >= 90 ? "$(flame)" : worst >= 70 ? "$(warning)" : "$(pulse)";
  item.text = `${icon} 5h ${fh}% · sem ${wk}%`;
  item.backgroundColor =
    worst >= 90
      ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : worst >= 70
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;

  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Claude — limites da assinatura**\n\n`);
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

function schedule(ctx: vscode.ExtensionContext): void {
  if (timer) clearInterval(timer);
  const sec = Math.max(
    10,
    vscode.workspace.getConfiguration("claudeUsage").get<number>("refreshSeconds", 30),
  );
  timer = setInterval(() => void update(), sec * 1000);
  ctx.subscriptions.push({ dispose: () => timer && clearInterval(timer) });
}

export function activate(ctx: vscode.ExtensionContext): void {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = "$(sync~spin) Claude…";
  item.command = "claudeUsage.details";
  item.show();
  ctx.subscriptions.push(item);

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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("claudeUsage.refreshSeconds")) schedule(ctx);
    }),
  );

  void update();
  schedule(ctx);
}

export function deactivate(): void {
  if (timer) clearInterval(timer);
}
