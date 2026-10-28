//! Where game webviews live: Tauri child webviews on desktop, native views on
//! mobile, and wry webviews sharing one browser process on Windows. All expose
//! the same functions so the rest of the app is platform independent.

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;
#[cfg(windows)]
mod windows;

#[cfg(all(desktop, not(windows)))]
pub use desktop::*;
#[cfg(mobile)]
pub use mobile::*;
#[cfg(windows)]
pub use windows::*;
