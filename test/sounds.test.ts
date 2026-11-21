// The UI sound files are what the code says they are: one per cue and variant, short, quiet at both ends.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { cueFiles, cueMs, VARIANTS, type SoundCue } from '../src/ui/sounds';

const CUES = Object.keys(VARIANTS) as SoundCue[];
const DIR = new URL('../src/assets/sounds/', import.meta.url);

function read(name: string): { rate: number; samples: number[] } {
  const buf = readFileSync(new URL(name, DIR));
  expect(buf.toString('latin1', 0, 4) + buf.toString('latin1', 8, 12) + buf.toString('latin1', 36, 40), name).toBe('RIFFWAVEdata');
  // PCM, one channel, 16 bits: the web player reads exactly this layout.
  expect([buf.readUInt16LE(20), buf.readUInt16LE(22), buf.readUInt16LE(34)], name).toEqual([1, 1, 16]);
  const samples = Array.from({ length: (buf.length - 44) / 2 }, (_, i) => buf.readInt16LE(44 + i * 2) / 32768);
  return { rate: buf.readUInt32LE(24), samples };
}

describe('sound files', () => {
  it('are one per cue and variant, and nothing else', () => {
    expect(readdirSync(DIR).filter((f) => f.endsWith('.wav')).sort()).toEqual(CUES.flatMap(cueFiles).sort());
  });

  it('start and end quiet, stay in range, and play for as long as cueMs says', () => {
    for (const cue of CUES) {
      let longest = 0;
      for (const name of cueFiles(cue)) {
        const { rate, samples } = read(name);
        expect(rate, name).toBe(44100);
        expect(Math.abs(samples[0]), name).toBeLessThan(0.01);
        expect(Math.abs(samples[samples.length - 1]), name).toBeLessThan(0.01);
        const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
        expect(peak, name).toBeGreaterThan(0.15);
        expect(peak, name).toBeLessThanOrEqual(0.75);
        longest = Math.max(longest, (samples.length / rate) * 1000);
      }
      expect(cueMs(cue), cue).toBeGreaterThanOrEqual(longest);
      expect(cueMs(cue) - longest, cue).toBeLessThan(10);
    }
  });

  it('keep the takes of a key at one loudness, so a run of them is even', () => {
    const loudest = (name: string): number => {
      const { samples } = read(name);
      const win = Math.min(samples.length, 882);
      let sum = 0, best = 0;
      samples.forEach((s, i) => {
        sum += s * s;
        if (i >= win) sum -= samples[i - win] ** 2;
        best = Math.max(best, sum / win);
      });
      return Math.sqrt(best);
    };
    for (const cue of CUES) {
      const levels = cueFiles(cue).map(loudest);
      for (const l of levels) expect(l / levels[0], cue).toBeCloseTo(1, 1);
    }
  });

  it('stay small, since the web app carries them in its one file', () => {
    const total = CUES.flatMap(cueFiles).reduce((n, f) => n + readFileSync(new URL(f, DIR)).length, 0);
    expect(total).toBeLessThan(150_000);
  });
});
