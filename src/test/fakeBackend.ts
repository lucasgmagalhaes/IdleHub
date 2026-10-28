import type { Backend, Settings, Tab, TabsView, UsageReport, WindowControls } from "../backend";

type TabInput = Pick<Tab, "label" | "url"> & Partial<Pick<Tab, "id" | "muted" | "pinned">>;

/** In-memory backend mirroring the Rust workspace rules closely enough for UI tests. */
export function createFakeBackend(initial: TabInput[] = [], panes = 4, max = 4) {
  let nextId = 1;
  let tabs = initial.map((t) => ({ id: t.id ?? `id-${nextId++}`, muted: true, pinned: false, ...t }));
  let paneCount = panes;
  let settings: Settings = { singlePaneFps: 60, multiPaneFps: 30, hiddenFps: 1 };
  const usage: UsageReport = {
    total: { cpuPercent: 0, memoryBytes: 0, processes: 0 },
    accounts: {},
    systemMemoryBytes: 8 * 1024 ** 3,
    cpuCount: 4,
  };

  const view = (): TabsView => ({
    panes: paneCount,
    tabs: tabs.map((t, i) => ({
      ...t,
      pane: i < paneCount ? i : null,
      policy: {
        maxFps: i >= paneCount ? settings.hiddenFps : paneCount === 1 ? settings.singlePaneFps : settings.multiPaneFps,
        muted: i >= paneCount || t.muted,
      },
    })),
  });
  const find = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) throw "account not found";
    return tab;
  };

  const backend = {
    getTabs: vi.fn(async () => view()),
    addTab: vi.fn(async (label: string, url?: string) => {
      if (tabs.length >= max) throw `account limit of ${max} reached`;
      if (!label.trim()) throw "label must not be empty";
      tabs.push({ id: `id-${nextId++}`, label: label.trim(), url: url || "https://huntera.com.br", muted: true, pinned: false });
      return view();
    }),
    closeTab: vi.fn(async (id: string) => {
      if (find(id).pinned) throw "pinned tabs must be unpinned first";
      tabs = tabs.filter((t) => t.id !== id);
      return view();
    }),
    setPanes: vi.fn(async (count: number) => {
      paneCount = count;
      return view();
    }),
    showInPane: vi.fn(async (pane: number, id: string) => {
      const from = tabs.indexOf(find(id));
      const to = Math.min(pane, tabs.length - 1);
      [tabs[from], tabs[to]] = [tabs[to], tabs[from]];
      return view();
    }),
    setMuted: vi.fn(async (id: string, muted: boolean) => {
      find(id).muted = muted;
      return view();
    }),
    setPinned: vi.fn(async (id: string, pinned: boolean) => {
      find(id).pinned = pinned;
      return view();
    }),
    getSettings: vi.fn(async () => ({ ...settings })),
    setSettings: vi.fn(async (next: Settings) => {
      settings = { ...next };
      return view();
    }),
    reloadTab: vi.fn(async (_id: string) => {}),
    setPaneRects: vi.fn(async () => {}),
    usage: vi.fn(async () => structuredClone(usage)),
  } satisfies Backend;

  return { backend, usage };
}

export function createFakeWindowControls(native = false) {
  return {
    native,
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } satisfies WindowControls;
}
