import { describe, it, expect } from 'vitest';
import { niceStep, tickValues } from '../src/ui/ticks';
import { run } from './sheet';
import { plotSVG, viewError } from '../src/ui/svg';
import { degreeWaves, fitCurves, piStep, wantsDegreeWaves, wantsPiTicks } from '../src/ui/plotmodel';
import type { DocRow } from '../src/ui/document';

describe('tick positions', () => {
  it('lists the multiples of the step inside the range', () => {
    expect(tickValues(-10, 10, 5)).toEqual([-10, -5, 0, 5, 10]);
    expect(tickValues(0.5, 3.2, 1)).toEqual([1, 2, 3]);
    expect(niceStep(1.3)).toBe(1);
    expect(niceStep(27)).toBe(20);
  });
  it('ends when the step is smaller than the spacing of doubles near the view', () => {
    // Near 1e16 neighboring doubles are 2 apart, so x += 0.2 never moved and the grid loop spun forever.
    const ticks = tickValues(1e16 - 4, 1e16 + 4, 0.2);
    expect(ticks.length).toBeLessThanOrEqual(41);
    expect(tickValues(1e20, 1e20 + 2e5, 2000).length).toBeLessThanOrEqual(101);
  });
  it('gives nothing for an empty, inverted, or non-finite range', () => {
    expect(tickValues(1, 1, 0)).toEqual([]);
    expect(tickValues(5, -5, 1)).toEqual([]);
    expect(tickValues(-Infinity, 0, 1)).toEqual([]);
    expect(tickValues(0, 1, NaN)).toEqual([]);
    expect(tickValues(-1e300, 1e300, 1e-300)).toEqual([]);
  });
});

describe('SVG plots at the edges of double precision', () => {
  it('draws a narrow view far from 0 instead of hanging', () => {
    const svg = plotSVG(run(['y = x']).results, { xmin: 1e20, xmax: 1e20 + 2e5, ymin: -1, ymax: 1 });
    expect(svg.startsWith('<svg')).toBe(true);
  });
  it('fits points 65536 apart near 1e20 without hanging', () => {
    expect(plotSVG(run(['(1e20, 0)', '(100000000000000065536, 1)']).results).startsWith('<svg')).toBe(true);
  });
  it('falls back to the default view when points are too far apart to subtract', () => {
    const svg = plotSVG(run(['(-1e308, 0)', '(1e308, 0)']).results);
    expect(svg).toContain('x −10 to 10');
  });
  it('keeps the automatic width when only one bound is past the other end', () => {
    expect(viewError({ xmin: 20 })).toBeNull();
    expect(plotSVG(run(['y = x']).results, { xmin: 20 })).toContain('x 20 to');
  });
  it('rejects a view the caller made empty or infinite', () => {
    expect(viewError({ xmin: 5, xmax: 5 })).toMatch(/xmin must be less than xmax/);
    expect(viewError({ ymin: 3, ymax: -3 })).toMatch(/ymin must be less than ymax/);
    expect(viewError({ xmin: -1e308, xmax: 1e308 })).toMatch(/finite/);
    expect(viewError({ xmin: 0, xmax: 1, ymin: 0, ymax: 1 })).toBeNull();
  });
});

describe('ticks in multiples of π', () => {
  const line = (text: string, hidden = false) => ({ id: text, kind: 'expr', text, color: 0, hidden }) as DocRow;
  const wants = (text: string, deg = false, hidden = false) => wantsPiTicks([line(text, hidden)], run([text]).results, deg);

  it('are for a drawn trig line in radians', () => {
    expect(wants('y = sin(x)')).toBe(true);
    expect(wants('y = 2*arctan(x)')).toBe(true);
    expect(wants('y = x^2')).toBe(false);
    expect(wants('sin(1)')).toBe(false);
    expect(wants('y = sin(x)', true)).toBe(false);
    expect(wants('y = sin(x)', false, true)).toBe(false);
  });

  it('give way to whole waves in degrees, where Fit would otherwise frame sin(x) as a line', () => {
    expect(wantsDegreeWaves([line('y = sin(x)')], run(['y = sin(x)']).results, true)).toBe(true);
    expect(wantsDegreeWaves([line('y = sin(x)')], run(['y = sin(x)']).results, false)).toBe(false);
    for (const text of ['y = sinx', 'y = sin2x', 'y = sin^2(x)']) expect(wantsDegreeWaves([line(text)], run([text]).results, true), text).toBe(true);
    for (const text of ['y = sinh(x)', 'y = asin(x)', 'y = arccos(x)']) expect(wantsDegreeWaves([line(text)], run([text]).results, true), text).toBe(false);
    const home = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
    const v = fitCurves([(x) => Math.sin((x * Math.PI) / 180)], degreeWaves(home))!;
    expect([v.xmin, v.xmax]).toEqual([-360, 360]);
    expect(v.ymax).toBeGreaterThan(1);
    expect(v.ymax).toBeLessThan(1.5);
    expect(degreeWaves({ ...home, xmin: -720, xmax: 720 }).xmin).toBe(-720);
  });

  it('ignore results with no row left', () => {
    expect(wantsPiTicks([], run(['y = sin(x)']).results, false)).toBe(false);
  });

  it('step by the finest multiple at least 70 px apart', () => {
    expect(piStep(20, 720)).toMatchObject({ num: 1, den: 1 });
    expect(piStep(20, 390)).toMatchObject({ num: 2, den: 1 });
    expect(piStep(4, 720)).toMatchObject({ num: 1, den: 6 });
  });

  it('give way to decimals past either end of the scale', () => {
    expect(piStep(0.1, 390)).toBeNull();
    expect(piStep(1, 390)).toMatchObject({ num: 1, den: 12 });
    expect(piStep(2000, 390)).toMatchObject({ num: 128, den: 1 });
    expect(piStep(1e5, 390)).toBeNull();
  });

  it('label the x axis of an exported image, and only when asked', () => {
    const results = run(['y = sin(x)']).results;
    const view = { width: 720, height: 480, xmin: -10, xmax: 10, ymin: -5, ymax: 5 };
    const xLabels = (svg: string) => [...svg.matchAll(/text-anchor="middle">([^<]+)</g)].map((m) => m[1]);
    expect(xLabels(plotSVG(results, { ...view, piTicks: true }))).toEqual(['−3π', '−2π', '−π', 'π', '2π', '3π']);
    expect(xLabels(plotSVG(results, view))).toContain('2');
  });
});
