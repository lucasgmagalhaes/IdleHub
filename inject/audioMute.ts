export interface AudioMute {
  readonly muted: boolean;
  setMuted(muted: boolean): void;
  uninstall(): void;
}

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

/**
 * Silences a game page: media elements are muted and Web Audio contexts are
 * suspended, which also stops the audio thread from using CPU.
 *
 * Only what this module muted is restored, so the game's own mute settings win.
 */
export function installAudioMute(win: AudioWindow, initiallyMuted: boolean): AudioMute {
  let muted = initiallyMuted;
  const mutedMedia = new Set<WeakRef<HTMLMediaElement>>();
  const contexts = new Set<WeakRef<AudioContext>>();
  const suspendedByUs = new WeakSet<AudioContext>();

  const mediaPrototype = win.HTMLMediaElement.prototype;
  const nativePlay = mediaPrototype.play;
  const nativeContexts = {
    AudioContext: win.AudioContext,
    webkitAudioContext: win.webkitAudioContext,
  };

  function muteMedia(el: HTMLMediaElement) {
    if (el.muted) return;
    el.muted = true;
    mutedMedia.add(new WeakRef(el));
  }

  function suspend(ctx: AudioContext) {
    if (ctx.state === "closed" || suspendedByUs.has(ctx)) return;
    suspendedByUs.add(ctx);
    void ctx.suspend();
  }

  // The game-facing resume() is replaced per context; this keeps the real one.
  const nativeResume = new WeakMap<AudioContext, () => Promise<void>>();

  function apply() {
    if (muted) {
      win.document.querySelectorAll("audio, video").forEach((el) => muteMedia(el as HTMLMediaElement));
      for (const ref of contexts) {
        const ctx = ref.deref();
        if (ctx) suspend(ctx);
        else contexts.delete(ref);
      }
      return;
    }
    for (const ref of mutedMedia) {
      const el = ref.deref();
      if (el) el.muted = false;
    }
    mutedMedia.clear();
    for (const ref of contexts) {
      const ctx = ref.deref();
      if (!ctx) {
        contexts.delete(ref);
      } else if (suspendedByUs.has(ctx)) {
        suspendedByUs.delete(ctx);
        void (nativeResume.get(ctx) ?? ctx.resume).call(ctx);
      }
    }
  }

  mediaPrototype.play = function (this: HTMLMediaElement) {
    if (muted) muteMedia(this);
    return nativePlay.call(this);
  };

  function wrapContext<T extends typeof AudioContext>(Native: T): T {
    return class extends (Native as typeof AudioContext) {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        const ctx = this as AudioContext;
        const resume = ctx.resume;
        nativeResume.set(ctx, resume);
        // While muted the game may try to resume (e.g. on first click); defer it instead.
        ctx.resume = function (this: AudioContext) {
          if (muted) {
            suspendedByUs.add(this);
            return Promise.resolve();
          }
          return resume.call(this);
        };
        contexts.add(new WeakRef(ctx));
        if (muted) suspend(ctx);
      }
    } as unknown as T;
  }

  if (nativeContexts.AudioContext) win.AudioContext = wrapContext(nativeContexts.AudioContext);
  if (nativeContexts.webkitAudioContext) win.webkitAudioContext = wrapContext(nativeContexts.webkitAudioContext);
  apply();

  return {
    get muted() {
      return muted;
    },
    setMuted(value: boolean) {
      if (value === muted) return;
      muted = value;
      apply();
    },
    uninstall() {
      mediaPrototype.play = nativePlay;
      win.AudioContext = nativeContexts.AudioContext;
      if (nativeContexts.webkitAudioContext) win.webkitAudioContext = nativeContexts.webkitAudioContext;
    },
  };
}
