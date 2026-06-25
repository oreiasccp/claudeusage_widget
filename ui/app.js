const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const RING_C = 2 * Math.PI * 84;
const $ = (id) => document.getElementById(id);
const sev = (pct) => (pct >= 90 ? "crit" : pct >= 70 ? "warn" : "");

// Reset clock in Brasília (GMT-3) + countdown.
const TZ = "America/Sao_Paulo";
const clock = (epochSec, withDay) => {
  const d = new Date(epochSec * 1000);
  const opts = withDay
    ? { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }
    : { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat("pt-BR", opts).format(d);
};
const until = (epochSec) => {
  let s = epochSec - Math.floor(Date.now() / 1000);
  if (s <= 0) return "agora";
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};
const resetLine = (epochSec, withDay) =>
  epochSec ? `reinicia <span class="clk">${clock(epochSec, withDay)}</span> · ${until(epochSec)}` : "";

const planLabel = (p) => {
  if (!p) return "Claude";
  const m = { max: "Max", pro: "Pro", team: "Team", free: "Free" };
  return "Claude " + (m[p.toLowerCase()] || p);
};
const fmtAge = (p) => {
  if (!p.ok) return "—";
  const s = Math.max(0, Math.floor((Date.now() - p.fetched_ms) / 1000));
  return s < 60 ? `live ${s}s` : `live ${Math.floor(s / 60)}m`;
};
const pct = (v) => (v == null ? "—" : `${Math.round(v)}%`);

let heroTween = null;
function setHeroPct(v, stale) {
  const el = $("hero-val");
  if (stale || v == null) { el.textContent = "—"; el.dataset.cur = "0"; return; }
  const from = parseFloat(el.dataset.cur || "0") || 0;
  el.dataset.cur = String(v);
  if (heroTween) cancelAnimationFrame(heroTween);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.innerHTML = Math.round(v) + '<span class="u">%</span>';
    return;
  }
  const t0 = performance.now(), dur = 480;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = Math.round(from + (v - from) * e) + '<span class="u">%</span>';
    if (k < 1) heroTween = requestAnimationFrame(step);
  };
  heroTween = requestAnimationFrame(step);
}

function render(p) {
  const hero = document.querySelector(".hero");
  const ring = $("ring");
  const live = !!p.ok && !p.stale; // fresh read
  const has = (!!p.ok || !!p.stale) && p.five_hour_pct != null; // value to show

  // pill
  $("status-pill").className = "pill " + (live ? "live" : "stale");
  $("status-text").textContent = live ? "live" : p.stale ? "antigo" : "—";

  // hero — session %
  hero.classList.remove("warn", "crit", "stale");
  if (has) {
    const v = Math.max(0, Math.min(100, p.five_hour_pct));
    if (!live) hero.classList.add("stale");
    else if (sev(v)) hero.classList.add(sev(v));
    ring.style.strokeDashoffset = RING_C * (1 - v / 100);
    setHeroPct(v, false);
  } else {
    hero.classList.add("stale");
    ring.style.strokeDashoffset = RING_C;
    setHeroPct(null, true);
  }
  $("hero-reset").innerHTML = has ? resetLine(p.five_hour_resets_at, false) : "carregando…";

  // weekly (all)
  const fill = $("weekly-fill");
  if (p.weekly_pct != null) {
    const w = Math.max(0, Math.min(100, p.weekly_pct));
    fill.style.width = w + "%";
    fill.className = "bar-fill " + sev(w);
    $("weekly-val").textContent = `${Math.round(w)}%`;
  } else {
    fill.style.width = "0%";
    $("weekly-val").textContent = "—";
  }
  $("weekly-reset").innerHTML = resetLine(p.weekly_resets_at, true);

  // footer
  $("ft-plan").textContent = planLabel(p.plan);
  $("ft-age").textContent = fmtAge(p);
}

async function refresh() {
  try { render(await invoke("get_usage")); } catch (e) { console.error(e); }
}
listen("usage", (ev) => render(ev.payload));
refresh();
