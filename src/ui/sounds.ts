// Keys are struck objects, not beeps. Each one is a filtered noise transient for the contact, a few
// inharmonic partials that die in a handful of milliseconds (that's what makes plastic sound like plastic
// and not like a sine wave), and a low thump for weight. Chimes use a marimba bar's partials with a soft
// mallet. Everything goes through a short diffuse room, built from sparse random taps, so it sits in a
// space instead of ringing like a comb filter. Frequent cues come in variants, so fast typing doesn't repeat
// one sample like a machine gun.

export type SoundCue = 'tick' | 'fn' | 'enter' | 'copy' | 'error' | 'clear' | 'toggle' | 'detent' | 'done';

export const VARIANTS: Record<SoundCue, number> = {
  tick: 5, fn: 4, enter: 3, copy: 1, error: 1, clear: 1, toggle: 3, detent: 3, done: 1,
};

const LEVEL: Record<SoundCue, number> = {
  tick: 0.5, fn: 0.54, enter: 0.72, copy: 0.44, error: 0.56, clear: 0.46, toggle: 0.46, detent: 0.34, done: 0.42,
};

interface Voice {
  /** Start time in ms. */
  at?: number;
}
interface Click extends Voice { kind: 'click'; freq: number; q: number; amp: number; decay: number }
/**
 * A struck object: partials at ratios of a fundamental, each with its own level and decay. The whole thing
 * can drop in pitch as it rings (a key bottoming out), from f0 toward f0 * drop with time constant glide.
 */
interface Strike extends Voice {
  kind: 'strike'; f0: number; partials: [ratio: number, amp: number, decay: number][];
  amp: number; drop?: number; glide?: number; attack?: number;
}
interface Sweep extends Voice { kind: 'sweep'; f0: number; f1: number; ms: number; amp: number; q: number }
type Part = Click | Strike | Sweep;

interface Recipe {
  ms: number;
  parts: Part[];
  room: number;
  /** One-pole lowpass on the output, in Hz, to take the edge off. */
  tone: number;
  /** One-pole highpass in Hz, so tiny phone speakers don't waste power on lows they can't play. */
  low?: number;
}

