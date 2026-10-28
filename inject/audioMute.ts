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
  /** Media to unmute when the tab gets its sound back; `mutedByUs` says which still should. */
  const mutedMedia = new Set<WeakRef<HTMLMediaElement>>();
  const mutedByUs = new WeakSet<HTMLMediaElement>();
  const contexts = new Set<WeakRef<AudioContext>>();
  const suspendedByUs = new WeakSet<AudioContext>();

  const mediaPrototype = win.HTMLMediaElement.prototype;
  const nativePlay = mediaPrototype.play;
  const nativeMuted = Object.getOwnPropertyDescriptor(mediaPrototype, "muted")!;
  const isMuted = (el: HTMLMediaElement) => nativeMuted.get!.call(el) as boolean;
  const setMuted = (el: HTMLMediaElement, value: boolean) => nativeMuted.set!.call(el, value);
  const nativeContexts = {
    AudioContext: win.AudioContext,
    webkitAudioContext: win.webkitAudioContext,
  };

  /** Silences `el` and remembers to give it its sound back. */
  function muteMedia(el: HTMLMediaElement) {
    if (isMuted(el) || mutedByUs.has(el)) return;
    setMuted(el, true);
    mutedByUs.add(el);
    mutedMedia.add(new WeakRef(el));
  }

  function suspend(ctx: AudioContext) {
    // A context the game paused itself stays the game's to resume.
    if (ctx.state !== "running" || suspendedByUs.has(ctx)) return;
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
      if (el && mutedByUs.has(el)) {
        mutedByUs.delete(el);
        setMuted(el, false);
      }
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

  // While the tab is muted, the game's own sound toggle is remembered, not applied:
  // it would otherwise make a hidden tab audible. Unmuting the tab applies it.
  Object.defineProperty(mediaPrototype, "muted", {
    ...nativeMuted,
    set(this: HTMLMediaElement, value: boolean) {
      if (!muted) return setMuted(this, value);
      if (value) {
        mutedByUs.delete(this);
        setMuted(this, true);
      } else {
        setMuted(this, true);
        if (!mutedByUs.has(this)) {
          mutedByUs.add(this);
          mutedMedia.add(new WeakRef(this));
        }
      }
    },
  });

  mediaPrototype.play = function (this: HTMLMediaElement) {
    if (muted) muteMedia(this);
    return nativePlay.call(this);
  };

  // Autoplay starts media without play(). "play" does not bubble, but capture on window sees it first.
  const onPlay = (event: Event) => {
    if (muted && event.target instanceof win.HTMLMediaElement) muteMedia(event.target);
  };
  win.addEventListener("play", onPlay, true);

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
      Object.defineProperty(mediaPrototype, "muted", nativeMuted);
      win.removeEventListener("play", onPlay, true);
      win.AudioContext = nativeContexts.AudioContext;
      if (nativeContexts.webkitAudioContext) win.webkitAudioContext = nativeContexts.webkitAudioContext;
    },
  };
}
