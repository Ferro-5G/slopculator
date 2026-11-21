// The app's sounds are short recordings: key clicks, a switch, a chime. scripts/make-sounds.mjs cuts them from two
// public-domain packs into src/assets/sounds/, one file per cue and variant: tick.wav, tick-1.wav, tick-2.wav.
// Keys come in variants, takes of the same sound, so fast typing doesn't repeat one sample like a machine gun.

export type SoundCue = 'tick' | 'fn' | 'enter' | 'copy' | 'error' | 'clear' | 'toggle' | 'detent' | 'done';

export const VARIANTS: Record<SoundCue, number> = {
  tick: 3, fn: 3, enter: 1, copy: 1, error: 1, clear: 1, toggle: 1, detent: 2, done: 1,
};

/** How long each cue's longest variant plays, in ms, rounded up. A player that reuses voices waits this long. */
const MS: Record<SoundCue, number> = {
  tick: 40, fn: 92, enter: 72, copy: 124, error: 142, clear: 60, toggle: 61, detent: 12, done: 72,
};

export function cueMs(cue: SoundCue): number {
  return MS[cue];
}

/** A cue's file names, in variant order. */
export function cueFiles(cue: SoundCue): string[] {
  return Array.from({ length: VARIANTS[cue] }, (_, v) => (v === 0 ? `${cue}.wav` : `${cue}-${v}.wav`));
}
