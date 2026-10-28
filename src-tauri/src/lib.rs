#[cfg(any(mobile, test))]
mod copy;
mod host;
mod sampler;
mod scripts;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use idlehub_core::account::{AccountId, AccountStore};
use idlehub_core::layout::{PaneCount, Rect};
use idlehub_core::metrics::{self, UsageReport};
use idlehub_core::policy::RenderPolicy;
use idlehub_core::profile::profile_for;
use idlehub_core::workspace::{TabState, Workspace};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use sampler::Sampler;

const WORKSPACE_FILE: &str = "workspace.json";
const LEGACY_ACCOUNTS_FILE: &str = "accounts.json";

struct AppState {
    data_dir: PathBuf,
    workspace: Mutex<Workspace>,
    /// Content area of each pane, reported by the UI in pane order.
    pane_rects: Mutex<Vec<Rect>>,
    /// Tabs whose webview exists. Webviews are created lazily on the first sync,
    /// once the UI is up (the mobile plugin needs the UI webview first).
    opened: Mutex<HashSet<AccountId>>,
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
    let mut workspace = read(WORKSPACE_FILE)
        .and_then(|json| Workspace::from_json(&json).ok())
        .unwrap_or_else(|| {
            let store = read(LEGACY_ACCOUNTS_FILE)
                .and_then(|json| AccountStore::from_json(&json).ok())
                .unwrap_or_default();
            Workspace::new(store)
        });
    // Phones show one tab at a time; the others keep running hidden.
    if cfg!(mobile) {
        workspace.set_panes(PaneCount::new(1).expect("1 is a valid pane count"));
    }
    workspace
}

fn save_workspace(data_dir: &Path, workspace: &Workspace) -> CommandResult<()> {
    std::fs::create_dir_all(data_dir).map_err(to_error)?;
    let tmp = data_dir.join(format!("{WORKSPACE_FILE}.tmp"));
    std::fs::write(&tmp, workspace.to_json()).map_err(to_error)?;
    std::fs::rename(tmp, data_dir.join(WORKSPACE_FILE)).map_err(to_error)
}

fn view(workspace: &Workspace) -> TabsView {
    TabsView {
        tabs: workspace.tabs(),
        panes: workspace.panes(),
    }
}

/// Creates missing webviews, moves every tab into its pane (or parks it) and
/// pushes changed policies to the pages.
fn sync(app: &AppHandle, state: &AppState) -> CommandResult<()> {
    let tabs = state.workspace.lock().unwrap().tabs();
    let rects = state.pane_rects.lock().unwrap().clone();
    let mut opened = state.opened.lock().unwrap();
    let mut applied = state.applied.lock().unwrap();
    let newly_opened = tabs.iter().any(|tab| !opened.contains(&tab.account.id));
    for tab in &tabs {
        let id = tab.account.id;
        if opened.insert(id) {
            host::open(app, &state.data_dir, tab)?;
            // The initialization script already carries the current policy.
            applied.insert(id, tab.policy);
        }
        host::place(app, id, tab.pane.and_then(|pane| rects.get(pane).copied()))?;
        if applied.get(&id) != Some(&tab.policy) {
            host::apply_policy(app, id, tab.policy)?;
            applied.insert(id, tab.policy);
        }
    }
    if newly_opened {
        host::tabs_running(app, tabs.len())?;
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
    update(&app, &state, |ws| {
        ws.add(&label, url.as_deref()).map(drop).map_err(to_error)
    })
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
    if state.opened.lock().unwrap().remove(&id) {
        host::close(&app, id)?;
    }
    host::tabs_running(&app, view.tabs.len())?;
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
    host::reload(&app, parse_id(&id)?)
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

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    app.manage(AppState {
        workspace: Mutex::new(load_workspace(&data_dir)),
        data_dir,
        pane_rects: Mutex::new(Vec::new()),
        opened: Mutex::new(HashSet::new()),
        applied: Mutex::new(HashMap::new()),
        sampler: Mutex::new(Sampler::new()),
    });
    host::create_window(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_tabs::init());
    builder
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
