import { describe, it, expect } from 'vitest';
import { niceCeil, wholeAwareRange } from '../src/ui/slider';

const lands = (value: number, r: { min: number; step: number }) => {
  const k = (value - r.min) / r.step;
  return Math.abs(k - Math.round(k)) < 1e-6;
};

describe('niceCeil', () => {
  it('rounds up the 1, 2, 5 ladder', () => {
    expect(niceCeil(49.98)).toBe(50);
    expect(niceCeil(50)).toBe(50);
    expect(niceCeil(22)).toBe(50);
    expect(niceCeil(120)).toBe(200);
    expect(niceCeil(1.0001)).toBe(2);
    expect(niceCeil(6)).toBe(10);
    expect(niceCeil(0.03)).toBe(0.05);
    expect(niceCeil(0.3)).toBe(0.5);
  });
});

describe('wholeAwareRange', () => {
  it('runs a whole number from 0 to a clean number at least twice it, in steps of 1', () => {
    expect(wholeAwareRange(10)).toEqual({ min: 0, max: 20, step: 1 });
    expect(wholeAwareRange(3)).toEqual({ min: 0, max: 10, step: 1 });
    expect(wholeAwareRange(30)).toEqual({ min: 0, max: 100, step: 1 });
    expect(wholeAwareRange(250)).toEqual({ min: 0, max: 500, step: 1 });
    expect(wholeAwareRange(-10)).toEqual({ min: -20, max: 0, step: 1 });
  });
  it('centres zero', () => {
    expect(wholeAwareRange(0)).toEqual({ min: -10, max: 10, step: 1 });
  });
  it('runs any other value either side of zero, ending on a clean number', () => {
    expect(wholeAwareRange(24.99)).toEqual({ min: -50, max: 50, step: 0.01 });
    expect(wholeAwareRange(-24.99)).toEqual({ min: -50, max: 50, step: 0.01 });
    expect(wholeAwareRange(3.5)).toEqual({ min: -10, max: 10, step: 0.01 });
  });
  it('uses a finer step when the usual one can\'t land on the value', () => {
    expect(wholeAwareRange(0.25).step).toBe(0.001);
    expect(wholeAwareRange(1.125).step).toBe(0.001);
    expect(wholeAwareRange(1234.5).step).toBe(0.1);
    for (const v of [24.99, 0.25, 1.125, 12.345, -7.5, 1e6 + 3, 99.99]) {
      const r = wholeAwareRange(v);
      expect(lands(v, r), `${v} on ${JSON.stringify(r)}`).toBe(true);
      expect(v >= r.min && v <= r.max).toBe(true);
    }
  });
  it('gives up on refining a value with too many places', () => {
    expect(wholeAwareRange(Math.PI).step).toBe(0.01);
  });
  it('stays finite for huge values, in its ends, its width and a drag across it', () => {
    expect(wholeAwareRange(1e300)).toEqual({ min: 0, max: 2e300, step: 1e298 });
    for (const v of [1.7e308, -1.7e308, 3e307, 1e300, -1e300, 2 ** 60]) {
      const r = wholeAwareRange(v);
      expect(Number.isFinite(r.max - r.min), `${v}: ${JSON.stringify(r)}`).toBe(true);
      expect(Number.isFinite((r.max - r.min) / r.step), `${v}: ${JSON.stringify(r)}`).toBe(true);
      expect(v >= r.min && v <= r.max).toBe(true);
    }
  });
  it('falls back to −10 to 10 for a value that isn\'t finite', () => {
    expect(wholeAwareRange(Infinity)).toEqual({ min: -10, max: 10, step: 0.1 });
    expect(wholeAwareRange(NaN)).toEqual({ min: -10, max: 10, step: 0.1 });
  });
  it('keeps a range the user set', () => {
    const own = { min: 1, max: 4, step: 0.5 };
    expect(wholeAwareRange(24.99, own)).toBe(own);
  });
});
