import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Account, Backend, Usage, UsageReport } from "./backend";
import { formatBytes, formatCpu } from "./format";
import "./App.css";

export const MAX_ACCOUNTS = 4;
const USAGE_REFRESH_MS = 2000;

function describeUsage(usage: Usage | undefined): string {
  return usage ? `${formatCpu(usage.cpuPercent)} · ${formatBytes(usage.memoryBytes)}` : "–";
}

export function App({ backend }: { backend: Backend }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    try {
      setError(null);
      await action();
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void run(async () => setAccounts(await backend.listAccounts()));
  }, [backend, run]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      backend.usage().then(
        (report) => !cancelled && setUsage(report),
        () => {},
      );
    void refresh();
    const timer = setInterval(refresh, USAGE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [backend]);

  const focus = useCallback(
    (id: string | null) =>
      run(async () => {
        await backend.focusAccount(id);
        setFocused(id);
      }),
    [backend, run],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void focus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const account = await backend.addAccount(newLabel, undefined);
      setAccounts((current) => [...current, account]);
      setNewLabel("");
    });
  };

  const remove = (account: Account) => {
    if (!window.confirm(`Remove ${account.label}? Its session data will be deleted.`)) return;
    void run(async () => {
      await backend.removeAccount(account.id);
      setAccounts((current) => current.filter((a) => a.id !== account.id));
      if (focused === account.id) setFocused(null);
    });
  };

  return (
    <header className="toolbar">
      <button type="button" className="mode" aria-pressed={focused === null} onClick={() => void focus(null)}>
        Grid
      </button>
      <ul className="accounts">
        {accounts.map((account) => (
          <li key={account.id} className="account">
            <button
              type="button"
              className="account-focus"
              aria-pressed={focused === account.id}
              onClick={() => void focus(account.id)}
            >
              <span className="account-label">{account.label}</span>
              <small>{describeUsage(usage?.accounts[account.id])}</small>
            </button>
            <button
              type="button"
              className="icon"
              aria-label={`Reload ${account.label}`}
              onClick={() => void run(() => backend.reloadAccount(account.id))}
            >
              ⟳
            </button>
            <button type="button" className="icon" aria-label={`Remove ${account.label}`} onClick={() => remove(account)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      {accounts.length < MAX_ACCOUNTS && (
        <form className="add" onSubmit={add}>
          <input
            aria-label="Account name"
            placeholder="New account"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <span className="total">{usage ? `Total ${describeUsage(usage.total)}` : ""}</span>
    </header>
  );
}
