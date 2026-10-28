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

  it("mutes media that starts on its own (autoplay) while muted", () => {
    uninstall = installAudioMute(asWindow(win), true).uninstall;
    const music = document.createElement("audio");
    music.autoplay = true;
    document.body.append(music);
    // Autoplay starts playback without calling play(); the browser fires "play".
    music.dispatchEvent(new Event("play"));
    expect(music.muted).toBe(true);
  });

  it("leaves autoplaying media alone while unmuted", () => {
    uninstall = installAudioMute(asWindow(win), false).uninstall;
    const music = document.createElement("audio");
    document.body.append(music);
    music.dispatchEvent(new Event("play"));
    expect(music.muted).toBe(false);
  });

  it("does not resume contexts the game had suspended itself", async () => {
    const control = installAudioMute(asWindow(win), false);
    uninstall = control.uninstall;
    const ctx = new (win.AudioContext as unknown as typeof FakeAudioContext)();
    await ctx.suspend(); // e.g. the game's own pause menu

    control.setMuted(true);
    control.setMuted(false);
    await Promise.resolve();
    expect(ctx.state).toBe("suspended");
  });

  it("stops muting new media after uninstall", () => {
    installAudioMute(asWindow(win), true).uninstall();
    const music = document.createElement("audio");
    document.body.append(music);
    music.dispatchEvent(new Event("play"));
    expect(music.muted).toBe(false);
  });

  it("keeps media silent when the game unmutes it while the tab is muted", async () => {
    uninstall = installAudioMute(asWindow(win), true).uninstall;
    const music = document.createElement("audio");
    document.body.append(music);
    await music.play();

    music.muted = false; // the game's own sound toggle

    expect(music.muted).toBe(true);
  });

  it("lets the game's sound choice apply once the tab is unmuted", async () => {
    const control = installAudioMute(asWindow(win), true);
    uninstall = control.uninstall;
    const music = document.createElement("audio");
    const effects = document.createElement("audio");
    document.body.append(music, effects);
    await music.play();
    await effects.play();

    music.muted = false; // game turns music on while the tab is muted
    effects.muted = true; // and turns effects off

    control.setMuted(false);
    expect(music.muted).toBe(false);
    expect(effects.muted).toBe(true);
  });

  it("lets the game mute and unmute freely while the tab is audible", () => {
    uninstall = installAudioMute(asWindow(win), false).uninstall;
    const music = document.createElement("audio");
    music.muted = true;
    expect(music.muted).toBe(true);
    music.muted = false;
    expect(music.muted).toBe(false);
  });

  it("restores the media muted property when uninstalled", () => {
    const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted");
    installAudioMute(asWindow(win), true).uninstall();
    expect(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted")).toEqual(native);
  });

  it("reports the current state", () => {
    const control = installAudioMute(asWindow(win), false);
    uninstall = control.uninstall;
    expect(control.muted).toBe(false);
    control.setMuted(true);
    expect(control.muted).toBe(true);
  });
});
