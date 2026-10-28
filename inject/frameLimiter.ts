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
/** Tolerance for frames that land a hair before they are due. */
const SLACK_MS = 2;

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
  /** Wall-clock time the next frame is due. */
  let nextDue = -Infinity;
  let scheduled = false;
  /** Pending sleep until the next frame is due, if any. */
  let timer: unknown;
  let fps = MIN_FPS;

  function setMaxFps(value: number) {
    fps = Number.isFinite(value) ? Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(value))) : MIN_FPS;
    const previous = interval;
    interval = 1000 / fps;
    if (interval >= previous || !Number.isFinite(nextDue)) return;
    // A faster cap counts from the last frame, so a tab leaving a 1 fps sleep
    // renders right away instead of finishing the old wait.
    nextDue -= previous - interval;
    if (timer !== undefined) {
      host.clearTimeout(timer);
      timer = undefined;
      scheduled = false;
      schedule();
    }
  }

  // Timing uses performance.now() at delivery, not the rAF timestamp: browsers
  // stamp callbacks with the frame's start time but run them later, so a request
  // made after a timer wakes up can still land in an already started frame.
  function flush(timestamp: number) {
    const now = host.performance.now();
    if (now < nextDue - SLACK_MS) {
      request(flush); // Too early: wait for another vsync.
      return;
    }
    scheduled = false;
    // Everything was cancelled; keep the slot for the next real request.
    if (callbacks.size === 0) return;
    // Advance by whole intervals so caps between display rates (45 fps on 60 Hz)
    // alternate frames; after a long pause, restart from now instead of bursting.
    nextDue = now - nextDue > interval ? now + interval : nextDue + interval;
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
    const wait = nextDue - SLACK_MS - host.performance.now();
    if (wait <= 0) {
      request(flush);
      return;
    }
    timer = host.setTimeout(() => {
      timer = undefined;
      request(flush);
    }, wait);
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
      if (timer !== undefined) host.clearTimeout(timer);
      // Callbacks still waiting for a throttled frame go to the browser, or the game loop would stop.
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const cb of pending) nativeRequest.call(host, cb);
    },
  };
}
