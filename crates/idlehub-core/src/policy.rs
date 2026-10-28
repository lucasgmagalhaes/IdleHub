//! Decides how much each tab may render and whether it may play audio.

use serde::{Deserialize, Serialize};

use crate::layout::PaneCount;

pub const MIN_FPS: u32 = 1;
pub const MAX_FPS: u32 = 120;

/// What the injected script enforces inside one game page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPolicy {
    pub max_fps: u32,
    pub muted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PolicySettings {
    /// Frame cap when a single pane fills the window.
    pub single_pane_fps: u32,
    /// Frame cap of each visible tab when the window is split.
    pub multi_pane_fps: u32,
    /// Frame cap of tabs that are running but not shown in any pane.
    pub hidden_fps: u32,
}

impl Default for PolicySettings {
    fn default() -> Self {
        Self {
            single_pane_fps: 60,
            multi_pane_fps: 30,
            hidden_fps: 1,
        }
    }
}

impl PolicySettings {
    pub fn clamped(self) -> Self {
        Self {
            single_pane_fps: clamp_fps(self.single_pane_fps),
            multi_pane_fps: clamp_fps(self.multi_pane_fps),
            hidden_fps: clamp_fps(self.hidden_fps),
        }
    }
}

/// Policy of one tab. `user_muted` is the tab's speaker toggle; hidden tabs are always muted.
pub fn tab_policy(
    visible: bool,
    panes: PaneCount,
    user_muted: bool,
    settings: PolicySettings,
) -> RenderPolicy {
    if !visible {
        return RenderPolicy {
            max_fps: clamp_fps(settings.hidden_fps),
            muted: true,
        };
    }
    let fps = if panes.get() == 1 {
        settings.single_pane_fps
    } else {
        settings.multi_pane_fps
    };
    RenderPolicy {
        max_fps: clamp_fps(fps),
        muted: user_muted,
    }
}

fn clamp_fps(fps: u32) -> u32 {
    fps.clamp(MIN_FPS, MAX_FPS)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SETTINGS: PolicySettings = PolicySettings {
        single_pane_fps: 60,
        multi_pane_fps: 30,
        hidden_fps: 5,
    };

    fn panes(n: u8) -> PaneCount {
        PaneCount::new(n).unwrap()
    }

    #[test]
    fn defaults_render_hidden_tabs_at_one_frame_per_second() {
        // Nobody sees them; 1 fps keeps rAF-driven game loops alive at ~1% CPU per
        // tab, versus ~3.5% at 5 fps (bench/sweep.bench.mjs).
        let defaults = PolicySettings::default();
        assert_eq!(defaults.hidden_fps, 1);
        assert_eq!(
            (defaults.single_pane_fps, defaults.multi_pane_fps),
            (60, 30)
        );
    }

    #[test]
    fn single_visible_pane_renders_at_full_rate() {
        assert_eq!(
            tab_policy(true, panes(1), false, SETTINGS),
            RenderPolicy {
                max_fps: 60,
                muted: false
            }
        );
    }

    #[test]
    fn split_panes_render_at_the_multi_pane_rate() {
        for n in 2..=4 {
            assert_eq!(tab_policy(true, panes(n), false, SETTINGS).max_fps, 30);
        }
    }

    #[test]
    fn visible_tabs_follow_the_user_mute_toggle() {
        assert!(tab_policy(true, panes(4), true, SETTINGS).muted);
        assert!(!tab_policy(true, panes(4), false, SETTINGS).muted);
    }

    #[test]
    fn hidden_tabs_keep_running_slowly_and_silently() {
        assert_eq!(
            tab_policy(false, panes(1), false, SETTINGS),
            RenderPolicy {
                max_fps: 5,
                muted: true
            }
        );
    }

    #[test]
    fn fps_is_clamped_to_supported_range() {
        let settings = PolicySettings {
            single_pane_fps: 1000,
            multi_pane_fps: 0,
            hidden_fps: 0,
        };
        assert_eq!(tab_policy(true, panes(1), false, settings).max_fps, MAX_FPS);
        assert_eq!(tab_policy(true, panes(2), false, settings).max_fps, MIN_FPS);
        assert_eq!(
            tab_policy(false, panes(2), false, settings).max_fps,
            MIN_FPS
        );
    }

    #[test]
    fn policy_serializes_in_camel_case_for_the_injected_script() {
        let json = serde_json::to_string(&RenderPolicy {
            max_fps: 5,
            muted: true,
        })
        .unwrap();
        assert_eq!(json, r#"{"maxFps":5,"muted":true}"#);
    }
}
