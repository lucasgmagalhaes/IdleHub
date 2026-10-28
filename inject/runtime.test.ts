import { installRuntime, type IdleHubWindow } from "./runtime";

describe("installRuntime", () => {
  let win: IdleHubWindow;

  beforeEach(() => {
    win = window as unknown as IdleHubWindow;
    delete win.__idlehub;
    delete win.__IDLEHUB_POLICY__;
  });

  afterEach(() => win.__idlehub?.uninstall());

  it("starts with the policy provided by the host", () => {
    win.__IDLEHUB_POLICY__ = { maxFps: 7, muted: true };
    const runtime = installRuntime(win);
    expect(runtime.policy).toEqual({ maxFps: 7, muted: true });
  });

  it("starts unthrottled and audible without a host policy", () => {
    expect(installRuntime(win).policy).toEqual({ maxFps: 60, muted: false });
  });

  it("is exposed on the window and applies new policies", () => {
    installRuntime(win);
    win.__idlehub!.apply({ maxFps: 5, muted: true });
    expect(win.__idlehub!.policy).toEqual({ maxFps: 5, muted: true });
  });

  it("only installs once per page", () => {
    const first = installRuntime(win);
    expect(installRuntime(win)).toBe(first);
  });

  it("keeps the page visible", () => {
    installRuntime(win);
    expect(document.visibilityState).toBe("visible");
  });
});
