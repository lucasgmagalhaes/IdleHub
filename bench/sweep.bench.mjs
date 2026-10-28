// Exploratory: CPU cost of one game tab per frame cap, to choose policy defaults.
// Usage: pnpm build:inject && node bench/sweep.bench.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

import { treeUsage } from "./lib/proc.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const injectScript = readFileSync(join(root, "dist-inject/inject.js"), "utf8");
const MEASURE_MS = Number(process.env.BENCH_MEASURE_MS ?? 4000);
const sprites = Number(process.env.SPRITES ?? 1500);
const gameUrl = `${pathToFileURL(join(root, "bench/fixtures/game.html")).href}?sprites=${sprites}`;
const caps = [null, 60, 45, 30, 24, 20, 15, 10, 5, 2, 1];

const browser = await chromium.launch();
console.log(`one tab, ${sprites} sprites, ${MEASURE_MS} ms per cap\n`);
console.log("cap        fps   main thread    all processes");
for (const cap of caps) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  if (cap) await page.addInitScript(`window.__IDLEHUB_POLICY__=${JSON.stringify({ maxFps: cap, muted: true })};\n${injectScript}`);
  const client = await context.newCDPSession(page);
  await client.send("Performance.enable");
  await page.goto(gameUrl);
  await new Promise((r) => setTimeout(r, 1000));
  const read = async () => ({
    task: (await client.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value,
    frames: await page.evaluate(() => window.stats.frames),
    cpu: treeUsage(process.pid).cpuSeconds,
  });
  const a = await read();
  await new Promise((r) => setTimeout(r, MEASURE_MS));
  const b = await read();
  const s = MEASURE_MS / 1000;
  console.log(
    `${String(cap ?? "none").padEnd(6)} ${((b.frames - a.frames) / s).toFixed(1).padStart(6)}` +
      `  ${(((b.task - a.task) * 1000) / s).toFixed(0).padStart(6)} ms/s` +
      `  ${(((b.cpu - a.cpu) / s) * 100).toFixed(1).padStart(9)}% cpu`,
  );
  await context.close();
}
await browser.close();
