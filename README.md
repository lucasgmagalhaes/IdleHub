# IdleHub

Lightweight multi-account browser for idle browser games (starting with
[Huntera](https://huntera.com.br)). Runs several isolated accounts side by side
while keeping CPU and memory as low as possible.

- **Desktop (Windows, macOS):** one window split into 1–4 panes (layout buttons
  in the top bar). Each pane has its own header with the site, address, reload,
  sound, pin and close. Tabs that do not fit in the chosen layout keep running
  hidden and can be brought into any pane from its title.
- **Mobile (Android, iOS 17+):** one tab on screen with a tab bar at the bottom;
  the other tabs keep running hidden. Android keeps games running in the
  background with a foreground service; iOS keeps them running while the app is
  open (the screen does not auto-lock). See [docs/PLANNING.md](docs/PLANNING.md).

## How it saves resources

Every game page gets a small injected runtime (`inject/`, ~3 KB) that:

| Feature | Why |
|---|---|
| Frame limiter (`requestAnimationFrame` cap) | Rendering is the main CPU cost; unfocused accounts render at 5–20 fps |
| Keep visible / focused | The game never pauses or disconnects because it thinks it is hidden |
| Audio mute | Only the focused account plays sound; Web Audio is suspended |

Measured with `pnpm bench` (4 accounts of a synthetic canvas game, headless
Chromium; CPU of all browser processes and of the pages' main threads):

| Scenario | All processes | Main thread | FPS per tab |
|---|---|---|---|
| No IdleHub runtime | ~90% CPU | ~710 ms/s | 60/60/60/60 |
| Runtime installed, nothing capped | ~92% (within noise: no overhead) | ~720 ms/s | 60/60/60/60 |
| 4 panes (30 fps each) | ~62% (**−31%**) | ~400 ms/s (**−43%**) | 30/30/30/30 |
| 1 pane (60 fps) + 3 hidden (1 fps) | ~29% (**−67%**) | ~210 ms/s (**−70%**) | 60/1/1/1 |

`pnpm bench:app` runs the real desktop app (Linux/WebKitGTK) the same way and
checks every tab renders at its policy's cap end to end, with a per-process
breakdown. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for the measurements
behind each optimization.

Game timers (server ticks) keep running at full speed in every scenario.

## Development

Requirements: Node 22, pnpm 10, Rust stable, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
pnpm install
pnpm tauri dev        # run the desktop app
pnpm dev              # UI only, in a browser, on demo data
pnpm test             # UI + injected runtime tests (Vitest)
cargo test --workspace  # Rust domain tests
pnpm bench            # CPU benchmark of the injected runtime
pnpm tauri android dev  # Android (needs the Android SDK and NDK)
pnpm tauri ios init && pnpm tauri ios dev  # iOS (macOS with Xcode)
```

## Layout

```
crates/idlehub-core/   Pure Rust domain: accounts, layout, policies, profiles, metrics
src-tauri/             Tauri shell: commands, injection, sampling; `host/` places game webviews
crates/tauri-plugin-tabs/  Native game webviews for Android (Kotlin) and iOS (Swift)
src/                   React toolbar UI
inject/                Runtime injected into every game page
bench/                 Performance benchmark
docs/PLANNING.md       Architecture and roadmap
```
