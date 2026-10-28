import { Lock, Pin, Plus, RotateCw, Volume2, VolumeX, X } from "lucide-react";
import type { Tab } from "../backend";
import { displayUrl } from "../format";
import { t } from "../strings";
import { Favicon } from "./Favicon";

interface PaneProps {
  index: number;
  tab: Tab | undefined;
  tabs: Tab[];
  /** Phones have one pane; pinning it would make switching tabs impossible. */
  canPin?: boolean;
  onShow(pane: number, id: string): void;
  onReload(id: string): void;
  onToggleMute(tab: Tab): void;
  onTogglePin(tab: Tab): void;
  onClose(tab: Tab): void;
  onNewTab(): void;
}

export function Pane({ index, tab, tabs, canPin = true, ...actions }: PaneProps) {
  const number = index + 1;
  return (
    <section className="pane" aria-label={t.pane(number, tab?.label ?? null)}>
      {tab ? (
        <div className="pane-header">
          <Favicon url={tab.url} label={tab.label} />
          <select
            className="pane-title"
            aria-label={t.paneTab(number)}
            value={tab.id}
            disabled={tab.pinned}
            onChange={(e) => actions.onShow(index, e.target.value)}
          >
            {tabs.map((option) => (
              // Pinned tabs on screen stay in their pane.
              <option key={option.id} value={option.id} disabled={option.id !== tab.id && option.pinned && option.pane !== null}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="pane-url">
            <Lock size={14} aria-hidden="true" />
            <span>{displayUrl(tab.url)}</span>
          </span>
          <div className="pane-actions">
            <button type="button" className="icon-button" aria-label={t.reload} onClick={() => actions.onReload(tab.id)}>
              <RotateCw size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t.sound}
              aria-pressed={!tab.muted}
              onClick={() => actions.onToggleMute(tab)}
            >
              {tab.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            {canPin && (
              <button
                type="button"
                className="icon-button"
                aria-label={t.pin}
                aria-pressed={tab.pinned}
                onClick={() => actions.onTogglePin(tab)}
              >
                <Pin size={16} />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={t.closeTab}
              disabled={tab.pinned}
              onClick={() => actions.onClose(tab)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="pane-header" />
      )}
      {/* The native game webview is placed over this element by the host. */}
      <div className="pane-content" data-pane-content={index}>
        {!tab && (
          <div className="pane-empty">
            <p>{t.emptyPane}</p>
            <button type="button" className="primary" onClick={actions.onNewTab}>
              <Plus size={16} aria-hidden="true" />
              {t.newTab}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
