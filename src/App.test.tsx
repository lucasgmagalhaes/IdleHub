import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeBackend, createFakeWindowControls } from "./test/fakeBackend";

const GB = 1024 ** 3;
const cookie = { id: "a", label: "Cookie Clicker", url: "https://orteil.dashnet.org/cookieclicker/" };
const melvor = { id: "b", label: "Melvor Idle", url: "https://melvoridle.com", muted: false };
const farmer = { id: "c", label: "Farmer Against Potatoes", url: "https://farmeragainstpotatoes.com" };
const slayer = { id: "d", label: "Idle Slayer", url: "https://idleslayer.com" };

function setup(tabs = [cookie, melvor, farmer, slayer], panes = 4, native = false) {
  const fake = createFakeBackend(tabs, panes);
  const controls = createFakeWindowControls(native);
  const user = userEvent.setup();
  render(<App backend={fake.backend} windowControls={controls} />);
  return { ...fake, controls, user };
}

const panes = () => screen.queryAllByRole("region", { name: /^Painel/ });

describe("App", () => {
  it("ignores a slow response that a newer one already replaced", async () => {
    const { backend, user } = setup();
    await screen.findAllByRole("region", { name: /^Painel/ });
    let finishSlow: () => void = () => {};
    const stale = await backend.setPanes(1);
    backend.setPanes.mockImplementationOnce(() => new Promise((resolve) => (finishSlow = () => resolve(stale))));

    await user.click(screen.getByRole("button", { name: "1 painel" }));
    await user.click(screen.getByRole("button", { name: "3 painéis" }));
    expect(panes()).toHaveLength(3);
    await act(async () => finishSlow());

    expect(panes()).toHaveLength(3);
  });

  describe("top bar", () => {
    it("shows the brand and the layout picker with the current layout selected", async () => {
      setup();
      expect(screen.getByText("IdleHub")).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "4 painéis" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "1 painel" })).toHaveAttribute("aria-pressed", "false");
    });

    it("switches the number of panes", async () => {
      const { backend, user } = setup();
      await screen.findAllByRole("region", { name: /^Painel/ });

      await user.click(screen.getByRole("button", { name: "3 painéis" }));

      expect(backend.setPanes).toHaveBeenCalledWith(3);
      expect(panes()).toHaveLength(3);
      expect(screen.getByRole("button", { name: "3 painéis" })).toHaveAttribute("aria-pressed", "true");
    });

    it("shows cpu and memory meters for the whole machine", async () => {
      const fake = createFakeBackend([cookie]);
      fake.usage.total = { cpuPercent: 48, memoryBytes: 1.4 * GB, processes: 9 };
      render(<App backend={fake.backend} windowControls={createFakeWindowControls()} />);

      const cpu = await screen.findByRole("meter", { name: "CPU" });
      expect(cpu).toHaveAttribute("aria-valuenow", "12");
      expect(within(cpu.closest("div")!).getByText("12%")).toBeInTheDocument();
      const memory = screen.getByRole("meter", { name: "Memória" });
      expect(within(memory.closest("div")!).getByText("1.4 GB / 8 GB")).toBeInTheDocument();
    });

    it("offers window buttons except where the system draws them", async () => {
      const { controls, user } = setup();
      await user.click(screen.getByRole("button", { name: "Fechar" }));
      expect(controls.close).toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Minimizar" }));
      expect(controls.minimize).toHaveBeenCalled();
    });

    it("hides window buttons on macOS", () => {
      setup(undefined, undefined, true);
      expect(screen.queryByRole("button", { name: "Fechar" })).not.toBeInTheDocument();
    });
  });

  describe("new tab", () => {
    it("opens a tab with a name and url", async () => {
      const { backend, user } = setup([cookie]);
      await screen.findAllByRole("region", { name: /^Painel/ });

      await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Nova aba" }));
      await user.type(screen.getByLabelText("Nome da aba"), "Huntera Main");
      await user.type(screen.getByLabelText("Endereço"), "https://huntera.com.br{Enter}");

      expect(backend.addTab).toHaveBeenCalledWith("Huntera Main", "https://huntera.com.br");
      expect(await screen.findByRole("region", { name: "Painel 2: Huntera Main" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Nome da aba")).not.toBeInTheDocument();
    });

    it("defaults the address to the game when left empty", async () => {
      const { backend, user } = setup([]);
      await user.click(within(await screen.findByRole("banner")).getByRole("button", { name: "Nova aba" }));
      await user.type(screen.getByLabelText("Nome da aba"), "Main{Enter}");
      expect(backend.addTab).toHaveBeenCalledWith("Main", undefined);
    });

    it("can be cancelled with Escape", async () => {
      const { user } = setup([]);
      await user.click(within(await screen.findByRole("banner")).getByRole("button", { name: "Nova aba" }));
      await user.keyboard("{Escape}");
      expect(screen.queryByLabelText("Nome da aba")).not.toBeInTheDocument();
    });

    it("shows backend errors", async () => {
      const { user } = setup([cookie, melvor, farmer, slayer]);
      await screen.findAllByRole("region", { name: /^Painel/ });
      await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Nova aba" }));
      await user.type(screen.getByLabelText("Nome da aba"), "Extra{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent("account limit of 4 reached");
    });

    it("is offered inside empty panes", async () => {
      const { user } = setup([cookie], 2);
      const empty = await screen.findByRole("region", { name: "Painel 2: vazio" });
      await user.click(within(empty).getByRole("button", { name: "Nova aba" }));
      expect(screen.getByLabelText("Nome da aba")).toHaveFocus();
    });
  });

  describe("panes", () => {
    it("shows each visible tab with its name and address", async () => {
      setup();
      const first = await screen.findByRole("region", { name: "Painel 1: Cookie Clicker" });
      expect(within(first).getByText("orteil.dashnet.org/cookieclicker/")).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Painel 4: Idle Slayer" })).toBeInTheDocument();
    });

    it("lets a pane switch to a hidden tab", async () => {
      const { backend, user } = setup(undefined, 1);
      const pane = await screen.findByRole("region", { name: "Painel 1: Cookie Clicker" });

      await user.selectOptions(within(pane).getByRole("combobox", { name: "Aba do painel 1" }), "Idle Slayer");

      expect(backend.showInPane).toHaveBeenCalledWith(0, "d");
      expect(await screen.findByRole("region", { name: "Painel 1: Idle Slayer" })).toBeInTheDocument();
    });

    it("toggles sound per tab", async () => {
      const { backend, user } = setup();
      const pane = await screen.findByRole("region", { name: "Painel 2: Melvor Idle" });
      const sound = within(pane).getByRole("button", { name: "Som" });
      expect(sound).toHaveAttribute("aria-pressed", "true");

      await user.click(sound);

      expect(backend.setMuted).toHaveBeenCalledWith("b", true);
      expect(within(pane).getByRole("button", { name: "Som" })).toHaveAttribute("aria-pressed", "false");
    });

    it("pins a tab, which protects it from closing", async () => {
      const { backend, user } = setup();
      const pane = await screen.findByRole("region", { name: "Painel 1: Cookie Clicker" });

      await user.click(within(pane).getByRole("button", { name: "Fixar" }));

      expect(backend.setPinned).toHaveBeenCalledWith("a", true);
      expect(within(pane).getByRole("button", { name: "Fixar" })).toHaveAttribute("aria-pressed", "true");
      expect(within(pane).getByRole("button", { name: "Fechar aba" })).toBeDisabled();
    });

    it("does not offer to move a pinned tab out of its pane", async () => {
      const { user } = setup([cookie, melvor, farmer], 2);
      const first = await screen.findByRole("region", { name: "Painel 1: Cookie Clicker" });
      await user.click(within(first).getByRole("button", { name: "Fixar" }));

      expect(within(first).getByRole("combobox", { name: "Aba do painel 1" })).toBeDisabled();
      const second = screen.getByRole("region", { name: "Painel 2: Melvor Idle" });
      const option = within(second).getByRole("option", { name: "Cookie Clicker" });
      expect(option).toBeDisabled();
      expect(within(second).getByRole("option", { name: "Farmer Against Potatoes" })).toBeEnabled();
    });

    it("reloads a tab", async () => {
      const { backend, user } = setup();
      const pane = await screen.findByRole("region", { name: "Painel 3: Farmer Against Potatoes" });
      await user.click(within(pane).getByRole("button", { name: "Recarregar" }));
      expect(backend.reloadTab).toHaveBeenCalledWith("c");
    });

    it("closes a tab after confirmation", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { backend, user } = setup();
      const pane = await screen.findByRole("region", { name: "Painel 4: Idle Slayer" });

      await user.click(within(pane).getByRole("button", { name: "Fechar aba" }));

      expect(backend.closeTab).toHaveBeenCalledWith("d");
      expect(await screen.findByRole("region", { name: "Painel 4: vazio" })).toBeInTheDocument();
    });

    it("keeps the tab when closing is not confirmed", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const { backend, user } = setup();
      const pane = await screen.findByRole("region", { name: "Painel 4: Idle Slayer" });
      await user.click(within(pane).getByRole("button", { name: "Fechar aba" }));
      expect(backend.closeTab).not.toHaveBeenCalled();
    });

    it("reports the content area of every pane to the host", async () => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const pane = Number(this.dataset.paneContent ?? -1);
        return { x: pane * 100, y: 60, width: 100, height: 200 } as DOMRect;
      });
      const { backend } = setup(undefined, 2);
      await screen.findAllByRole("region", { name: /^Painel/ });

      act(() => (globalThis as unknown as { triggerResize(): void }).triggerResize());

      expect(backend.setPaneRects).toHaveBeenLastCalledWith([
        { x: 0, y: 60, width: 100, height: 200 },
        { x: 100, y: 60, width: 100, height: 200 },
      ]);
      vi.restoreAllMocks();
    });
  });

  describe("status bar", () => {
    it("counts running tabs, including hidden ones", async () => {
      setup(undefined, 1);
      expect(await screen.findByText("4 abas ativas")).toBeInTheDocument();
    });

    it("uses the singular for one tab", async () => {
      setup([cookie]);
      expect(await screen.findByText("1 aba ativa")).toBeInTheDocument();
    });

    it("shows memory use against the machine total", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fake = createFakeBackend([cookie]);
      fake.usage.total = { cpuPercent: 4, memoryBytes: 1.4 * GB, processes: 5 };
      render(<App backend={fake.backend} windowControls={createFakeWindowControls()} />);

      const status = await screen.findByRole("contentinfo");
      expect(await within(status).findByText("1.4 GB / 8 GB")).toBeInTheDocument();
      expect(within(status).getByText("18%")).toBeInTheDocument();

      fake.usage.total = { cpuPercent: 4, memoryBytes: 2 * GB, processes: 5 };
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(within(status).getByText("2 GB / 8 GB")).toBeInTheDocument();
      vi.useRealTimers();
    });
  });
});
