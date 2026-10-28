//! Accounts and the store that owns them.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const DEFAULT_GAME_URL: &str = "https://huntera.com.br";
pub const DEFAULT_MAX_ACCOUNTS: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AccountId(Uuid);

impl AccountId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_bytes(&self) -> &[u8; 16] {
        self.0.as_bytes()
    }
}

impl Default for AccountId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for AccountId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl std::str::FromStr for AccountId {
    type Err = AccountError;

    /// Unknown or malformed ids are reported as a missing account.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Uuid::parse_str(s)
            .map(Self)
            .map_err(|_| AccountError::NotFound)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    pub id: AccountId,
    pub label: String,
    pub url: String,
    /// Speaker toggle of the tab. New tabs start muted so several games never play at once.
    #[serde(default = "default_muted")]
    pub muted: bool,
    /// Pinned tabs cannot be closed or moved out of their pane.
    #[serde(default)]
    pub pinned: bool,
}

fn default_muted() -> bool {
    true
}

/// An http(s) address with a host, which every platform's webview can load.
fn is_web_url(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|parsed| {
        matches!(parsed.scheme(), "http" | "https")
            && parsed.host_str().is_some_and(|h| !h.is_empty())
    })
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AccountError {
    #[error("account limit of {0} reached")]
    LimitReached(usize),
    #[error("label must not be empty")]
    EmptyLabel,
    #[error("label \"{0}\" is already used")]
    DuplicateLabel(String),
    #[error("url must start with http:// or https://")]
    InvalidUrl,
    #[error("account not found")]
    NotFound,
    #[error("pinned tabs must be unpinned first")]
    Pinned,
    #[error("pane {0} does not exist in the current layout")]
    InvalidPane(usize),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "StoredAccounts")]
pub struct AccountStore {
    max_accounts: usize,
    accounts: Vec<Account>,
}

/// The store as found on disk, before the rules `add` enforces are checked.
#[derive(Deserialize)]
struct StoredAccounts {
    max_accounts: usize,
    accounts: Vec<Account>,
}

impl From<StoredAccounts> for AccountStore {
    /// Files edited by hand or written by older versions may break the store's
    /// rules. Accounts that do are dropped rather than failing the whole file.
    fn from(stored: StoredAccounts) -> Self {
        let max_accounts = match stored.max_accounts {
            0 => DEFAULT_MAX_ACCOUNTS,
            n => n,
        };
        let mut store = Self::new(max_accounts);
        for account in stored.accounts {
            let fits = store.accounts.len() < max_accounts;
            if fits && store.get(account.id).is_none() && is_web_url(&account.url) {
                store.accounts.push(account);
            }
        }
        store
    }
}

impl Default for AccountStore {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_ACCOUNTS)
    }
}

impl AccountStore {
    pub fn new(max_accounts: usize) -> Self {
        Self {
            max_accounts,
            accounts: Vec::new(),
        }
    }

    pub fn accounts(&self) -> &[Account] {
        &self.accounts
    }

    pub fn get(&self, id: AccountId) -> Option<&Account> {
        self.accounts.iter().find(|a| a.id == id)
    }

    pub fn index_of(&self, id: AccountId) -> Option<usize> {
        self.accounts.iter().position(|a| a.id == id)
    }

    pub fn add(&mut self, label: &str, url: Option<&str>) -> Result<&Account, AccountError> {
        if self.accounts.len() >= self.max_accounts {
            return Err(AccountError::LimitReached(self.max_accounts));
        }
        let label = self.validate_label(label, None)?;
        let url = url.unwrap_or(DEFAULT_GAME_URL).trim();
        if !is_web_url(url) {
            return Err(AccountError::InvalidUrl);
        }
        self.accounts.push(Account {
            id: AccountId::new(),
            label,
            url: url.to_owned(),
            muted: true,
            pinned: false,
        });
        Ok(self.accounts.last().expect("just pushed"))
    }

    pub fn rename(&mut self, id: AccountId, label: &str) -> Result<(), AccountError> {
        let index = self.index_of(id).ok_or(AccountError::NotFound)?;
        let label = self.validate_label(label, Some(id))?;
        self.accounts[index].label = label;
        Ok(())
    }

    pub fn remove(&mut self, id: AccountId) -> Result<Account, AccountError> {
        let index = self.index_of(id).ok_or(AccountError::NotFound)?;
        if self.accounts[index].pinned {
            return Err(AccountError::Pinned);
        }
        Ok(self.accounts.remove(index))
    }

    pub fn set_muted(&mut self, id: AccountId, muted: bool) -> Result<(), AccountError> {
        self.get_mut(id)?.muted = muted;
        Ok(())
    }

    pub fn set_pinned(&mut self, id: AccountId, pinned: bool) -> Result<(), AccountError> {
        self.get_mut(id)?.pinned = pinned;
        Ok(())
    }

