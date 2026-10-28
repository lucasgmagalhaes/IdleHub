//! JavaScript snippets sent to the game webviews.

#[cfg(any(desktop, test))]
use idlehub_core::account::AccountId;
use idlehub_core::policy::RenderPolicy;

/// The bundled page runtime (see `inject/`), built by `pnpm build:inject`.
pub const RUNTIME: &str = include_str!("../../dist-inject/inject.js");

// Labels name Tauri child webviews, which only exist on desktop.
#[cfg(any(desktop, test))]
const LABEL_PREFIX: &str = "account-";

#[cfg(any(desktop, test))]
pub fn webview_label(id: AccountId) -> String {
    format!("{LABEL_PREFIX}{id}")
}

#[cfg(any(desktop, test))]
pub fn account_id_from_label(label: &str) -> Option<AccountId> {
    label.strip_prefix(LABEL_PREFIX)?.parse().ok()
}

/// Script that runs before any page script: seeds the policy, then installs the runtime.
pub fn initialization_script(policy: RenderPolicy) -> String {
    format!(
        "window.__IDLEHUB_POLICY__={};\n{RUNTIME}",
        policy_json(policy)
    )
}

/// Script that updates the policy of an already running page.
pub fn apply_policy_script(policy: RenderPolicy) -> String {
    format!(
        "window.__idlehub&&window.__idlehub.apply({});",
        policy_json(policy)
    )
}

fn policy_json(policy: RenderPolicy) -> String {
    serde_json::to_string(&policy).expect("policy is always serializable")
}

#[cfg(test)]
mod tests {
    use super::*;

    const POLICY: RenderPolicy = RenderPolicy {
        max_fps: 5,
        muted: true,
    };

    #[test]
    fn labels_round_trip_to_account_ids() {
        let id = AccountId::new();
        let label = webview_label(id);
        assert!(label.starts_with("account-"));
        assert_eq!(account_id_from_label(&label), Some(id));
    }

    #[test]
    fn other_labels_are_not_accounts() {
        assert_eq!(account_id_from_label("ui"), None);
        assert_eq!(account_id_from_label("account-garbage"), None);
    }

    #[test]
    fn labels_only_use_characters_tauri_accepts() {
        let label = webview_label(AccountId::new());
        assert!(label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-/:_".contains(c)));
    }

    #[test]
    fn initialization_script_seeds_policy_before_the_runtime() {
        let script = initialization_script(POLICY);
        let seed = script
            .find(r#"window.__IDLEHUB_POLICY__={"maxFps":5,"muted":true};"#)
            .unwrap();
        let runtime = script.find(RUNTIME).unwrap();
        assert!(seed < runtime);
    }

    #[test]
    fn apply_script_is_safe_when_the_runtime_is_missing() {
        assert_eq!(
            apply_policy_script(POLICY),
            r#"window.__idlehub&&window.__idlehub.apply({"maxFps":5,"muted":true});"#
        );
    }
}
