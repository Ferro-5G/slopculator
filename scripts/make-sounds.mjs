// Synthesizes crisp, damped, tactile UI micro-sounds (iOS/macOS Taptic & lubricated keycap aesthetic) directly into
// 16-bit 44.1 kHz mono WAV files with zero external dependencies.
// Usage:
//   node scripts/make-sounds.mjs [extra output directories...]
// Always writes src/assets/sounds/ and any additional folders passed.
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 44100;
const TAU = 2 * Math.PI;

/** Deterministic PRNG (Mulberry32) so generated WAVs are byte-reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
  };
}

/** 2-pole biquad bandpass filter for shaping short tactile transients cleanly. */
function bandpass(input, freq, q) {
  const w0 = (TAU * freq) / RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha, b1 = 0, b2 = -alpha;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

/** 2-pole biquad lowpass filter for warm, non-harsh damping. */
function lowpass(input, freq, q = 0.707) {
  const w0 = (TAU * freq) / RATE;
  const c = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2;
  const a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

/** Smooth raised-cosine fade on both ends so every WAV starts and ends dead quiet. */
function envelopeEnds(x, fadeInMs = 0.4, fadeOutMs = 3) {
  const nIn = Math.min(x.length, Math.round((fadeInMs / 1000) * RATE));
  const nOut = Math.min(x.length, Math.round((fadeOutMs / 1000) * RATE));
  for (let i = 0; i < nIn; i++) x[i] *= 0.5 * (1 - Math.cos((Math.PI * i) / nIn));
  for (let i = 0; i < nOut; i++) x[x.length - 1 - i] *= 0.5 * (1 - Math.cos((Math.PI * i) / nOut));
  x[0] = 0;
  x[x.length - 1] = 0;
  return x;
}

/** Tactile keycap tap: short bandpassed fingertip click + warm damped PBT body thock. */
function makeKeyTap(ms, { seed, clickHz, bodyStartHz, bodyEndHz, bodyDecayMs, woodHz, clickMix }) {
  const n = Math.round((ms / 1000) * RATE);
  const rand = rng(seed);
  const noise = new Float32Array(n);
  const clickLen = Math.round(0.0028 * RATE);
  for (let i = 0; i < clickLen && i < n; i++) {
    const w = Math.sin((Math.PI * i) / clickLen);
    noise[i] = rand() * w * w;
  }
  const click = bandpass(noise, clickHz, 1.9);
  const out = new Float32Array(n);
  let phaseBody = 0, phaseWood = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const fBody = bodyEndHz + (bodyStartHz - bodyEndHz) * Math.exp(-t / 0.0045);
    phaseBody += (TAU * fBody) / RATE;
    phaseWood += (TAU * woodHz) / RATE;
    const envBody = Math.exp(-t / (bodyDecayMs / 1000));
    const envWood = Math.exp(-t / 0.0032);
    out[i] = Math.sin(phaseBody) * envBody * 0.72 + Math.sin(phaseWood) * envWood * 0.22 + click[i] * clickMix;
  }
  return envelopeEnds(lowpass(out, 4800, 0.75), 0.35, 3.5);
}

/** Precision Swiss-watch / macOS slider detent tick. */
function makeDetent(ms, { seed, hz }) {
  const n = Math.round((ms / 1000) * RATE);
  const rand = rng(seed);
  const noise = new Float32Array(n);
  const len = Math.round(0.0018 * RATE);
  for (let i = 0; i < len && i < n; i++) noise[i] = rand() * Math.sin((Math.PI * i) / len);
  const crisp = bandpass(noise, hz, 2.6);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    out[i] = crisp[i] * 1.4 + Math.sin(TAU * (hz * 0.45) * t) * Math.exp(-t / 0.0022) * 0.35;
  }
  return envelopeEnds(lowpass(out, 5600, 0.75), 0.25, 2.5);
}

