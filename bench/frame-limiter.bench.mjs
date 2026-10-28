// Measures main-thread CPU time of 4 game pages with and without the IdleHub runtime.
//
// Usage: pnpm bench   (builds dist-inject/inject.js first)
// Fails (exit 1) when the savings fall below the thresholds below.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gameUrl = pathToFileURL(join(root, "bench/fixtures/game.html")).href;
const injectScript = readFileSync(join(root, "dist-inject/inject.js"), "utf8");
const ACCOUNTS = 4;
const WARMUP_MS = 1500;
const MEASURE_MS = Number(process.env.BENCH_MEASURE_MS ?? 5000);

// Minimum CPU reduction versus the unthrottled baseline.
const THRESHOLDS = { grid: 0.5, focused: 0.6 };

const scenarios = [
  { name: "baseline", policies: null },
  { name: "grid", policies: Array(ACCOUNTS).fill({ maxFps: 20, muted: true }) },
  {
    name: "focused",
    policies: [{ maxFps: 60, muted: false }, ...Array(ACCOUNTS - 1).fill({ maxFps: 5, muted: true })],
  },
];

async function metrics(client) {
  const { metrics } = await client.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function runScenario(browser, scenario) {
  const pages = [];
  for (let i = 0; i < ACCOUNTS; i++) {
    // One context per account, like IdleHub's isolated profiles.
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    if (scenario.policies) {
      await page.addInitScript(
        `window.__IDLEHUB_POLICY__ = ${JSON.stringify(scenario.policies[i])};\n${injectScript}`,
      );
    }
    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    await page.goto(gameUrl);
    pages.push({ page, client, context });
  }
  await new Promise((r) => setTimeout(r, WARMUP_MS));

  const before = await Promise.all(pages.map(async (p) => ({
    m: await metrics(p.client),
    s: await p.page.evaluate(() => ({ ...window.stats })),
  })));
  await new Promise((r) => setTimeout(r, MEASURE_MS));
  const after = await Promise.all(pages.map(async (p) => ({
    m: await metrics(p.client),
    s: await p.page.evaluate(() => ({ ...window.stats })),
  })));

  const seconds = MEASURE_MS / 1000;
  const perAccount = pages.map((_, i) => ({
    cpuMsPerSec: ((after[i].m.TaskDuration - before[i].m.TaskDuration) * 1000) / seconds,
    fps: (after[i].s.frames - before[i].s.frames) / seconds,
    ticksPerSec: (after[i].s.ticks - before[i].s.ticks) / seconds,
    heapMb: after[i].m.JSHeapUsedSize / 1024 / 1024,
  }));
  await Promise.all(pages.map((p) => p.context.close()));
  return {
    name: scenario.name,
    perAccount,
    totalCpuMsPerSec: perAccount.reduce((sum, a) => sum + a.cpuMsPerSec, 0),
  };
}

const browser = await chromium.launch();
const results = [];
for (const scenario of scenarios) results.push(await runScenario(browser, scenario));
await browser.close();

const baseline = results[0].totalCpuMsPerSec;
console.log(`\n${ACCOUNTS} accounts, ${MEASURE_MS} ms window (main-thread CPU ms per second, all accounts)\n`);
for (const r of results) {
  const saving = 1 - r.totalCpuMsPerSec / baseline;
  const fps = r.perAccount.map((a) => a.fps.toFixed(0)).join("/");
  const ticks = r.perAccount.map((a) => a.ticksPerSec.toFixed(1)).join("/");
  console.log(
    `${r.name.padEnd(9)} cpu=${r.totalCpuMsPerSec.toFixed(0).padStart(4)} ms/s  ` +
      `saving=${(saving * 100).toFixed(0).padStart(3)}%  fps=${fps}  game ticks/s=${ticks}`,
  );
  r.saving = saving;
}

mkdirSync(join(root, "bench/results"), { recursive: true });
writeFileSync(join(root, "bench/results/frame-limiter.json"), JSON.stringify(results, null, 2));

let failed = false;
for (const r of results.slice(1)) {
  if (r.saving < THRESHOLDS[r.name]) {
    console.error(`✗ ${r.name}: saving ${(r.saving * 100).toFixed(0)}% < ${THRESHOLDS[r.name] * 100}%`);
    failed = true;
  }
  // Game logic driven by timers must keep running at full speed.
  if (r.perAccount.some((a) => a.ticksPerSec < 3.5)) {
    console.error(`✗ ${r.name}: game timers were slowed down`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
