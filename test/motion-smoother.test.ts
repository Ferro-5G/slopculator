import { describe, it, expect } from 'vitest';
import { DEFAULT_SMOOTHER, startSmoother, stepSmoother, type SmootherState } from '../src/ui/motionsmoother';

const FRAME_MS = 1000 / 120;

const run = (start: [number, number], raw: (frame: number) => [number, number], frames: number) => {
  let s: SmootherState = startSmoother(start[0], start[1]);
  const out: [number, number][] = [];
  for (let i = 1; i <= frames; i++) {
    const [x, y] = raw(i);
    s = stepSmoother(s, x, y, FRAME_MS, DEFAULT_SMOOTHER);
    out.push([s.x, s.y]);
  }
  return out;
};

// RMS of how much the frame-to-frame displacement changes, the same measure as scripts/score-drag.mjs.
const jerk = (path: number[]) => {
  let sq = 0;
  for (let i = 2; i < path.length; i++) sq += ((path[i] - path[i - 1]) - (path[i - 1] - path[i - 2])) ** 2;
  return Math.sqrt(sq / (path.length - 2));
};

describe('motion smoother', () => {
  it('keeps a still input still', () => {
    const out = run([10, 20], () => [10, 20], 240);
    for (const [x, y] of out) {
      expect(x).toBe(10);
      expect(y).toBe(20);
    }
  });

  it('settles on the input once the finger stops', () => {
    const drag = (i: number): [number, number] => [40 * Math.min(i, 120) * FRAME_MS / 1000, 0];
    const out = run([0, 0], drag, 120 + 60);
    const stop = drag(120)[0];
    expect(Math.abs(out[179][0] - stop)).toBeLessThan(1e-6);
    expect(Math.abs(out[179][1])).toBeLessThan(1e-6);
  });

  it('keeps a fast constant-speed drag close to the finger', () => {
    const at = (v: number) => (i: number): [number, number] => [v * i * FRAME_MS / 1000, 0];
    const lag = (v: number, frames: number) => run([0, 0], at(v), frames).map(([x], i) => at(v)(i + 1)[0] - x);
    // A drag that starts at full speed lags most in its first frames. Once it settles, the lag is v / (2π · cutoff).
    const fast = lag(300, 240);
    expect(Math.max(...fast)).toBeLessThan(3);
    expect(fast[239]).toBeLessThan(1.1);
    expect(Math.max(...lag(1000, 240))).toBeLessThan(8);
  });

  it('turns a 0.33-point staircase at 120 Hz into a path with a third of its jerk', () => {
    const raw: number[] = [];
    const gaps = [3, 4, 5];
    for (let g = 0; raw.length < 360; g++) {
      const n = gaps[g % gaps.length];
      for (let k = 0; k < n && raw.length < 360; k++) raw.push(0.33 * g);
    }
    const filtered = [raw[0], ...run([raw[0], 0], (i) => [raw[i], 0], raw.length - 1).map(([x]) => x)];
    expect(jerk(filtered)).toBeLessThan(jerk(raw) / 3);
  });

  it('moves a diagonal drag straight, with one speed for both axes', () => {
    const out = run([0, 0], (i) => [i * 0.7, i * 0.7], 200);
    for (const [x, y] of out) expect(y).toBe(x);
  });

  it('clamps dt to 0.5 to 50 ms, so a stalled frame cannot jump', () => {
    const s = startSmoother(0, 0);
    const at = (dt: number) => stepSmoother(s, 100, 50, dt, DEFAULT_SMOOTHER);
    expect(at(1000)).toEqual(at(50));
    expect(at(0)).toEqual(at(0.5));
    expect(at(-5)).toEqual(at(0.5));
    expect(at(8.33)).not.toEqual(at(50));
  });

  it('returns a new state and leaves the old one alone', () => {
    const s = startSmoother(5, 5);
    const next = stepSmoother(s, 50, 50, FRAME_MS, DEFAULT_SMOOTHER);
    expect(next).not.toBe(s);
    expect(s).toEqual({ x: 5, y: 5, dx: 0, dy: 0 });
  });
});
