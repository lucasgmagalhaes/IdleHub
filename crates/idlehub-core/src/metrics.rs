//! Aggregates CPU and memory of the app and of each account from a process snapshot.
//!
//! Sampling the OS lives in the app crate; this module only does the math so it
//! can be tested with synthetic snapshots.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use serde::Serialize;

use crate::account::AccountId;

#[derive(Debug, Clone, PartialEq)]
pub struct ProcessSample {
    pub pid: u32,
    pub parent: Option<u32>,
    /// Full command line, used to recognise which profile a browser process serves.
    pub command: String,
    /// CPU usage in percent of one core.
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub processes: usize,
}

impl Usage {
    fn add(&mut self, sample: &ProcessSample) {
        self.cpu_percent += sample.cpu_percent;
        self.memory_bytes += sample.memory_bytes;
        self.processes += 1;
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    /// The app and all of its descendants.
    pub total: Usage,
    /// Usage attributed to each account's profile.
    pub accounts: HashMap<AccountId, Usage>,
    /// Physical memory of the machine, to show usage as a share of it.
    pub system_memory_bytes: u64,
    /// Logical CPUs; `total.cpu_percent / cpu_count` is the share of the whole machine.
    pub cpu_count: usize,
}

/// Builds a report for the process tree rooted at `root`.
///
/// A process belongs to an account when it, or one of its ancestors inside the
/// tree, was started with that account's profile directory on its command line.
pub fn usage_report(
    snapshot: &[ProcessSample],
    root: u32,
    profiles: &[(AccountId, PathBuf)],
) -> UsageReport {
    let by_pid: HashMap<u32, &ProcessSample> = snapshot.iter().map(|p| (p.pid, p)).collect();
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in snapshot {
        if let Some(parent) = p.parent {
            children.entry(parent).or_default().push(p.pid);
        }
    }
    let profiles: Vec<(AccountId, String)> = profiles
        .iter()
        .map(|(id, dir)| (*id, dir.to_string_lossy().into_owned()))
        .collect();

    let mut report = UsageReport::default();
    let mut visited = HashSet::new();
    let mut stack: Vec<(u32, Option<AccountId>)> = vec![(root, None)];
    while let Some((pid, inherited)) = stack.pop() {
        let Some(sample) = by_pid.get(&pid) else {
            continue;
        };
        if !visited.insert(pid) {
            continue;
        }
        let owner = owner_of(&sample.command, &profiles).or(inherited);
        report.total.add(sample);
        if let Some(account) = owner {
            report.accounts.entry(account).or_default().add(sample);
        }
        for &child in children.get(&pid).into_iter().flatten() {
            stack.push((child, owner));
        }
    }
    report
}

fn owner_of(command: &str, profiles: &[(AccountId, String)]) -> Option<AccountId> {
    profiles
        .iter()
        .find(|(_, dir)| contains_path(command, dir))
        .map(|(id, _)| *id)
}

/// True when `path` appears in `command` as a whole path (not as a prefix of a sibling).
fn contains_path(command: &str, path: &str) -> bool {
    command.match_indices(path).any(|(start, _)| {
        matches!(
            command[start + path.len()..].chars().next(),
            None | Some('/' | '\\' | '"' | '\'' | ' ')
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(pid: u32, parent: Option<u32>, command: &str, cpu: f32, mem: u64) -> ProcessSample {
        ProcessSample {
            pid,
            parent,
            command: command.into(),
            cpu_percent: cpu,
            memory_bytes: mem,
        }
    }

    #[test]
    fn total_sums_the_whole_tree_and_ignores_unrelated_processes() {
        let snapshot = vec![
            process(1, None, "init", 50.0, 1000),
            process(10, Some(1), "idlehub", 1.0, 100),
            process(11, Some(10), "helper", 2.0, 200),
            process(12, Some(11), "grandchild", 3.0, 300),
            process(20, Some(1), "other app", 90.0, 9000),
        ];
        let report = usage_report(&snapshot, 10, &[]);
        assert_eq!(
            report.total,
            Usage {
                cpu_percent: 6.0,
                memory_bytes: 600,
                processes: 3
            }
        );
        assert!(report.accounts.is_empty());
    }

    #[test]
    fn processes_are_attributed_to_the_profile_on_their_command_line() {
        let (a, b) = (AccountId::new(), AccountId::new());
        let profiles = vec![
            (a, PathBuf::from("/data/profiles/a")),
            (b, PathBuf::from("/data/profiles/b")),
        ];
        let snapshot = vec![
            process(10, None, "idlehub", 1.0, 100),
            process(
                11,
                Some(10),
                "msedgewebview2 --user-data-dir=/data/profiles/a/EBWebView",
                2.0,
                200,
            ),
            process(12, Some(11), "msedgewebview2 --type=renderer", 10.0, 1000),
            process(
                13,
                Some(10),
                "msedgewebview2 --user-data-dir=/data/profiles/b/EBWebView",
                3.0,
                300,
            ),
            process(
                14,
                Some(10),
                "msedgewebview2 --user-data-dir=/data/ui",
                1.0,
                50,
            ),
        ];
        let report = usage_report(&snapshot, 10, &profiles);
        assert_eq!(
            report.accounts[&a],
            Usage {
                cpu_percent: 12.0,
                memory_bytes: 1200,
                processes: 2
            }
        );
        assert_eq!(
            report.accounts[&b],
            Usage {
                cpu_percent: 3.0,
                memory_bytes: 300,
                processes: 1
            }
        );
        assert_eq!(report.total.processes, 5);
    }

    #[test]
    fn profile_prefixes_do_not_match_longer_sibling_paths() {
        let a = AccountId::new();
        let profiles = vec![(a, PathBuf::from("/data/profiles/a"))];
        let snapshot = vec![
            process(10, None, "idlehub", 0.0, 0),
            process(
                11,
                Some(10),
                "webview --user-data-dir=/data/profiles/ab",
                5.0,
                500,
            ),
        ];
        assert!(!usage_report(&snapshot, 10, &profiles)
            .accounts
            .contains_key(&a));
    }

    #[test]
    fn report_serializes_in_camel_case_for_the_ui() {
        let report = UsageReport { system_memory_bytes: 8, cpu_count: 4, ..UsageReport::default() };
        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(json["systemMemoryBytes"], 8);
        assert_eq!(json["cpuCount"], 4);
        assert_eq!(json["total"]["memoryBytes"], 0);
    }

    #[test]
    fn missing_root_yields_an_empty_report() {
        let report = usage_report(&[process(1, None, "init", 1.0, 1)], 99, &[]);
        assert_eq!(report, UsageReport::default());
    }

    #[test]
    fn parent_cycles_do_not_hang() {
        let snapshot = vec![
            process(10, Some(11), "idlehub", 1.0, 1),
            process(11, Some(10), "child", 1.0, 1),
        ];
        assert_eq!(usage_report(&snapshot, 10, &[]).total.processes, 2);
    }
}
