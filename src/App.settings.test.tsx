import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeBackend, createFakeWindowControls } from "./test/fakeBackend";

const tabs = [
  { id: "a", label: "Main", url: "https://huntera.com.br" },
  { id: "b", label: "Alt", url: "https://huntera.com.br" },
];

function setup(layout: "desktop" | "mobile" = "desktop") {
  const fake = createFakeBackend(tabs, layout === "mobile" ? 1 : 2);
  const user = userEvent.setup();
  render(<App backend={fake.backend} windowControls={createFakeWindowControls()} layout={layout} />);
  return { ...fake, user };
}

const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findAllByRole("region", { name: /^Painel/ });
  await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Configurações" }));
  return screen.findByRole("region", { name: "Configurações" });
};

describe("settings", () => {
  it("shows the current frame caps in place of the panes", async () => {
    const { user } = setup();
    const settings = await openSettings(user);

    expect(within(settings).getByLabelText("Painel único")).toHaveValue("60");
    expect(within(settings).getByLabelText("Vários painéis")).toHaveValue("30");
    expect(within(settings).getByLabelText("Abas escondidas")).toHaveValue("1");
    // The games keep running parked while the settings page is open.
    expect(screen.queryAllByRole("region", { name: /^Painel/ })).toHaveLength(0);
  });

  it("saves new frame caps and returns to the panes", async () => {
    const { backend, user } = setup();
    const settings = await openSettings(user);

    await user.selectOptions(within(settings).getByLabelText("Vários painéis"), "20");
    await user.click(within(settings).getByRole("button", { name: "Salvar" }));

    expect(backend.setSettings).toHaveBeenCalledWith({ singlePaneFps: 60, multiPaneFps: 20, hiddenFps: 1 });
    expect(await screen.findAllByRole("region", { name: /^Painel/ })).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Configurações" })).not.toBeInTheDocument();
  });

  it("can be left without saving", async () => {
    const { backend, user } = setup();
    const settings = await openSettings(user);
    await user.selectOptions(within(settings).getByLabelText("Painel único"), "30");
    await user.click(within(settings).getByRole("button", { name: "Cancelar" }));

    expect(backend.setSettings).not.toHaveBeenCalled();
    expect(await screen.findAllByRole("region", { name: /^Painel/ })).toHaveLength(2);
  });

  it("offers the frame rates measured in the performance log", async () => {
    const { user } = setup();
    const settings = await openSettings(user);
    const options = within(within(settings).getByLabelText("Abas escondidas")).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["60", "45", "30", "24", "20", "15", "10", "5", "2", "1"]);
  });

  it("can still be left when the frame caps fail to load", async () => {
    const { backend, user } = setup();
    backend.getSettings.mockRejectedValueOnce("settings unavailable");
    const settings = await openSettings(user);

    expect(await within(settings).findByRole("alert")).toHaveTextContent("settings unavailable");
    await user.click(within(settings).getByRole("button", { name: "Cancelar" }));
    expect(await screen.findAllByRole("region", { name: /^Painel/ })).toHaveLength(2);
  });

  it("shows a saved frame cap that is not among the offered ones", async () => {
    const { backend, user } = setup();
    backend.getSettings.mockResolvedValueOnce({ singlePaneFps: 50, multiPaneFps: 30, hiddenFps: 1 });
    const settings = await openSettings(user);

    expect(within(settings).getByLabelText("Painel único")).toHaveValue("50");
    await user.click(within(settings).getByRole("button", { name: "Salvar" }));
    expect(backend.setSettings).toHaveBeenCalledWith({ singlePaneFps: 50, multiPaneFps: 30, hiddenFps: 1 });
  });

  it("is reachable on phones too", async () => {
    const { user } = setup("mobile");
    expect(await openSettings(user)).toBeInTheDocument();
  });
});
