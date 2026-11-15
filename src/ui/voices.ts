// Why it exists: expo-audio's seekTo is async, and play() on a player sitting at the end of its clip is a no-op
// on iOS (AVPlayer pauses again at once). Calling seekTo(0) then play() back to back raced, so a key played once
// and then went quiet until a later rewind happened to land first. Here a player is rewound as soon as its clip
// ends, so play() never has to wait on a seek.

export interface Player {
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  volume: number;
}

interface Voice {
  player: Player;
  ready: boolean;
  /** When the current play ends, in ms. */
  busyUntil: number;
  gen: number;
  variant: number;
}

export interface VoicePool<C extends string> {
  play(cue: C): void;
  setVolume(volume: number): void;
}

export function createVoicePool<C extends string>(
  variants: Record<C, number>,
  make: (cue: C, variant: number) => Player,
  ms: (cue: C) => number,
  minVoices = 3,
): VoicePool<C> {
  const pool = new Map<C, Voice[]>();
  const lastVariant = new Map<C, number>();
  for (const cue of Object.keys(variants) as C[]) {
    const n = variants[cue];
    pool.set(cue, Array.from({ length: Math.max(minVoices, n) }, (_, i) => ({ player: make(cue, i % n), ready: true, busyUntil: 0, gen: 0, variant: i % n })));
  }

  function park(v: Voice, gen: number): void {
    if (v.gen !== gen) return;
    const done = () => { if (v.gen === gen) v.ready = true; };
    try {
      v.player.pause();
      v.player.seekTo(0).then(done, done);
    } catch {
      v.ready = true;
    }
  }

  function start(v: Voice, cue: C): void {
    const gen = ++v.gen;
    v.ready = false;
    const len = ms(cue);
    v.busyUntil = Date.now() + len;
    v.player.play();
    // Rewind on a timer instead of waiting on a finished event: status events are throttled and can arrive late.
    setTimeout(() => park(v, gen), len + 30);
  }

  return {
    play(cue) {
      const voices = pool.get(cue);
      if (!voices?.length) return;
      const prev = lastVariant.get(cue);
      const free = voices.filter((v) => v.ready);
      const fresh = free.filter((v) => v.variant !== prev);
      const from = fresh.length ? fresh : free;
      const pick = from[Math.floor(Math.random() * from.length)];
      if (pick) {
        lastVariant.set(cue, pick.variant);
        start(pick, cue);
        return;
      }
      const v = voices.reduce((a, b) => (b.busyUntil < a.busyUntil ? b : a));
      const gen = ++v.gen;
      v.ready = false;
      lastVariant.set(cue, v.variant);
      v.player.pause();
      v.player.seekTo(0).then(() => { if (v.gen === gen) start(v, cue); }, () => {});
    },
    setVolume(volume) {
      for (const voices of pool.values()) for (const v of voices) v.player.volume = volume;
    },
  };
}
