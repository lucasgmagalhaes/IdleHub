mod sampler;
mod scripts;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use idlehub_core::account::{Account, AccountId, AccountStore};
use idlehub_core::layout::Rect;
use idlehub_core::metrics::{self, UsageReport};
use idlehub_core::policy::RenderPolicy;
use idlehub_core::profile::profile_for;
use idlehub_core::workspace::{Placement, Workspace};
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::window::WindowBuilder;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, Window, WindowEvent,
};

use sampler::Sampler;
use scripts::{account_id_from_label, apply_policy_script, initialization_script, webview_label};

const MAIN_WINDOW: &str = "main";
const UI_WEBVIEW: &str = "ui";
/// Height of the React toolbar; must match `--toolbar-height` in `src/App.css`.
const TOOLBAR_HEIGHT: f64 = 44.0;
const ACCOUNTS_FILE: &str = "accounts.json";

struct AppState {
    data_dir: PathBuf,
    workspace: Mutex<Workspace>,
    /// Last policy sent to each page, so resizes do not spam `eval`.
    applied: Mutex<HashMap<AccountId, RenderPolicy>>,
    sampler: Mutex<Sampler>,
}

type CommandResult<T> = Result<T, String>;

fn to_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn load_store(data_dir: &Path) -> AccountStore {
    std::fs::read_to_string(data_dir.join(ACCOUNTS_FILE))
        .ok()
        .and_then(|json| AccountStore::from_json(&json).ok())
        .unwrap_or_default()
}

fn save_store(data_dir: &Path, store: &AccountStore) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let tmp = data_dir.join(format!("{ACCOUNTS_FILE}.tmp"));
    std::fs::write(&tmp, store.to_json())?;
    std::fs::rename(tmp, data_dir.join(ACCOUNTS_FILE))
}

fn main_window(app: &AppHandle) -> CommandResult<Window> {
    app.get_window(MAIN_WINDOW)
        .ok_or_else(|| "main window is gone".to_owned())
}

/// Area below the toolbar, in logical pixels.
fn content_area(window: &Window) -> tauri::Result<(Rect, f64)> {
    let scale = window.scale_factor()?;
    let size = window.inner_size()?.to_logical::<f64>(scale);
    let area = Rect::new(
        0.0,
        TOOLBAR_HEIGHT,
        size.width,
        (size.height - TOOLBAR_HEIGHT).max(0.0),
    );
    Ok((area, size.width))
}

fn create_account_webview(
    window: &Window,
    data_dir: &Path,
    account: &Account,
    placement: &Placement,
) -> CommandResult<()> {
    let url = account.url.parse().map_err(to_error)?;
    let profile = profile_for(data_dir, account.id);
    let builder = WebviewBuilder::new(webview_label(account.id), WebviewUrl::External(url))
        .initialization_script(initialization_script(placement.policy))
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .on_page_load(|webview, payload| {
            // A reload restarts the runtime with the initial policy; re-send the current one.
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            if let Some(id) = account_id_from_label(webview.label()) {
                let state = webview.app_handle().state::<AppState>();
                state.applied.lock().unwrap().remove(&id);
                if let Ok(window) = main_window(webview.app_handle()) {
                    let _ = relayout(&window, &state);
                }
            }
        });
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let builder = builder.data_store_identifier(profile.store_identifier);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let builder = builder.data_directory(profile.data_dir);

    let bounds = placement.bounds;
    window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(to_error)?;
    Ok(())
}

/// Moves every webview to its slot and pushes changed policies to the pages.
fn relayout(window: &Window, state: &AppState) -> tauri::Result<()> {
    let (area, width) = content_area(window)?;
    let app = window.app_handle();
    if let Some(ui) = app.get_webview(UI_WEBVIEW) {
        ui.set_position(LogicalPosition::new(0.0, 0.0))?;
        ui.set_size(LogicalSize::new(width, TOOLBAR_HEIGHT))?;
    }
    let placements = state.workspace.lock().unwrap().placements(area);
    let mut applied = state.applied.lock().unwrap();
    for placement in placements {
        let Some(webview) = app.get_webview(&webview_label(placement.account)) else {
            continue;
        };
        let bounds = placement.bounds;
        webview.set_position(LogicalPosition::new(bounds.x, bounds.y))?;
        webview.set_size(LogicalSize::new(bounds.width, bounds.height))?;
        if applied.get(&placement.account) != Some(&placement.policy) {
            webview.eval(apply_policy_script(placement.policy))?;
            applied.insert(placement.account, placement.policy);
        }
    }
    Ok(())
}

#[tauri::command]
async fn list_accounts(state: State<'_, AppState>) -> CommandResult<Vec<Account>> {
    Ok(state.workspace.lock().unwrap().store().accounts().to_vec())
}

