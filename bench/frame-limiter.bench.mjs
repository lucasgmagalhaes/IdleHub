// Measures what the IdleHub page runtime saves on 4 accounts of a canvas game.
//
// Usage: pnpm bench   (builds dist-inject/inject.js first)
// Each scenario runs 4 isolated pages in headless Chromium and records, over the
// same window: main-thread CPU (CDP TaskDuration), CPU of all browser processes
// (renderers + GPU, from /proc), memory, frame rate and game timer rate.
// Fails (exit 1) when a check below does not hold.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

import { treeUsage } from "./lib/proc.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gameUrl = pathToFileURL(join(root, "bench/fixtures/game.html")).href;
const injectScript = readFileSync(join(root, "dist-inject/inject.js"), "utf8");
const ACCOUNTS = 4;
const WARMUP_MS = 1500;
const MEASURE_MS = Number(process.env.BENCH_MEASURE_MS ?? 5000);

// Mirrors `PolicySettings::default()` in crates/idlehub-core/src/policy.rs.
const POLICY = { singlePane: 60, multiPane: 30, hidden: 1 };
const policy = (maxFps, muted = true) => ({ maxFps, muted });

const scenarios = [
  { name: "baseline", label: "No IdleHub runtime", policies: null },
  {
    name: "uncapped",
    label: "Runtime installed, nothing capped",
    policies: Array(ACCOUNTS).fill(policy(60, false)),
  },
  {
    name: "fourPanes",
    label: `4 panes (${POLICY.multiPane} fps each)`,
    policies: Array(ACCOUNTS).fill(policy(POLICY.multiPane)),
  },
  {
    name: "onePane",
    label: `1 pane (${POLICY.singlePane} fps) + 3 hidden (${POLICY.hidden} fps)`,
    policies: [policy(POLICY.singlePane, false), ...Array(ACCOUNTS - 1).fill(policy(POLICY.hidden))],
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

  const sample = () =>
    Promise.all(pages.map(async (p) => ({ m: await metrics(p.client), s: await p.page.evaluate(() => ({ ...window.stats })) })));
  const before = await sample();
  const processesBefore = treeUsage(process.pid);
  await new Promise((r) => setTimeout(r, MEASURE_MS));
  const processesAfter = treeUsage(process.pid);
  const after = await sample();

  const seconds = MEASURE_MS / 1000;
  const perAccount = pages.map((_, i) => ({
    mainThreadMsPerSec: ((after[i].m.TaskDuration - before[i].m.TaskDuration) * 1000) / seconds,
    fps: (after[i].s.frames - before[i].s.frames) / seconds,
    ticksPerSec: (after[i].s.ticks - before[i].s.ticks) / seconds,
    heapMb: after[i].m.JSHeapUsedSize / 1024 / 1024,
  }));
  await Promise.all(pages.map((p) => p.context.close()));
  return {
    ...scenario,
    perAccount,
    mainThreadMsPerSec: perAccount.reduce((sum, a) => sum + a.mainThreadMsPerSec, 0),
    // Includes this Node process, which does the same small amount of work in every scenario.
    processCpuPercent: ((processesAfter.cpuSeconds - processesBefore.cpuSeconds) / seconds) * 100,
    rssMb: processesAfter.rssBytes / 1024 / 1024,
  };
}

const browser = await chromium.launch();
const results = [];
for (const scenario of scenarios) results.push(await runScenario(browser, scenario));
await browser.close();

const byName = Object.fromEntries(results.map((r) => [r.name, r]));
const base = byName.baseline;
const saving = (r, key) => 1 - r[key] / base[key];
const pct = (x) => `${(x * 100).toFixed(0).padStart(4)}%`;

console.log(`\n${ACCOUNTS} accounts, ${MEASURE_MS} ms window\n`);
console.log("scenario                                  main thread   all processes   fps per tab      ticks/s");
for (const r of results) {
  console.log(
    `${r.label.padEnd(42)}${r.mainThreadMsPerSec.toFixed(0).padStart(5)} ms/s${pct(saving(r, "mainThreadMsPerSec"))}` +
      `${r.processCpuPercent.toFixed(0).padStart(6)}% cpu${pct(saving(r, "processCpuPercent"))}` +
      `   ${r.perAccount.map((a) => a.fps.toFixed(0)).join("/").padEnd(15)}  ` +
      `${r.perAccount.map((a) => a.ticksPerSec.toFixed(1)).join("/")}`,
  );
}

mkdirSync(join(root, "bench/results"), { recursive: true });
writeFileSync(join(root, "bench/results/frame-limiter.json"), JSON.stringify(results, null, 2));

const failures = [];
const check = (ok, message) => ok || failures.push(message);
for (const r of results) {
  // Game logic driven by timers must keep running at full speed everywhere.
  check(r.perAccount.every((a) => a.ticksPerSec >= 3.5), `${r.name}: game timers were slowed down`);
}
// The runtime itself must be close to free when it does not cap anything.
check(byName.uncapped.perAccount.every((a) => a.fps >= 55), "uncapped: frame rate dropped below 55 fps");
check(
  byName.uncapped.processCpuPercent <= base.processCpuPercent * 1.1,
  `uncapped: runtime overhead ${(-saving(byName.uncapped, "processCpuPercent") * 100).toFixed(0)}% > 10%`,
);
// Every tab must render at the rate its policy asks for.
for (const name of ["fourPanes", "onePane"]) {
  const r = byName[name];
  r.perAccount.forEach((a, i) => {
    const target = r.policies[i].maxFps;
    check(Math.abs(a.fps - target) <= Math.max(2, target * 0.15), `${name}: tab ${i + 1} ran at ${a.fps.toFixed(1)} fps, expected ${target}`);
  });
}
// And the caps must translate into real CPU savings.
check(saving(byName.fourPanes, "mainThreadMsPerSec") >= 0.35, "fourPanes: main-thread saving below 35%");
check(saving(byName.fourPanes, "processCpuPercent") >= 0.25, "fourPanes: process CPU saving below 25%");
check(saving(byName.onePane, "mainThreadMsPerSec") >= 0.55, "onePane: main-thread saving below 55%");
check(saving(byName.onePane, "processCpuPercent") >= 0.4, "onePane: process CPU saving below 40%");

if (failures.length) {
  console.error(`\n✗ ${failures.join("\n✗ ")}`);
  process.exit(1);
}
console.log("\n✓ all performance checks passed");
