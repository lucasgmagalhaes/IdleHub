import type { FrameHost } from "../frameLimiter";

/** A deterministic 60 Hz display with a manual clock, for frame limiter tests. */
export function createFakeFrameHost(displayHz = 60) {
  let now = 0;
  let nextId = 1;
  let nativeFrameRequests = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { at: number; fn: () => void }>();
  const frameInterval = 1000 / displayHz;
  let nextVsync = frameInterval;

  const host: FrameHost = {
    requestAnimationFrame(cb) {
      nativeFrameRequests++;
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(fn: () => void, ms = 0) {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) {
      if (id !== undefined) timers.delete(id as number);
    },
    performance: { now: () => now },
  };

  function advance(ms: number) {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 1);
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
      if (now >= nextVsync) {
        nextVsync += frameInterval;
        const due = [...frames.values()];
        frames.clear();
        for (const cb of due) cb(now);
      }
    }
  }

  return {
    host,
    advance,
    get nativeFrameRequests() {
      return nativeFrameRequests;
    },
  };
}