#[tauri::command]
async fn add_account(
    app: AppHandle,
    state: State<'_, AppState>,
    label: String,
    url: Option<String>,
) -> CommandResult<Account> {
    let window = main_window(&app)?;
    let (area, _) = content_area(&window).map_err(to_error)?;
    let (account, placement) = {
        let mut workspace = state.workspace.lock().unwrap();
        let account = workspace.add(&label, url.as_deref()).map_err(to_error)?;
        save_store(&state.data_dir, workspace.store()).map_err(to_error)?;
        let placement = workspace
            .placement_of(account.id, area)
            .expect("account was just added");
        (account, placement)
    };
    create_account_webview(&window, &state.data_dir, &account, &placement)?;
    state
        .applied
        .lock()
        .unwrap()
        .insert(account.id, placement.policy);
    relayout(&window, &state).map_err(to_error)?;
    Ok(account)
}

#[tauri::command]
async fn remove_account(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    let id: AccountId = id.parse().map_err(to_error)?;
    {
        let mut workspace = state.workspace.lock().unwrap();
        workspace.remove(id).map_err(to_error)?;
        save_store(&state.data_dir, workspace.store()).map_err(to_error)?;
    }
    state.applied.lock().unwrap().remove(&id);
    if let Some(webview) = app.get_webview(&webview_label(id)) {
        webview.close().map_err(to_error)?;
    }
    // The browser may still hold the profile for a moment after closing.
    let profile_dir = profile_for(&state.data_dir, id).data_dir;
    std::thread::spawn(move || {
        for _ in 0..10 {
            if !profile_dir.exists() || std::fs::remove_dir_all(&profile_dir).is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
    relayout(&main_window(&app)?, &state).map_err(to_error)
}

#[tauri::command]
async fn focus_account(
    app: AppHandle,
    state: State<'_, AppState>,
    id: Option<String>,
) -> CommandResult<()> {
    let id = id
        .map(|id| id.parse::<AccountId>())
        .transpose()
        .map_err(to_error)?;
    state
        .workspace
        .lock()
        .unwrap()
        .focus(id)
        .map_err(to_error)?;
    let window = main_window(&app)?;
    relayout(&window, &state).map_err(to_error)?;
    if let Some(webview) = id.and_then(|id| app.get_webview(&webview_label(id))) {
        webview.set_focus().map_err(to_error)?;
    }
    Ok(())
}

#[tauri::command]
async fn reload_account(app: AppHandle, id: String) -> CommandResult<()> {
    let id: AccountId = id.parse().map_err(to_error)?;
    let webview = app
        .get_webview(&webview_label(id))
        .ok_or("account not found")?;
    webview.reload().map_err(to_error)
}

#[tauri::command]
async fn usage_report(state: State<'_, AppState>) -> CommandResult<UsageReport> {
    let snapshot = state.sampler.lock().unwrap().snapshot();
    let profiles: Vec<_> = state
        .workspace
        .lock()
        .unwrap()
        .store()
        .accounts()
        .iter()
        .map(|a| (a.id, profile_for(&state.data_dir, a.id).data_dir))
        .collect();
    Ok(metrics::usage_report(
        &snapshot,
        std::process::id(),
        &profiles,
    ))
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    let workspace = Workspace::new(load_store(&data_dir));
    app.manage(AppState {
        data_dir: data_dir.clone(),
        workspace: Mutex::new(workspace),
        applied: Mutex::new(HashMap::new()),
        sampler: Mutex::new(Sampler::new()),
    });

    let window = WindowBuilder::new(app, MAIN_WINDOW)
        .title("IdleHub")
        .inner_size(1280.0, 844.0)
        .min_inner_size(640.0, 480.0)
        .build()?;
    let (area, width) = content_area(&window)?;
    window.add_child(
        WebviewBuilder::new(UI_WEBVIEW, WebviewUrl::App("index.html".into())),
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(width, TOOLBAR_HEIGHT),
    )?;

    let state = app.state::<AppState>();
    let (accounts, placements) = {
        let workspace = state.workspace.lock().unwrap();
        (
            workspace.store().accounts().to_vec(),
            workspace.placements(area),
        )
    };
    for (account, placement) in accounts.iter().zip(&placements) {
        create_account_webview(&window, &data_dir, account, placement)?;
        state
            .applied
            .lock()
            .unwrap()
            .insert(account.id, placement.policy);
    }

    let handle = app.handle().clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
        ) {
            if let Ok(window) = main_window(&handle) {
                let _ = relayout(&window, &handle.state::<AppState>());
            }
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(setup)
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            add_account,
            remove_account,
            focus_account,
            reload_account,
            usage_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running IdleHub");
}
