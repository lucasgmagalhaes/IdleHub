// End-to-end check on the real desktop app (Linux/WebKitGTK and Windows/WebView2).
//
// Usage: pnpm bench:app   (builds the app with the UI embedded first)
// Starts IdleHub with 4 accounts of the synthetic game, once per layout, and
// checks that every page renders at the frame rate its policy asks for — which
// proves the policy travels from Rust to the page — and that the hidden-tab
// layout costs less CPU than the 4-pane one. The game pages report their own
// frame counts to a local server.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFixtureServer } from "./lib/fixture-server.mjs";
import { treeProcesses, treeUsage } from "./lib/proc.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const binary = process.env.IDLEHUB_BIN ?? join(root, "target/debug", windows ? "idlehub.exe" : "idlehub");
const IDENTIFIER = "com.lucasgmagalhaes.idlehub";
const MEASURE_MS = Number(process.env.BENCH_MEASURE_MS ?? 10000);
const ACCOUNTS = 4;
// Mirrors `PolicySettings::default()` in crates/idlehub-core/src/policy.rs.
const POLICY = { singlePane: 60, multiPane: 30, hidden: 1 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withDisplay() {
  if (windows || process.env.DISPLAY) return { display: process.env.DISPLAY, stop() {} };
  const display = ":97";
  const xvfb = spawn("Xvfb", [display, "-screen", "0", "1440x900x24"], { stdio: "ignore" });
  await sleep(1000);
  return { display, stop: () => xvfb.kill() };
}

/**
 * Where the app keeps its data. Linux honours XDG_DATA_HOME, so each run gets a
 * temporary folder; Windows always uses the roaming AppData folder.
 */
function appDataDir() {
  if (windows) return { dataHome: null, dir: join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), IDENTIFIER) };
  const dataHome = mkdtempSync(join(tmpdir(), "idlehub-bench-"));
  return { dataHome, dir: join(dataHome, IDENTIFIER) };
}

