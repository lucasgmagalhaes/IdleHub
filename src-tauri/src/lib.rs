mod sampler;
mod scripts;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use idlehub_core::account::{AccountId, AccountStore};
use idlehub_core::layout::{PaneCount, Rect};
use idlehub_core::metrics::{self, UsageReport};
use idlehub_core::policy::RenderPolicy;
use idlehub_core::profile::profile_for;
use idlehub_core::workspace::{TabState, Workspace};
use serde::Serialize;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::window::WindowBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, Window};

use sampler::Sampler;
use scripts::{account_id_from_label, apply_policy_script, initialization_script, webview_label};

const MAIN_WINDOW: &str = "main";
const UI_WEBVIEW: &str = "ui";
const WORKSPACE_FILE: &str = "workspace.json";
const LEGACY_ACCOUNTS_FILE: &str = "accounts.json";
/// Tabs without a pane are shrunk to this size instead of hidden: hiding a
/// webview makes WebView2 / WebKit throttle its timers, which would stall the game.
const PARKED_SIZE: f64 = 1.0;

struct AppState {
    data_dir: PathBuf,
    workspace: Mutex<Workspace>,
    /// Content area of each pane, reported by the UI in pane order.
    pane_rects: Mutex<Vec<Rect>>,
    /// Last policy sent to each page, so layout changes do not spam `eval`.
    applied: Mutex<HashMap<AccountId, RenderPolicy>>,
    sampler: Mutex<Sampler>,
}

/// Everything the UI renders, returned by every command that changes it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TabsView {
    tabs: Vec<TabState>,
    panes: PaneCount,
}

type CommandResult<T> = Result<T, String>;

fn to_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn load_workspace(data_dir: &Path) -> Workspace {
    let read = |file| std::fs::read_to_string(data_dir.join(file)).ok();
    if let Some(workspace) = read(WORKSPACE_FILE).and_then(|json| Workspace::from_json(&json).ok())
    {
        return workspace;
    }
    let store = read(LEGACY_ACCOUNTS_FILE)
        .and_then(|json| AccountStore::from_json(&json).ok())
        .unwrap_or_default();
    Workspace::new(store)
}

fn save_workspace(data_dir: &Path, workspace: &Workspace) -> CommandResult<()> {
    std::fs::create_dir_all(data_dir).map_err(to_error)?;
    let tmp = data_dir.join(format!("{WORKSPACE_FILE}.tmp"));
    std::fs::write(&tmp, workspace.to_json()).map_err(to_error)?;
    std::fs::rename(tmp, data_dir.join(WORKSPACE_FILE)).map_err(to_error)
}

fn main_window(app: &AppHandle) -> CommandResult<Window> {
    app.get_window(MAIN_WINDOW)
        .ok_or_else(|| "main window is gone".to_owned())
}

fn view(workspace: &Workspace) -> TabsView {
    TabsView {
        tabs: workspace.tabs(),
        panes: workspace.panes(),
    }
}

fn create_tab_webview(window: &Window, data_dir: &Path, tab: &TabState) -> CommandResult<()> {
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
                let _ = sync(webview.app_handle(), &state);
            }
        });
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let builder = builder.data_store_identifier(profile.store_identifier);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let builder = builder.data_directory(profile.data_dir);

    window
        .add_child(
            builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(PARKED_SIZE, PARKED_SIZE),
        )
        .map_err(to_error)?;
    Ok(())
}

/// Moves every tab webview into its pane (or parks it) and pushes changed policies.
fn sync(app: &AppHandle, state: &AppState) -> CommandResult<()> {
    let tabs = state.workspace.lock().unwrap().tabs();
    let rects = state.pane_rects.lock().unwrap().clone();
    let mut applied = state.applied.lock().unwrap();
    for tab in tabs {
        let Some(webview) = app.get_webview(&webview_label(tab.account.id)) else {
            continue;
        };
        let bounds = tab
            .pane
            .and_then(|pane| rects.get(pane).copied())
            .unwrap_or(Rect::new(0.0, 0.0, PARKED_SIZE, PARKED_SIZE));
        webview
            .set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(to_error)?;
        webview
            .set_size(LogicalSize::new(
                bounds.width.max(PARKED_SIZE),
                bounds.height.max(PARKED_SIZE),
            ))
            .map_err(to_error)?;
        if applied.get(&tab.account.id) != Some(&tab.policy) {
            webview
                .eval(apply_policy_script(tab.policy))
                .map_err(to_error)?;
            applied.insert(tab.account.id, tab.policy);
        }
    }
    Ok(())
}

/// Applies `change` to the workspace, persists it, re-syncs the webviews and returns the new view.
fn update(
    app: &AppHandle,
    state: &AppState,
    change: impl FnOnce(&mut Workspace) -> Result<(), String>,
) -> CommandResult<TabsView> {
    let view = {
        let mut workspace = state.workspace.lock().unwrap();
        change(&mut workspace)?;
        save_workspace(&state.data_dir, &workspace)?;
        view(&workspace)
    };
    sync(app, state)?;
    Ok(view)
}

