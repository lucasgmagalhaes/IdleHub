import type { Account, Backend, UsageReport } from "../backend";

export function createFakeBackend(initial: Account[] = [], max = 4) {
  let accounts = [...initial];
  let nextId = 1;
  const usage: UsageReport = { total: { cpuPercent: 0, memoryBytes: 0, processes: 0 }, accounts: {} };
  const backend = {
    listAccounts: vi.fn(async () => [...accounts]),
    addAccount: vi.fn(async (label: string, url?: string) => {
      if (accounts.length >= max) throw `account limit of ${max} reached`;
      if (!label.trim()) throw "label must not be empty";
      const account = { id: `id-${nextId++}`, label: label.trim(), url: url || "https://huntera.com.br" };
      accounts.push(account);
      return account;
    }),
    removeAccount: vi.fn(async (id: string) => {
      accounts = accounts.filter((a) => a.id !== id);
    }),
    focusAccount: vi.fn(async (_id: string | null) => {}),
    reloadAccount: vi.fn(async (_id: string) => {}),
    usage: vi.fn(async () => structuredClone(usage)),
  } satisfies Backend;
  return { backend, usage };
}
