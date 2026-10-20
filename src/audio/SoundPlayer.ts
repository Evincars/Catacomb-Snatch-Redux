import { assetUrl } from '../assets/assetUrl';
import { LoadError, attemptAsync } from '../core/errors';
import { createLog } from '../core/log';

const log = createLog('audio');
/**
 * Web Audio port of the Java ISoundPlayer. Music is queued as soon as it is
 * requested and is heard the moment the browser lets the AudioContext run
 * (immediately if autoplay is allowed, otherwise on the first user gesture).
 * Sound effects requested while the context is still suspended are dropped.
 */

export const SFX = {
  shot1: '/sound/Shot 1.wav',
  shot2: '/sound/Shot 2.wav',
  hit: '/sound/hit2.wav',
  explosion: '/sound/Explosion.wav',
  explosion2: '/sound/Explosion 2.wav',
  death: '/sound/Death.wav',
  enemyDeath1: '/sound/Enemy Death 1.wav',
  enemyDeath2: '/sound/Enemy Death 2.wav',
  pharaoDies: '/sound/pharao_dies.wav',
  smallCoin: '/sound/Small Coin.wav',
  bigCoin: '/sound/Big Coin.wav',
  gem: '/sound/Gem.wav',
  bigGem: '/sound/Big Gem.wav',
  step1: '/sound/Step 1.wav',
  step2: '/sound/Step 2.wav',
  levelUp: '/sound/levelUp.wav',
  upgrade: '/sound/Upgrade.wav',
  trackPlace: '/sound/Track Place.wav',
  fail: '/sound/Fail.wav',
  fall: '/sound/Fall.wav',
  fallingMale: '/sound/falling_male.wav',
  fallingFemale: '/sound/falling_female.wav',
} as const;

export type SfxName = keyof typeof SFX;

const MUSIC = {
  title: '/sound/ThemeTitle.ogg',
  end: '/sound/ThemeEnd.ogg',
  background: [
    '/sound/Background 1.ogg',
    '/sound/Background 2.ogg',
    '/sound/Background 3.ogg',
    '/sound/Background 4.ogg',
  ],
} as const;

/** Distance in pixels past which a positional sound is inaudible. */
const EARSHOT = 320;

class SoundPlayer {
  onEffect: ((name: SfxName, x?: number, y?: number) => void) | null = null;
  /** Set while the computer opponent acts, so its unpositioned UI sounds stay silent. */
  muteInterface = false;
  private ctx: AudioContext | null = null;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private music: AudioBufferSourceNode | null = null;
  private currentMusic: string | null = null;
  private currentLoop = true;
  private listener = { x: 0, y: 0 };

  sfxVolume = 0.6;
  musicVolume = 0.35;

  /** Number of clips load() fetches, for progress reporting. */
  readonly clipCount = Object.keys(SFX).length + 2 + MUSIC.background.length;

  /** Decodes every clip up front. Safe to call before any user gesture. */
  async load(onClipDone?: () => void): Promise<void> {
    const ctx = this.context();
    // The title theme goes first so the menu music can start while the rest downloads.
    const paths = [MUSIC.title, ...Object.values(SFX), MUSIC.end, ...MUSIC.background];

    await Promise.all(
      paths.map(async (path) => {
        // A single unplayable clip must not break the whole game: it is logged and skipped.
        const loaded = await attemptAsync(() => this.loadClip(ctx, path), 'load-failed');
        if (!loaded.ok) log.warn('Sound clip unavailable', { path, reason: loaded.error.message });
        onClipDone?.();
      }),
    );
  }

  private async loadClip(ctx: AudioContext, path: string): Promise<void> {
    const res = await fetch(assetUrl(path));
    if (!res.ok) throw new LoadError(`HTTP ${res.status} loading ${path}`, { context: { path, status: res.status } });
    this.buffers.set(path, await ctx.decodeAudioData(await res.arrayBuffer()));
    if (path === this.currentMusic && !this.music) this.playMusic(path, this.currentLoop);
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * Tries to start audio right away and otherwise retries on the first user
   * gesture, which browsers with a strict autoplay policy require.
   */
  autoStart(): void {
    const events = ['pointerdown', 'keydown', 'touchend'] as const;
    const ctx = this.context();
    const detach = () => events.forEach((e) => window.removeEventListener(e, unlock, true));
    const unlock = () => {
      void ctx.resume();
      if (ctx.state === 'running') detach();
    };
    events.forEach((e) => window.addEventListener(e, unlock, true));
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') detach();
    });
    // Without a gesture the browser refuses; the listeners above retry on the first one.
    void ctx.resume().catch(() => log.debug('Audio waits for a user gesture'));
  }

  /** Call from a click/keypress handler. Resumes the context if the browser suspended it. */
  unlock(): void {
    const ctx = this.context();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  setListener(x: number, y: number): void {
    this.listener.x = x;
    this.listener.y = y;
  }

  /** Plays a sound effect, optionally attenuated and panned by world position. */
  playSound(name: SfxName, x?: number, y?: number): void {
    // Interface sounds (no position) of the computer opponent are not heard.
    if (this.muteInterface && (x === undefined || y === undefined)) return;
    this.onEffect?.(name, x, y);
    if (this.ctx?.state !== 'running') return;
    const buffer = this.buffers.get(SFX[name]);
    if (!buffer) return;

    const ctx = this.context();
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    if (x === undefined || y === undefined) {
      src.connect(this.sfxGain);
    } else {
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      const dist = Math.hypot(dx, dy);
      if (dist > EARSHOT) return;

      const gain = ctx.createGain();
      gain.gain.value = 1 - dist / EARSHOT;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, dx / EARSHOT));
      src.connect(gain);
      gain.connect(pan);
      pan.connect(this.sfxGain);
    }

    src.start();
  }

  /** Picks one of several clips at random — used for footsteps and gunshots. */
  playOneOf(names: SfxName[], x?: number, y?: number): void {
    this.playSound(names[Math.floor(Math.random() * names.length)], x, y);
  }

  startTitleMusic(): void {
    this.playMusic(MUSIC.title, true);
  }

  startBackgroundMusic(): void {
    this.playMusic(MUSIC.background[Math.floor(Math.random() * MUSIC.background.length)], true);
  }

  startEndMusic(): void {
    this.playMusic(MUSIC.end, false);
  }

  stopBackgroundMusic(): void {
    this.music?.stop();
    this.music = null;
    this.currentMusic = null;
  }

  private playMusic(path: string, loop: boolean): void {
    if (this.currentMusic === path && this.music) return;

    this.music?.stop();
    this.music = null;
    this.currentMusic = path;
    this.currentLoop = loop;

    // If the clip is still downloading, load() starts it once decoded.
    const buffer = this.buffers.get(path);
    if (!buffer) return;

    const src = this.context().createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.connect(this.musicGain);
    src.start();
    this.music = src;
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = v;
    if (this.ctx) this.sfxGain.gain.value = v;
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    if (this.ctx) this.musicGain.gain.value = v;
  }
}

export const sound = new SoundPlayer();
