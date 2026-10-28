import type { UsageReport } from "../backend";
import { formatBytes } from "../format";
import { t } from "../strings";

export function StatusBar({ tabCount, usage }: { tabCount: number; usage: UsageReport | null }) {
  const memory = usage?.total.memoryBytes ?? 0;
  const systemMemory = usage?.systemMemoryBytes ?? 0;
  const percent = systemMemory ? Math.round((memory / systemMemory) * 100) : 0;
  return (
    <footer className="status-bar">
      <span className="status-active">
        <span className="status-dot" aria-hidden="true" />
        {t.activeTabs(tabCount)}
      </span>
      <span className="status-memory">
        <span>{t.memoryUsage}</span>
        <span>{`${formatBytes(memory)} / ${formatBytes(systemMemory)}`}</span>
        <span className="meter-track" aria-hidden="true">
          <span className="meter-fill" style={{ width: `${percent}%` }} />
        </span>
        <span>{`${percent}%`}</span>
      </span>
    </footer>
  );
}
