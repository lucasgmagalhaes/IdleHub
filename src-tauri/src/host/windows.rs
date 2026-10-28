//! Windows: all game tabs share one WebView2 browser process; each account is a
//! WebView2 profile, which keeps cookies and storage isolated.
//!
//! Giving every account its own user data folder (what Tauri's child webviews
//! do) starts a full browser process tree per account. Tauri does not expose
//! WebView2 profiles, so the game webviews are created with wry directly, as
//! children of the main window. wry webviews live on the main thread.
//!
//! `IDLEHUB_WEBVIEW2_SEPARATE=1` switches back to one browser per account
//! (Tauri child webviews), for troubleshooting and A/B measurements.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use idlehub_core::account::AccountId;
use idlehub_core::layout::Rect;
use idlehub_core::policy::RenderPolicy;
use idlehub_core::workspace::TabState;
use tauri::{App, AppHandle, Manager};
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::{
    MemoryUsageLevel, PageLoadEvent, WebContext, WebView, WebViewBuilder, WebViewBuilderExtWindows,
    WebViewExtWindows,
};

use super::desktop;
use crate::scripts::{apply_policy_script, initialization_script};
use crate::{to_error, AppState, CommandResult};

/// Folder shared by every account's WebView2 profile.
const SHARED_DATA_DIR: &str = "webview2";
/// Same reasoning as on other desktops: parked tabs shrink instead of hiding.
const PARKED_SIZE: f64 = 1.0;

struct GameTab {
    webview: WebView,
    parked: bool,
}

thread_local! {
    // Main thread only: wry webviews are neither Send nor Sync.
    static CONTEXT: RefCell<Option<WebContext>> = const { RefCell::new(None) };
    static TABS: RefCell<HashMap<AccountId, GameTab>> = RefCell::new(HashMap::new());
}

fn separate_browsers() -> bool {
    std::env::var_os("IDLEHUB_WEBVIEW2_SEPARATE").is_some_and(|v| v != "0")
}

/// Runs `action` on the main thread; failures are logged since nobody awaits them.
fn on_main_thread(
    app: &AppHandle,
    what: &'static str,
    action: impl FnOnce() -> wry::Result<()> + Send + 'static,
) -> CommandResult<()> {
    app.run_on_main_thread(move || {
        if let Err(error) = action() {
            eprintln!("idlehub: failed to {what}: {error}");
        }
    })
    .map_err(to_error)
}

fn with_tab(
    id: AccountId,
    action: impl FnOnce(&mut GameTab) -> wry::Result<()>,
) -> wry::Result<()> {
    TABS.with_borrow_mut(|tabs| tabs.get_mut(&id).map_or(Ok(()), action))
}

fn wry_rect(bounds: Rect) -> wry::Rect {
    wry::Rect {
        position: LogicalPosition::new(bounds.x, bounds.y).into(),
        size: LogicalSize::new(
            bounds.width.max(PARKED_SIZE),
            bounds.height.max(PARKED_SIZE),
        )
        .into(),
    }
}

pub fn create_window(app: &App) -> tauri::Result<()> {
    desktop::create_window(app)
}

pub fn open(app: &AppHandle, data_dir: &Path, tab: &TabState) -> CommandResult<()> {
    if separate_browsers() {
        return desktop::open(app, data_dir, tab);
    }
    let window = app.get_window("main").ok_or("main window is gone")?;
    let handle = app.clone();
    let shared_dir: PathBuf = data_dir.join(SHARED_DATA_DIR);
    let id = tab.account.id;
    let url = tab.account.url.clone();
    let init_script = initialization_script(tab.policy);
    on_main_thread(app, "open a tab", move || {
        let webview = CONTEXT.with_borrow_mut(|context| {
            let context = context.get_or_insert_with(|| WebContext::new(Some(shared_dir)));
            WebViewBuilder::new_with_web_context(context)
                .with_url(url)
                .with_initialization_script(init_script)
                .with_profile_name(id.to_string())
                .with_bounds(wry_rect(Rect::new(0.0, 0.0, PARKED_SIZE, PARKED_SIZE)))
                .with_on_page_load_handler(move |event, _| {
                    // A reload restarts the runtime with the initial policy; re-send the current one.
                    if matches!(event, PageLoadEvent::Finished) {
                        let state = handle.state::<AppState>();
                        state.applied.lock().unwrap().remove(&id);
                        let _ = crate::sync(&handle, &state);
                    }
                })
                .build_as_child(&window)
        })?;
        webview.set_memory_usage_level(MemoryUsageLevel::Low)?;
        TABS.with_borrow_mut(|tabs| {
            tabs.insert(
                id,
                GameTab {
                    webview,
                    parked: true,
                },
            )
        });
        Ok(())
    })
}

pub fn place(app: &AppHandle, id: AccountId, bounds: Option<Rect>) -> CommandResult<()> {
    if separate_browsers() {
        return desktop::place(app, id, bounds);
    }
    on_main_thread(app, "place a tab", move || {
        with_tab(id, |tab| {
            let parked = bounds.is_none();
            tab.webview.set_bounds(wry_rect(bounds.unwrap_or(Rect::new(
                0.0,
                0.0,
                PARKED_SIZE,
                PARKED_SIZE,
            ))))?;
            if parked != tab.parked {
                // Lets WebView2 trim caches of tabs nobody looks at.
                let level = if parked {
                    MemoryUsageLevel::Low
                } else {
                    MemoryUsageLevel::Normal
                };
                tab.webview.set_memory_usage_level(level)?;
                tab.parked = parked;
            }
            Ok(())
        })
    })
}

pub fn apply_policy(app: &AppHandle, id: AccountId, policy: RenderPolicy) -> CommandResult<()> {
    if separate_browsers() {
        return desktop::apply_policy(app, id, policy);
    }
    let script = apply_policy_script(policy);
    on_main_thread(app, "apply a policy", move || {
        with_tab(id, |tab| tab.webview.evaluate_script(&script))
    })
}

pub fn reload(app: &AppHandle, id: AccountId) -> CommandResult<()> {
    if separate_browsers() {
        return desktop::reload(app, id);
    }
    on_main_thread(app, "reload a tab", move || {
        with_tab(id, |tab| tab.webview.reload())
    })
}

pub fn close(app: &AppHandle, id: AccountId) -> CommandResult<()> {
    if separate_browsers() {
        return desktop::close(app, id);
    }
    on_main_thread(app, "close a tab", move || {
        // The profile lives inside the shared folder, so its data is cleared here.
        let tab = TABS.with_borrow_mut(|tabs| tabs.remove(&id));
        tab.map_or(Ok(()), |tab| tab.webview.clear_all_browsing_data())
    })
}

pub fn tabs_running(app: &AppHandle, count: usize) -> CommandResult<()> {
    desktop::tabs_running(app, count)
}
