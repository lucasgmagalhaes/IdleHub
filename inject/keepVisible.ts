/**
 * Makes the page believe it is always visible and focused.
 *
 * Games commonly pause, throttle or disconnect when the tab is hidden or loses
 * focus. In IdleHub several accounts share the screen (and on mobile most of
 * them are off-screen), so those signals must never reach the game.
 */
const SWALLOWED_DOCUMENT_EVENTS = ["visibilitychange", "webkitvisibilitychange"];

export function installKeepVisible(win: Window): () => void {
  const doc = win.document;
  const overrides: Record<string, PropertyDescriptor> = {
    visibilityState: { configurable: true, get: () => "visible" },
    webkitVisibilityState: { configurable: true, get: () => "visible" },
    hidden: { configurable: true, get: () => false },
    webkitHidden: { configurable: true, get: () => false },
    hasFocus: { configurable: true, writable: true, value: () => true },
  };
  for (const [name, descriptor] of Object.entries(overrides)) {
    Object.defineProperty(doc, name, descriptor);
  }

  // Capture listeners on window run before any listener registered by the page.
  const swallow = (event: Event) => event.stopImmediatePropagation();
  const swallowWindowBlur = (event: Event) => {
    // Element blur (inputs, buttons) must keep working; only the window losing focus is hidden.
    if (!(event.target instanceof (win as Window & typeof globalThis).Node)) event.stopImmediatePropagation();
  };
  for (const type of SWALLOWED_DOCUMENT_EVENTS) win.addEventListener(type, swallow, true);
  win.addEventListener("blur", swallowWindowBlur, true);

  return () => {
    for (const name of Object.keys(overrides)) delete (doc as unknown as Record<string, unknown>)[name];
    for (const type of SWALLOWED_DOCUMENT_EVENTS) win.removeEventListener(type, swallow, true);
    win.removeEventListener("blur", swallowWindowBlur, true);
  };
}
