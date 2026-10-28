import { invoke } from "@tauri-apps/api/core";

export interface Account {
  id: string;
  label: string;
  url: string;
}

export interface Usage {
  cpuPercent: number;
  memoryBytes: number;
  processes: number;
}

export interface UsageReport {
  total: Usage;
  accounts: Record<string, Usage>;
}

/** Everything the UI needs from the host app; faked in tests. */
export interface Backend {
  listAccounts(): Promise<Account[]>;
  addAccount(label: string, url?: string): Promise<Account>;
  removeAccount(id: string): Promise<void>;
  /** `null` shows the grid, an id focuses that account. */
  focusAccount(id: string | null): Promise<void>;
  reloadAccount(id: string): Promise<void>;
  usage(): Promise<UsageReport>;
}

export const tauriBackend: Backend = {
  listAccounts: () => invoke("list_accounts"),
  addAccount: (label, url) => invoke("add_account", { label, url: url || null }),
  removeAccount: (id) => invoke("remove_account", { id }),
  focusAccount: (id) => invoke("focus_account", { id }),
  reloadAccount: (id) => invoke("reload_account", { id }),
  usage: () => invoke("usage_report"),
};
