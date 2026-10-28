import { useEffect, useRef, useState } from "react";
import type { Backend, UsageReport } from "../backend";
import { formatBytes, formatCpu } from "../format";

const REFRESH_MS = 2000;

/** The numbers exactly as the UI shows them; equal keys render identically. */
function displayKey(report: UsageReport): string {
  const machineCpu = report.total.cpuPercent / Math.max(1, report.cpuCount);
  const accounts = Object.entries(report.accounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, u]) => `${id}=${formatCpu(u.cpuPercent)},${formatBytes(u.memoryBytes)}`);
  return [formatCpu(machineCpu), formatBytes(report.total.memoryBytes), formatBytes(report.systemMemoryBytes), ...accounts].join("|");
}

/**
 * Polls the host for CPU / memory usage.
 *
 * Measuring is the main cost of an idle IdleHub, so it pauses while the window
 * is hidden and only hands out a new report when a shown number changed.
 */
export function useUsage(backend: Backend): UsageReport | null {
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const shown = useRef("");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = () =>
      backend.usage().then((report) => {
        if (cancelled) return;
        const key = displayKey(report);
        if (key === shown.current) return;
        shown.current = key;
        setUsage(report);
      }, () => {});
    const start = () => {
      clearInterval(timer);
      void refresh();
      timer = setInterval(refresh, REFRESH_MS);
    };
    const stop = () => clearInterval(timer);
    const onVisibility = () => (document.visibilityState === "hidden" ? stop() : start());

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [backend]);

  return usage;
}
