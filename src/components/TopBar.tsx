import { Columns2, LayoutGrid, LayoutPanelLeft, Minus, Plus, Square, X } from "lucide-react";
import type { UsageReport, WindowControls } from "../backend";
import { formatBytes, formatCpu } from "../format";
import { t } from "../strings";
import { Meter } from "./Meter";
import { NewTabForm } from "./NewTabForm";

const LAYOUT_ICONS = [Square, Columns2, LayoutPanelLeft, LayoutGrid];

interface TopBarProps {
  panes: number;
  usage: UsageReport | null;
  adding: boolean;
  error: string | null;
  windowControls: WindowControls;
  onSetPanes(count: number): void;
  onStartAdding(): void;
  onCancelAdding(): void;
  onAdd(label: string, url: string | undefined): Promise<boolean>;
}

export function TopBar(props: TopBarProps) {
  const { panes, usage, adding, error, windowControls } = props;
  const cpu = usage ? usage.total.cpuPercent / Math.max(1, usage.cpuCount) : 0;
  const memory = usage?.total.memoryBytes ?? 0;
  const systemMemory = usage?.systemMemoryBytes ?? 0;

  return (
    <header className={`top-bar ${windowControls.native ? "native-controls" : ""}`} data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <LayoutGrid className="brand-logo" size={28} aria-hidden="true" />
        <span>IdleHub</span>
      </div>

      {adding ? (
        <NewTabForm onSubmit={props.onAdd} onCancel={props.onCancelAdding} />
      ) : (
        <button type="button" className="primary new-tab" onClick={props.onStartAdding}>
          <Plus size={16} aria-hidden="true" />
          {t.newTab}
        </button>
      )}

      <div className="layout-picker" role="group">
        {LAYOUT_ICONS.map((Icon, i) => (
          <button
            key={i}
            type="button"
            aria-label={t.paneCount(i + 1)}
            aria-pressed={panes === i + 1}
            onClick={() => props.onSetPanes(i + 1)}
          >
            <Icon size={16} aria-hidden="true" />
            <span aria-hidden="true">{i + 1}</span>
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <div className="spacer" data-tauri-drag-region />

      <Meter label={t.cpu} percent={cpu} text={formatCpu(cpu)} />
      <Meter
        label={t.memory}
        percent={systemMemory ? (memory / systemMemory) * 100 : 0}
        text={`${formatBytes(memory)} / ${formatBytes(systemMemory)}`}
      />

      {!windowControls.native && (
        <div className="window-controls">
          <button type="button" className="icon-button" aria-label={t.minimize} onClick={() => void windowControls.minimize()}>
            <Minus size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t.maximize}
            onClick={() => void windowControls.toggleMaximize()}
          >
            <Square size={14} />
          </button>
          <button type="button" className="icon-button close" aria-label={t.close} onClick={() => void windowControls.close()}>
            <X size={18} />
          </button>
        </div>
      )}
    </header>
  );
}
