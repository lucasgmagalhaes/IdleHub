// Process CPU and memory accounting for whole process trees (renderers, GPU and
// network processes), not only a page's main thread. Linux reads /proc; Windows
// asks CIM through PowerShell.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const TICKS_PER_SECOND = 100; // USER_HZ on Linux
const PAGE_SIZE = 4096;

function linuxProcess(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const name = raw.slice(raw.indexOf("(") + 1, raw.lastIndexOf(")"));
    // The command name may contain spaces; fields after it are space separated.
    const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    return {
      pid,
      name,
      command: "",
      ppid: Number(fields[1]),
      cpuSeconds: (Number(fields[11]) + Number(fields[12])) / TICKS_PER_SECOND,
      rssBytes: Number(fields[21]) * PAGE_SIZE,
      privateBytes: null,
    };
  } catch {
    return null;
  }
}

function windowsProcesses() {
  const script =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine," +
    "KernelModeTime,UserModeTime,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress";
  const json = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(json).map((p) => ({
    pid: p.ProcessId,
    name: p.Name ?? "",
    command: p.CommandLine ?? "",
    ppid: p.ParentProcessId,
    // CIM reports times in 100 ns units.
    cpuSeconds: (Number(p.KernelModeTime) + Number(p.UserModeTime)) / 1e7,
    rssBytes: Number(p.WorkingSetSize),
    privateBytes: Number(p.PrivatePageCount),
  }));
}

function allProcesses() {
  if (process.platform === "win32") return windowsProcesses();
  return readdirSync("/proc")
    .filter((name) => /^\d+$/.test(name))
    .map((pid) => linuxProcess(Number(pid)))
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

/** CPU seconds and memory of a process tree right now. */
export function treeUsage(root) {
  const tree = processTree(root);
  const sum = (key) => tree.reduce((total, p) => total + (p[key] ?? 0), 0);
  return {
    cpuSeconds: sum("cpuSeconds"),
    rssBytes: sum("rssBytes"),
    // Memory a process does not share with others; Windows only.
    privateBytes: tree.some((p) => p.privateBytes !== null) ? sum("privateBytes") : null,
    processes: tree.length,
  };
}

/** Per-process usage of a tree, keyed by pid. */
export function treeProcesses(root) {
  return new Map(processTree(root).map((p) => [p.pid, p]));
}
