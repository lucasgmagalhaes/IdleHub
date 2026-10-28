//! Decides how much each account may render, based on what the user is looking at.

use serde::{Deserialize, Serialize};

use crate::layout::ViewMode;

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
#[serde(rename_all = "camelCase")]
pub struct PolicySettings {
    /// Frame cap of the focused account.
    pub focused_fps: u32,
    /// Frame cap of every account while the grid is shown.
    pub grid_fps: u32,
    /// Frame cap of the accounts in the side rail while another one is focused.
    pub background_fps: u32,
}

impl Default for PolicySettings {
    fn default() -> Self {
        Self {
            focused_fps: 60,
            grid_fps: 20,
            background_fps: 5,
        }
    }
}

/// Returns one policy per account, in account order.
///
/// Only the focused account plays audio; in grid mode every account is muted.
pub fn policies(count: usize, mode: ViewMode, settings: PolicySettings) -> Vec<RenderPolicy> {
    let focused = match mode {
        ViewMode::Focused(index) if index < count => Some(index),
        _ => None,
    };
    (0..count)
        .map(|i| match focused {
            Some(f) if f == i => RenderPolicy {
                max_fps: clamp_fps(settings.focused_fps),
                muted: false,
            },
            Some(_) => RenderPolicy {
                max_fps: clamp_fps(settings.background_fps),
                muted: true,
            },
            None => RenderPolicy {
                max_fps: clamp_fps(settings.grid_fps),
                muted: true,
            },
        })
        .collect()
}

fn clamp_fps(fps: u32) -> u32 {
    fps.clamp(MIN_FPS, MAX_FPS)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SETTINGS: PolicySettings = PolicySettings {
        focused_fps: 60,
        grid_fps: 20,
        background_fps: 5,
    };

    #[test]
    fn grid_mode_caps_everyone_at_grid_fps_and_mutes_all() {
        assert_eq!(
            policies(4, ViewMode::Grid, SETTINGS),
            vec![
                RenderPolicy {
                    max_fps: 20,
                    muted: true
                };
                4
            ]
        );
    }

    #[test]
    fn focused_account_renders_fast_with_audio_and_others_throttle() {
        let result = policies(3, ViewMode::Focused(2), SETTINGS);
        assert_eq!(
            result,
            vec![
                RenderPolicy {
                    max_fps: 5,
                    muted: true
                },
                RenderPolicy {
                    max_fps: 5,
                    muted: true
                },
                RenderPolicy {
                    max_fps: 60,
                    muted: false
                },
            ]
        );
    }

    #[test]
    fn unknown_focus_behaves_like_grid() {
        assert_eq!(
            policies(2, ViewMode::Focused(7), SETTINGS),
            policies(2, ViewMode::Grid, SETTINGS)
        );
    }

    #[test]
    fn fps_is_clamped_to_supported_range() {
        let settings = PolicySettings {
            focused_fps: 1000,
            grid_fps: 0,
            background_fps: 0,
        };
        assert_eq!(policies(1, ViewMode::Grid, settings)[0].max_fps, MIN_FPS);
        let focused = policies(2, ViewMode::Focused(0), settings);
        assert_eq!(focused[0].max_fps, MAX_FPS);
        assert_eq!(focused[1].max_fps, MIN_FPS);
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
