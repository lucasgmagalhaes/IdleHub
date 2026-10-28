import { act, renderHook } from "@testing-library/react";
import { useUsage } from "./useUsage";
import { createFakeBackend } from "../test/fakeBackend";

const MB = 1024 * 1024;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useUsage", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("refreshes every 2 seconds", async () => {
    const { backend, usage } = createFakeBackend();
    const { result } = renderHook(() => useUsage(backend));
    await act(() => vi.advanceTimersByTimeAsync(0));
    usage.total.memoryBytes = 300 * MB;
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current?.total.memoryBytes).toBe(300 * MB);
  });

  it("keeps the same report while the shown numbers do not change, so nothing re-renders", async () => {
    const { backend, usage } = createFakeBackend();
    usage.total = { cpuPercent: 12.3, memoryBytes: 300 * MB, processes: 5 };
    const { result } = renderHook(() => useUsage(backend));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const first = result.current;

    usage.total = { cpuPercent: 12.31, memoryBytes: 300 * MB + 1000, processes: 5 };
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current).toBe(first);

    usage.total = { cpuPercent: 20, memoryBytes: 300 * MB, processes: 5 };
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current).not.toBe(first);
  });

  it("does not pile up requests while the host is slow to answer", async () => {
    // A full process scan can take longer than the refresh interval on a busy machine.
    const { backend, usage } = createFakeBackend();
    let answer: () => void = () => {};
    backend.usage.mockImplementation(() => new Promise((resolve) => (answer = () => resolve(structuredClone(usage)))));
    renderHook(() => useUsage(backend));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(backend.usage).toHaveBeenCalledTimes(1);

    await act(async () => answer());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(backend.usage).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after a failed request", async () => {
    const { backend } = createFakeBackend();
    backend.usage.mockRejectedValueOnce("sampler busy");
    const { result } = renderHook(() => useUsage(backend));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current).not.toBeNull();
  });

  it("stops polling while the window is hidden and refreshes as soon as it is back", async () => {
    const { backend } = createFakeBackend();
    renderHook(() => useUsage(backend));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const calls = backend.usage.mock.calls.length;

    act(() => setVisibility("hidden"));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(backend.usage.mock.calls.length).toBe(calls);

    act(() => setVisibility("visible"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(backend.usage.mock.calls.length).toBe(calls + 1);
  });
});
