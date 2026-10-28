//! Android / iOS: game webviews are native views owned by `tauri-plugin-tabs`.

use std::path::Path;

use idlehub_core::account::AccountId;
use idlehub_core::layout::Rect;
use idlehub_core::policy::RenderPolicy;
use idlehub_core::workspace::TabState;
use tauri::{App, AppHandle, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_tabs::{ApplyPolicy, Bounds, KeepAlive, OpenTab, PlaceTab, TabRef, TabsExt};

use crate::copy;
use crate::scripts::{apply_policy_script, initialization_script};
use crate::{to_error, CommandResult};

pub fn create_window(app: &App) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into())).build()?;
    Ok(())
}

pub fn open(app: &AppHandle, _data_dir: &Path, tab: &TabState) -> CommandResult<()> {
    app.tabs()
        .open(OpenTab {
            id: tab.account.id.to_string(),
            url: tab.account.url.clone(),
            profile: tab.account.id.to_string(),
            init_script: initialization_script(tab.policy),
        })
        .map_err(to_error)
}

pub fn place(app: &AppHandle, id: AccountId, bounds: Option<Rect>) -> CommandResult<()> {
    let bounds = bounds.map(|r| Bounds {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
    });
    app.tabs()
        .place(PlaceTab {
            id: id.to_string(),
            bounds,
        })
        .map_err(to_error)
}

pub fn apply_policy(app: &AppHandle, id: AccountId, policy: RenderPolicy) -> CommandResult<()> {
    app.tabs()
        .apply_policy(ApplyPolicy {
            id: id.to_string(),
            script: apply_policy_script(policy),
        })
        .map_err(to_error)
}

pub fn reload(app: &AppHandle, id: AccountId) -> CommandResult<()> {
    app.tabs()
        .reload(TabRef { id: id.to_string() })
        .map_err(to_error)
}

pub fn close(app: &AppHandle, id: AccountId) -> CommandResult<()> {
    app.tabs()
        .close(TabRef { id: id.to_string() })
        .map_err(to_error)
}

/// Mobile systems suspend background apps; keep the games alive while tabs run.
pub fn tabs_running(app: &AppHandle, count: usize) -> CommandResult<()> {
    app.tabs()
        .keep_alive(KeepAlive {
            active_tabs: count as u32,
            title: "IdleHub".into(),
            text: copy::active_tabs(count),
        })
        .map_err(to_error)
}
