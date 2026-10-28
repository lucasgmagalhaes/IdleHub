import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface RenderPolicy {
  maxFps: number;
  muted: boolean;
}

export interface Tab {
  id: string;
  label: string;
  url: string;
  muted: boolean;
  pinned: boolean;
  /** Pane showing the tab, or null when it runs hidden. */
  pane: number | null;
  policy: RenderPolicy;
}

export interface TabsView {
  tabs: Tab[];
  panes: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Usage {
  cpuPercent: number;
  memoryBytes: number;
  processes: number;
}

export interface UsageReport {
  total: Usage;
  accounts: Record<string, Usage>;
  systemMemoryBytes: number;
  cpuCount: number;
}

/** Everything the UI needs from the host app; faked in tests. */
/** Frame caps; mirrors `PolicySettings` in crates/idlehub-core/src/policy.rs. */
export interface Settings {
  singlePaneFps: number;
  multiPaneFps: number;
  hiddenFps: number;
}

export interface Backend {
  getTabs(): Promise<TabsView>;
  addTab(label: string, url?: string): Promise<TabsView>;
  closeTab(id: string): Promise<TabsView>;
  setPanes(count: number): Promise<TabsView>;
  showInPane(pane: number, id: string): Promise<TabsView>;
  setMuted(id: string, muted: boolean): Promise<TabsView>;
  setPinned(id: string, pinned: boolean): Promise<TabsView>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<TabsView>;
  reloadTab(id: string): Promise<void>;
  /** Content area of each pane, in pane order, in window coordinates. */
  setPaneRects(rects: Rect[]): Promise<void>;
  usage(): Promise<UsageReport>;
  /** Problems the host hits outside of a command (a tab failing to load, for example). Returns an unsubscribe. */
  onHostError(listener: (message: string) => void): () => void;
}

/** Event the shell emits for errors that no command can return. */
export const HOST_ERROR_EVENT = "host-error";

export interface WindowControls {
  /** macOS keeps its native traffic lights, so the UI hides its own buttons. */
  native: boolean;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}

export const tauriBackend: Backend = {
  getTabs: () => invoke("get_tabs"),
  addTab: (label, url) => invoke("add_tab", { label, url: url || null }),
  closeTab: (id) => invoke("close_tab", { id }),
  setPanes: (count) => invoke("set_panes", { count }),
  showInPane: (pane, id) => invoke("show_in_pane", { pane, id }),
  setMuted: (id, muted) => invoke("set_muted", { id, muted }),
  setPinned: (id, pinned) => invoke("set_pinned", { id, pinned }),
  getSettings: () => invoke("get_settings"),
  setSettings: (settings) => invoke("set_settings", { settings }),
  reloadTab: (id) => invoke("reload_tab", { id }),
  setPaneRects: (rects) => invoke("set_pane_rects", { rects }),
  usage: () => invoke("usage_report"),
  onHostError: (listener) => {
    const unlisten = listen<string>(HOST_ERROR_EVENT, (event) => listener(event.payload));
    return () => void unlisten.then((stop) => stop());
  },
};

export const tauriWindowControls: WindowControls = {
  native: /Mac|iPhone|iPad|Android/.test(navigator.userAgent),
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
};