function stopTree(app) {
  if (windows) {
    try {
      execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  } else {
    app.kill("SIGTERM");
  }
}

function writeWorkspace(dir, port, panes, count) {
  mkdirSync(dir, { recursive: true });
  const accounts = Array.from({ length: count }, (_, i) => ({
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

/**
 * Groups per-process CPU by role. WebKitGTK starts one web process per webview,
 * in creation order: the UI first, then the game tabs.
 */
function breakdown(before, after, seconds) {
  const roles = {};
  const add = (role, cpu, rss) => {
    roles[role] ??= { cpuPercent: 0, rssMb: 0, processes: 0 };
    roles[role].cpuPercent += cpu;
    roles[role].rssMb += rss;
    roles[role].processes += 1;
  };
  const web = [...after.values()].filter((p) => p.name.startsWith("WebKitWebProces")).sort((a, b) => a.pid - b.pid);
  for (const p of after.values()) {
    const cpu = ((p.cpuSeconds - (before.get(p.pid)?.cpuSeconds ?? p.cpuSeconds)) / seconds) * 100;
    const rss = (p.privateBytes ?? p.rssBytes) / 1024 / 1024;
    if (p.name.startsWith("msedgewebview2")) add(`webview2 ${/--type=([\w-]+)/.exec(p.command)?.[1] ?? "browser"}`, cpu, rss);
    else if (p.name.startsWith("WebKitNetwork")) add("network processes", cpu, rss);
    else if (p.name.startsWith("WebKitWebProces")) add(p === web[0] ? "ui web process" : `tab web process ${web.indexOf(p)}`, cpu, rss);
    else if (p.name === "idlehub" || p.name === "idlehub.exe") add("app process", cpu, rss);
    else add(`other (${p.name})`, cpu, rss);
  }
  return roles;
}

async function runScenario(server, display, scenario) {
  const { dataHome, dir } = appDataDir();
  rmSync(dir, { recursive: true, force: true });
  writeWorkspace(dir, server.port, scenario.panes, scenario.tabs);
  const env = { ...process.env, ...scenario.env, WEBKIT_DISABLE_COMPOSITING_MODE: "1" };
  if (display) env.DISPLAY = display;
  if (dataHome) env.XDG_DATA_HOME = dataHome;
  const app = spawn(binary, [], { env, stdio: "ignore" });
  try {
    await waitFor(() => server.snapshot().size === scenario.tabs, 60000, "all tabs to report");
    await sleep(4000); // warm-up
    const before = server.snapshot();
    const usageBefore = treeUsage(app.pid);
    const processesBefore = treeProcesses(app.pid);
    await sleep(MEASURE_MS);
    const usageAfter = treeUsage(app.pid);
    const processesAfter = treeProcesses(app.pid);
    const after = server.snapshot();

    const tabs = [...Array(scenario.tabs).keys()].map((i) => {
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
      privateMb: usageAfter.privateBytes === null ? null : usageAfter.privateBytes / 1024 / 1024,
      processes: usageAfter.processes,
      roles: breakdown(processesBefore, processesAfter, MEASURE_MS / 1000),
    };
  } finally {
    stopTree(app);
    await sleep(2000);
    if (app.exitCode === null) app.kill("SIGKILL");
    rmSync(dataHome ?? dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

const scenarios = [
  ...(windows
    ? [
        {
          name: "fourPanesSeparate",
          label: "4 panes, browser per account",
          panes: 4,
          tabs: ACCOUNTS,
          env: { IDLEHUB_WEBVIEW2_SEPARATE: "1" },
          expected: Array(ACCOUNTS).fill(POLICY.multiPane),
        },
      ]
    : []),
  { name: "empty", label: "no tabs", panes: 4, tabs: 0, expected: [] },
  { name: "fourPanes", label: "4 panes", panes: 4, tabs: ACCOUNTS, expected: Array(ACCOUNTS).fill(POLICY.multiPane) },
  {
    name: "onePane",
    label: "1 pane + 3 hidden",
    panes: 1,
    tabs: ACCOUNTS,
    expected: [POLICY.singlePane, ...Array(ACCOUNTS - 1).fill(POLICY.hidden)],
  },
];

// BENCH_SCENARIOS=empty,onePane runs a subset (checks then only cover what ran).
const only = process.env.BENCH_SCENARIOS?.split(",");
const selected = only ? scenarios.filter((s) => only.includes(s.name)) : scenarios;

const server = await startFixtureServer(join(root, "bench/fixtures"));
const screen = await withDisplay();
const results = [];
try {
  for (const scenario of selected) results.push(await runScenario(server, screen.display, scenario));
} finally {
  screen.stop();
  await server.close();
}

console.log(`\nIdleHub desktop app, ${ACCOUNTS} accounts, ${MEASURE_MS} ms window\n`);
for (const r of results) {
  console.log(
    `${r.label.padEnd(30)} cpu ${r.cpuPercent.toFixed(0).padStart(4)}%  rss ${r.rssMb.toFixed(0).padStart(5)} MB  ` +
      (r.privateMb === null ? "" : `private ${r.privateMb.toFixed(0).padStart(5)} MB  `) +
      `${String(r.processes).padStart(2)} processes  fps ${r.tabs.map((t) => t.fps.toFixed(1)).join("/")}` +
      ` (expected ${r.expected.join("/")})  ticks/s ${r.tabs.map((t) => t.ticksPerSec.toFixed(1)).join("/")}`,
  );
  for (const [role, u] of Object.entries(r.roles).sort()) {
    console.log(`    ${role.padEnd(22)} ${u.cpuPercent.toFixed(1).padStart(5)}% cpu  ${u.rssMb.toFixed(0).padStart(5)} MB  (${u.processes})`);
  }
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
const named = Object.fromEntries(results.map((r) => [r.name, r]));
const { fourPanes: four, onePane: one, fourPanesSeparate: separate } = named;
if (four && one) check(one.cpuPercent < four.cpuPercent, "hiding tabs did not reduce CPU");
// Windows: sharing one WebView2 browser between accounts must use less memory.
if (four && separate) {
  check(four.processes < separate.processes, "shared browser did not reduce the number of processes");
  check(four.privateMb < separate.privateMb, "shared browser did not reduce private memory");
}

if (failures.length) {
  console.error(`\n✗ ${failures.join("\n✗ ")}`);
  process.exit(1);
}
console.log("\n✓ all checks passed");
if (four && one) console.log(`  1 pane + 3 hidden uses ${(100 - (one.cpuPercent / four.cpuPercent) * 100).toFixed(0)}% less CPU than 4 panes`);
if (four && separate) {
  console.log(
    `  shared browser: ${separate.processes} → ${four.processes} processes, ` +
      `private memory ${separate.privateMb.toFixed(0)} → ${four.privateMb.toFixed(0)} MB ` +
      `(${(100 - (four.privateMb / separate.privateMb) * 100).toFixed(0)}% less)`,
  );
}
