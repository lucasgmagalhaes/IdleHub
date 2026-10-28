use serde::de::{DeserializeOwned, IgnoredAny};
use serde::Serialize;
use tauri::plugin::{PluginApi, PluginHandle};
use tauri::{AppHandle, Runtime};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_tabs);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Tabs<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.lucasgmagalhaes.idlehub.tabs", "TabsPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_tabs)?;
    Ok(Tabs(handle))
}

/// Native game webviews, layered over the app's UI webview.
pub struct Tabs<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Tabs<R> {
    fn call(&self, command: &str, payload: impl Serialize) -> crate::Result<()> {
        self.0.run_mobile_plugin::<IgnoredAny>(command, payload)?;
        Ok(())
    }

    pub fn open(&self, tab: OpenTab) -> crate::Result<()> {
        self.call("open", tab)
    }

    pub fn place(&self, place: PlaceTab) -> crate::Result<()> {
        self.call("place", place)
    }

    pub fn apply_policy(&self, policy: ApplyPolicy) -> crate::Result<()> {
        self.call("applyPolicy", policy)
    }

    pub fn reload(&self, tab: TabRef) -> crate::Result<()> {
        self.call("reload", tab)
    }

    pub fn close(&self, tab: TabRef) -> crate::Result<()> {
        self.call("close", tab)
    }

    pub fn keep_alive(&self, keep_alive: KeepAlive) -> crate::Result<()> {
        self.call("keepAlive", keep_alive)
    }
}
