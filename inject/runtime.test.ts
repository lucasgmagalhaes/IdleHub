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

  it("keeps the fields a partial policy leaves out", () => {
    win.__IDLEHUB_POLICY__ = { maxFps: 30, muted: false };
    const runtime = installRuntime(win);
    runtime.apply({ muted: true } as never);
    expect(runtime.policy).toEqual({ maxFps: 30, muted: true });
  });

  it("cannot be replaced or found by page scripts", () => {
    const runtime = installRuntime(win);
    expect(Object.keys(win)).not.toContain("__idlehub");
    expect(() => {
      (win as { __idlehub?: unknown }).__idlehub = undefined;
    }).toThrow(TypeError);
    expect(win.__idlehub).toBe(runtime);
  });

  it("hands the policy copy out read-only", () => {
    const runtime = installRuntime(win);
    const copy = runtime.policy;
    copy.maxFps = 1;
    expect(runtime.policy.maxFps).toBe(60);
  });

  it("ignores fields a policy sends as undefined", () => {
    win.__IDLEHUB_POLICY__ = { maxFps: 30, muted: true };
    const runtime = installRuntime(win);
    runtime.apply({ maxFps: undefined, muted: undefined } as never);
    expect(runtime.policy).toEqual({ maxFps: 30, muted: true });
  });

  it("treats an infinite cap as uncapped, not as the slowest rate", () => {
    const runtime = installRuntime(win);
    runtime.apply({ maxFps: Number.POSITIVE_INFINITY, muted: false });
    expect(runtime.policy.maxFps).toBeGreaterThanOrEqual(120);
  });

  it("survives a policy that is not an object", () => {
    const runtime = installRuntime(win);
    expect(() => runtime.apply(null as never)).not.toThrow();
    expect(runtime.policy).toEqual({ maxFps: 60, muted: false });
  });

  it("keeps the page visible", () => {
    installRuntime(win);
    expect(document.visibilityState).toBe("visible");
  });
});
