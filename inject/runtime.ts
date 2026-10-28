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

/** The fields of `next` that are usable; anything else keeps its current value. */
function usable(next: unknown): Partial<RenderPolicy> {
  if (typeof next !== "object" || next === null) return {};
  const { maxFps, muted } = next as Record<string, unknown>;
  return {
    ...(typeof maxFps === "number" ? { maxFps } : {}),
    ...(typeof muted === "boolean" ? { muted } : {}),
  };
}

/**
 * Installs every page-side optimisation and exposes `window.__idlehub` so the
 * host app can push a new policy with `__idlehub.apply({ maxFps, muted })`.
 */
export function installRuntime(win: IdleHubWindow): IdleHubRuntime {
  if (win.__idlehub) return win.__idlehub;

  let policy = { ...DEFAULT_POLICY, ...usable(win.__IDLEHUB_POLICY__) };
  const restoreVisibility = installKeepVisible(win);
  const frames = installFrameLimiter(win, policy.maxFps);
  const audio = installAudioMute(win, policy.muted);

  const runtime: IdleHubRuntime = {
    get policy() {
      return { ...policy };
    },
    apply(next) {
      policy = { ...policy, ...usable(next) };
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
