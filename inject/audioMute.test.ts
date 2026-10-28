import { installAudioMute } from "./audioMute";

class FakeAudioContext {
  state: "running" | "suspended" = "running";
  suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  resume = vi.fn(async () => {
    this.state = "running";
  });
}

type TestWindow = Omit<Window & typeof globalThis, "AudioContext"> & { AudioContext: unknown };

const asWindow = (w: TestWindow) => w as unknown as Window & typeof globalThis;

describe("installAudioMute", () => {
  let uninstall: () => void = () => {};
  const win = window as TestWindow;

  beforeEach(() => {
    win.AudioContext = FakeAudioContext;
    // jsdom does not implement playback.
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = "";
  });

  it("mutes media elements already in the page", () => {
    const audio = document.createElement("audio");
    document.body.append(audio);
    uninstall = installAudioMute(asWindow(win), true).uninstall;
    expect(audio.muted).toBe(true);
  });

  it("mutes detached audio objects when they start playing", async () => {
    uninstall = installAudioMute(asWindow(win), true).uninstall;
    const sound = new Audio();
    await sound.play();
    expect(sound.muted).toBe(true);
  });

  it("unmutes only what it muted", async () => {
    const mutedByGame = document.createElement("video");
    mutedByGame.muted = true;
    const music = document.createElement("audio");
    document.body.append(mutedByGame, music);
    const control = installAudioMute(asWindow(win), true);
    uninstall = control.uninstall;
    const sound = new Audio();
    await sound.play();

    control.setMuted(false);

    expect(music.muted).toBe(false);
    expect(sound.muted).toBe(false);
    expect(mutedByGame.muted).toBe(true);
  });

  it("suspends web audio contexts while muted and resumes them after", async () => {
    const control = installAudioMute(asWindow(win), false);
    uninstall = control.uninstall;
    const ctx = new (win.AudioContext as unknown as typeof FakeAudioContext)();

    control.setMuted(true);
    expect(ctx.state).toBe("suspended");

    control.setMuted(false);
    await Promise.resolve();
    expect(ctx.state).toBe("running");
  });

  it("keeps contexts created while muted suspended even if the game resumes them", async () => {
    const control = installAudioMute(asWindow(win), true);
    uninstall = control.uninstall;
    const ctx = new (win.AudioContext as unknown as typeof FakeAudioContext)();
    await Promise.resolve();
    expect(ctx.state).toBe("suspended");

    await ctx.resume();
    expect(ctx.state).toBe("suspended");

    control.setMuted(false);
    await Promise.resolve();
    expect(ctx.state).toBe("running");
  });

  it("reports the current state", () => {
    const control = installAudioMute(asWindow(win), false);
    uninstall = control.uninstall;
    expect(control.muted).toBe(false);
    control.setMuted(true);
    expect(control.muted).toBe(true);
  });
});
