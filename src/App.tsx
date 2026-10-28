import { useCallback, useEffect, useRef, useState } from "react";
import type { Backend, Rect, Settings, Tab, TabsView, WindowControls } from "./backend";
import { Pane } from "./components/Pane";
import { SettingsView } from "./components/SettingsView";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { TopBar } from "./components/TopBar";
import { usePaneRects } from "./hooks/usePaneRects";
import { useUsage } from "./hooks/useUsage";
import { t } from "./strings";
import "./App.css";

interface AppProps {
  backend: Backend;
  windowControls: WindowControls;
  /** Phones show one pane and a bottom tab bar. */
  layout?: "desktop" | "mobile";
}

export function App({ backend, windowControls, layout = "desktop" }: AppProps) {
  const mobile = layout === "mobile";
  const [view, setView] = useState<TabsView>({ tabs: [], panes: 4 });
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usage = useUsage(backend);
  const grid = useRef<HTMLElement>(null);

  /** Runs a command that returns the new tabs view; reports failures in the top bar. */
  const run = useCallback(async (command: () => Promise<TabsView | void>) => {
    try {
      setError(null);
      const next = await command();
      if (next) setView(next);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, []);

  useEffect(() => {
    void run(() => backend.getTabs());
  }, [backend, run]);

  const reportRects = useCallback((rects: Rect[]) => void backend.setPaneRects(rects).catch(() => {}), [backend]);
  const visible = view.tabs.filter((tab) => tab.pane !== null).map((tab) => tab.id);
  usePaneRects(grid, `${view.panes}:${visible.join(",")}:${adding}:${settingsOpen}`, reportRects);
  const loadSettings = useCallback(() => backend.getSettings(), [backend]);
  const saveSettings = (settings: Settings) => run(() => backend.setSettings(settings));

  const close = (tab: Tab) => {
    if (window.confirm(t.confirmClose(tab.label))) void run(() => backend.closeTab(tab.id));
  };

  const add = async (label: string, url: string | undefined) => {
    const ok = await run(() => backend.addTab(label, url));
    if (ok) setAdding(false);
    return ok;
  };

  const tabInPane = (pane: number) => view.tabs.find((tab) => tab.pane === pane);

  return (
    <div className={`app ${mobile ? "mobile" : ""}`}>
      <TopBar
        compact={mobile}
        panes={view.panes}
        usage={usage}
        adding={adding}
        error={error}
        windowControls={windowControls}
        onSetPanes={(count) => void run(() => backend.setPanes(count))}
        onStartAdding={() => setAdding(true)}
        onCancelAdding={() => {
          setAdding(false);
          setError(null);
        }}
        onAdd={add}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main ref={grid} className={settingsOpen ? "settings-page" : `pane-grid panes-${view.panes}`}>
        {settingsOpen && <SettingsView load={loadSettings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
        {!settingsOpen && Array.from({ length: view.panes }, (_, pane) => (
          <Pane
            key={pane}
            index={pane}
            tab={tabInPane(pane)}
            tabs={view.tabs}
            onShow={(index, id) => void run(() => backend.showInPane(index, id))}
            onReload={(id) => void run(() => backend.reloadTab(id))}
            onToggleMute={(tab) => void run(() => backend.setMuted(tab.id, !tab.muted))}
            onTogglePin={(tab) => void run(() => backend.setPinned(tab.id, !tab.pinned))}
            onClose={close}
            onNewTab={() => setAdding(true)}
          />
        ))}
      </main>
      {mobile ? (
        <TabBar tabs={view.tabs} onSelect={(id) => void run(() => backend.showInPane(0, id))} />
      ) : (
        <StatusBar tabCount={view.tabs.length} usage={usage} />
      )}
    </div>
  );
}