/** Deterministic noise, so every build and every page load produce the same sounds. */
function rng(seed: number): () => number {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

function spread(v: number, n: number): number {
  return n <= 1 ? 0 : (v / (n - 1)) * 2 - 1;
}

// Partials of the objects the keys are made of. Ratios are inharmonic on purpose.
const CAP: [number, number, number][] = [[1, 1, 3.2], [1.59, 0.55, 2.1], [2.37, 0.3, 1.4], [3.41, 0.14, 0.9]];
const KEY: [number, number, number][] = [[1, 1, 6], [1.71, 0.42, 3.5], [2.63, 0.2, 2], [3.9, 0.08, 1.2]];
const THUMP: [number, number, number][] = [[1, 1, 9], [2.02, 0.22, 4]];
/** A marimba bar: a fundamental, its tuned 4th partial, and a short 10th. Decays in ms at 1 kHz. */
const BAR: [number, number, number][] = [[1, 1, 150], [3.93, 0.2, 30], [9.24, 0.06, 7]];

function note(f: number, at: number, amp: number, ring = 1): Part[] {
  return [
    { kind: 'click', at, freq: Math.min(6000, f * 2.2), q: 0.9, amp: amp * 0.18, decay: 0.7 },
    { kind: 'strike', at, f0: f, amp, attack: 1.6, partials: BAR.map(([r, a, d]) => [r, a, (d * ring * 1000) / Math.max(600, f)]) },
  ];
}

function recipe(cue: SoundCue, v: number): Recipe {
  const k = spread(v, VARIANTS[cue]);
  const p = 1 + 0.035 * k; // pitch
  const d = 1 - 0.12 * k; // decay
  const b = 1 + 0.12 * Math.sin(v * 2.4); // brightness of the contact
  switch (cue) {
    // Digit keys: a soft, short tap on a keycap. Felt more than heard.
    case 'tick': return {
      ms: 55, room: 0.16, tone: 7200, low: 140,
      parts: [
        { kind: 'click', freq: 3600 * p * b, q: 0.8, amp: 0.5, decay: 0.45 * d },
        { kind: 'strike', at: 0.3, f0: 1850 * p, amp: 0.3, drop: 0.93, glide: 4, partials: CAP.map(([r, a, t]) => [r, a, t * d]) },
        { kind: 'strike', at: 0.8, f0: 400 * p, amp: 0.2, drop: 0.84, glide: 6, partials: THUMP.map(([r, a, t]) => [r, a, t * 0.8 * d]) },
      ],
    };
    // Function and operator keys: the same hand on a bigger key, lower and rounder.
    case 'fn': return {
      ms: 75, room: 0.18, tone: 6600, low: 120,
      parts: [
        { kind: 'click', freq: 2900 * p * b, q: 0.8, amp: 0.45, decay: 0.55 * d },
        { kind: 'strike', at: 0.3, f0: 1200 * p, amp: 0.32, drop: 0.9, glide: 5, partials: KEY.map(([r, a, t]) => [r, a, t * d]) },
        { kind: 'strike', at: 0.9, f0: 310 * p, amp: 0.26, drop: 0.8, glide: 7, partials: THUMP.map(([r, a, t]) => [r, a, t * d]) },
      ],
    };
    // Enter: a deep, satisfying thock, then a quiet bar note a beat later that says "got it".
    case 'enter': return {
      ms: 300, room: 0.24, tone: 6800, low: 70,
      parts: [
        { kind: 'click', freq: 2300 * p * b, q: 0.7, amp: 0.42, decay: 0.8 * d },
        { kind: 'strike', at: 0.4, f0: 600 * p, amp: 0.42, drop: 0.86, glide: 8, partials: KEY.map(([r, a, t]) => [r, a, t * 1.6 * d]) },
        { kind: 'strike', at: 1, f0: 165 * p, amp: 0.46, drop: 0.74, glide: 12, partials: THUMP.map(([r, a, t]) => [r, a, t * 2.6 * d]) },
        ...note(1568 * (1 + 0.004 * k), 34, 0.07, 0.7),
      ],
    };
    // Copy: two marimba notes rising a fourth (E6, A6), like something lifted onto the clipboard.
    case 'copy': return {
      ms: 640, room: 0.3, tone: 9000, low: 200,
      parts: [...note(1318.5, 0, 0.36), ...note(1760, 62, 0.4, 1.2)],
    };
    // Error: two low, muted knocks that fall a minor third. Never a buzzer.
    case 'error': return {
      ms: 300, room: 0.18, tone: 3200, low: 90,
      parts: [
        { kind: 'click', freq: 1400, q: 0.7, amp: 0.22, decay: 0.9 },
        { kind: 'strike', at: 0.5, f0: 392, amp: 0.48, drop: 0.92, glide: 20, partials: [[1, 1, 42], [2.76, 0.25, 9], [5.4, 0.06, 3]] },
        { kind: 'click', at: 92, freq: 1200, q: 0.7, amp: 0.2, decay: 0.9 },
        { kind: 'strike', at: 92.5, f0: 329.6, amp: 0.5, drop: 0.9, glide: 26, partials: [[1, 1, 60], [2.76, 0.22, 10], [5.4, 0.05, 3]] },
      ],
    };
    // Clear all: a page swept off the desk. Airy noise falling away with a soft low tail.
    case 'clear': return {
      ms: 340, room: 0.26, tone: 6000, low: 110,
      parts: [
        { kind: 'sweep', f0: 5200, f1: 700, ms: 250, amp: 0.4, q: 1.1 },
        { kind: 'sweep', at: 25, f0: 1800, f1: 240, ms: 280, amp: 0.3, q: 1.6 },
        { kind: 'strike', at: 30, f0: 330, amp: 0.05, drop: 0.5, glide: 110, attack: 40, partials: [[1, 1, 120]] },
      ],
    };
    // Toggles, tabs and modes: a crisp latch, press then settle, the second click a little lower.
    case 'toggle': return {
      ms: 70, room: 0.14, tone: 8000, low: 220,
      parts: [
        { kind: 'click', freq: 4300 * p * b, q: 1.2, amp: 0.42, decay: 0.35 * d },
        { kind: 'strike', at: 0.2, f0: 2400 * p, amp: 0.2, drop: 0.95, glide: 3, partials: CAP.map(([r, a, t]) => [r, a, t * 0.7]) },
        { kind: 'click', at: 19, freq: 3100 * p, q: 1.1, amp: 0.3, decay: 0.4 * d },
        { kind: 'strike', at: 19.2, f0: 1500 * p, amp: 0.16, drop: 0.93, glide: 3, partials: CAP.map(([r, a, t]) => [r, a, t * 0.9]) },
      ],
    };
    // Slider detents and graph trace steps: the smallest possible tick.
    case 'detent': return {
      ms: 22, room: 0, tone: 9000, low: 400,
      parts: [
        { kind: 'click', freq: 5200 * p, q: 1.4, amp: 0.45, decay: 0.28 * d },
        { kind: 'strike', at: 0.2, f0: 2900 * p, amp: 0.14, partials: [[1, 1, 1.4], [1.62, 0.4, 0.8]] },
      ],
    };
    // A finished result: a quick, soft C major arpeggio on the bar.
    case 'done': return {
      ms: 700, room: 0.32, tone: 8500, low: 200,
      parts: [...note(1046.5, 0, 0.26), ...note(1318.5, 42, 0.24), ...note(1568, 84, 0.3, 1.3)],
    };
  }
}

/** Two-pole bandpass (RBJ biquad, constant peak gain) run over a signal in place. */
function bandpass(x: Float32Array, rate: number, freq: (i: number) => number, q: number): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let b0 = 0, b2 = 0, a1 = 0, a2 = 0;
  for (let i = 0; i < x.length; i++) {
    if ((i & 15) === 0) {
      const w = (2 * Math.PI * Math.min(freq(i), rate * 0.45)) / rate;
      const alpha = Math.sin(w) / (2 * q);
      const a0 = 1 + alpha;
      b0 = alpha / a0; b2 = -alpha / a0; a1 = (-2 * Math.cos(w)) / a0; a2 = (1 - alpha) / a0;
    }
    const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    x[i] = y;
  }
}