    /// Swaps the positions of two accounts. Positions decide which pane shows a tab.
    pub fn swap(&mut self, a: AccountId, b: AccountId) -> Result<(), AccountError> {
        let a = self.index_of(a).ok_or(AccountError::NotFound)?;
        let b = self.index_of(b).ok_or(AccountError::NotFound)?;
        self.accounts.swap(a, b);
        Ok(())
    }

    fn get_mut(&mut self, id: AccountId) -> Result<&mut Account, AccountError> {
        self.accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or(AccountError::NotFound)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("store is always serializable")
    }

    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    fn validate_label(
        &self,
        label: &str,
        except: Option<AccountId>,
    ) -> Result<String, AccountError> {
        let label = label.trim();
        if label.is_empty() {
            return Err(AccountError::EmptyLabel);
        }
        let taken = self
            .accounts
            .iter()
            .any(|a| Some(a.id) != except && a.label.to_lowercase() == label.to_lowercase());
        if taken {
            return Err(AccountError::DuplicateLabel(label.to_owned()));
        }
        Ok(label.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_id_parses_from_its_display_form() {
        let id = AccountId::new();
        assert_eq!(id.to_string().parse::<AccountId>(), Ok(id));
        assert_eq!("nope".parse::<AccountId>(), Err(AccountError::NotFound));
    }

    #[test]
    fn new_store_is_empty() {
        assert!(AccountStore::default().accounts().is_empty());
    }

    #[test]
    fn add_uses_huntera_by_default_and_trims_label() {
        let mut store = AccountStore::default();
        let account = store.add("  Main  ", None).unwrap();
        assert_eq!(account.label, "Main");
        assert_eq!(account.url, DEFAULT_GAME_URL);
    }

    #[test]
    fn add_accepts_custom_url() {
        let mut store = AccountStore::default();
        let account = store.add("Alt", Some("https://example.com/game")).unwrap();
        assert_eq!(account.url, "https://example.com/game");
    }

    #[test]
    fn add_rejects_invalid_input() {
        let mut store = AccountStore::default();
        assert_eq!(
            store.add("   ", None).unwrap_err(),
            AccountError::EmptyLabel
        );
        assert_eq!(
            store.add("A", Some("javascript:alert(1)")).unwrap_err(),
            AccountError::InvalidUrl
        );
        assert_eq!(
            store.add("A", Some("file:///etc/passwd")).unwrap_err(),
            AccountError::InvalidUrl
        );
    }

    #[test]
    fn add_rejects_urls_the_webview_cannot_open() {
        // These passed a prefix check, then failed when the webview was created.
        let mut store = AccountStore::default();
        for url in [
            "https://",
            "http://",
            "https://exa mple.com",
            "https://[::1",
        ] {
            assert_eq!(
                store.add("A", Some(url)).unwrap_err(),
                AccountError::InvalidUrl,
                "{url}"
            );
        }
    }

    #[test]
    fn add_accepts_scheme_in_any_case_and_keeps_the_url_as_typed() {
        let mut store = AccountStore::default();
        let account = store.add("A", Some(" HTTPS://huntera.com.br ")).unwrap();
        assert_eq!(account.url, "HTTPS://huntera.com.br");
    }

    #[test]
    fn labels_are_unique_ignoring_case() {
        let mut store = AccountStore::default();
        store.add("Main", None).unwrap();
        assert_eq!(
            store.add("main", None).unwrap_err(),
            AccountError::DuplicateLabel("main".into())
        );
    }

    #[test]
    fn add_stops_at_the_account_limit() {
        let mut store = AccountStore::new(2);
        store.add("A", None).unwrap();
        store.add("B", None).unwrap();
        assert_eq!(
            store.add("C", None).unwrap_err(),
            AccountError::LimitReached(2)
        );
    }

    #[test]
    fn ids_are_unique() {
        let mut store = AccountStore::default();
        let a = store.add("A", None).unwrap().id;
        let b = store.add("B", None).unwrap().id;
        assert_ne!(a, b);
        assert_eq!(store.index_of(b), Some(1));
        assert_eq!(store.get(a).unwrap().label, "A");
    }

    #[test]
    fn rename_validates_and_updates_label() {
        let mut store = AccountStore::default();
        let a = store.add("A", None).unwrap().id;
        store.add("B", None).unwrap();
        assert_eq!(
            store.rename(a, "b"),
            Err(AccountError::DuplicateLabel("b".into()))
        );
        assert_eq!(store.rename(a, ""), Err(AccountError::EmptyLabel));
        store.rename(a, "a").unwrap();
        assert_eq!(store.get(a).unwrap().label, "a");
        assert_eq!(
            store.rename(AccountId::new(), "x"),
            Err(AccountError::NotFound)
        );
    }

    #[test]
    fn remove_returns_the_account_and_frees_a_slot() {
        let mut store = AccountStore::new(1);
        let a = store.add("A", None).unwrap().id;
        assert_eq!(store.remove(a).unwrap().label, "A");
        assert_eq!(store.remove(a), Err(AccountError::NotFound));
        assert!(store.add("B", None).is_ok());
    }

    #[test]
    fn new_tabs_start_muted_and_unpinned() {
        let mut store = AccountStore::default();
        let account = store.add("A", None).unwrap();
        assert!(account.muted);
        assert!(!account.pinned);
    }

    #[test]
    fn mute_and_pin_can_be_toggled() {
        let mut store = AccountStore::default();
        let id = store.add("A", None).unwrap().id;
        store.set_muted(id, false).unwrap();
        store.set_pinned(id, true).unwrap();
        let account = store.get(id).unwrap();
        assert!(!account.muted);
        assert!(account.pinned);
        assert_eq!(
            store.set_muted(AccountId::new(), true),
            Err(AccountError::NotFound)
        );
        assert_eq!(
            store.set_pinned(AccountId::new(), true),
            Err(AccountError::NotFound)
        );
    }

    #[test]
    fn pinned_tabs_cannot_be_removed() {
        let mut store = AccountStore::default();
        let id = store.add("A", None).unwrap().id;
        store.set_pinned(id, true).unwrap();
        assert_eq!(store.remove(id), Err(AccountError::Pinned));
        store.set_pinned(id, false).unwrap();
        assert!(store.remove(id).is_ok());
    }

    #[test]
    fn swap_exchanges_positions() {
        let mut store = AccountStore::default();
        let a = store.add("A", None).unwrap().id;
        let b = store.add("B", None).unwrap().id;
        let c = store.add("C", None).unwrap().id;
        store.swap(a, c).unwrap();
        let order: Vec<_> = store.accounts().iter().map(|x| x.id).collect();
        assert_eq!(order, vec![c, b, a]);
        assert_eq!(store.swap(a, AccountId::new()), Err(AccountError::NotFound));
    }

    fn stored(max: usize, accounts: &[(AccountId, &str, &str)]) -> AccountStore {
        let accounts: Vec<_> = accounts
            .iter()
            .map(|(id, label, url)| serde_json::json!({"id": id, "label": label, "url": url}))
            .collect();
        AccountStore::from_json(
            &serde_json::json!({"max_accounts": max, "accounts": accounts}).to_string(),
        )
        .unwrap()
    }

    fn labels(store: &AccountStore) -> Vec<&str> {
        store.accounts().iter().map(|a| a.label.as_str()).collect()
    }

    #[test]
    fn loading_drops_accounts_that_repeat_an_id() {
        // Two tabs with one id would fight over one webview and one profile.
        let id = AccountId::new();
        let store = stored(
            4,
            &[(id, "A", DEFAULT_GAME_URL), (id, "B", DEFAULT_GAME_URL)],
        );
        assert_eq!(labels(&store), ["A"]);
    }

    #[test]
    fn loading_keeps_at_most_the_account_limit() {
        let store = stored(
            2,
            &[
                (AccountId::new(), "A", DEFAULT_GAME_URL),
                (AccountId::new(), "B", DEFAULT_GAME_URL),
                (AccountId::new(), "C", DEFAULT_GAME_URL),
            ],
        );
        assert_eq!(labels(&store), ["A", "B"]);
    }

    #[test]
    fn loading_drops_accounts_whose_address_cannot_be_opened() {
        let store = stored(
            4,
            &[
                (AccountId::new(), "A", "https://"),
                (AccountId::new(), "B", DEFAULT_GAME_URL),
            ],
        );
        assert_eq!(labels(&store), ["B"]);
    }

    #[test]
    fn loading_a_zero_limit_falls_back_to_the_default() {
        let store = stored(0, &[(AccountId::new(), "A", DEFAULT_GAME_URL)]);
        assert_eq!(labels(&store), ["A"]);
    }

    #[test]
    fn older_files_without_mute_or_pin_still_load() {
        let id = AccountId::new();
        let json = format!(
            r#"{{"max_accounts":4,"accounts":[{{"id":"{id}","label":"A","url":"https://x.y"}}]}}"#
        );
        let store = AccountStore::from_json(&json).unwrap();
        assert!(store.get(id).unwrap().muted);
        assert!(!store.get(id).unwrap().pinned);
    }

    #[test]
    fn json_round_trip_preserves_everything() {
        let mut store = AccountStore::new(3);
        store.add("A", None).unwrap();
        store.add("B", Some("https://example.com")).unwrap();
        let restored = AccountStore::from_json(&store.to_json()).unwrap();
        assert_eq!(restored, store);
    }
}
