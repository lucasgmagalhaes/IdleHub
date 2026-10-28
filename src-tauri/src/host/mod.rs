//! Where game webviews live: Tauri child webviews on desktop, native views on mobile.
//! Both expose the same functions so the rest of the app is platform independent.

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
pub use desktop::*;
#[cfg(mobile)]
pub use mobile::*;
