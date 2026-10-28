import type { Backend, Settings, Tab, TabsView, UsageReport, WindowControls } from "./backend";

/**
 * In-browser stand-in for the Tauri host, used by `pnpm dev` outside the app
 * shell to work on the UI. Game webviews are not available here.
 */
export function createDemoBackend(initialPanes = 4): Backend {
  let nextId = 1;
  let panes = initialPanes;
  let settings: Settings = { singlePaneFps: 60, multiPaneFps: 30, hiddenFps: 1 };
  let tabs: Omit<Tab, "pane" | "policy">[] = [
    ["Cookie Clicker", "https://orteil.dashnet.org/cookieclicker/", true],
    ["Melvor Idle", "https://melvoridle.com", false],
    ["Farmer Against Potatoes", "https://farmeragainstpotatoes.com", true],
    ["Idle Slayer", "https://idleslayer.com", false],
  ].map(([label, url, muted]) => ({ id: `demo-${nextId++}`, label: String(label), url: String(url), muted: Boolean(muted), pinned: false }));

  const view = (): TabsView => ({
    panes,
    tabs: tabs.map((tab, i) => ({ ...tab, pane: i < panes ? i : null, policy: { maxFps: 30, muted: tab.muted } })),
  });
  const find = (id: string) => tabs.find((tab) => tab.id === id)!;

  return {
    getTabs: async () => view(),
    addTab: async (label, url) => {
      if (tabs.length >= 4) throw "account limit of 4 reached";
      tabs.push({ id: `demo-${nextId++}`, label, url: url ?? "https://huntera.com.br", muted: true, pinned: false });
      return view();
    },
    closeTab: async (id) => {
      tabs = tabs.filter((tab) => tab.id !== id);
      return view();
    },
    setPanes: async (count) => {
      panes = count;
      return view();
    },
    showInPane: async (pane, id) => {
      const from = tabs.indexOf(find(id));
      const to = Math.min(pane, tabs.length - 1);
      [tabs[from], tabs[to]] = [tabs[to], tabs[from]];
      return view();
    },
    setMuted: async (id, muted) => {
      find(id).muted = muted;
      return view();
    },
    setPinned: async (id, pinned) => {
      find(id).pinned = pinned;
      return view();
    },
    getSettings: async () => ({ ...settings }),
    setSettings: async (next) => {
      settings = { ...next };
      return view();
    },
    reloadTab: async () => {},
    setPaneRects: async () => {},
    usage: async (): Promise<UsageReport> => ({
      total: { cpuPercent: 48 + Math.random() * 8, memoryBytes: 1.4 * 1024 ** 3, processes: 9 },
      accounts: {},
      systemMemoryBytes: 8 * 1024 ** 3,
      cpuCount: 4,
    }),
  };
}

export const demoWindowControls: WindowControls = {
  native: false,
  minimize: async () => {},
  toggleMaximize: async () => {},
  close: async () => {},
};
