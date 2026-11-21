import { describe, expect, it } from 'vitest';
import { evaluateDocument } from '../src/engine/document';
import type { Settings } from '../src/engine/evaluator';
import { formatValue } from '../src/engine/format';
import type { RecordV } from '../src/engine/values';

const DEG: Settings = { deg: true, complex: false, sample: false };
const RAD: Settings = { ...DEG, deg: false };
const O = { places: null, exact: false, percent: false };
const sheet = (lines: string[], s: Settings = RAD) => evaluateDocument(lines.map((text, k) => ({ id: `r${k}`, kind: 'expr' as const, text })), s);
const lastOf = (lines: string[], s: Settings = RAD) => sheet(lines, s).at(-1)!;

describe('tangent(f, p)', () => {
  it('is the line touching f at p, with slope f′(p)', () => {
    const r = lastOf(['f(x) = x^3 - 3x', 'tangent(f, 1.3)']);
    expect(r.error).toBeUndefined();
    const v = r.value as RecordV;
    expect(v.t).toBe('record');
    // f′(1.3) = 3(1.69) − 3 = 2.07, f(1.3) = −1.703, and the line meets the y-axis at −1.703 − 2.07 × 1.3 = −4.394.
    expect(v.rows[0].value).toBeCloseTo(2.07, 10);
    expect(v.rows[2].value).toBeCloseTo(-4.394, 10);
    expect(v.title).toBe('y = 2.07x − 4.394');
  });
  it('reads a slider for the point, and a built-in by name', () => {
    expect((lastOf(['p = 0', 'tangent(sin, p)']).value as RecordV).title).toBe('y = x');
    expect((lastOf(['tangent(cos, 0)']).value as RecordV).title).toBe('y = 1');
  });
  it('says what it needs', () => {
    expect(lastOf(['tangent(x^2, 1)']).error).toMatch(/function's name/);
    expect(lastOf(['tangent(g, 1)']).error).toMatch(/isn't a function|isn't defined/);
    expect(lastOf(['f(x) = abs(x)', 'tangent(f, 0)']).error).toMatch(/settle|corner/);
  });
});

describe('riemann(f, a, b, n)', () => {
  it('sums strips at their middles unless told otherwise', () => {
    // The mockup's g(x) = x³ − 3x on [0, 2] in 8 strips.
    expect(lastOf(['g(x) = x^3 - 3x', 'riemann(g, 0, 2, 8)']).value).toBeCloseTo(-2.03125, 12);
    expect(lastOf(['g(x) = x^2', 'riemann(g, 0, 1, 4, "left")']).value).toBeCloseTo(0.21875, 12);
    expect(lastOf(['g(x) = x^2', 'riemann(g, 0, 1, 4, "right")']).value).toBeCloseTo(0.46875, 12);
    expect(lastOf(['g(x) = x^2', 'riemann(g, 0, 1, 4, "middle")']).value).toBeCloseTo(0.328125, 12);
  });
  it('approaches the integral', () => {
    expect(lastOf(['riemann(sin, 0, pi, 1000)']).value).toBeCloseTo(2, 5);
  });
  it('checks its inputs', () => {
    expect(lastOf(['g(x) = x', 'riemann(g, 0, 1, 2.5)']).error).toMatch(/whole/);
    expect(lastOf(['g(x) = x', 'riemann(g, 0, 1, 0)']).error).toMatch(/at least 1/);
    expect(lastOf(['g(x) = x', 'riemann(g, 0, 1, 4, "up")']).error).toMatch(/left/);
  });
});

describe('unit circle(θ)', () => {
  it('reads with a space, as unitcircle does', () => {
    const a = lastOf(['unit circle(60)'], DEG), b = lastOf(['unitcircle(60)'], DEG);
    expect(a.error).toBeUndefined();
    expect(formatValue(a.value!, O)).toBe(formatValue(b.value!, O));
  });
  it('keeps unit and circle apart elsewhere', () => {
    expect(lastOf(['unit = 2', 'circle = 3', 'unit circle'], DEG).value).toBe(6);
  });
});
