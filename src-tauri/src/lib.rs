mod config;
mod state;
mod usage_api;

use config::{Config, INTERVAL_CHOICES};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition,
};
use tauri_plugin_autostart::ManagerExt;
use usage_api::Payload;

struct AppState {
    cfg: Mutex<Config>,
    interval_items: Mutex<Vec<(u64, CheckMenuItem<tauri::Wry>)>>,
    autostart_item: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
    shown_at: AtomicI64,
    last: Mutex<Option<Payload>>,
}

/// Subscription limits. Endpoint is primary; statusline file is the fallback
/// when the endpoint is unreachable or the OAuth token has expired.
fn compute() -> Payload {
    let p = usage_api::fetch();
    if p.ok {
        return p;
    }
    // Only fall back to the statusline file when it is genuinely fresh (an
    // active terminal session). A stale file must NOT masquerade as live.
    let ls = state::read();
    if ls.fresh && (ls.five_hour_pct.is_some() || ls.weekly_pct.is_some()) {
        Payload {
            five_hour_pct: ls.five_hour_pct,
            five_hour_resets_at: ls.five_hour_resets_at,
            weekly_pct: ls.weekly_pct,
            weekly_resets_at: ls.weekly_resets_at,
            weekly_sonnet_pct: None,
            weekly_opus_pct: None,
            plan: p.plan,
            ok: true,
            stale: false,
            fetched_ms: p.fetched_ms,
        }
    } else {
        p // ok = false
    }
}

#[tauri::command]
fn get_usage(app: tauri::AppHandle) -> Payload {
    // Return cache instantly; never call the network on the UI path. The poll
    // thread warms the cache ~1s after launch and pushes a "usage" event.
    app.state::<AppState>()
        .last
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_default()
}

fn tooltip(p: &Payload) -> String {
    match (p.five_hour_pct, p.weekly_pct) {
        (Some(s), Some(w)) => format!("Claude · 5h {s:.0}% · semana {w:.0}%"),
        (Some(s), None) => format!("Claude · 5h {s:.0}%"),
        _ => "Claude Usage".into(),
    }
}

fn toggle_popup(app: &tauri::AppHandle, near: Option<PhysicalPosition<f64>>) {
    let Some(win) = app.get_webview_window("popup") else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }
    if let Some(pos) = near {
        if let Ok(size) = win.outer_size() {
            let (mut x, mut y) = (
                pos.x as i32 - (size.width as i32) / 2,
                pos.y as i32 - size.height as i32 - 12,
            );
            let mon = win
                .current_monitor()
                .ok()
                .flatten()
                .or_else(|| app.primary_monitor().ok().flatten());
            if let Some(m) = mon {
                let ms = m.size();
                x = x.clamp(8, (ms.width as i32 - size.width as i32 - 8).max(8));
                y = y.clamp(8, (ms.height as i32 - size.height as i32 - 8).max(8));
            } else {
                x = x.max(8);
                y = y.max(8);
            }
            let _ = win.set_position(PhysicalPosition::new(x as f64, y as f64));
        }
    }
    app.state::<AppState>()
        .shown_at
        .store(usage_api::now_ms(), Ordering::Relaxed);
    let _ = win.show();
    let _ = win.set_focus();
    if let Some(p) = app.state::<AppState>().last.lock().unwrap().clone() {
        let _ = win.emit("usage", &p);
    }
}

fn handle_menu(app: &tauri::AppHandle, id: &str) {
    match id {
        "show" => toggle_popup(app, None),
        "quit" => app.exit(0),
        "autostart" => {
            let mgr = app.autolaunch();
            let now_on = mgr.is_enabled().unwrap_or(false);
            let _ = if now_on { mgr.disable() } else { mgr.enable() };
            let new_on = mgr.is_enabled().unwrap_or(!now_on);
            if let Some(item) = app.state::<AppState>().autostart_item.lock().unwrap().as_ref() {
                let _ = item.set_checked(new_on);
            }
        }
        other if other.starts_with("iv:") => {
            if let Ok(secs) = other[3..].parse::<u64>() {
                let st = app.state::<AppState>();
                {
                    let mut cfg = st.cfg.lock().unwrap();
                    cfg.interval_secs = secs;
                    cfg.save();
                }
                for (s, item) in st.interval_items.lock().unwrap().iter() {
                    let _ = item.set_checked(*s == secs);
                }
            }
        }
        _ => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState {
            cfg: Mutex::new(Config::load()),
            interval_items: Mutex::new(Vec::new()),
            autostart_item: Mutex::new(None),
            shown_at: AtomicI64::new(0),
            last: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![get_usage])
        .setup(|app| {
            let handle = app.handle().clone();
            let cur_interval = app.state::<AppState>().cfg.lock().unwrap().interval_secs;
            let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);

            // --- Menu ---
            let show = MenuItemBuilder::with_id("show", "Open Claude Usage").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let mut interval_items: Vec<(u64, CheckMenuItem<tauri::Wry>)> = Vec::new();
            let mut sub = SubmenuBuilder::new(app, "Refresh interval");
            for s in INTERVAL_CHOICES {
                let label = if s < 60 { format!("{s}s") } else { format!("{}m", s / 60) };
                let item = CheckMenuItemBuilder::with_id(format!("iv:{s}"), label)
                    .checked(s == cur_interval)
                    .build(app)?;
                sub = sub.item(&item);
                interval_items.push((s, item));
            }
            let submenu = sub.build()?;

            let autostart = CheckMenuItemBuilder::with_id("autostart", "Start with Windows")
                .checked(autostart_on)
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[&show])
                .separator()
                .item(&submenu)
                .item(&autostart)
                .separator()
                .items(&[&quit])
                .build()?;

            {
                let st = app.state::<AppState>();
                *st.interval_items.lock().unwrap() = interval_items;
                *st.autostart_item.lock().unwrap() = Some(autostart);
            }

            // --- Tray ---
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("Claude Usage")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        toggle_popup(tray.app_handle(), Some(position));
                    }
                })
                .build(app)?;

            // Hide popup on blur (guarded) / close-request.
            if let Some(win) = app.get_webview_window("popup") {
                let w = win.clone();
                let h = app.handle().clone();
                win.on_window_event(move |e| match e {
                    tauri::WindowEvent::Focused(false) => {
                        let shown = h.state::<AppState>().shown_at.load(Ordering::Relaxed);
                        if usage_api::now_ms() - shown > 600 {
                            let _ = w.hide();
                        }
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                    _ => {}
                });
            }

            // Poll loop: fetch → cache → tray tooltip → push to popup → sleep.
            std::thread::spawn(move || loop {
                let fresh = compute();
                // Keep the last good value during a transient failure (e.g. 429),
                // marked stale — never regress to a blank or an old seed.
                let p = {
                    let st = handle.state::<AppState>();
                    let mut guard = st.last.lock().unwrap();
                    if fresh.ok {
                        *guard = Some(fresh.clone());
                        fresh
                    } else if let Some(prev) = guard.clone() {
                        Payload { stale: true, ..prev }
                    } else {
                        fresh
                    }
                };
                if let Some(tray) = handle.tray_by_id("main") {
                    let _ = tray.set_tooltip(Some(tooltip(&p)));
                }
                if let Some(win) = handle.get_webview_window("popup") {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.emit("usage", &p);
                    }
                }
                let secs = handle
                    .state::<AppState>()
                    .cfg
                    .lock()
                    .unwrap()
                    .interval_secs
                    .max(30);
                std::thread::sleep(Duration::from_secs(secs));
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
