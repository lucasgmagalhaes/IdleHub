export interface FrameHost {
  requestAnimationFrame(cb: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(fn: () => void, ms?: number): unknown;
  clearTimeout(id: unknown): void;
  performance: { now(): number };
}

export interface FrameLimiter {
  readonly maxFps: number;
  setMaxFps(fps: number): void;
  uninstall(): void;
}

const MIN_FPS = 1;
const MAX_FPS = 240;

/**
 * Replaces requestAnimationFrame with a version capped at `maxFps`.
 *
 * Rendering dominates the CPU cost of canvas games, so capping the frame rate of
 * accounts nobody is looking at is the biggest saving available. While throttled,
 * the limiter sleeps with a timer and only asks for a native frame when the next
 * one is due, so it does not wake up on every vsync.
 */
export function installFrameLimiter(
  host: FrameHost,
  maxFps: number,
  onError: (error: unknown) => void = console.error,
): FrameLimiter {
  const nativeRequest = host.requestAnimationFrame;
  const nativeCancel = host.cancelAnimationFrame;
  const request = nativeRequest.bind(host);
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  let interval = 0;
  let lastFrame = -Infinity;
  let scheduled = false;
  let fps = MIN_FPS;

  function setMaxFps(value: number) {
    fps = Number.isFinite(value) ? Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(value))) : MIN_FPS;
    interval = 1000 / fps;
  }

  function flush(timestamp: number) {
    scheduled = false;
    lastFrame = timestamp;
    const due = [...callbacks.values()];
    callbacks.clear();
    for (const cb of due) {
      try {
        cb(timestamp);
      } catch (error) {
        onError(error);
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // Small slack so a frame landing a hair early is not pushed a whole vsync later.
    const wait = lastFrame + interval - host.performance.now() - 2;
    if (wait > 0) host.setTimeout(() => request(flush), wait);
    else request(flush);
  }

  host.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, cb);
    schedule();
    return id;
  };
  host.cancelAnimationFrame = (id: number) => {
    callbacks.delete(id);
  };
  setMaxFps(maxFps);

  return {
    get maxFps() {
      return fps;
    },
    setMaxFps,
    uninstall() {
      host.requestAnimationFrame = nativeRequest;
      host.cancelAnimationFrame = nativeCancel;
    },
  };
}
