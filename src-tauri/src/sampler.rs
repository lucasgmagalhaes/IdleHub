//! Samples CPU and memory of the app's process tree.

use idlehub_core::metrics::ProcessSample;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

pub struct Sampler {
    system: System,
}

impl Sampler {
    pub fn new() -> Self {
        let mut sampler = Self {
            system: System::new(),
        };
        // CPU usage is a delta between two refreshes; prime the first one.
        sampler.snapshot();
        sampler
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
