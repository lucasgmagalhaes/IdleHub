//! Ties accounts, focus, layout and policies together.
//!
//! The app shell asks the workspace where each webview goes and what it may
//! render, then only has to apply the answer to the native webviews.

use crate::account::{Account, AccountError, AccountId, AccountStore};
use crate::layout::{compute_layout, LayoutOptions, Rect, ViewMode};
use crate::policy::{policies, PolicySettings, RenderPolicy};

#[derive(Debug, Clone, PartialEq)]
pub struct Placement {
    pub account: AccountId,
    pub bounds: Rect,
    pub policy: RenderPolicy,
}

#[derive(Debug, Clone, Default)]
pub struct Workspace {
    store: AccountStore,
    focused: Option<AccountId>,
    pub layout: LayoutOptions,
    pub policy: PolicySettings,
}

impl Workspace {
    pub fn new(store: AccountStore) -> Self {
        Self {
            store,
            ..Self::default()
        }
    }

    pub fn store(&self) -> &AccountStore {
        &self.store
    }

    pub fn focused(&self) -> Option<AccountId> {
        self.focused
    }

    /// `None` returns to the grid.
    pub fn focus(&mut self, account: Option<AccountId>) -> Result<(), AccountError> {
        if let Some(id) = account {
            self.store.get(id).ok_or(AccountError::NotFound)?;
        }
        self.focused = account;
        Ok(())
    }

    pub fn add(&mut self, label: &str, url: Option<&str>) -> Result<Account, AccountError> {
        self.store.add(label, url).cloned()
    }

    pub fn remove(&mut self, account: AccountId) -> Result<Account, AccountError> {
        let removed = self.store.remove(account)?;
        if self.focused == Some(account) {
            self.focused = None;
        }
        Ok(removed)
    }

    pub fn placements(&self, area: Rect) -> Vec<Placement> {
        let accounts = self.store.accounts();
        let mode = self
            .focused
            .and_then(|id| self.store.index_of(id))
            .map_or(ViewMode::Grid, ViewMode::Focused);
        let bounds = compute_layout(area, accounts.len(), mode, self.layout);
        let policies = policies(accounts.len(), mode, self.policy);
        accounts
            .iter()
            .zip(bounds)
            .zip(policies)
            .map(|((account, bounds), policy)| Placement {
                account: account.id,
                bounds,
                policy,
            })
            .collect()
    }

    pub fn placement_of(&self, account: AccountId, area: Rect) -> Option<Placement> {
        self.placements(area)
            .into_iter()
            .find(|p| p.account == account)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect::new(0.0, 44.0, 1000.0, 800.0);

    fn workspace_with(labels: &[&str]) -> (Workspace, Vec<AccountId>) {
        let mut ws = Workspace::default();
        ws.layout.gap = 0.0;
        let ids = labels.iter().map(|l| ws.add(l, None).unwrap().id).collect();
        (ws, ids)
    }

    #[test]
    fn grid_places_every_account_with_the_grid_policy() {
        let (ws, ids) = workspace_with(&["A", "B", "C", "D"]);
        let placements = ws.placements(AREA);
        assert_eq!(
            placements.iter().map(|p| p.account).collect::<Vec<_>>(),
            ids
        );
        assert_eq!(placements[3].bounds, Rect::new(500.0, 444.0, 500.0, 400.0));
        assert!(placements
            .iter()
            .all(|p| p.policy.max_fps == ws.policy.grid_fps && p.policy.muted));
    }

    #[test]
    fn focusing_gives_the_account_the_main_area_and_audio() {
        let (mut ws, ids) = workspace_with(&["A", "B", "C"]);
        ws.focus(Some(ids[1])).unwrap();
        let focused = ws.placement_of(ids[1], AREA).unwrap();
        assert_eq!(focused.bounds.width, 800.0);
        assert_eq!(
            focused.policy,
            RenderPolicy {
                max_fps: ws.policy.focused_fps,
                muted: false
            }
        );
        let other = ws.placement_of(ids[0], AREA).unwrap();
        assert_eq!(other.policy.max_fps, ws.policy.background_fps);
    }

    #[test]
    fn focusing_an_unknown_account_fails_and_keeps_state() {
        let (mut ws, ids) = workspace_with(&["A"]);
        ws.focus(Some(ids[0])).unwrap();
        assert_eq!(
            ws.focus(Some(AccountId::new())),
            Err(AccountError::NotFound)
        );
        assert_eq!(ws.focused(), Some(ids[0]));
        ws.focus(None).unwrap();
        assert_eq!(ws.focused(), None);
    }

    #[test]
    fn removing_the_focused_account_returns_to_the_grid() {
        let (mut ws, ids) = workspace_with(&["A", "B"]);
        ws.focus(Some(ids[0])).unwrap();
        ws.remove(ids[0]).unwrap();
        assert_eq!(ws.focused(), None);
        assert_eq!(ws.placements(AREA).len(), 1);
    }

    #[test]
    fn workspace_is_built_from_a_persisted_store() {
        let (ws, _) = workspace_with(&["A", "B"]);
        let restored = Workspace::new(AccountStore::from_json(&ws.store().to_json()).unwrap());
        assert_eq!(restored.store(), ws.store());
        assert_eq!(restored.focused(), None);
    }

    #[test]
    fn placement_of_unknown_account_is_none() {
        let (ws, _) = workspace_with(&["A"]);
        assert_eq!(ws.placement_of(AccountId::new(), AREA), None);
    }
}
