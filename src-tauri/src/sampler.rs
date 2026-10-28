//! Samples CPU and memory of the app's process tree.

use idlehub_core::metrics::ProcessSample;
#[cfg(not(target_os = "ios"))]
use sysinfo::{MemoryRefreshKind, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[cfg(not(target_os = "ios"))]
pub struct Sampler {
    system: System,
}

#[cfg(not(target_os = "ios"))]
impl Sampler {
    pub fn new() -> Self {
        let mut sampler = Self {
            system: System::new(),
        };
        // CPU usage is a delta between two refreshes; prime the first one.
        sampler.snapshot();
        sampler
    }

    pub fn total_memory(&mut self) -> u64 {
        self.system
            .refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        self.system.total_memory()
    }

    pub fn cpu_count(&self) -> usize {
        std::thread::available_parallelism().map_or(1, |n| n.get())
    }

    /// Current snapshot of every process. CPU is averaged since the previous call.
    pub fn snapshot(&mut self) -> Vec<ProcessSample> {
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_cpu()
                .with_memory()
                .with_cmd(UpdateKind::OnlyIfNotSet),
        );
        self.system
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
            .collect()
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
