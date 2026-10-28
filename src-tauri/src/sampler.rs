//! Samples CPU and memory of the app's process tree.
//!
//! Listing every process on the machine is the expensive part, so a full scan
//! only runs every few samples (to find new webview processes); in between only
//! the app's own process tree is refreshed.

#[cfg(not(target_os = "ios"))]
use idlehub_core::metrics::tree_pids;
use idlehub_core::metrics::ProcessSample;
#[cfg(not(target_os = "ios"))]
use sysinfo::{MemoryRefreshKind, Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// With the UI polling every 2 s, new processes show up within 10 s.
#[cfg_attr(target_os = "ios", allow(dead_code))]
const FULL_SCAN_EVERY: u32 = 5;

/// Whether sample number `call` (0-based) must list every process.
#[cfg_attr(target_os = "ios", allow(dead_code))]
fn needs_full_scan(call: u32, known_tree: bool) -> bool {
    !known_tree || call.is_multiple_of(FULL_SCAN_EVERY)
}

#[cfg(not(target_os = "ios"))]
pub struct Sampler {
    system: System,
    tree: Vec<Pid>,
    calls: u32,
    total_memory: u64,
}

#[cfg(not(target_os = "ios"))]
impl Sampler {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        let total_memory = system.total_memory();
        let mut sampler = Self {
            system,
            tree: Vec::new(),
            calls: 0,
            total_memory,
        };
        // CPU usage is a delta between two refreshes; prime the first one.
        sampler.snapshot();
        sampler
    }

    pub fn total_memory(&mut self) -> u64 {
        self.total_memory
    }

    pub fn cpu_count(&self) -> usize {
        std::thread::available_parallelism().map_or(1, |n| n.get())
    }

    /// Current snapshot of the app's processes. CPU is averaged since the previous call.
    pub fn snapshot(&mut self) -> Vec<ProcessSample> {
        let full = needs_full_scan(self.calls, !self.tree.is_empty());
        self.calls = self.calls.wrapping_add(1);
        let kind = ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            .with_cmd(UpdateKind::OnlyIfNotSet);
        let targets = if full {
            ProcessesToUpdate::All
        } else {
            ProcessesToUpdate::Some(&self.tree)
        };
        self.system.refresh_processes_specifics(targets, true, kind);

        let samples: Vec<ProcessSample> = self
            .system
            .processes()
            .values()
            // On Linux threads are listed as processes sharing the parent's memory.
            .filter(|p| p.thread_kind().is_none())
            .map(|p| ProcessSample {
                pid: p.pid().as_u32(),
                parent: p.parent().map(|parent| parent.as_u32()),
                command: p
                    .cmd()
                    .iter()
                    .map(|arg| arg.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" "),
                cpu_percent: p.cpu_usage(),
                memory_bytes: p.memory(),
            })
            .collect();
        if full {
            self.tree = tree_pids(&samples, std::process::id())
                .into_iter()
                .map(Pid::from_u32)
                .collect();
        }
        samples
    }
}

/// iOS does not let apps inspect processes; usage is reported as unknown (zero).
#[cfg(target_os = "ios")]
pub struct Sampler;

#[cfg(target_os = "ios")]
impl Sampler {
    pub fn new() -> Self {
        Self
    }

    pub fn total_memory(&mut self) -> u64 {
        0
    }

    pub fn cpu_count(&self) -> usize {
        std::thread::available_parallelism().map_or(1, |n| n.get())
    }

    pub fn snapshot(&mut self) -> Vec<ProcessSample> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_sample_scans_everything() {
        assert!(needs_full_scan(0, false));
    }

    #[test]
    fn later_samples_only_refresh_the_known_tree_until_the_next_full_scan() {
        let plan: Vec<bool> = (1..=10).map(|call| needs_full_scan(call, true)).collect();
        assert_eq!(
            plan,
            [false, false, false, false, true, false, false, false, false, true]
        );
    }

    #[test]
    fn scans_everything_while_the_tree_is_unknown() {
        assert!(needs_full_scan(3, false));
    }
}
