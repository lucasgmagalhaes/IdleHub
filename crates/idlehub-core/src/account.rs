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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    pub id: AccountId,
    pub label: String,
    pub url: String,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountStore {
    max_accounts: usize,
    accounts: Vec<Account>,
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
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return Err(AccountError::InvalidUrl);
        }
        self.accounts.push(Account {
            id: AccountId::new(),
            label,
            url: url.to_owned(),
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
        Ok(self.accounts.remove(index))
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
    fn json_round_trip_preserves_everything() {
        let mut store = AccountStore::new(3);
        store.add("A", None).unwrap();
        store.add("B", Some("https://example.com")).unwrap();
        let restored = AccountStore::from_json(&store.to_json()).unwrap();
        assert_eq!(restored, store);
    }
}
