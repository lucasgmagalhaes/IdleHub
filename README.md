# IdleHub

Lightweight multi-account browser for idle browser games (starting with
[Huntera](https://huntera.com.br)). Runs several isolated accounts side by side
while keeping CPU and memory as low as possible.

- **Desktop (Windows, macOS):** one window, up to 4 accounts in a 2×2 grid; focus
  one account and the others keep running in a side rail.
- **Mobile (Android, iOS):** planned, see [docs/PLANNING.md](docs/PLANNING.md).

## How it saves resources

Every game page gets a small injected runtime (`inject/`, ~3 KB) that:

| Feature | Why |
|---|---|
| Frame limiter (`requestAnimationFrame` cap) | Rendering is the main CPU cost; unfocused accounts render at 5–20 fps |
| Keep visible / focused | The game never pauses or disconnects because it thinks it is hidden |
| Audio mute | Only the focused account plays sound; Web Audio is suspended |

Measured with `pnpm bench` (4 accounts of a synthetic canvas game, headless Chromium):

| Scenario | Main-thread CPU | Saving | FPS per account |
|---|---|---|---|
| No IdleHub runtime | ~850–980 ms/s | – | 60/60/60/60 |
| Grid (20 fps each) | ~260–290 ms/s | 65–74% | 20/20/20/20 |
| One focused (60 fps), others 5 fps | ~230–245 ms/s | 71–77% | 60/5/5/5 |

Game timers (server ticks) keep running at full speed in every scenario.

## Development

Requirements: Node 22, pnpm 10, Rust stable, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
pnpm install
pnpm tauri dev        # run the desktop app
pnpm test             # UI + injected runtime tests (Vitest)
cargo test --workspace  # Rust domain tests
pnpm bench            # CPU benchmark of the injected runtime
```

## Layout

```
crates/idlehub-core/   Pure Rust domain: accounts, layout, policies, profiles, metrics
src-tauri/             Tauri shell: child webviews, injection, commands, sampling
src/                   React toolbar UI
inject/                Runtime injected into every game page
bench/                 Performance benchmark
docs/PLANNING.md       Architecture and roadmap
```
