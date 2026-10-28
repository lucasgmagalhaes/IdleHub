import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import type { TabsView } from "./backend";
import { createFakeBackend, createFakeWindowControls } from "./test/fakeBackend";

function prng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
}

const initial = [
  { id: "a", label: "Main", url: "https://huntera.com.br" },
  { id: "b", label: "Alt", url: "https://huntera.com.br" },
  { id: "c", label: "Farm", url: "https://huntera.com.br" },
];

/** The screen must show exactly what the backend holds. */
function expectScreenMatches(view: TabsView, mobile: boolean) {
  const panes = screen.getAllByRole("region", { name: /^Painel/ });
  expect(panes).toHaveLength(mobile ? 1 : view.panes);
  panes.forEach((pane, i) => {
    const tab = view.tabs.find((t) => t.pane === i);
    expect(pane).toHaveAccessibleName(`Painel ${i + 1}: ${tab?.label ?? "vazio"}`);
    if (!tab) return;
    expect(within(pane).getByRole("combobox")).toHaveValue(tab.id);
    expect(within(pane).getByRole("button", { name: "Som" })).toHaveAttribute("aria-pressed", String(!tab.muted));
    expect(within(pane).getByRole("button", { name: "Fechar aba" })).toHaveProperty("disabled", tab.pinned);
  });
  if (mobile) {
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs).toHaveLength(view.tabs.length);
  } else {
    expect(screen.getByText(new RegExp(`^${view.tabs.length} abas? ativas?$`))).toBeInTheDocument();
  }
}

describe.each(["desktop", "mobile"] as const)("random use of the %s app", (layout) => {
  const mobile = layout === "mobile";
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(Array.from({ length: 15 }, (_, i) => i + 1))("seed %i keeps the screen in line with the tabs", async (seed) => {
    const random = prng(seed);
    const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];
    vi.spyOn(window, "confirm").mockImplementation(() => random() < 0.7);
    const fake = createFakeBackend(initial, mobile ? 1 : 2);
    const user = userEvent.setup();
    render(<App backend={fake.backend} windowControls={createFakeWindowControls()} layout={layout} />);
    await screen.findAllByRole("region", { name: /^Painel/ });
    let added = 0;

    for (let step = 0; step < 25; step++) {
      const panes = screen.getAllByRole("region", { name: /^Painel/ });
      const pane = pick(panes);
      const actions: (() => Promise<void>)[] = [
        async () => {
          if (mobile) return;
          await user.click(screen.getByRole("button", { name: pick(["1 painel", "2 painéis", "3 painéis", "4 painéis"]) }));
        },
        async () => {
          const button = within(pane).queryByRole("button", { name: pick(["Som", "Fixar", "Fechar aba", "Recarregar"]) });
          if (button && !(button as HTMLButtonElement).disabled) await user.click(button);
        },
        async () => {
          const select = within(pane).queryByRole("combobox");
          if (!select || (select as HTMLSelectElement).disabled) return;
          const options = within(select)
            .getAllByRole("option")
            .filter((o) => !(o as HTMLOptionElement).disabled);
          await user.selectOptions(select, pick(options));
        },
        async () => {
          if (!mobile) return;
          await user.click(pick(within(screen.getByRole("tablist")).getAllByRole("tab")));
        },
        async () => {
          await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Nova aba" }));
          await user.type(screen.getByLabelText("Nome da aba"), `Tab${added++}{Enter}`);
          const cancel = within(screen.getByRole("banner")).queryByRole("button", { name: "Cancelar" });
          if (cancel) await user.click(cancel); // the account limit was reached
        },
      ];
      await pick(actions)();
      await act(async () => {});
      expectScreenMatches(await fake.backend.getTabs(), mobile);
      // Nothing the UI offers should be refused by the backend (the account limit aside).
      expect(screen.queryByRole("alert")?.textContent ?? "", `seed ${seed}, step ${step}`).not.toMatch(/pinned|not found/);
    }
  });
});
