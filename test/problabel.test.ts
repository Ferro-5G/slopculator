import { describe, it, expect } from 'vitest';
import { probLabelPlacement } from '../src/ui/problabel';
import { normPdf } from '../src/engine/numeric';

// A 960×600 view of x in [-4, 4], y in [0, 0.45], like the desktop graph.
const X = (x: number) => ((x + 4) / 8) * 960;
const Y = (y: number) => 600 - (y / 0.45) * 600;
const pdf = (x: number) => normPdf(x);

describe('probability label placement', () => {
  it('goes inside a shaded region that has room', () => {
    const at = probLabelPlacement({ a: -1, b: 1, mu: 0, pdf, X, Y });
    expect(at).toMatchObject({ anchor: 'middle', big: true });
    expect(at.x).toBeCloseTo(X(0));
    expect(at.y).toBeLessThan(Y(0));
    expect(at.y).toBeGreaterThan(Y(pdf(0)));
  });

  it('sits above the curve on a thin left tail, not on the axis', () => {
    // P(Z < -2.5): long and flat, so wide in pixels but only a few pixels tall.
    const at = probLabelPlacement({ a: -4, b: -2.5, mu: 0, pdf, X, Y });
    expect(at.big).toBe(false);
    expect(at.anchor).toBe('end');
    expect(at.x).toBeLessThan(X(-2.5));
    // Above the curve at the tail's tallest edge.
    expect(at.y).toBeLessThan(Y(pdf(-2.5)) - 10);
  });

  it('runs a right tail label out to the right', () => {
    const at = probLabelPlacement({ a: 2.5, b: 4, mu: 0, pdf, X, Y });
    expect(at.anchor).toBe('start');
    expect(at.x).toBeGreaterThan(X(2.5));
  });

  it('centers over a thin sliver around the mean', () => {
    const at = probLabelPlacement({ a: -0.05, b: 0.05, mu: 0, pdf, X, Y });
    expect(at).toMatchObject({ anchor: 'middle', big: false });
    expect(at.x).toBeCloseTo(X(0));
  });
});
