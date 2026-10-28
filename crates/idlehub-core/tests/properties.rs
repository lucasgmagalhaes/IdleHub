//! Property tests: random sequences of user actions must never break the
//! workspace's rules, and every failed action must leave it untouched.

use std::collections::HashSet;
use std::path::PathBuf;

use idlehub_core::account::{AccountError, AccountId, AccountStore, DEFAULT_MAX_ACCOUNTS};
use idlehub_core::layout::PaneCount;
use idlehub_core::metrics::{tree_pids, usage_report, ProcessSample};
use idlehub_core::policy::{PolicySettings, MAX_FPS, MIN_FPS};
use idlehub_core::workspace::Workspace;
use proptest::prelude::*;

#[derive(Debug, Clone)]
enum Action {
    Add(String, Option<String>),
    /// Indexes pick an existing tab (modulo the tab count) or, past it, an unknown id.
    Remove(usize),
    SetPanes(u8),
    ShowInPane(usize, usize),
    SetMuted(usize, bool),
    SetPinned(usize, bool),
    SetPolicy(u32, u32, u32),
    Reload,
}

fn action() -> impl Strategy<Value = Action> {
    let label = prop_oneof![
        Just("Main".to_owned()),
        Just("main".to_owned()),
        Just(" Alt ".to_owned()),
        Just("".to_owned()),
        "[a-zA-Z ]{0,6}",
    ];
    let url = prop_oneof![
        Just(None),
        Just(Some("https://huntera.com.br/play".to_owned())),
        Just(Some("https://".to_owned())),
        Just(Some("javascript:alert(1)".to_owned())),
        "[a-z:/. ]{0,16}".prop_map(Some),
    ];
    prop_oneof![
        (label, url).prop_map(|(l, u)| Action::Add(l, u)),
        (0usize..6).prop_map(Action::Remove),
        (0u8..7).prop_map(Action::SetPanes),
        (0usize..6, 0usize..6).prop_map(|(p, i)| Action::ShowInPane(p, i)),
        (0usize..6, any::<bool>()).prop_map(|(i, m)| Action::SetMuted(i, m)),
        (0usize..6, any::<bool>()).prop_map(|(i, p)| Action::SetPinned(i, p)),
        (0u32..300, 0u32..300, 0u32..300).prop_map(|(a, b, c)| Action::SetPolicy(a, b, c)),
        Just(Action::Reload),
    ]
}

/// An existing tab for small indexes, an unknown id otherwise.
fn pick(ws: &Workspace, index: usize) -> AccountId {
    let accounts = ws.store().accounts();
    if index < 4 && !accounts.is_empty() {
        accounts[index % accounts.len()].id
    } else {
        AccountId::new()
    }
}

/// Applies `action`; returns whether it succeeded.
fn apply(ws: &mut Workspace, action: &Action) -> bool {
    match action {
        Action::Add(label, url) => ws.add(label, url.as_deref()).is_ok(),
        Action::Remove(i) => ws.remove(pick(ws, *i)).is_ok(),
        Action::SetPanes(n) => match PaneCount::new(*n) {
            Some(panes) => {
                ws.set_panes(panes);
                true
            }
            None => false,
        },
        Action::ShowInPane(pane, i) => ws.show_in_pane(*pane, pick(ws, *i)).is_ok(),
        Action::SetMuted(i, m) => ws.set_muted(pick(ws, *i), *m).is_ok(),
        Action::SetPinned(i, p) => ws.set_pinned(pick(ws, *i), *p).is_ok(),
        Action::SetPolicy(a, b, c) => {
            ws.set_policy(PolicySettings {
                single_pane_fps: *a,
                multi_pane_fps: *b,
                hidden_fps: *c,
            });
            true
        }
        Action::Reload => {
            *ws = Workspace::from_json(&ws.to_json()).expect("a saved workspace loads back");
            true
        }
    }
}

