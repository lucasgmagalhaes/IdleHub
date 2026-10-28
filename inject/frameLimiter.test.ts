import { installFrameLimiter } from "./frameLimiter";
import { createFakeFrameHost } from "./testing/fakeFrameHost";

function startGameLoop(host: { requestAnimationFrame(cb: FrameRequestCallback): number }) {
  const timestamps: number[] = [];
  const loop: FrameRequestCallback = (ts) => {
    timestamps.push(ts);
    host.requestAnimationFrame(loop);
  };
  host.requestAnimationFrame(loop);
  return timestamps;
}

describe("installFrameLimiter", () => {
  it("passes through at display rate when the cap is above it", () => {
    const fake = createFakeFrameHost(60);
    installFrameLimiter(fake.host, 120);
    const frames = startGameLoop(fake.host);
    fake.advance(1000);
    expect(frames.length).toBeGreaterThanOrEqual(58);
    expect(frames.length).toBeLessThanOrEqual(60);
  });

  it("caps a game loop at the configured fps", () => {
    const fake = createFakeFrameHost(60);
    installFrameLimiter(fake.host, 10);
    const frames = startGameLoop(fake.host);
    fake.advance(1000);
    expect(frames.length).toBeGreaterThanOrEqual(9);
    expect(frames.length).toBeLessThanOrEqual(11);
  });

  it.each([30, 20, 45])("caps at %i fps when callbacks run late in the frame", (cap) => {
    const fake = createFakeFrameHost(60, 15);
    installFrameLimiter(fake.host, cap);
    const frames = startGameLoop(fake.host);
    fake.advance(2000);
    const fps = frames.length / 2;
    expect(fps).toBeGreaterThanOrEqual(cap * 0.85);
    expect(fps).toBeLessThanOrEqual(cap * 1.05);
  });

  it("still reaches the display rate with late callbacks when uncapped", () => {
    const fake = createFakeFrameHost(60, 15);
    installFrameLimiter(fake.host, 60);
    const frames = startGameLoop(fake.host);
    fake.advance(2000);
    expect(frames.length / 2).toBeGreaterThanOrEqual(57);
  });

  it("does not wake up on every vsync while throttled", () => {
    const fake = createFakeFrameHost(60);
    installFrameLimiter(fake.host, 5);
    startGameLoop(fake.host);
    const before = fake.nativeFrameRequests;
    fake.advance(1000);
    expect(fake.nativeFrameRequests - before).toBeLessThanOrEqual(7);
  });

  it("changes the cap at runtime", () => {
    const fake = createFakeFrameHost(60);
    const limiter = installFrameLimiter(fake.host, 60);
    const frames = startGameLoop(fake.host);
    fake.advance(1000);
    const atFull = frames.length;
    limiter.setMaxFps(4);
    fake.advance(1000);
    expect(frames.length - atFull).toBeLessThanOrEqual(5);
    expect(limiter.maxFps).toBe(4);
  });

  it("delivers callbacks requested in the same frame together with one timestamp", () => {
    const fake = createFakeFrameHost(60);
    installFrameLimiter(fake.host, 10);
    const a = vi.fn();
    const b = vi.fn();
    fake.host.requestAnimationFrame(a);
    fake.host.requestAnimationFrame(b);
    fake.advance(200);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0]).toBe(b.mock.calls[0][0]);
  });

  it("cancels pending callbacks", () => {
    const fake = createFakeFrameHost(60);
    installFrameLimiter(fake.host, 10);
    const cb = vi.fn();
    const id = fake.host.requestAnimationFrame(cb);
    fake.host.cancelAnimationFrame(id);
    fake.advance(500);
    expect(cb).not.toHaveBeenCalled();
  });

  it("keeps running other callbacks when one throws", () => {
    const fake = createFakeFrameHost(60);
    const onError = vi.fn();
    installFrameLimiter(fake.host, 30, onError);
    const after = vi.fn();
    fake.host.requestAnimationFrame(() => {
      throw new Error("boom");
    });
    fake.host.requestAnimationFrame(after);
    fake.advance(100);
    expect(after).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });

  it("restores the native functions when uninstalled", () => {
    const fake = createFakeFrameHost(60);
    const native = fake.host.requestAnimationFrame;
    const limiter = installFrameLimiter(fake.host, 10);
    expect(fake.host.requestAnimationFrame).not.toBe(native);
    limiter.uninstall();
    expect(fake.host.requestAnimationFrame).toBe(native);
  });

  it("reacts within one frame when the cap is raised during a long throttled sleep", () => {
    // A hidden tab at 1 fps that gets shown must not wait out its old one-second sleep.
    const fake = createFakeFrameHost(60);
    const limiter = installFrameLimiter(fake.host, 1);
    const frames = startGameLoop(fake.host);
    fake.advance(1500);
    const before = frames.length;
    limiter.setMaxFps(60);
    fake.advance(100);
    expect(frames.length - before).toBeGreaterThanOrEqual(5);
  });

  it("does not spend a frame slot when every pending callback was cancelled", () => {
    const fake = createFakeFrameHost(60);
    installFrameLimiter(fake.host, 10);
    fake.host.cancelAnimationFrame(fake.host.requestAnimationFrame(vi.fn()));
    fake.advance(50);
    const cb = vi.fn();
    fake.host.requestAnimationFrame(cb);
    fake.advance(30);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("hands pending callbacks back to the browser when uninstalled", () => {
    // Otherwise a game loop waiting on a throttled frame would stop for good.
    const fake = createFakeFrameHost(60);
    const limiter = installFrameLimiter(fake.host, 2);
    const frames = startGameLoop(fake.host);
    fake.advance(100);
    const before = frames.length;
    limiter.uninstall();
    fake.advance(100);
    expect(frames.length - before).toBeGreaterThanOrEqual(5);
  });

  it("rejects invalid caps", () => {
    const fake = createFakeFrameHost(60);
    const limiter = installFrameLimiter(fake.host, 10);
    limiter.setMaxFps(0);
    expect(limiter.maxFps).toBe(1);
    limiter.setMaxFps(Number.NaN);
    expect(limiter.maxFps).toBe(1);
  });
});
