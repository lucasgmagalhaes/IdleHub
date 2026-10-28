import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeBackend, createFakeWindowControls } from "./test/fakeBackend";

const tabs = [
  { id: "a", label: "Huntera Main", url: "https://huntera.com.br" },
  { id: "b", label: "Huntera Alt", url: "https://huntera.com.br" },
  { id: "c", label: "Huntera Farm", url: "https://huntera.com.br" },
];

function setup(initial = tabs) {
  const fake = createFakeBackend(initial, 1);
  const user = userEvent.setup();
  render(<App backend={fake.backend} windowControls={createFakeWindowControls(true)} layout="mobile" />);
  return { ...fake, user };
}

const tabBar = () => screen.getByRole("tablist", { name: "Abas" });

describe("App on mobile", () => {
  it("shows a single pane without the desktop layout picker or window buttons", async () => {
    setup();
    expect(await screen.findByRole("region", { name: "Painel 1: Huntera Main" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /^Painel/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "4 painéis" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fechar" })).not.toBeInTheDocument();
  });

  it("lists every tab in the bottom bar and marks the one on screen", async () => {
    setup();
    await screen.findByRole("region", { name: /^Painel 1/ });
    const items = within(tabBar()).getAllByRole("tab");
    expect(items.map((tab) => tab.textContent)).toEqual(["Huntera Main", "Huntera Alt", "Huntera Farm"]);
    expect(items[0]).toHaveAttribute("aria-selected", "true");
    expect(items[1]).toHaveAttribute("aria-selected", "false");
  });

  it("switches the tab on screen; the others keep running", async () => {
    const { backend, user } = setup();
    await screen.findByRole("region", { name: /^Painel 1/ });

    await user.click(within(tabBar()).getByRole("tab", { name: "Huntera Farm" }));

    expect(backend.showInPane).toHaveBeenCalledWith(0, "c");
    expect(await screen.findByRole("region", { name: "Painel 1: Huntera Farm" })).toBeInTheDocument();
    expect(within(tabBar()).getByRole("tab", { name: "Huntera Farm" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the tab bar order stable when switching", async () => {
    const { user } = setup();
    await screen.findByRole("region", { name: /^Painel 1/ });

    await user.click(within(tabBar()).getByRole("tab", { name: "Huntera Farm" }));
    await screen.findByRole("region", { name: "Painel 1: Huntera Farm" });

    const order = within(tabBar()).getAllByRole("tab").map((tab) => tab.textContent);
    expect(order).toEqual(["Huntera Main", "Huntera Alt", "Huntera Farm"]);
  });

  it("does nothing when tapping the tab already on screen", async () => {
    const { backend, user } = setup();
    await screen.findByRole("region", { name: /^Painel 1/ });
    await user.click(within(tabBar()).getByRole("tab", { name: "Huntera Main" }));
    expect(backend.showInPane).not.toHaveBeenCalled();
  });

  it("does not offer pinning, which would lock the only pane", async () => {
    setup();
    const pane = await screen.findByRole("region", { name: "Painel 1: Huntera Main" });
    expect(within(pane).queryByRole("button", { name: "Fixar" })).not.toBeInTheDocument();
  });

  it("opens a new tab from the top bar", async () => {
    const { backend, user } = setup();
    await screen.findByRole("region", { name: /^Painel 1/ });

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Nova aba" }));
    await user.type(screen.getByLabelText("Nome da aba"), "Huntera Bank{Enter}");

    expect(backend.addTab).toHaveBeenCalledWith("Huntera Bank", undefined);
    expect(await within(tabBar()).findByRole("tab", { name: "Huntera Bank" })).toBeInTheDocument();
  });

  it("shows how much memory the app uses", async () => {
    const fake = createFakeBackend(tabs, 1);
    fake.usage.total = { cpuPercent: 4, memoryBytes: 600 * 1024 * 1024, processes: 3 };
    render(<App backend={fake.backend} windowControls={createFakeWindowControls(true)} layout="mobile" />);
    expect(await screen.findByRole("meter", { name: "Memória" })).toBeInTheDocument();
    expect(await screen.findByText("600 MB")).toBeInTheDocument();
  });
});
