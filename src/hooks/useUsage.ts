import { useEffect, useState } from "react";
import type { Backend, UsageReport } from "../backend";

const REFRESH_MS = 2000;

/** Polls the host for CPU / memory usage. */
export function useUsage(backend: Backend): UsageReport | null {
  const [usage, setUsage] = useState<UsageReport | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      backend.usage().then(
        (report) => !cancelled && setUsage(report),
        () => {},
      );
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [backend]);
  return usage;
}
