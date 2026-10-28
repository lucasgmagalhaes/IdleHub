# Performance log

How IdleHub's resource use was measured and what each optimization bought.
All numbers come from the benchmarks in `bench/` on the CI-like Linux container
(4 vCPU, software rendering), so compare them relative to each other.

| Tool | What it measures |
|---|---|
| `pnpm bench` | 4 game pages in headless Chromium with and without the page runtime; per-tab FPS, timer rate, main-thread and all-process CPU. CI gate. |
| `pnpm bench:app` | The real desktop app with 4 accounts per layout, plus the idle app; per-tab FPS reported by the pages, CPU and memory per process role. CI gate. |
| `node bench/sweep.bench.mjs` | CPU of one tab for each frame cap, to choose policy defaults. Exploratory. |

## Cost of a frame cap (one tab, `sweep.bench.mjs`)

| Cap (fps) | none | 60 | 45 | 30 | 24 | 20 | 15 | 10 | 5 | 2 | 1 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| All-process CPU | 22.7% | 24.7% | 21.0% | 15.2% | 14.0% | 12.5% | 8.8% | 8.0% | 3.5% | 1.5% | 1.3% |

CPU is roughly linear in frames drawn, with a ~1.3% floor (the game's own timers).

## Where the app spends CPU (`bench:app`, 4 accounts)

| Role | 4 panes | 1 pane + 3 hidden |
|---|---|---|
| Visible game tab | ~9% each (30 fps) | ~16% (60 fps) |
| Hidden game tab | — | ~0.7% each (1 fps) |
| App process (on Linux it also composites WebKitGTK frames) | ~13% | ~7.5% |
| Network processes (one per account) | <1%, ~52 MB each | same |
| UI webview | ~1% | ~1% |
| Idle app (no tabs) | ~1.2% total | |

## Windows (CI runner, `pnpm bench:app`)

All accounts share one WebView2 browser, each in its own WebView2 profile
(run 40718364785, 10 s window, debug build, 4 accounts):

| Scenario | CPU | Private memory | Processes | fps per tab | Game timers |
|---|---|---|---|---|---|
| No tabs | 1% | 109 MB | 7 | – | – |
| 4 panes | 20% | 366 MB | 16 | 30/30/30/30 | 4.0/s each |
| 1 pane + 3 hidden | 6% | 336 MB | 16 | 60/1/1/1 | 4.0/s each |

With 4 panes, the renderers use 12% CPU and the GPU process 6.6%. Hiding
3 tabs cuts CPU by 70% while their timers keep their pace. Run 40719933879
measured the same (1 pane + 3 hidden: 6%, 334 MB, 16 processes).

The comparison with one browser per account (`IDLEHUB_WEBVIEW2_SEPARATE=1`)
could not be measured: in that mode only 2–3 of the 4 tabs load, even after
3 minutes, and the app reports no error. That mode is only a troubleshooting
fallback, so the benchmark reports it without failing.

## Optimizations

| Change | Before | After |
|---|---|---|
| Frame limiter timed by delivery time (it ignored 30 fps caps in Chromium) | 30 fps cap ran at 45–60 fps | 30.0 fps |
| Usage sampling refreshes only the app's process tree between full scans | app process 1.1% idle | 0.9% |
| UI skips re-renders when shown numbers did not change, pauses while hidden, no bar animation | UI 1.7% idle | 0.9% |
| Idle app total | 2.8% | 1.2% |
| Hidden tabs at 1 fps instead of 5 | 2.6% per hidden tab, 37% for 1 pane + 3 hidden | 0.7% per tab, 27–31% |

## Not done yet / ideas

- **Windows browser-per-account mode:** some tabs never load in it (see the
  Windows section), so the memory saving of the shared browser is not
  measured yet. Needs debugging on a Windows machine.
- **4-pane frame rate:** 20 fps instead of 30 would save ~18% per visible tab
  (see the sweep). Kept at 30 for smoothness; a good candidate for a setting.
- **Mobile:** CPU has not been measured on devices yet; the emulator tests only
  check that timers keep running.
