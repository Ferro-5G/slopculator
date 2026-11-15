// The UI sound recipes are well-formed.
import { describe, it, expect } from 'vitest';
import { synth, VARIANTS, type SoundCue } from '../src/ui/sounds';

const CUES = Object.keys(VARIANTS) as SoundCue[];

describe('sound recipes', () => {
  it('start and end silent, stay in range, and never produce NaN', () => {
    for (const cue of CUES) for (let v = 0; v < VARIANTS[cue]; v++) {
      const x = synth(cue, v, 48000);
      expect(x.length, cue).toBeGreaterThan(48000 * 0.02);
      expect(Math.abs(x[0]), cue).toBeLessThan(1e-3);
      expect(Math.abs(x[x.length - 1]), cue).toBe(0);
      expect(x.every(Number.isFinite), cue).toBe(true);
      const peak = x.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
      expect(peak, cue).toBeGreaterThan(0.2);
      expect(peak, cue).toBeLessThanOrEqual(0.75);
    }
  });

  it('give frequent cues variants that actually differ', () => {
    const a = synth('tick', 0, 44100), b = synth('tick', 1, 44100);
    let diff = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBeGreaterThan(1);
  });
});
