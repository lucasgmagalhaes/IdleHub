import { installAudioMute } from "./audioMute";
import { installFrameLimiter } from "./frameLimiter";
import { installKeepVisible } from "./keepVisible";

export interface RenderPolicy {
  maxFps: number;
  muted: boolean;
}

export interface IdleHubRuntime {
  readonly policy: RenderPolicy;
  apply(policy: RenderPolicy): void;
  uninstall(): void;
}

export type IdleHubWindow = Window &
  typeof globalThis & {
    __idlehub?: IdleHubRuntime;
    __IDLEHUB_POLICY__?: RenderPolicy;
  };

const DEFAULT_POLICY: RenderPolicy = { maxFps: 60, muted: false };

/**
 * Installs every page-side optimisation and exposes `window.__idlehub` so the
 * host app can push a new policy with `__idlehub.apply({ maxFps, muted })`.
 */
export function installRuntime(win: IdleHubWindow): IdleHubRuntime {
  if (win.__idlehub) return win.__idlehub;

  let policy = { ...DEFAULT_POLICY, ...win.__IDLEHUB_POLICY__ };
  const restoreVisibility = installKeepVisible(win);
  const frames = installFrameLimiter(win, policy.maxFps);
  const audio = installAudioMute(win, policy.muted);

  const runtime: IdleHubRuntime = {
    get policy() {
      return { ...policy };
    },
    apply(next) {
      policy = { ...policy, ...next };
      frames.setMaxFps(policy.maxFps);
      audio.setMuted(policy.muted);
    },
    uninstall() {
      audio.uninstall();
      frames.uninstall();
      restoreVisibility();
      delete win.__idlehub;
    },
  };
  Object.defineProperty(win, "__idlehub", { value: runtime, configurable: true, enumerable: false });
  return runtime;
}
