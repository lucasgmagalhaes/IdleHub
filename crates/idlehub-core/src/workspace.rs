//! Ties tabs, the pane layout and render policies together.
//!
//! Tabs are kept in order; the first `panes` tabs are shown (tab `i` in pane
//! `i`) and the rest keep running hidden. The app shell asks the workspace what
//! each tab should do and only applies the answer to the native webviews.

use serde::{Deserialize, Serialize};

use crate::account::{Account, AccountError, AccountId, AccountStore};
use crate::layout::PaneCount;
use crate::policy::{tab_policy, PolicySettings, RenderPolicy};

/// A tab as the UI and the shell see it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabState {
    #[serde(flatten)]
    pub account: Account,
    /// Pane showing this tab, or `None` when it runs hidden.
    pub pane: Option<usize>,
    pub policy: RenderPolicy,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Workspace {
    store: AccountStore,
    #[serde(default)]
    panes: PaneCount,
    #[serde(skip)]
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

    pub fn panes(&self) -> PaneCount {
        self.panes
    }

    pub fn set_panes(&mut self, panes: PaneCount) {
        self.panes = panes;
    }

    pub fn add(&mut self, label: &str, url: Option<&str>) -> Result<Account, AccountError> {
        self.store.add(label, url).cloned()
    }

    pub fn remove(&mut self, id: AccountId) -> Result<Account, AccountError> {
        self.store.remove(id)
    }

    pub fn set_muted(&mut self, id: AccountId, muted: bool) -> Result<(), AccountError> {
        self.store.set_muted(id, muted)
    }

    pub fn set_pinned(&mut self, id: AccountId, pinned: bool) -> Result<(), AccountError> {
        self.store.set_pinned(id, pinned)
    }

    /// Shows `id` in `pane`, swapping places with the tab that was there.
    pub fn show_in_pane(&mut self, pane: usize, id: AccountId) -> Result<(), AccountError> {
        if pane >= self.panes.get() {
            return Err(AccountError::InvalidPane(pane));
        }
        let accounts = self.store.accounts();
        let from = self.store.index_of(id).ok_or(AccountError::NotFound)?;
        // Tabs are contiguous, so an empty pane means "the last occupied slot".
        let to = pane.min(accounts.len() - 1);
        if from == to {
            return Ok(());
        }
        if accounts[from].pinned || accounts[to].pinned {
            return Err(AccountError::Pinned);
        }
        let other = accounts[to].id;
        self.store.swap(id, other)
    }

    pub fn tabs(&self) -> Vec<TabState> {
        let panes = self.panes.get();
        self.store
            .accounts()
            .iter()
            .enumerate()
            .map(|(i, account)| {
                let visible = i < panes;
                TabState {
                    account: account.clone(),
                    pane: visible.then_some(i),
                    policy: tab_policy(visible, self.panes, account.muted, self.policy),
                }
            })
            .collect()
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("workspace is always serializable")
    }

    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace_with(labels: &[&str]) -> (Workspace, Vec<AccountId>) {
        let mut ws = Workspace::default();
        let ids = labels.iter().map(|l| ws.add(l, None).unwrap().id).collect();
        (ws, ids)
    }

    fn panes(n: u8) -> PaneCount {
        PaneCount::new(n).unwrap()
    }

    fn pane_of(ws: &Workspace, id: AccountId) -> Option<usize> {
        ws.tabs()
            .into_iter()
            .find(|t| t.account.id == id)
            .unwrap()
            .pane
    }

    #[test]
    fn four_panes_show_every_tab_in_order() {
        let (ws, ids) = workspace_with(&["A", "B", "C", "D"]);
        assert_eq!(ws.panes().get(), 4);
        let shown: Vec<_> = ws.tabs().iter().map(|t| (t.account.id, t.pane)).collect();
        assert_eq!(
            shown,
            ids.iter()
                .enumerate()
                .map(|(i, id)| (*id, Some(i)))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn fewer_panes_hide_the_remaining_tabs() {
        let (mut ws, ids) = workspace_with(&["A", "B", "C"]);
        ws.set_panes(panes(1));
        assert_eq!(pane_of(&ws, ids[0]), Some(0));
        assert_eq!(pane_of(&ws, ids[1]), None);
        assert_eq!(pane_of(&ws, ids[2]), None);
    }

    #[test]
    fn policies_follow_visibility_and_mute() {
        let (mut ws, ids) = workspace_with(&["A", "B"]);
        ws.set_panes(panes(1));
        ws.set_muted(ids[0], false).unwrap();
        let tabs = ws.tabs();
        assert_eq!(
            tabs[0].policy,
            RenderPolicy {
                max_fps: ws.policy.single_pane_fps,
                muted: false
            }
        );
        assert_eq!(
            tabs[1].policy,
            RenderPolicy {
                max_fps: ws.policy.hidden_fps,
                muted: true
            }
        );
    }

    #[test]
    fn show_in_pane_swaps_with_the_tab_in_that_pane() {
        let (mut ws, ids) = workspace_with(&["A", "B", "C"]);
        ws.set_panes(panes(1));
        ws.show_in_pane(0, ids[2]).unwrap();
        assert_eq!(pane_of(&ws, ids[2]), Some(0));
        assert_eq!(pane_of(&ws, ids[0]), None);
        let order: Vec<_> = ws.store().accounts().iter().map(|a| a.id).collect();
        assert_eq!(order, vec![ids[2], ids[1], ids[0]]);
    }

    #[test]
    fn show_in_pane_rejects_panes_outside_the_layout() {
        let (mut ws, ids) = workspace_with(&["A", "B"]);
        ws.set_panes(panes(2));
        assert_eq!(
            ws.show_in_pane(2, ids[0]),
            Err(AccountError::InvalidPane(2))
        );
        assert_eq!(
            ws.show_in_pane(0, AccountId::new()),
            Err(AccountError::NotFound)
        );
    }

    #[test]
    fn show_in_pane_on_an_empty_pane_moves_the_tab_to_the_last_slot() {
        let (mut ws, ids) = workspace_with(&["A", "B"]);
        ws.show_in_pane(3, ids[0]).unwrap();
        assert_eq!(pane_of(&ws, ids[0]), Some(1));
    }

    #[test]
    fn pinned_tabs_are_not_moved() {
        let (mut ws, ids) = workspace_with(&["A", "B"]);
        ws.set_panes(panes(1));
        ws.set_pinned(ids[0], true).unwrap();
        assert_eq!(ws.show_in_pane(0, ids[1]), Err(AccountError::Pinned));
        assert_eq!(pane_of(&ws, ids[0]), Some(0));
    }

    #[test]
    fn showing_a_tab_in_its_own_pane_is_a_no_op() {
        let (mut ws, ids) = workspace_with(&["A"]);
        ws.set_pinned(ids[0], true).unwrap();
        assert_eq!(ws.show_in_pane(0, ids[0]), Ok(()));
    }

    #[test]
    fn json_round_trip_keeps_tabs_and_layout() {
        let (mut ws, _) = workspace_with(&["A", "B"]);
        ws.set_panes(panes(2));
        let restored = Workspace::from_json(&ws.to_json()).unwrap();
        assert_eq!(restored, ws);
    }

    #[test]
    fn tab_state_serializes_flat_for_the_ui() {
        let (ws, ids) = workspace_with(&["A"]);
        let json = serde_json::to_value(&ws.tabs()[0]).unwrap();
        assert_eq!(json["id"], ids[0].to_string());
        assert_eq!(json["label"], "A");
        assert_eq!(json["muted"], true);
        assert_eq!(json["pane"], 0);
        assert_eq!(json["policy"]["maxFps"], ws.policy.multi_pane_fps);
    }
}
