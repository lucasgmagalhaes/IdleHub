//! Payloads sent to the native side. Field names must match the Kotlin / Swift
//! argument classes (`TabsPlugin.kt`, `TabsPlugin.swift`).

use serde::Serialize;

/// Rectangle in CSS pixels of the app's UI webview.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTab {
    pub id: String,
    pub url: String,
    /// Browser profile name; one per account keeps sessions isolated.
    pub profile: String,
    /// Runs before any page script on every navigation.
    pub init_script: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceTab {
    pub id: String,
    /// `None` parks the webview at 1×1 px so it keeps running unseen.
    pub bounds: Option<Bounds>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPolicy {
    pub id: String,
    /// Re-run by the native side after every page load.
    pub script: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabRef {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepAlive {
    /// Zero stops background execution.
    pub active_tabs: u32,
    pub title: String,
    pub text: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn open_tab_uses_the_native_field_names() {
        let open = OpenTab {
            id: "a".into(),
            url: "https://x.y".into(),
            profile: "p".into(),
            init_script: "s".into(),
        };
        assert_eq!(
            serde_json::to_value(open).unwrap(),
            json!({"id": "a", "url": "https://x.y", "profile": "p", "initScript": "s"})
        );
    }

    #[test]
    fn place_tab_sends_bounds_or_null_to_park() {
        let shown = PlaceTab {
            id: "a".into(),
            bounds: Some(Bounds {
                x: 1.0,
                y: 2.0,
                width: 3.0,
                height: 4.0,
            }),
        };
        assert_eq!(
            serde_json::to_value(shown).unwrap(),
            json!({"id": "a", "bounds": {"x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0}})
        );
        let parked = PlaceTab {
            id: "a".into(),
            bounds: None,
        };
        assert_eq!(
            serde_json::to_value(parked).unwrap(),
            json!({"id": "a", "bounds": null})
        );
    }

    #[test]
    fn keep_alive_uses_the_native_field_names() {
        let keep = KeepAlive {
            active_tabs: 2,
            title: "t".into(),
            text: "x".into(),
        };
        assert_eq!(
            serde_json::to_value(keep).unwrap(),
            json!({"activeTabs": 2, "title": "t", "text": "x"})
        );
    }
}