/** Two-phase precision micro-switch toggle click. */
function makeToggle(ms) {
  const n = Math.round((ms / 1000) * RATE);
  const out = new Float32Array(n);
  const a = makeKeyTap(12, { seed: 401, clickHz: 2100, bodyStartHz: 340, bodyEndHz: 210, bodyDecayMs: 4.5, woodHz: 1480, clickMix: 1.0 });
  const b = makeKeyTap(18, { seed: 402, clickHz: 1750, bodyStartHz: 290, bodyEndHz: 165, bodyDecayMs: 7.5, woodHz: 1120, clickMix: 0.9 });
  const offset = Math.round(0.0075 * RATE);
  for (let i = 0; i < a.length && i < n; i++) out[i] += a[i] * 0.48;
  for (let i = 0; i < b.length && offset + i < n; i++) out[offset + i] += b[i] * 0.95;
  return envelopeEnds(out, 0.3, 4);
}

/** Grounded Enter thock + whisper-soft warm harmonic settle (zero cartoon boop). */
function makeEnter(ms) {
  const n = Math.round((ms / 1000) * RATE);
  const tap = makeKeyTap(26, { seed: 501, clickHz: 1450, bodyStartHz: 230, bodyEndHz: 118, bodyDecayMs: 11, woodHz: 880, clickMix: 1.0 });
  const out = new Float32Array(n);
  for (let i = 0; i < tap.length && i < n; i++) out[i] += tap[i] * 0.95;
  const start = Math.round(0.007 * RATE);
  for (let i = start; i < n; i++) {
    const t = (i - start) / RATE;
    const att = 1 - Math.exp(-t / 0.002);
    const dec = Math.exp(-t / 0.011);
    out[i] += (Math.sin(TAU * 587.33 * t) * 0.16 + Math.sin(TAU * 1174.66 * t) * 0.04) * att * dec;
  }
  return envelopeEnds(lowpass(out, 4500, 0.75), 0.35, 6);
}

/** Delicate airy two-note glass marimba chime (copy / done). */
function makeChime(ms, f1, f2, gapMs) {
  const n = Math.round((ms / 1000) * RATE);
  const out = new Float32Array(n);
  const addNote = (freq, startMs, decayMs, amp) => {
    const start = Math.round((startMs / 1000) * RATE);
    for (let i = start; i < n; i++) {
      const t = (i - start) / RATE;
      const att = 1 - Math.exp(-t / 0.0022);
      const dec1 = Math.exp(-t / (decayMs / 1000));
      const dec2 = Math.exp(-t / ((decayMs * 0.45) / 1000));
      out[i] += amp * att * (Math.sin(TAU * freq * t) * dec1 + Math.sin(TAU * freq * 2 * t) * 0.13 * dec2);
    }
  };
  addNote(f1, 0, ms * 0.34, 0.72);
  addNote(f2, gapMs, ms * 0.42, 0.85);
  return envelopeEnds(lowpass(out, 5200, 0.75), 0.8, 12);
}

/** Soft downward slate-wipe brush + muted wooden settle for AC / Clear. */
function makeClear(ms) {
  const n = Math.round((ms / 1000) * RATE);
  const rand = rng(601);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.sin(Math.min(1, t / 0.008) * (Math.PI / 2)) * Math.exp(-t / 0.015);
    raw[i] = rand() * env;
  }
  const brush = lowpass(bandpass(raw, 720, 1.1), 1600, 0.8);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 135 + 115 * Math.exp(-t / 0.012);
    phase += (TAU * f) / RATE;
    out[i] = brush[i] * 1.15 + Math.sin(phase) * Math.exp(-t / 0.014) * 0.55;
  }
  return envelopeEnds(lowpass(out, 2800, 0.75), 0.6, 10);
}

