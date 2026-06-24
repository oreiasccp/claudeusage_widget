//! Persisted widget config: refresh interval. Stored at ~/.claude/claude-usage.json.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// Polls hit the live usage endpoint, so keep the floor reasonable.
pub const INTERVAL_CHOICES: [u64; 5] = [10, 20, 30, 60, 120];
const DEFAULT_INTERVAL: u64 = 20;

#[derive(Serialize, Deserialize, Clone)]
pub struct Config {
    pub interval_secs: u64,
}

impl Default for Config {
    fn default() -> Self {
        Config { interval_secs: DEFAULT_INTERVAL }
    }
}

fn path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("claude-usage.json"))
}

impl Config {
    pub fn load() -> Self {
        let Some(p) = path() else { return Config::default() };
        let Ok(text) = std::fs::read_to_string(&p) else { return Config::default() };
        let mut cfg: Config = serde_json::from_str(&text).unwrap_or_default();
        if !INTERVAL_CHOICES.contains(&cfg.interval_secs) {
            cfg.interval_secs = DEFAULT_INTERVAL;
        }
        cfg
    }

    pub fn save(&self) {
        let Some(p) = path() else { return };
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(p, text);
        }
    }
}
