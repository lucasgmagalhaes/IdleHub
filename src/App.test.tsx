import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeBackend } from "./test/fakeBackend";

const main = { id: "a", label: "Main", url: "https://huntera.com.br" };
const alt = { id: "b", label: "Alt", url: "https://huntera.com.br" };

describe("App", () => {
  it("lists the accounts from the backend", async () => {
    const { backend } = createFakeBackend([main, alt]);
    render(<App backend={backend} />);
    expect(await screen.findByRole("button", { name: /^Main/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Alt/ })).toBeInTheDocument();
  });

  it("focuses an account and returns to the grid", async () => {
    const user = userEvent.setup();
    const { backend } = createFakeBackend([main, alt]);
    render(<App backend={backend} />);

    await user.click(await screen.findByRole("button", { name: /^Alt/ }));
    expect(backend.focusAccount).toHaveBeenLastCalledWith("b");
    expect(screen.getByRole("button", { name: /^Alt/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Grid" }));
    expect(backend.focusAccount).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: /^Alt/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("returns to the grid with Escape", async () => {
    const user = userEvent.setup();
    const { backend } = createFakeBackend([main]);
    render(<App backend={backend} />);
    await user.click(await screen.findByRole("button", { name: /^Main/ }));
    await user.keyboard("{Escape}");
    expect(backend.focusAccount).toHaveBeenLastCalledWith(null);
  });

  it("adds an account", async () => {
    const user = userEvent.setup();
    const { backend } = createFakeBackend([main]);
    render(<App backend={backend} />);
    await screen.findByRole("button", { name: /^Main/ });

    await user.type(screen.getByLabelText("Account name"), "Farm{Enter}");

    expect(backend.addAccount).toHaveBeenCalledWith("Farm", undefined);
    expect(await screen.findByRole("button", { name: /^Farm/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toHaveValue("");
  });

  it("shows backend errors when adding fails", async () => {
    const user = userEvent.setup();
    const { backend } = createFakeBackend([main]);
    backend.addAccount.mockRejectedValueOnce("label \"main\" is already used");
    render(<App backend={backend} />);
    await screen.findByRole("button", { name: /^Main/ });

    await user.type(screen.getByLabelText("Account name"), "main{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent('label "main" is already used');
  });

  it("hides the add form when the account limit is reached", async () => {
    const accounts = ["A", "B", "C", "D"].map((label) => ({ id: label, label, url: "" }));
    const { backend } = createFakeBackend(accounts);
    render(<App backend={backend} />);
    await screen.findByRole("button", { name: /^A/ });
    expect(screen.queryByLabelText("Account name")).not.toBeInTheDocument();
  });

  it("removes an account after confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { backend } = createFakeBackend([main, alt]);
    render(<App backend={backend} />);
    await screen.findByRole("button", { name: /^Main/ });

    await user.click(screen.getByRole("button", { name: "Remove Main" }));

    expect(backend.removeAccount).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("button", { name: /^Main/ })).not.toBeInTheDocument();
  });

  it("reloads an account", async () => {
    const user = userEvent.setup();
    const { backend } = createFakeBackend([main]);
    render(<App backend={backend} />);
    await user.click(await screen.findByRole("button", { name: "Reload Main" }));
    expect(backend.reloadAccount).toHaveBeenCalledWith("a");
  });

  it("shows resource usage per account and in total, refreshed periodically", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { backend, usage } = createFakeBackend([main]);
    usage.total = { cpuPercent: 12.5, memoryBytes: 300 * 1024 * 1024, processes: 5 };
    usage.accounts = { a: { cpuPercent: 4.2, memoryBytes: 120 * 1024 * 1024, processes: 2 } };
    render(<App backend={backend} />);

    const account = await screen.findByRole("button", { name: /^Main/ });
    expect(await within(account).findByText("4.2% · 120 MB")).toBeInTheDocument();
    expect(screen.getByText("Total 13% · 300 MB")).toBeInTheDocument();

    usage.total = { cpuPercent: 2, memoryBytes: 200 * 1024 * 1024, processes: 5 };
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText("Total 2% · 200 MB")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