fn check_rules(ws: &Workspace) {
    let accounts = ws.store().accounts();
    assert!(accounts.len() <= DEFAULT_MAX_ACCOUNTS);
    let ids: HashSet<_> = accounts.iter().map(|a| a.id).collect();
    assert_eq!(ids.len(), accounts.len(), "ids repeat");
    let labels: HashSet<_> = accounts.iter().map(|a| a.label.to_lowercase()).collect();
    assert_eq!(labels.len(), accounts.len(), "labels repeat");
    for account in accounts {
        assert!(!account.label.is_empty() && account.label.trim() == account.label);
        assert!(account.url.starts_with("http"));
    }

    let panes = ws.panes().get();
    let settings = ws.policy();
    for fps in [
        settings.single_pane_fps,
        settings.multi_pane_fps,
        settings.hidden_fps,
    ] {
        assert!((MIN_FPS..=MAX_FPS).contains(&fps));
    }
    for (i, tab) in ws.tabs().iter().enumerate() {
        let visible = i < panes;
        assert_eq!(tab.pane, visible.then_some(i), "tab {i} in the wrong pane");
        assert!((MIN_FPS..=MAX_FPS).contains(&tab.policy.max_fps));
        if visible {
            let expected = if panes == 1 {
                settings.single_pane_fps
            } else {
                settings.multi_pane_fps
            };
            assert_eq!(tab.policy.max_fps, expected);
            assert_eq!(tab.policy.muted, tab.account.muted);
        } else {
            assert_eq!(tab.policy.max_fps, settings.hidden_fps);
            assert!(tab.policy.muted, "hidden tabs must be silent");
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn random_actions_keep_the_workspace_valid(actions in prop::collection::vec(action(), 1..40)) {
        let mut ws = Workspace::default();
        for action in &actions {
            let before = ws.clone();
            let ok = apply(&mut ws, action);
            if !ok {
                prop_assert_eq!(&ws, &before, "failed {:?} changed the workspace", action);
            }
            check_rules(&ws);
            prop_assert_eq!(Workspace::from_json(&ws.to_json()).unwrap(), ws.clone());
        }
    }

    #[test]
    fn pins_hold_tabs_that_are_on_screen(actions in prop::collection::vec(action(), 1..40), pane in 0usize..4, pick_index in 0usize..4) {
        let mut ws = Workspace::default();
        for action in &actions {
            apply(&mut ws, action);
        }
        let accounts = ws.store().accounts().to_vec();
        if accounts.is_empty() {
            return Ok(());
        }
        let id = accounts[pick_index % accounts.len()].id;
        let from = ws.store().index_of(id).unwrap();
        let to = pane.min(accounts.len() - 1);
        let panes = ws.panes().get();
        let shown_and_pinned = |i: usize| i < panes && accounts[i].pinned;
        let before = ws.clone();
        match ws.show_in_pane(pane, id) {
            Ok(()) => {
                prop_assert!(pane < panes);
                prop_assert!(from == to || !(shown_and_pinned(from) || shown_and_pinned(to)));
                prop_assert_eq!(ws.store().index_of(id), Some(to));
            }
            Err(AccountError::InvalidPane(_)) => prop_assert!(pane >= panes),
            Err(AccountError::Pinned) => prop_assert!(shown_and_pinned(from) || shown_and_pinned(to)),
            Err(other) => prop_assert!(false, "unexpected error {other:?}"),
        }
        if ws != before {
            // A move swaps exactly two tabs.
            let moved = ws.store().accounts().iter().zip(before.store().accounts()).filter(|(a, b)| a.id != b.id).count();
            prop_assert_eq!(moved, 2);
        }
    }

    #[test]
    fn any_saved_store_loads_into_a_valid_one(
        max in 0usize..8,
        entries in prop::collection::vec((0usize..5, "[A-Za-z]{0,3}", prop_oneof![Just("https://a.b"), Just("https://"), Just("ftp://x")]), 0..10),
    ) {
        let ids: Vec<_> = (0..5).map(|_| AccountId::new()).collect();
        let accounts: Vec<_> = entries
            .iter()
            .map(|(id, label, url)| serde_json::json!({"id": ids[*id], "label": label, "url": url}))
            .collect();
        let json = serde_json::json!({"max_accounts": max, "accounts": accounts}).to_string();
        let store = AccountStore::from_json(&json).unwrap();
        let limit = if max == 0 { DEFAULT_MAX_ACCOUNTS } else { max };
        prop_assert!(store.accounts().len() <= limit);
        let unique: HashSet<_> = store.accounts().iter().map(|a| a.id).collect();
        prop_assert_eq!(unique.len(), store.accounts().len());
        prop_assert!(store.accounts().iter().all(|a| a.url == "https://a.b"));
    }

    #[test]
    fn usage_reports_survive_any_process_table(
        table in prop::collection::vec((1u32..30, prop::option::of(0u32..30), 0u32..3, 0f32..100.0, 0u64..1_000), 0..40),
        root in 1u32..30,
    ) {
        let (a, b) = (AccountId::new(), AccountId::new());
        let profiles = vec![(a, PathBuf::from("/p/a")), (b, PathBuf::from("/p/b"))];
        let commands = ["browser --user-data-dir=/p/a", "browser --user-data-dir=/p/b", "helper"];
        // Pids may repeat and parents may form cycles, as in a snapshot taken mid-change.
        let snapshot: Vec<_> = table
            .iter()
            .map(|(pid, parent, command, cpu, mem)| ProcessSample {
                pid: *pid,
                parent: *parent,
                command: commands[*command as usize].to_owned(),
                cpu_percent: *cpu,
                memory_bytes: *mem,
            })
            .collect();

        let report = usage_report(&snapshot, root, &profiles);
        let pids = tree_pids(&snapshot, root);
        let unique: HashSet<_> = pids.iter().collect();
        prop_assert_eq!(unique.len(), pids.len(), "tree lists a pid twice");
        prop_assert_eq!(report.total.processes, pids.len());
        let in_accounts: usize = report.accounts.values().map(|u| u.processes).sum();
        prop_assert!(in_accounts <= report.total.processes);
        let memory: u64 = report.accounts.values().map(|u| u.memory_bytes).sum();
        prop_assert!(memory <= report.total.memory_bytes);
    }
}
