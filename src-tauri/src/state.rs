//! Live limit state, emitted by the Claude Code statusline hook.
//!
//! The statusline command receives a JSON blob on stdin that includes
//! `rate_limits.five_hour.used_percentage` (the same number `/usage` shows).
//! Our patched statusline writes that blob verbatim to ~/.claude/widget-state.json
//! on every render. We read it here. It is fresh only while a session is active.

use serde::Serialize;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone, Default)]
pub struct LiveState {
    pub five_hour_pct: Option<f64>,
    pub weekly_pct: Option<f64>,
    pub context_pct: Option<f64>,
    pub model: Option<String>,
    /// Unix epoch seconds when each window resets (from the statusline payload).
    pub five_hour_resets_at: Option<i64>,
    pub weekly_resets_at: Option<i64>,
    /// Seconds since the file was last written; None if the file is absent.
    pub age_secs: Option<u64>,
    /// True when the file was written within the freshness window.
    pub fresh: bool,
}

fn state_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("widget-state.json"))
}

fn pct_at(v: &serde_json::Value, group: &str) -> Option<f64> {
    v.get("rate_limits")?
        .get(group)?
        .get("used_percentage")?
        .as_f64()
}

fn reset_at(v: &serde_json::Value, group: &str) -> Option<i64> {
    let r = v.get("rate_limits")?.get(group)?.get("resets_at")?;
    r.as_i64().or_else(|| r.as_f64().map(|f| f as i64))
}

/// Read and parse the live state file. Returns a default (all-None, not fresh)
/// when the file is missing or unreadable — the JSONL engine still works.
pub fn read() -> LiveState {
    let Some(path) = state_path() else {
        return LiveState::default();
    };
    let Ok(meta) = std::fs::metadata(&path) else {
        return LiveState::default();
    };
    let age_secs = meta
        .modified()
        .ok()
        .and_then(|m| SystemTime::now().duration_since(m).ok())
        .map(|d| d.as_secs());
    // Considered fresh if written in the last 90 seconds (statusline re-renders often).
    let fresh = age_secs.map(|s| s <= 90).unwrap_or(false);

    let Ok(text) = std::fs::read_to_string(&path) else {
        return LiveState { age_secs, fresh: false, ..Default::default() };
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return LiveState { age_secs, fresh: false, ..Default::default() };
    };

    LiveState {
        five_hour_pct: pct_at(&v, "five_hour"),
        // Official key is `seven_day`; keep `weekly` as a fallback.
        weekly_pct: pct_at(&v, "seven_day").or_else(|| pct_at(&v, "weekly")),
        five_hour_resets_at: reset_at(&v, "five_hour"),
        weekly_resets_at: reset_at(&v, "seven_day").or_else(|| reset_at(&v, "weekly")),
        context_pct: v
            .get("context_window")
            .and_then(|c| c.get("used_percentage"))
            .and_then(|p| p.as_f64()),
        model: v
            .get("model")
            .and_then(|m| m.get("display_name"))
            .and_then(|s| s.as_str())
            .map(|s| s.to_string()),
        age_secs,
        fresh,
    }
}

#[allow(dead_code)]
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