function attackGain(tms: number, attack: number): number {
  return tms >= attack ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * tms) / attack);
}

/**
 * A small room's impulse response: sparse taps of random sign (velvet noise) over an exponential decay,
 * getting darker as they go. Dense enough to sound smooth, sparse enough to convolve cheaply.
 */
const tapCache = new Map<number, { at: number; g: number }[]>();
function roomTaps(rate: number): { at: number; g: number }[] {
  const hit = tapCache.get(rate);
  if (hit) return hit;
  const noise = rng(424242);
  const taps: { at: number; g: number }[] = [];
  const len = 70, density = 1.1; // ms, taps per ms: past 70 ms the tail is 30 dB down
  for (let t = 3; t < len; t += 1 / density) {
    const at = Math.round(((t + (noise() * 0.5 + 0.5) / density) / 1000) * rate);
    const g = (noise() < 0 ? -1 : 1) * Math.exp(-t / 22) * 0.16;
    taps.push({ at, g: g * 1.4 }); // half the taps of a denser room, so each carries a bit more
  }
  tapCache.set(rate, taps);
  return taps;
}

export function cueMs(cue: SoundCue): number {
  return recipe(cue, 0).ms;
}

export function synth(cue: SoundCue, v: number, rate: number): Float32Array {
  const variant = ((v % VARIANTS[cue]) + VARIANTS[cue]) % VARIANTS[cue];
  const r = recipe(cue, variant);
  const n = Math.round((r.ms / 1000) * rate);
  const out = new Float32Array(n);
  const noise = rng(1 + variant * 7919 + cue.length * 104729 + cue.charCodeAt(0) * 31);

  for (const part of r.parts) {
    const start = Math.round(((part.at ?? 0) / 1000) * rate);
    if (part.kind === 'strike') {
      const attack = part.attack ?? 0.25;
      const drop = part.drop ?? 1, glide = part.glide ?? 1;
      const attackN = Math.ceil((attack / 1000) * rate);
      for (const [ratio, a, decay] of part.partials) {
        let phase = noise() * Math.PI; // a random starting phase per partial, as a real strike has
        // Exponentials stepped by multiplying, one per sample, instead of calling exp() for each.
        const kEnv = Math.exp(-1000 / (decay * rate)), kGlide = Math.exp(-1000 / (glide * rate));
        const w0 = (2 * Math.PI * part.f0 * ratio) / rate;
        if (part.f0 * ratio * Math.max(1, drop) >= rate * 0.45) continue;
        let env = part.amp * a, gl = 1;
        for (let i = start; i < n; i++) {
          if (env < 1e-4 * part.amp * a) break;
          phase += w0 * (drop + (1 - drop) * gl);
          const k = i - start;
          out[i] += Math.sin(phase) * env * (k < attackN ? attackGain((k / rate) * 1000, attack) : 1);
          env *= kEnv;
          gl *= kGlide;
        }
      }
    } else if (part.kind === 'click') {
      const len = Math.min(n - start, Math.round(((part.decay * 9) / 1000) * rate));
      const buf = new Float32Array(Math.max(0, len));
      for (let i = 0; i < buf.length; i++) {
        const tms = (i / rate) * 1000;
        buf[i] = noise() * Math.exp(-tms / part.decay) * attackGain(tms, 0.08);
      }
      bandpass(buf, rate, () => part.freq, part.q);
      // The bandpass loses level at high Q; this keeps amp meaning roughly the same across clicks.
      const g = part.amp * (1 + part.q) * 1.6;
      for (let i = 0; i < buf.length; i++) out[start + i] += g * buf[i];
    } else {
      const len = Math.min(n - start, Math.round((part.ms / 1000) * rate));
      const buf = new Float32Array(Math.max(0, len));
      for (let i = 0; i < buf.length; i++) {
        const u = i / buf.length;
        buf[i] = noise() * Math.sin((Math.PI / 2) * Math.min(1, u * 5)) ** 2 * (1 - u) ** 1.8;
      }
      bandpass(buf, rate, (i) => part.f0 * (part.f1 / part.f0) ** (i / buf.length), part.q);
      const g = part.amp * (1 + part.q);
      for (let i = 0; i < buf.length; i++) out[start + i] += g * buf[i];
    }
  }

  if (r.room > 0) {
    const wet = new Float32Array(n);
    for (const { at, g } of roomTaps(rate)) for (let i = at; i < n; i++) wet[i] += out[i - at] * g;
    const a = 1 - Math.exp((-2 * Math.PI * 3500) / rate);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += a * (wet[i] - lp);
      out[i] += r.room * 3 * lp;
    }
  }

  const a = 1 - Math.exp((-2 * Math.PI * r.tone) / rate);
  const hp = Math.exp((-2 * Math.PI * (r.low ?? 20)) / rate);
  let lp = 0, hpIn = 0, hpOut = 0;
  for (let i = 0; i < n; i++) {
    lp += a * (out[i] - lp);
    hpOut = hp * (hpOut + lp - hpIn);
    hpIn = lp;
    out[i] = hpOut;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = peak > 0 ? LEVEL[cue] / peak : 0;
  const fade = Math.min(n, Math.round(Math.max(0.004 * rate, Math.min(0.06 * rate, n * 0.12))));
  for (let i = 0; i < n; i++) {
    const tail = i >= n - fade ? ((n - 1 - i) / fade) ** 2 : 1;
    out[i] = Math.tanh(out[i] * gain * 1.1) * tail;
  }
  return out;
}
