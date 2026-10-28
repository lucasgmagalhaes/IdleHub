import { useRef } from "react";
import type { Tab } from "../backend";
import { Favicon } from "./Favicon";

interface TabBarProps {
  tabs: Tab[];
  onSelect(id: string): void;
}

/** Bottom tab bar on phones: one tab on screen, the others keep running hidden. */
export function TabBar({ tabs, onSelect }: TabBarProps) {
  // Showing a tab swaps it into the first slot; the bar keeps the order tabs were first seen in.
  const seen = useRef<string[]>([]);
  const ids = new Set(tabs.map((tab) => tab.id));
  seen.current = [...seen.current.filter((id) => ids.has(id)), ...tabs.map((t) => t.id).filter((id) => !seen.current.includes(id))];
  const ordered = seen.current.map((id) => tabs.find((tab) => tab.id === id)!);

  return (
    <nav className="tab-bar" role="tablist" aria-label="Abas">
      {ordered.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.pane === 0}
          onClick={() => tab.pane !== 0 && onSelect(tab.id)}
        >
          <Favicon url={tab.url} label={tab.label} />
          <span className="tab-bar-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
