import { installKeepVisible } from "./keepVisible";

function setRealVisibility(state: "visible" | "hidden") {
  Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => state });
  Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => state === "hidden" });
}

describe("installKeepVisible", () => {
  let uninstall: () => void;

  beforeEach(() => {
    setRealVisibility("hidden");
    uninstall = installKeepVisible(window);
  });

  afterEach(() => uninstall());

  it("always reports the page as visible", () => {
    expect(document.visibilityState).toBe("visible");
    expect(document.hidden).toBe(false);
  });

  it("reports the document as focused", () => {
    expect(document.hasFocus()).toBe(true);
  });

  it("swallows visibilitychange before page listeners see it", () => {
    const onDocument = vi.fn();
    const onWindow = vi.fn();
    document.addEventListener("visibilitychange", onDocument);
    window.addEventListener("visibilitychange", onWindow, true);
    document.onvisibilitychange = onDocument;

    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));

    expect(onDocument).not.toHaveBeenCalled();
    expect(onWindow).not.toHaveBeenCalled();
    document.onvisibilitychange = null;
  });

  it("swallows window blur but keeps element blur working", () => {
    const onWindowBlur = vi.fn();
    const onInputBlur = vi.fn();
    window.addEventListener("blur", onWindowBlur);
    const input = document.createElement("input");
    input.addEventListener("blur", onInputBlur);
    document.body.append(input);

    window.dispatchEvent(new FocusEvent("blur"));
    input.dispatchEvent(new FocusEvent("blur"));

    expect(onWindowBlur).not.toHaveBeenCalled();
    expect(onInputBlur).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("restores the original behaviour when uninstalled", () => {
    uninstall();
    expect(document.visibilityState).toBe("hidden");
    const listener = vi.fn();
    document.addEventListener("visibilitychange", listener);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);
    uninstall = () => {};
  });
});
