import "@testing-library/jest-dom/vitest";

// jsdom has no layout engine; tests drive resize notifications by hand.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
(globalThis as { triggerResize?: () => void }).triggerResize = () =>
  FakeResizeObserver.instances.forEach((o) => o.trigger());
