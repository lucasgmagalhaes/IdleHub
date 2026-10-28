//! Per-account browser profile locations (cookies, storage, cache).

use std::path::{Path, PathBuf};

use crate::account::AccountId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileLocation {
    /// Directory holding the profile on engines that use a folder (WebView2, WebKitGTK).
    pub data_dir: PathBuf,
    /// Identifier for engines that use named data stores (WKWebView, Android profiles).
    pub store_identifier: [u8; 16],
}

/// Resolves where the profile of `id` lives under the app data directory `base`.
pub fn profile_for(base: &Path, id: AccountId) -> ProfileLocation {
    ProfileLocation {
        data_dir: base.join("profiles").join(id.to_string()),
        store_identifier: *id.as_bytes(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_lives_under_profiles_dir_named_by_account_id() {
        let id = AccountId::new();
        let profile = profile_for(Path::new("/data"), id);
        assert_eq!(
            profile.data_dir,
            Path::new("/data").join("profiles").join(id.to_string())
        );
    }

    #[test]
    fn profile_is_stable_for_the_same_account() {
        let id = AccountId::new();
        assert_eq!(
            profile_for(Path::new("/data"), id),
            profile_for(Path::new("/data"), id)
        );
    }

    #[test]
    fn different_accounts_never_share_a_profile() {
        let (a, b) = (AccountId::new(), AccountId::new());
        let (pa, pb) = (
            profile_for(Path::new("/data"), a),
            profile_for(Path::new("/data"), b),
        );
        assert_ne!(pa.data_dir, pb.data_dir);
        assert_ne!(pa.store_identifier, pb.store_identifier);
    }

    #[test]
    fn store_identifier_survives_serialization_of_the_account_id() {
        let id = AccountId::new();
        let restored: AccountId =
            serde_json::from_str(&serde_json::to_string(&id).unwrap()).unwrap();
        assert_eq!(
            profile_for(Path::new("/x"), id).store_identifier,
            profile_for(Path::new("/x"), restored).store_identifier
        );
    }
}
