import { describe, it, expect } from 'vitest';
import { roundTo } from '../src/engine/numeric';
import { exactForm, formatNumber, plainNumber, toFraction } from '../src/engine/format';

const TINY = 0.000000000000000123;
const exact = { places: null, exact: true, percent: false };

describe('very small and very large numbers', () => {
  it('rounds without producing NaN', () => {
    expect(roundTo(TINY, 2)).toBe(0);
    expect(roundTo(-TINY, 2) === 0).toBe(true);
    expect(roundTo(1.5e21, 2)).toBe(1.5e21);
    expect(roundTo(1e-7, 8)).toBe(1e-7);
    expect(plainNumber(TINY, 2)).toBe('0.00');
    expect(plainNumber(-TINY, 2)).toBe('0.00');
    expect(plainNumber(TINY, 15)).toBe('0.000000000000000');
    expect(plainNumber(1.23e-10, 12)).toBe('0.000000000123');
  });
  it('keeps rounding half away from zero for ordinary numbers', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(0.81859461412, 3)).toBe(0.819);
    expect(roundTo(123456.789, 1)).toBe(123456.8);
  });
  it('never calls a nonzero number 0/1', () => {
    expect(toFraction(TINY)).toBeNull();
    expect(exactForm(TINY)).toBeNull();
    expect(formatNumber(TINY, exact)).not.toBe('0');
    expect(formatNumber(TINY, exact)).toMatch(/1\.23/);
    expect(toFraction(0)).toEqual([0, 1]);
  });
  it('still finds ordinary fractions', () => {
    expect(toFraction(1 / 3)).toEqual([1, 3]);
    expect(toFraction(0.1 + 0.2)).toEqual([3, 10]);
    expect(toFraction(-14 / 3)).toEqual([-14, 3]);
    expect(exactForm(0.375)).toBe('3/8');
  });
});
