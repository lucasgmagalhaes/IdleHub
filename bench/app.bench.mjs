// End-to-end check on the real desktop app (Linux, WebKitGTK).
//
// Usage: pnpm bench:app   (builds the app with the UI embedded first)
// Starts IdleHub with 4 accounts of the synthetic game, once per layout, and
// checks that every page renders at the frame rate its policy asks for — which
// proves the policy travels from Rust to the page — and that the hidden-tab
// layout costs less CPU than the 4-pane one. The game pages report their own
// frame counts to a local server.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFixtureServer } from "./lib/fixture-server.mjs";
import { treeUsage } from "./lib/proc.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binary = process.env.IDLEHUB_BIN ?? join(root, "target/debug/idlehub");
const MEASURE_MS = Number(process.env.BENCH_MEASURE_MS ?? 10000);
const ACCOUNTS = 4;
// Mirrors `PolicySettings::default()` in crates/idlehub-core/src/policy.rs.
const POLICY = { singlePane: 60, multiPane: 30, hidden: 5 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withDisplay() {
  if (process.env.DISPLAY) return { display: process.env.DISPLAY, stop() {} };
  const display = ":97";
  const xvfb = spawn("Xvfb", [display, "-screen", "0", "1440x900x24"], { stdio: "ignore" });
  await sleep(1000);
  return { display, stop: () => xvfb.kill() };
}

function writeWorkspace(dataHome, port, panes) {
  const dir = join(dataHome, "com.lucasgmagalhaes.idlehub");
  mkdirSync(dir, { recursive: true });
  const accounts = Array.from({ length: ACCOUNTS }, (_, i) => ({
    id: randomUUID(),
    label: `Tab ${i + 1}`,
    url: `http://127.0.0.1:${port}/game.html?sprites=300&report=1&tab=${i}`,
    muted: true,
    pinned: false,
  }));
  writeFileSync(join(dir, "workspace.json"), JSON.stringify({ store: { max_accounts: ACCOUNTS, accounts }, panes }));
}

async function waitFor(condition, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (condition()) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function runScenario(server, display, scenario) {
  const dataHome = mkdtempSync(join(tmpdir(), "idlehub-bench-"));
  writeWorkspace(dataHome, server.port, scenario.panes);
  const app = spawn(binary, [], {
    env: { ...process.env, DISPLAY: display, XDG_DATA_HOME: dataHome, WEBKIT_DISABLE_COMPOSITING_MODE: "1" },
    stdio: "ignore",
  });
  try {
    await waitFor(() => server.snapshot().size === ACCOUNTS, 60000, "all tabs to report");
    await sleep(4000); // warm-up
    const before = server.snapshot();
    const usageBefore = treeUsage(app.pid);
    await sleep(MEASURE_MS);
    const usageAfter = treeUsage(app.pid);
    const after = server.snapshot();

    const tabs = [...Array(ACCOUNTS).keys()].map((i) => {
      const a = before.get(String(i));
      const b = after.get(String(i));
      const seconds = (b.at - a.at) / 1000;
      return { fps: (b.frames - a.frames) / seconds, ticksPerSec: (b.ticks - a.ticks) / seconds };
    });
    return {
      ...scenario,
      tabs,
      cpuPercent: ((usageAfter.cpuSeconds - usageBefore.cpuSeconds) / (MEASURE_MS / 1000)) * 100,
      rssMb: usageAfter.rssBytes / 1024 / 1024,
      processes: usageAfter.processes,
    };
  } finally {
    app.kill("SIGTERM");
    await sleep(1000);
    if (app.exitCode === null) app.kill("SIGKILL");
    rmSync(dataHome, { recursive: true, force: true });
  }
}

const scenarios = [
  { name: "fourPanes", label: "4 panes", panes: 4, expected: Array(ACCOUNTS).fill(POLICY.multiPane) },
  {
    name: "onePane",
    label: "1 pane + 3 hidden",
    panes: 1,
    expected: [POLICY.singlePane, ...Array(ACCOUNTS - 1).fill(POLICY.hidden)],
  },
];

const server = await startFixtureServer(join(root, "bench/fixtures"));
const screen = await withDisplay();
const results = [];
try {
  for (const scenario of scenarios) results.push(await runScenario(server, screen.display, scenario));
} finally {
  screen.stop();
  await server.close();
}

console.log(`\nIdleHub desktop app, ${ACCOUNTS} accounts, ${MEASURE_MS} ms window\n`);
for (const r of results) {
  console.log(
    `${r.label.padEnd(20)} cpu ${r.cpuPercent.toFixed(0).padStart(4)}%  rss ${r.rssMb.toFixed(0).padStart(5)} MB  ` +
      `${String(r.processes).padStart(2)} processes  fps ${r.tabs.map((t) => t.fps.toFixed(1)).join("/")}` +
      ` (expected ${r.expected.join("/")})  ticks/s ${r.tabs.map((t) => t.ticksPerSec.toFixed(1)).join("/")}`,
  );
}
mkdirSync(join(root, "bench/results"), { recursive: true });
writeFileSync(join(root, "bench/results/app.json"), JSON.stringify(results, null, 2));

const failures = [];
const check = (ok, message) => ok || failures.push(message);
for (const r of results) {
  r.tabs.forEach((tab, i) => {
    const target = r.expected[i];
    // Software rendering under Xvfb can fall short of 60 fps, so only an upper bound
    // is strict; the lower bound just shows the tab was not throttled harder.
    check(tab.fps <= target * 1.15 + 1, `${r.name}: tab ${i + 1} ran at ${tab.fps.toFixed(1)} fps, above its cap of ${target}`);
    check(tab.fps >= target * 0.6, `${r.name}: tab ${i + 1} ran at ${tab.fps.toFixed(1)} fps, far below ${target}`);
    check(tab.ticksPerSec >= 3.5, `${r.name}: tab ${i + 1} game timers slowed to ${tab.ticksPerSec.toFixed(1)}/s`);
  });
}
const [four, one] = results;
check(one.cpuPercent < four.cpuPercent, "hiding tabs did not reduce CPU");

if (failures.length) {
  console.error(`\n✗ ${failures.join("\n✗ ")}`);
  process.exit(1);
}
console.log(`\n✓ all checks passed; 1 pane + 3 hidden uses ${(100 - (one.cpuPercent / four.cpuPercent) * 100).toFixed(0)}% less CPU than 4 panes`);
