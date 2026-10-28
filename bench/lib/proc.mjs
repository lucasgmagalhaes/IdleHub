// Linux process CPU accounting from /proc, to measure whole process trees
// (renderers, GPU and network processes), not only a page's main thread.
import { readdirSync, readFileSync } from "node:fs";

const TICKS_PER_SECOND = 100; // USER_HZ on Linux

function readStat(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const name = raw.slice(raw.indexOf("(") + 1, raw.lastIndexOf(")"));
    // The command name may contain spaces; fields after it are space separated.
    const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    return {
      pid,
      name,
      ppid: Number(fields[1]),
      cpuTicks: Number(fields[11]) + Number(fields[12]),
      rssPages: Number(fields[21]),
    };
  } catch {
    return null;
  }
}

function allProcesses() {
  return readdirSync("/proc")
    .filter((name) => /^\d+$/.test(name))
    .map((pid) => readStat(Number(pid)))
    .filter(Boolean);
}

/** The process `root` and all its descendants. */
export function processTree(root) {
  const all = allProcesses();
  const tree = new Map([[root, all.find((p) => p.pid === root)]].filter(([, p]) => p));
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of all) {
      if (!tree.has(p.pid) && tree.has(p.ppid)) {
        tree.set(p.pid, p);
        grew = true;
      }
    }
  }
  return [...tree.values()];
}

/** CPU seconds and resident memory of a process tree right now. */
export function treeUsage(root) {
  const tree = processTree(root);
  const pageSize = 4096;
  return {
    cpuSeconds: tree.reduce((sum, p) => sum + p.cpuTicks, 0) / TICKS_PER_SECOND,
    rssBytes: tree.reduce((sum, p) => sum + p.rssPages * pageSize, 0),
    processes: tree.length,
  };
}

/** Per-process CPU seconds and memory of a tree, keyed by pid. */
export function treeProcesses(root) {
  return new Map(processTree(root).map((p) => [p.pid, { ...p, cpuSeconds: p.cpuTicks / TICKS_PER_SECOND }]));
}
