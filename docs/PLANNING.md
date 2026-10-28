# IdleHub — Architecture & Roadmap

IdleHub is a lightweight multi-account browser for idle browser games, starting
with [Huntera](https://huntera.com.br). It keeps several isolated game sessions
alive at the same time while spending as little CPU and memory as possible.

## Targets

| Platform | Engine            | Layout                     | Background behaviour                         |
|----------|-------------------|----------------------------|----------------------------------------------|
| Windows  | WebView2 (Chromium) | 2×2 grid, focus mode     | All accounts always running                  |
| macOS    | WKWebView         | 2×2 grid, focus mode       | All accounts always running                  |
| Android  | Android WebView   | One account on screen, tabs | Hidden tabs keep running; foreground service when app is backgrounded |
| iOS      | WKWebView         | One account on screen, tabs | Hidden tabs keep running while app is open; background is best-effort |

Initial scope: **4 accounts**.

## Stack

- **Tauri 2 (Rust)** — app shell, account storage, webview orchestration, metrics.
- **React + TypeScript (Vite)** — UI chrome (grid overlay, tabs, status bar, settings).
- **Injected scripts (TypeScript, bundled as IIFE)** — run inside each game page.
- **Native mobile plugin (Kotlin / Swift)** — Tauri does not support multiple
  webviews on mobile, so a plugin owns the game webviews there.

### Repository layout

```
crates/idlehub-core/   Pure Rust domain logic (no Tauri dependency, fully unit tested)
src-tauri/             Tauri app: commands, child webviews, injection, metrics sampling
src/                   React UI
inject/                Scripts injected into every game page
bench/                 Performance benchmarks (Playwright + Chromium)
docs/                  This document
```

## Account isolation

Each account gets its own cookie jar / localStorage / IndexedDB:

| Platform | Mechanism |
|----------|-----------|
| Windows  | Separate WebView2 user data directory per account (`WebviewBuilder::data_directory`) |
| macOS    | `WKWebsiteDataStore(forIdentifier:)` (`WebviewBuilder::data_store_identifier`, macOS 14+) |
| Android  | AndroidX WebKit `ProfileStore` (one profile per account) |
| iOS      | `WKWebsiteDataStore(forIdentifier:)` (iOS 17+) |

The identifier is derived deterministically from the account id
(`idlehub-core::profile`), so an account always reopens with its own session.

## Resource strategy

Huntera is a server-authoritative MMORPG: the session must stay connected, so we
never discard a running account. Instead we make every non-focused account cheap:

1. **Frame limiter** — `requestAnimationFrame` is capped (default 60 fps focused,
   10 fps unfocused). Rendering is the dominant CPU cost of canvas games.
2. **Keep visible** — the page always reports `document.visibilityState === "visible"`
   and `visibilitychange` is swallowed, so the game never pauses or disconnects
   because it thinks it is hidden.
3. **Audio mute** — every non-focused account is muted (media elements + WebAudio).
4. **Metrics** — the app samples CPU / RSS of every webview process and shows it per
   account and in total, so regressions are visible.

Policies are pure functions in `idlehub-core::policy` and pushed to pages through
`window.__idlehub.apply(policy)`.

### Desktop

One window, four child webviews in a 2×2 grid (`idlehub-core::layout`). Clicking an
account focuses it (full window); `Esc` returns to the grid.

### Android

- All four `WebView`s stay attached to the window (stacked); the active one is on top.
  We never call `onPause()` / `pauseTimers()`.
- `setRendererPriorityPolicy(RENDERER_PRIORITY_IMPORTANT, false)` so hidden renderers
  are not killed.
- Foreground service (+ partial wake lock, battery optimisation exemption) while the
  app is in the background.

### iOS

- All four `WKWebView`s stay in the view hierarchy (occluded, not `isHidden`), so
  WebKit keeps them running while the app is open.
- iOS suspends apps in the background. An opt-in "keep alive" mode (audio background
  mode) is possible for sideloaded/TestFlight builds but is likely to be rejected by
  App Review. Treat background execution on iOS as best-effort.

## Testing & performance

- **TDD**: Rust domain logic with `cargo test`, UI and injected scripts with Vitest.
- **Performance gate**: `bench/` runs a synthetic canvas game in headless Chromium
  with and without the injected limiter and asserts the CPU-time reduction.
- **CI**: tests on Linux; Tauri build on macOS and Windows.

## Roadmap

1. ✅ Foundation: core domain, injected scripts, performance bench, desktop grid.
2. Desktop hardening: persistent window state, per-account reload, crash recovery,
   metrics panel.
3. Android plugin (Kotlin): ProfileStore webviews, foreground service.
4. iOS plugin (Swift): data stores per account, keep-attached tabs.
5. Spike: validate on real Huntera sessions (visibility handling, reconnects, offline cap).

## Risks

- Multi-webview in Tauri is behind the `unstable` feature.
- `data_store_identifier` requires macOS 14+ / iOS 17+.
- Huntera's terms may restrict multiple accounts. IdleHub does not automate gameplay
  or talk to the game protocol; it only manages browser sessions.
