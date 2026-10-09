/**
 * Web Audio port of the Java ISoundPlayer. Browsers refuse to start audio
 * before a user gesture, so playback requests made before the first click are
 * dropped and music is restarted by unlock().
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
  private ctx: AudioContext | null = null;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private music: AudioBufferSourceNode | null = null;
  private currentMusic: string | null = null;
  private unlocked = false;
  private listener = { x: 0, y: 0 };

  sfxVolume = 0.6;
  musicVolume = 0.35;

  /** Decodes every clip up front. Safe to call before any user gesture. */
  async load(): Promise<void> {
    const ctx = this.context();
    const paths = [...Object.values(SFX), MUSIC.title, MUSIC.end, ...MUSIC.background];

    await Promise.all(
      paths.map(async (path) => {
        try {
          const res = await fetch(path);
          if (!res.ok) return;
          const bytes = await res.arrayBuffer();
          this.buffers.set(path, await ctx.decodeAudioData(bytes));
        } catch {
          // A single unplayable clip must not break the whole game.
        }
      }),
    );
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

  /** Call from a click/keypress handler. Resumes the context and starts any pending track. */
  unlock(): void {
    const ctx = this.context();
    if (ctx.state === 'suspended') void ctx.resume();
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.currentMusic && !this.music) this.playMusic(this.currentMusic, true);
  }

  setListener(x: number, y: number): void {
    this.listener.x = x;
    this.listener.y = y;
  }

  /** Plays a sound effect, optionally attenuated and panned by world position. */
  playSound(name: SfxName, x?: number, y?: number): void {
    if (!this.unlocked) return;
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

    // Remember the request so unlock() can start it after the first gesture.
    if (!this.unlocked) return;

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
