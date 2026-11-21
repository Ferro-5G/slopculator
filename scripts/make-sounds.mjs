// Builds the app's UI sounds from two of Kenney's sound packs, which are in the public domain (CC0):
//   Interface Sounds  https://kenney.nl/assets/interface-sounds
//   UI Audio          https://kenney.nl/assets/ui-audio
// Unzip both into one folder and run, with ffmpeg on the PATH:
//   node scripts/make-sounds.mjs <folder holding interface-sounds/ and ui-audio/> [another folder to write to, …]
// It writes src/assets/sounds/, which the web app bundles, and the same files into any other folder named after the
// packs. The packs themselves aren't kept in the repository.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 44100;

/**
 * Each cue's clips, by pack and file, and how loud the cue plays: the peak of its loudest moment, 1 being full scale.
 * Keys are quiet because they are constant; a chime that plays once can carry more. maxMs ends a key's clip there:
 * a recorded switch rings on in its room for a fifth of a second, which a fast run of keys would pile up.
 */
const CUES = {
  tick: { level: 0.42, maxMs: 60, clips: ['ui-audio/click5', 'ui-audio/click4', 'ui-audio/switch14'] },
  fn: { level: 0.46, maxMs: 90, clips: ['ui-audio/switch19', 'ui-audio/rollover5', 'ui-audio/switch15'] },
  enter: { level: 0.6, clips: ['interface-sounds/back_002'] },
  copy: { level: 0.36, clips: ['interface-sounds/glass_002'] },
  // Error and clear are wood in the middle of the range, not low thuds: a phone's speaker plays little under 300 Hz.
  error: { level: 0.45, maxMs: 140, clips: ['interface-sounds/drop_003'] },
  clear: { level: 0.45, clips: ['interface-sounds/back_003'] },
  toggle: { level: 0.42, maxMs: 90, clips: ['interface-sounds/toggle_004'] },
  detent: { level: 0.3, clips: ['interface-sounds/click_002', 'interface-sounds/click_003'] },
  done: { level: 0.36, clips: ['interface-sounds/glass_005'] },
};

function decode(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return Float32Array.from(new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4));
}

/**
 * A clip cut to its sound: the silence before it goes (a key must sound the moment it is pressed), the tail ends once
 * it is 50 dB down, and both ends fade so neither clicks.
 */
function trim(x, maxMs = Infinity) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const lead = Math.round(0.0005 * RATE);
  const start = Math.max(0, x.findIndex((v) => Math.abs(v) > peak * 0.02) - lead);
  let end = x.length - 1;
  while (end > start && Math.abs(x[end]) < peak * 10 ** (-50 / 20)) end--;
  end = Math.min(end, start + Math.round((maxMs / 1000) * RATE));
  const y = x.slice(start, end + 1);
  const fadeIn = Math.min(y.length, Math.round(0.0004 * RATE));
  for (let i = 0; i < fadeIn; i++) y[i] *= i / fadeIn;
  // A clip cut short at maxMs fades over a fifth of its length, so the cut can't be heard.
  const fadeOut = Math.min(y.length, Math.round(Math.max(0.008 * RATE, Number.isFinite(maxMs) ? y.length * 0.2 : 0)));
  for (let i = 0; i < fadeOut; i++) y[y.length - 1 - i] *= (i / fadeOut) ** 2;
  return y;
}

/** How loud a clip is to the ear, near enough: the root mean square of its loudest 20 ms. */
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

const packs = process.argv[2];
if (!packs || !existsSync(join(packs, 'interface-sounds')) || !existsSync(join(packs, 'ui-audio'))) {
  console.error('Usage: node scripts/make-sounds.mjs <folder holding interface-sounds/ and ui-audio/> [another folder to write to, …]');
  process.exit(2);
}
const outs = ['src/assets/sounds', ...process.argv.slice(3)];
for (const dir of outs) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.wav')) unlinkSync(join(dir, f));
}
const report = [];
for (const [cue, { level, maxMs, clips }] of Object.entries(CUES)) {
  const takes = clips.map((clip) => trim(decode(join(packs, clip.replace('/', '/Audio/') + '.ogg')), maxMs));
  // Takes of one cue play at one loudness, so a run of keys is even; the loudest take's peak sets the cue's level.
  const loud = takes.map(loudness);
  const even = takes.map((x, i) => x.map((v) => (v * loud[0]) / loud[i]));
  const peak = Math.max(...even.map((x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  even.forEach((x, v) => {
    const name = v === 0 ? `${cue}.wav` : `${cue}-${v}.wav`;
    const out = wav(x.map((s) => (s * level) / peak));
    for (const dir of outs) writeFileSync(join(dir, name), out);
    report.push(`${name.padEnd(14)} ${String(Math.round((x.length / RATE) * 1000)).padStart(4)} ms  ${String(out.length).padStart(6)} bytes  from ${clips[v]}`);
  });
}
console.log(report.join('\n'));
