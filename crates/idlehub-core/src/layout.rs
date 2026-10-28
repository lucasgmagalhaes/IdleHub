//! How many panes the window is split into, and the geometry types shared with the UI.
//!
//! The UI owns the visual arrangement (CSS grid) and reports where each pane's
//! content area ended up; the app shell then moves the native webviews there.

use serde::{Deserialize, Serialize};

/// Axis-aligned rectangle in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

/// Number of panes shown at once (the 1–4 layout buttons).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct PaneCount(u8);

impl PaneCount {
    pub const MAX: u8 = 4;

    pub fn new(count: u8) -> Option<Self> {
        (1..=Self::MAX).contains(&count).then_some(Self(count))
    }

    pub fn get(self) -> usize {
        self.0 as usize
    }
}

impl Default for PaneCount {
    fn default() -> Self {
        Self(Self::MAX)
    }
}

impl TryFrom<u8> for PaneCount {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Self::new(value).ok_or_else(|| format!("pane count must be between 1 and {}", Self::MAX))
    }
}

impl From<PaneCount> for u8 {
    fn from(value: PaneCount) -> Self {
        value.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_one_to_four_panes() {
        for n in 1..=4 {
            assert_eq!(PaneCount::new(n).unwrap().get(), n as usize);
        }
    }

    #[test]
    fn rejects_zero_and_more_than_four() {
        assert_eq!(PaneCount::new(0), None);
        assert_eq!(PaneCount::new(5), None);
    }

    #[test]
    fn defaults_to_four_panes() {
        assert_eq!(PaneCount::default().get(), 4);
    }

    #[test]
    fn serializes_as_a_plain_number_and_validates_on_read() {
        assert_eq!(
            serde_json::to_string(&PaneCount::new(2).unwrap()).unwrap(),
            "2"
        );
        assert_eq!(serde_json::from_str::<PaneCount>("3").unwrap().get(), 3);
        assert!(serde_json::from_str::<PaneCount>("9").is_err());
    }

    #[test]
    fn rect_deserializes_from_the_ui_shape() {
        let rect: Rect = serde_json::from_str(r#"{"x":1,"y":2,"width":3,"height":4}"#).unwrap();
        assert_eq!(rect, Rect::new(1.0, 2.0, 3.0, 4.0));
    }
}
