import { VARIANTS, type SoundCue } from '../ui/sounds';

export type Cue = SoundCue;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let enabled = true;
const VOLUME = 0.35;
const cache = new Map<string, AudioBuffer>();
const last = new Map<Cue, { variant: number; at: number }>();

/**
 * The recorded clips, each as a data: URL in the bundle (scripts/make-sounds.mjs writes the files). The page is one
 * file with nothing to fetch, so a clip is read out of its own text when it is first played.
 */
const CLIPS = import.meta.glob<string>('../assets/sounds/*.wav', { eager: true, query: '?inline', import: 'default' });

/** A clip's samples and rate, from a 16-bit mono WAV file. */
function clip(cue: Cue, variant: number): { samples: Float32Array<ArrayBuffer>; rate: number } {
  const url = CLIPS[`../assets/sounds/${variant === 0 ? cue : `${cue}-${variant}`}.wav`];
  const text = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array((bytes.length - 44) >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  return { samples, rate: view.getUint32(24, true) };
}

export function setSound(on: boolean): void {
  enabled = on;
}

function buffer(c: AudioContext, cue: Cue, variant: number): AudioBuffer {
  const key = `${cue}:${variant}`;
  let b = cache.get(key);
  if (!b) {
    // The buffer keeps the file's own rate, and the context resamples it as it plays.
    const { samples, rate } = clip(cue, variant);
    b = c.createBuffer(1, samples.length, rate);
    b.copyToChannel(samples, 0);
    cache.set(key, b);
  }
  return b;
}

function context(): AudioContext {
  if (ctx) return ctx;
  ctx = new AudioContext({ latencyHint: 'interactive' });
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 6;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  out = ctx.createGain();
  out.gain.value = VOLUME;
  out.connect(limiter).connect(ctx.destination);
  return ctx;
}

function nextVariant(cue: Cue): number {
  const n = VARIANTS[cue];
  const prev = last.get(cue)?.variant;
  if (n === 1) return 0;
  if (prev === undefined) return Math.floor(Math.random() * n);
  const v = Math.floor(Math.random() * (n - 1));
  return v >= prev ? v + 1 : v;
}

/**
 * Browsers start audio suspended until a gesture, and iOS Safari parks it as "interrupted" after a call, a
 * lock or a trip to another app. Resume on every gesture, not only the first, so a sound never goes missing
 * for the press after one of those.
 */
function wake(): void {
  if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
}
for (const type of ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const) window.addEventListener(type, wake, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

export function play(cue: Cue): void {
  if (!enabled) return;
  try {
    const c = context();
    if (c.state !== 'running') void c.resume().catch(() => {});
    const variant = nextVariant(cue);
    const now = performance.now();
    const prev = last.get(cue);
    const burst = prev && now - prev.at < 45 ? 0.8 : 1;
    last.set(cue, { variant, at: now });
    const src = c.createBufferSource();
    src.buffer = buffer(c, cue, variant);
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.024;
    const gain = c.createGain();
    gain.gain.value = burst * (0.92 + Math.random() * 0.08);
    src.connect(gain).connect(out!);
    src.start();
  } catch {
    // No audio device: stay silent.
  }
}