/** Polite, muted macOS-style low wooden double-knock for errors (never a buzzer). */
function makeError(ms) {
  const n = Math.round((ms / 1000) * RATE);
  const out = new Float32Array(n);
  const addKnock = (startMs, fStart, fEnd, decayMs, amp) => {
    const start = Math.round((startMs / 1000) * RATE);
    let phase = 0;
    for (let i = start; i < n; i++) {
      const t = (i - start) / RATE;
      const f = fEnd + (fStart - fEnd) * Math.exp(-t / 0.008);
      phase += (TAU * f) / RATE;
      const att = 1 - Math.exp(-t / 0.0018);
      const dec = Math.exp(-t / (decayMs / 1000));
      out[i] += amp * att * dec * (Math.sin(phase) + Math.sin(phase * 2) * 0.18);
    }
  };
  addKnock(0, 225, 168, 13, 0.78);
  addKnock(34, 178, 132, 18, 0.92);
  return envelopeEnds(lowpass(out, 1800, 0.75), 0.5, 10);
}

/** Root-mean-square loudness of the loudest 20 ms window (mirrors test/sounds.test.ts). */
function loudness(x) {
  const win = Math.min(x.length, Math.round(0.02 * RATE));
  let sum = 0, best = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i] * x[i];
    if (i >= win) sum -= x[i - win] * x[i - win];
    best = Math.max(best, sum / win);
  }
  return Math.sqrt(best);
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const CUES = {
  tick: {
    level: 0.28,
    takes: [
      makeKeyTap(18, { seed: 101, clickHz: 1850, bodyStartHz: 275, bodyEndHz: 148, bodyDecayMs: 7.5, woodHz: 1180, clickMix: 1.05 }),
      makeKeyTap(18, { seed: 102, clickHz: 1960, bodyStartHz: 288, bodyEndHz: 154, bodyDecayMs: 7.2, woodHz: 1240, clickMix: 1.05 }),
      makeKeyTap(18, { seed: 103, clickHz: 1740, bodyStartHz: 264, bodyEndHz: 142, bodyDecayMs: 7.8, woodHz: 1120, clickMix: 1.05 }),
    ],
  },
  fn: {
    level: 0.30,
    takes: [
      makeKeyTap(22, { seed: 201, clickHz: 1380, bodyStartHz: 218, bodyEndHz: 116, bodyDecayMs: 9.5, woodHz: 860, clickMix: 0.95 }),
      makeKeyTap(22, { seed: 202, clickHz: 1460, bodyStartHz: 226, bodyEndHz: 120, bodyDecayMs: 9.2, woodHz: 900, clickMix: 0.95 }),
      makeKeyTap(22, { seed: 203, clickHz: 1300, bodyStartHz: 208, bodyEndHz: 112, bodyDecayMs: 9.8, woodHz: 820, clickMix: 0.95 }),
    ],
  },
  enter: { level: 0.38, takes: [makeEnter(38)] },
  copy: { level: 0.28, takes: [makeChime(86, 880, 1318.51, 26)] },
  error: { level: 0.32, takes: [makeError(82)] },
  clear: { level: 0.30, takes: [makeClear(52)] },
  toggle: { level: 0.28, takes: [makeToggle(26)] },
  detent: {
    level: 0.22,
    takes: [
      makeDetent(11, { seed: 301, hz: 2450 }),
      makeDetent(11, { seed: 302, hz: 2620 }),
    ],
  },
  done: { level: 0.28, takes: [makeChime(96, 783.99, 1174.66, 30)] },
};

const outs = ['src/assets/sounds', ...process.argv.slice(2)];
for (const dir of outs) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.wav')) unlinkSync(join(dir, f));
}

const report = [];
for (const [cue, { level, takes }] of Object.entries(CUES)) {
  const loud = takes.map(loudness);
  const even = takes.map((x, i) => x.map((v) => (v * loud[0]) / loud[i]));
  const peak = Math.max(...even.map((x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  even.forEach((x, v) => {
    const name = v === 0 ? `${cue}.wav` : `${cue}-${v}.wav`;
    const out = wav(x.map((s) => (s * level) / peak));
    for (const dir of outs) writeFileSync(join(dir, name), out);
    report.push(`${name.padEnd(14)} ${String(Math.round((x.length / RATE) * 1000)).padStart(4)} ms  ${String(out.length).padStart(6)} bytes`);
  });
}
console.log(report.join('\n'));
