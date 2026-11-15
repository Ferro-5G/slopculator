import { synth, VARIANTS, type SoundCue } from '../ui/sounds';

export type Cue = SoundCue;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let enabled = true;
const VOLUME = 0.35;
const cache = new Map<string, AudioBuffer>();
/** Rendered samples by rate, cue and variant. They don't need an AudioContext, so they can be made before the first tap. */
const samples = new Map<string, Float32Array>();
const last = new Map<Cue, { variant: number; at: number }>();

function render(rate: number, cue: Cue, variant: number): Float32Array {
  const key = `${rate}:${cue}:${variant}`;
  let x = samples.get(key);
  if (!x) samples.set(key, (x = synth(cue, variant, rate)));
  return x;
}

/**
 * Renders every sound at a rate while the page is idle, one at a time with a yield between: all of them at
 * once held the main thread for about 100 ms. Keys come first, since they're pressed first.
 */
function warm(rate: number): void {
  const queue = (Object.keys(VARIANTS) as Cue[]).flatMap((cue) => Array.from({ length: VARIANTS[cue] }, (_, v) => [cue, v] as const));
  const idle = 'requestIdleCallback' in window;
  const next = () => (idle ? window.requestIdleCallback(step, { timeout: 3000 }) : setTimeout(step, 50));
  function step(deadline?: IdleDeadline): void {
    if (!enabled) return;    do {
      const item = queue.shift();
      if (!item) return;
      render(rate, item[0], item[1]);
    } while (deadline && !deadline.didTimeout && deadline.timeRemaining() > 8);
    next();
  }
  next();
}
// Most phones and desktops run audio at 48 kHz. Render for that before anything is pressed; a context that
// turns out to run at another rate renders its own set when it starts.
const GUESS_RATE = 48000;
warm(GUESS_RATE);

export function setSound(on: boolean): void {
  enabled = on;
}

function buffer(c: AudioContext, cue: Cue, variant: number): AudioBuffer {
  const key = `${cue}:${variant}`;
  let b = cache.get(key);
  if (!b) {
    const x = render(c.sampleRate, cue, variant);
    b = c.createBuffer(1, x.length, c.sampleRate);
    b.getChannelData(0).set(x);
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
  if (ctx.sampleRate !== GUESS_RATE) warm(ctx.sampleRate);
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
