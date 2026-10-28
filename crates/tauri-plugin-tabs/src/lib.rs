//! Native game webviews for IdleHub on mobile.
//!
//! Tauri cannot host several webviews in one window on Android or iOS, so this
//! plugin creates them natively (one isolated browser profile per account) and
//! lays them over the app's UI webview. On desktop it does nothing: the app uses
//! Tauri's own child webviews there.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

mod error;
#[cfg(mobile)]
mod mobile;
mod models;

pub use error::{Error, Result};
#[cfg(mobile)]
pub use mobile::Tabs;
pub use models::*;

/// Access to the native tabs from any Tauri manager (app, handle, window).
#[cfg(mobile)]
pub trait TabsExt<R: Runtime> {
    fn tabs(&self) -> &Tabs<R>;
}

#[cfg(mobile)]
impl<R: Runtime, T: tauri::Manager<R>> TabsExt<R> for T {
    fn tabs(&self) -> &Tabs<R> {
        self.state::<Tabs<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("tabs")
        .setup(|_app, _api| {
            #[cfg(mobile)]
            {
                use tauri::Manager;
                let tabs = mobile::init(_app, _api)?;
                _app.manage(tabs);
            }
            Ok(())
        })
        .build()
}
