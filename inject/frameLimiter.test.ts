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

  it("rejects invalid caps", () => {
    const fake = createFakeFrameHost(60);
    const limiter = installFrameLimiter(fake.host, 10);
    limiter.setMaxFps(0);
    expect(limiter.maxFps).toBe(1);
    limiter.setMaxFps(Number.NaN);
    expect(limiter.maxFps).toBe(1);
  });
});
