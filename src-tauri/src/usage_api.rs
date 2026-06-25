//! Live subscription limits via the endpoint Claude Code uses for /usage:
//!   GET https://api.anthropic.com/api/oauth/usage   (Bearer OAuth token)
//!
//! The endpoint rate-limits, and several clients may poll it (this tray, the
//! VS Code status-bar extension, Claude Code itself). To avoid 429s, all clients
//! share a cooperative cache file: a fresh cache is reused without a network
//! call; only one client actually fetches per freshness window.
//!
//! Undocumented / reverse-engineered — may change across Claude Code versions.

use chrono::DateTime;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone, Default)]
pub struct Payload {
    pub five_hour_pct: Option<f64>,
    pub five_hour_resets_at: Option<i64>,
    pub weekly_pct: Option<f64>,
    pub weekly_resets_at: Option<i64>,
    pub weekly_sonnet_pct: Option<f64>,
    pub weekly_opus_pct: Option<f64>,
    pub plan: Option<String>,
    pub ok: bool,
    /// Last good values shown during an outage (e.g. 429) rather than a fresh read.
    pub stale: bool,
    pub fetched_ms: i64,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn creds() -> Option<Value> {
    let p = dirs::home_dir()?.join(".claude").join(".credentials.json");
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}
fn plan_of(c: &Option<Value>) -> Option<String> {
    c.as_ref()?
        .get("claudeAiOauth")?
        .get("subscriptionType")?
        .as_str()
        .map(|s| s.to_string())
}
fn token_of(c: &Option<Value>) -> Option<String> {
    c.as_ref()?
        .get("claudeAiOauth")?
        .get("accessToken")?
        .as_str()
        .map(|s| s.to_string())
}
fn iso(v: &Value) -> Option<i64> {
    v.as_str()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp())
}
fn util(j: &Value, k: &str) -> Option<f64> {
    j.get(k)?.get("utilization")?.as_f64()
}

fn cache_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("claude-usage-cache.json"))
}
fn read_cache() -> Option<(Value, i64)> {
    let p = cache_path()?;
    let v: Value = serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()?;
    let fm = v.get("_fetched_ms")?.as_i64()?;
    Some((v, fm))
}
fn write_cache(mut raw: Value, fetched_ms: i64) {
    if let Some(p) = cache_path() {
        if let Value::Object(ref mut m) = raw {
            m.insert("_fetched_ms".into(), serde_json::json!(fetched_ms));
        }
        if let Ok(s) = serde_json::to_string(&raw) {
            let _ = std::fs::write(p, s);
        }
    }
}

fn parse(j: &Value, fetched_ms: i64, plan: Option<String>, stale: bool) -> Payload {
    let mut o = Payload {
        fetched_ms,
        plan,
        stale,
        ..Default::default()
    };
    if let Some(fh) = j.get("five_hour") {
        o.five_hour_pct = fh.get("utilization").and_then(|x| x.as_f64());
        o.five_hour_resets_at = fh.get("resets_at").and_then(iso);
    }
    if let Some(sd) = j.get("seven_day") {
        o.weekly_pct = sd.get("utilization").and_then(|x| x.as_f64());
        o.weekly_resets_at = sd.get("resets_at").and_then(iso);
    }
    o.weekly_sonnet_pct = util(j, "seven_day_sonnet");
    o.weekly_opus_pct = util(j, "seven_day_opus");
    o.ok = o.five_hour_pct.is_some() || o.weekly_pct.is_some();
    o
}

fn fetch_raw(tok: &str) -> Option<Value> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(8))
        .build();
    let resp = agent
        .get("https://api.anthropic.com/api/oauth/usage")
        .set("Authorization", &format!("Bearer {tok}"))
        .set("anthropic-beta", "oauth-2025-04-20")
        .set("anthropic-version", "2023-06-01")
        .set("Content-Type", "application/json")
        .set("User-Agent", "claude-usage-widget/0.1")
        .call()
        .ok()?;
    serde_json::from_str(&resp.into_string().ok()?).ok()
}

/// Cooperative fetch: reuse a cache younger than `fresh_secs`; otherwise fetch
/// and rewrite the cache; on failure fall back to a cache up to `stale_secs` old
/// (marked stale).
pub fn get(fresh_secs: i64, stale_secs: i64) -> Payload {
    let now = now_ms();
    let c = creds();
    let plan = plan_of(&c);

    if let Some((raw, fm)) = read_cache() {
        if (now - fm) / 1000 <= fresh_secs {
            return parse(&raw, fm, plan, false);
        }
    }
    if let Some(tok) = token_of(&c) {
        if let Some(j) = fetch_raw(&tok) {
            write_cache(j.clone(), now);
            return parse(&j, now, plan, false);
        }
    }
    if let Some((raw, fm)) = read_cache() {
        if (now - fm) / 1000 <= stale_secs {
            return parse(&raw, fm, plan, true);
        }
    }
    Payload {
        ok: false,
        fetched_ms: now,
        plan,
        ..Default::default()
    }
}