fn parse_id(id: &str) -> CommandResult<AccountId> {
    id.parse().map_err(to_error)
}

#[tauri::command]
async fn get_tabs(state: State<'_, AppState>) -> CommandResult<TabsView> {
    Ok(view(&state.workspace.lock().unwrap()))
}

#[tauri::command]
async fn add_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    label: String,
    url: Option<String>,
) -> CommandResult<TabsView> {
    let tab = {
        let mut workspace = state.workspace.lock().unwrap();
        let account = workspace.add(&label, url.as_deref()).map_err(to_error)?;
        save_workspace(&state.data_dir, &workspace)?;
        workspace
            .tabs()
            .into_iter()
            .find(|t| t.account.id == account.id)
            .expect("tab was just added")
    };
    create_tab_webview(&main_window(&app)?, &state.data_dir, &tab)?;
    state
        .applied
        .lock()
        .unwrap()
        .insert(tab.account.id, tab.policy);
    update(&app, &state, |_| Ok(()))
}

#[tauri::command]
async fn close_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<TabsView> {
    let id = parse_id(&id)?;
    let view = update(&app, &state, |ws| ws.remove(id).map(drop).map_err(to_error))?;
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
    Ok(view)
}

#[tauri::command]
async fn set_panes(
    app: AppHandle,
    state: State<'_, AppState>,
    count: u8,
) -> CommandResult<TabsView> {
    let panes = PaneCount::try_from(count)?;
    update(&app, &state, |ws| {
        ws.set_panes(panes);
        Ok(())
    })
}

#[tauri::command]
async fn show_in_pane(
    app: AppHandle,
    state: State<'_, AppState>,
    pane: usize,
    id: String,
) -> CommandResult<TabsView> {
    let id = parse_id(&id)?;
    update(&app, &state, |ws| {
        ws.show_in_pane(pane, id).map_err(to_error)
    })
}

#[tauri::command]
async fn set_muted(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    muted: bool,
) -> CommandResult<TabsView> {
    let id = parse_id(&id)?;
    update(&app, &state, |ws| ws.set_muted(id, muted).map_err(to_error))
}

#[tauri::command]
async fn set_pinned(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> CommandResult<TabsView> {
    let id = parse_id(&id)?;
    update(&app, &state, |ws| {
        ws.set_pinned(id, pinned).map_err(to_error)
    })
}

#[tauri::command]
async fn reload_tab(app: AppHandle, id: String) -> CommandResult<()> {
    let webview = app
        .get_webview(&webview_label(parse_id(&id)?))
        .ok_or("tab not found")?;
    webview.reload().map_err(to_error)
}

#[tauri::command]
async fn set_pane_rects(
    app: AppHandle,
    state: State<'_, AppState>,
    rects: Vec<Rect>,
) -> CommandResult<()> {
    *state.pane_rects.lock().unwrap() = rects;
    sync(&app, &state)
}

#[tauri::command]
async fn usage_report(state: State<'_, AppState>) -> CommandResult<UsageReport> {
    let (snapshot, system_memory_bytes, cpu_count) = {
        let mut sampler = state.sampler.lock().unwrap();
        (
            sampler.snapshot(),
            sampler.total_memory(),
            sampler.cpu_count(),
        )
    };
    let profiles: Vec<_> = state
        .workspace
        .lock()
        .unwrap()
        .store()
        .accounts()
        .iter()
        .map(|a| (a.id, profile_for(&state.data_dir, a.id).data_dir))
        .collect();
    Ok(UsageReport {
        system_memory_bytes,
        cpu_count,
        ..metrics::usage_report(&snapshot, std::process::id(), &profiles)
    })
}

fn build_main_window(app: &tauri::App) -> tauri::Result<Window> {
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
    builder.build()
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    let workspace = load_workspace(&data_dir);
    let tabs = workspace.tabs();
    app.manage(AppState {
        data_dir: data_dir.clone(),
        workspace: Mutex::new(workspace),
        pane_rects: Mutex::new(Vec::new()),
        applied: Mutex::new(HashMap::new()),
        sampler: Mutex::new(Sampler::new()),
    });

    let window = build_main_window(app)?;
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    // Created first so the game webviews stack above it.
    window.add_child(
        WebviewBuilder::new(UI_WEBVIEW, WebviewUrl::App("index.html".into())).auto_resize(),
        LogicalPosition::new(0.0, 0.0),
        size,
    )?;

    let state = app.state::<AppState>();
    for tab in &tabs {
        create_tab_webview(&window, &data_dir, tab)?;
        state
            .applied
            .lock()
            .unwrap()
            .insert(tab.account.id, tab.policy);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(setup)
        .invoke_handler(tauri::generate_handler![
            get_tabs,
            add_tab,
            close_tab,
            set_panes,
            show_in_pane,
            set_muted,
            set_pinned,
            reload_tab,
            set_pane_rects,
            usage_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running IdleHub");
}
