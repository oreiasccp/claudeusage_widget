//! Live subscription limits — the only data source. Calls the endpoint Claude
//! Code itself uses:
//!   GET https://api.anthropic.com/api/oauth/usage
//!   Authorization: Bearer <claudeAiOauth.accessToken>   (~/.claude/.credentials.json)
//!   anthropic-beta: oauth-2025-04-20
//!
//! No token/cost accounting, no transcript scanning — pure subscription usage.
//! Undocumented / reverse-engineered; may change across Claude Code versions.

use chrono::DateTime;
use serde::Serialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone, Default)]
pub struct Payload {
    pub five_hour_pct: Option<f64>,
    pub five_hour_resets_at: Option<i64>, // epoch seconds
    pub weekly_pct: Option<f64>,
    pub weekly_resets_at: Option<i64>,
    pub weekly_sonnet_pct: Option<f64>,
    pub weekly_opus_pct: Option<f64>,
    pub plan: Option<String>, // e.g. "max"
    pub ok: bool,
    /// True when these are the last good values being shown during an outage
    /// (e.g. a transient 429) rather than a fresh read.
    pub stale: bool,
    pub fetched_ms: i64,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn creds() -> Option<serde_json::Value> {
    let p = dirs::home_dir()?.join(".claude").join(".credentials.json");
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

fn iso(v: &serde_json::Value) -> Option<i64> {
    v.as_str()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp())
}

fn util(j: &serde_json::Value, key: &str) -> Option<f64> {
    j.get(key)?.get("utilization")?.as_f64()
}

pub fn fetch() -> Payload {
    let mut out = Payload {
        fetched_ms: now_ms(),
        ..Default::default()
    };

    let c = creds();
    out.plan = c
        .as_ref()
        .and_then(|c| c.get("claudeAiOauth"))
        .and_then(|o| o.get("subscriptionType"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    let Some(tok) = c
        .as_ref()
        .and_then(|c| c.get("claudeAiOauth"))
        .and_then(|o| o.get("accessToken"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
    else {
        return out;
    };

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
        .call();

    let Ok(r) = resp else { return out };
    let Ok(txt) = r.into_string() else { return out };
    let Ok(j) = serde_json::from_str::<serde_json::Value>(&txt) else {
        return out;
    };

    if let Some(fh) = j.get("five_hour") {
        out.five_hour_pct = fh.get("utilization").and_then(|x| x.as_f64());
        out.five_hour_resets_at = fh.get("resets_at").and_then(iso);
    }
    if let Some(sd) = j.get("seven_day") {
        out.weekly_pct = sd.get("utilization").and_then(|x| x.as_f64());
        out.weekly_resets_at = sd.get("resets_at").and_then(iso);
    }
    out.weekly_sonnet_pct = util(&j, "seven_day_sonnet");
    out.weekly_opus_pct = util(&j, "seven_day_opus");
    out.ok = out.five_hour_pct.is_some() || out.weekly_pct.is_some();
    out
}
