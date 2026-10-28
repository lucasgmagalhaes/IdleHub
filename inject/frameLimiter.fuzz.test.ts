import { installFrameLimiter } from "./frameLimiter";
import { createFakeFrameHost } from "./testing/fakeFrameHost";

/** Small deterministic PRNG so a failing seed can be replayed. */
function prng(seed: number) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: T[]) => items[Math.floor(next() * items.length)],
  };
}

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

describe("frame limiter under random conditions", () => {
  it.each(SEEDS)("seed %i: keeps every game loop within its cap and alive", (seed) => {
    const rnd = prng(seed);
    const displayHz = rnd.pick([30, 60, 75, 120, 144]);
    const lag = rnd.int(0, 12);
    const fake = createFakeFrameHost(displayHz, lag);
    const limiter = installFrameLimiter(fake.host, rnd.pick([1, 2, 5, 10, 24, 30, 45, 60, 120]), () => {});

    const frames: number[] = [];
    let now = 0;
    const loop: FrameRequestCallback = () => {
      frames.push(now);
      fake.host.requestAnimationFrame(loop);
    };
    fake.host.requestAnimationFrame(loop);

    // Random cap changes, each held long enough to measure the steady rate.
    for (let phase = 0; phase < 4; phase++) {
      const cap = rnd.pick([1, 2, 5, 10, 15, 24, 30, 45, 60, 90, 120]);
      limiter.setMaxFps(cap);
      const settle = 1200;
      const window = 2000;
      fake.advance(settle);
      now += settle;
      const start = frames.length;
      for (let t = 0; t < window; t += 10) {
        fake.advance(10);
        now += 10;
      }
      const fps = (frames.length - start) / (window / 1000);
      const ceiling = Math.min(cap, displayHz);
      const context = `seed ${seed}: ${displayHz} Hz, lag ${lag} ms, cap ${cap}`;
      expect(fps, `${context} ran too fast`).toBeLessThanOrEqual(cap * 1.05 + 1);
      expect(fps, `${context} ran too slow`).toBeGreaterThanOrEqual(ceiling * 0.7 - 1);
    }
  });

  it.each(SEEDS)("seed %i: runs each callback once, unless cancelled, and none is lost", (seed) => {
    const rnd = prng(seed);
    const fake = createFakeFrameHost(rnd.pick([60, 144]), rnd.int(0, 10));
    const limiter = installFrameLimiter(fake.host, rnd.pick([1, 5, 30, 60]), () => {});
    const calls = new Map<number, number>();
    const cancelled = new Set<number>();
    const ids: number[] = [];

    for (let step = 0; step < 200; step++) {
      const roll = rnd.next();
      if (roll < 0.5) {
        let id = 0;
        id = fake.host.requestAnimationFrame(() => calls.set(id, (calls.get(id) ?? 0) + 1));
        ids.push(id);
      } else if (roll < 0.65 && ids.length) {
        const id = rnd.pick(ids);
        if (!calls.has(id)) {
          fake.host.cancelAnimationFrame(id);
          cancelled.add(id);
        }
      } else if (roll < 0.7) {
        limiter.setMaxFps(rnd.pick([1, 5, 30, 60, 120]));
      } else {
        fake.advance(rnd.int(1, 120));
      }
    }
    // With no new requests, everything still pending must be delivered within a slow frame.
    fake.advance(2500);

    for (const id of ids) {
      const count = calls.get(id) ?? 0;
      if (cancelled.has(id)) expect(count, `seed ${seed}: cancelled callback ${id} ran`).toBe(0);
      else expect(count, `seed ${seed}: callback ${id} ran ${count} times`).toBe(1);
    }
  });

  it.each(SEEDS)("seed %i: hands every pending callback back on uninstall", (seed) => {
    const rnd = prng(seed);
    const fake = createFakeFrameHost(60, rnd.int(0, 10));
    const limiter = installFrameLimiter(fake.host, rnd.pick([1, 2, 5]), () => {});
    const ran = vi.fn();
    fake.advance(rnd.int(0, 500));
    const requested = rnd.int(1, 5);
    for (let i = 0; i < requested; i++) fake.host.requestAnimationFrame(ran);
    fake.advance(rnd.int(0, 50));
    limiter.uninstall();
    fake.advance(100);
    // Each exactly once: before uninstall through the limiter, or after it natively.
    expect(ran, `seed ${seed}`).toHaveBeenCalledTimes(requested);
  });
});
