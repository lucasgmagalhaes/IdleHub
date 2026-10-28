//! Desktop: game webviews are Tauri child webviews of the main window.

use std::path::Path;

use idlehub_core::account::AccountId;
use idlehub_core::layout::Rect;
use idlehub_core::policy::RenderPolicy;
use idlehub_core::profile::profile_for;
use idlehub_core::workspace::TabState;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::window::WindowBuilder;
use tauri::{App, AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, Window};

use crate::scripts::{
    account_id_from_label, apply_policy_script, initialization_script, webview_label,
};
use crate::{to_error, AppState, CommandResult};

const MAIN_WINDOW: &str = "main";
const UI_WEBVIEW: &str = "ui";
/// Tabs without a pane are shrunk to this size instead of hidden: hiding a
/// webview makes WebView2 / WebKit throttle its timers, which would stall the game.
const PARKED_SIZE: f64 = 1.0;

fn main_window(app: &AppHandle) -> CommandResult<Window> {
    app.get_window(MAIN_WINDOW)
        .ok_or_else(|| "main window is gone".to_owned())
}

pub fn create_window(app: &App) -> tauri::Result<()> {
    let builder = WindowBuilder::new(app, MAIN_WINDOW)
        .title("IdleHub")
        .inner_size(1440.0, 900.0)
        .min_inner_size(800.0, 560.0);
    // The UI draws its own title bar; macOS keeps the native traffic lights over it.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);
    let window = builder.build()?;

    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    // Created first so the game webviews stack above it.
    window.add_child(
        WebviewBuilder::new(UI_WEBVIEW, WebviewUrl::App("index.html".into())).auto_resize(),
        LogicalPosition::new(0.0, 0.0),
        size,
    )?;
    Ok(())
}

pub fn open(app: &AppHandle, data_dir: &Path, tab: &TabState) -> CommandResult<()> {
    let url = tab.account.url.parse().map_err(to_error)?;
    let profile = profile_for(data_dir, tab.account.id);
    let builder = WebviewBuilder::new(webview_label(tab.account.id), WebviewUrl::External(url))
        .initialization_script(initialization_script(tab.policy))
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .on_page_load(|webview, payload| {
            // A reload restarts the runtime with the initial policy; re-send the current one.
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            if let Some(id) = account_id_from_label(webview.label()) {
                let state = webview.app_handle().state::<AppState>();
                state.applied.lock().unwrap().remove(&id);
                let _ = crate::sync(webview.app_handle(), &state);
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(profile.store_identifier);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(profile.data_dir);

    main_window(app)?
        .add_child(
            builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(PARKED_SIZE, PARKED_SIZE),
        )
        .map_err(to_error)?;
    Ok(())
}

pub fn place(app: &AppHandle, id: AccountId, bounds: Option<Rect>) -> CommandResult<()> {
    let Some(webview) = app.get_webview(&webview_label(id)) else {
        return Ok(());
    };
    let bounds = bounds.unwrap_or(Rect::new(0.0, 0.0, PARKED_SIZE, PARKED_SIZE));
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(to_error)?;
    webview
        .set_size(LogicalSize::new(
            bounds.width.max(PARKED_SIZE),
            bounds.height.max(PARKED_SIZE),
        ))
        .map_err(to_error)
}

pub fn apply_policy(app: &AppHandle, id: AccountId, policy: RenderPolicy) -> CommandResult<()> {
    match app.get_webview(&webview_label(id)) {
        Some(webview) => webview.eval(apply_policy_script(policy)).map_err(to_error),
        None => Ok(()),
    }
}

pub fn reload(app: &AppHandle, id: AccountId) -> CommandResult<()> {
    let webview = app.get_webview(&webview_label(id)).ok_or("tab not found")?;
    webview.reload().map_err(to_error)
}

/// Closes a tab the user removed and erases its cookies and storage. The data
/// folder is deleted afterwards by the caller, but macOS keeps profiles in a
/// named data store that only the webview can clear.
pub fn close(app: &AppHandle, id: AccountId) -> CommandResult<()> {
    let Some(webview) = app.get_webview(&webview_label(id)) else {
        return Ok(());
    };
    // Queued before the close, so it runs while the webview still exists.
    if let Err(error) = webview.clear_all_browsing_data() {
        eprintln!("idlehub: failed to clear the data of a closed tab: {error}");
    }
    webview.close().map_err(to_error)
}

/// Desktop processes are never suspended by the OS, so nothing to do.
pub fn tabs_running(_app: &AppHandle, _count: usize) -> CommandResult<()> {
    Ok(())
}
