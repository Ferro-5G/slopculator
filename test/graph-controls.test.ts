import { describe, expect, it } from 'vitest';
import { evaluateDocument, type GraphItem, type RowResult } from '../src/engine/document';
import type { Settings } from '../src/engine/evaluator';
import type { DocRow } from '../src/ui/document';
import { asymptoteAcross, binomPeakAtMean, clearOfCover, fitBounds, fitCurves, fittableCurves, slidersOnGraph, homeView, isHomeView, isSquareView } from '../src/ui/plotmodel';

const DEG: Settings = { deg: true, complex: false, sample: false };
const rowsOf = (lines: string[]): DocRow[] => lines.map((text, i) => ({ id: `r${i}`, kind: 'expr', text, color: 0 }));
const slidersFor = (lines: string[]): string[] => {
  const rows = rowsOf(lines);
  return slidersOnGraph(rows, evaluateDocument(rows, DEG) as RowResult[]).map((s) => s.name);
};

describe('slidersOnGraph', () => {
  it('sees a slider inside a product like nx', () => {
    expect(slidersFor(['n = 2', 'y = nx'])).toEqual(['n']);
    expect(slidersFor(['n = 2', 'y = n*x'])).toEqual(['n']);
  });

  it('sees a value multiplying a bracket', () => {
    expect(slidersFor(['n = 2', 'y = n(x + 1)'])).toEqual(['n']);
  });

  it('finds each letter of a longer product', () => {
    expect(slidersFor(['a = 2', 'b = 3', 'y = abx'])).toEqual(['a', 'b']);
  });

  it('does not take the n in sin for a slider', () => {
    expect(slidersFor(['n = 2', 'y = sin(x)'])).toEqual([]);
  });

  it('skips a number no drawn line uses, and a hidden line', () => {
    expect(slidersFor(['n = 2', 'k = 3', 'y = nx'])).toEqual(['n']);
    const rows = rowsOf(['n = 2', 'y = nx']).map((r, i) => (i === 1 ? { ...r, hidden: true } : r));
    expect(slidersOnGraph(rows, evaluateDocument(rows, DEG) as RowResult[])).toEqual([]);
  });
});

describe('Fit on plain curves', () => {
  const home = homeView(400, 800);

  it('frames a curve across the x range already in view', () => {
    const v = fitCurves([(x) => x * x - 3], home)!;
    expect(v.xmin).toBe(home.xmin);
    expect(v.xmax).toBe(home.xmax);
    expect(v.ymin).toBeLessThan(-3);
    expect(v.ymax).toBeGreaterThan(90);
    expect(v.ymax).not.toBeCloseTo(home.ymax, 3);
  });

  it('keeps a bounded curve readable beside a much wider one', () => {
    const v = fitCurves([(x) => 2 * Math.sin(x), (x) => x * x - 3], { xmin: -10, xmax: 10, ymin: -20, ymax: 20 })!;
    const clear = v.ymax - v.ymin;
    expect(clear).toBeLessThan(25);
    expect(4 / clear).toBeGreaterThan(0.18);
    expect(v.ymin).toBeLessThan(-3);
  });

  it('never drops a wide curve that sits entirely away from the narrow one', () => {
    const v = fitCurves([(x) => Math.sin(x), (x) => x + 100], { xmin: -10, xmax: 10, ymin: -20, ymax: 20 })!;
    expect(v.ymin).toBeLessThan(0);
    expect(v.ymax).toBeGreaterThan(100);
  });

  it('frames a flat line around its value', () => {
    const v = fitCurves([() => 4], home)!;
    expect(v.ymin).toBeLessThan(4);
    expect(v.ymax).toBeGreaterThan(4);
  });

  it('gives up on a curve with nothing to frame', () => {
    expect(fitCurves([() => NaN], home)).toBeNull();
    expect(fitCurves([], home)).toBeNull();
  });

  it('leaves inequalities out', () => {
    const f = (x: number) => x;
    expect(fittableCurves([{ type: 'fx', f }, { type: 'fx', f, ineq: '<' }] as never)).toHaveLength(1);
  });
});

describe('a plot partly covered by floating controls', () => {
  it('centres the home view on what is left', () => {
    const v = homeView(400, 800, { top: 100, bottom: 300 });
    const y0Px = 800 - ((0 - v.ymin) / (v.ymax - v.ymin)) * 800;
    expect(y0Px).toBeCloseTo(100 + (800 - 100 - 300) / 2, 6);
  });

  it('puts a fitted range between the covers', () => {
    const v = clearOfCover({ xmin: 0, xmax: 1, ymin: 0, ymax: 10 }, 800, { top: 100, bottom: 300 });
    const toPx = (y: number) => 800 - ((y - v.ymin) / (v.ymax - v.ymin)) * 800;
    expect(toPx(10)).toBeCloseTo(100, 6);
    expect(toPx(0)).toBeCloseTo(500, 6);
  });

  it.each<GraphItem>([
    { type: 'points', pts: [[-3, -4], [3, 4]] },
    { type: 'polygon', pts: [[-3, -4], [3, -4], [3, 4]] },
    { type: 'vector', to: [3, 4] },
  ])('keeps a $type fit square beneath floating controls', (item) => {
    const cover = { top: 100, bottom: 300 };
    const f = fitBounds([item], 400, 800, binomPeakAtMean, cover)!;
    expect(f.square).toBe(true);
    expect(isSquareView(f.view, 400, 800)).toBe(true);
    const toPx = (y: number) => 800 - ((y - f.view.ymin) / (f.view.ymax - f.view.ymin)) * 800;
    expect(toPx(4)).toBeGreaterThanOrEqual(100);
    expect(toPx(item.type === 'vector' ? 0 : -4)).toBeLessThanOrEqual(500);
  });

  it('falls back to a home view centred on what is left', () => {
    const cover = { top: 100, bottom: 300 };
    const huge: GraphItem = { type: 'points', pts: [[-1e308, 0], [1e308, 0]] };
    expect(fitBounds([huge], 400, 800, binomPeakAtMean, cover)!.view).toEqual(homeView(400, 800, cover));
  });

  it('treats a covered home view as home', () => {
    const cover = { top: 100, bottom: 300 };
    expect(isHomeView(homeView(400, 800, cover), 400, 800, cover)).toBe(true);
    expect(isHomeView(homeView(400, 800), 400, 800, cover)).toBe(false);
  });
});

describe('which tools have nothing to do', () => {
  it('knows the home view and square axes', () => {
    const home = homeView(400, 800);
    expect(isHomeView(home, 400, 800)).toBe(true);
    expect(isSquareView(home, 400, 800)).toBe(true);
    const fitted = { ...home, ymin: -3, ymax: 100 };
    expect(isHomeView(fitted, 400, 800)).toBe(false);
    expect(isSquareView(fitted, 400, 800)).toBe(false);
  });
});

describe('asymptoteAcross', () => {
  it('finds a pole when one sample lands almost on it', () => {
    const near = Math.PI / 2 + 1e-5;
    expect(asymptoteAcross(Math.tan, Math.PI / 2 - 0.08, Math.tan(Math.PI / 2 - 0.08), near, Math.tan(near))).toBeCloseTo(Math.PI / 2, 4);
  });

  it('leaves a plain jump alone, however uneven', () => {
    const step = (x: number) => (x < 0 ? -1 : 1000);
    expect(asymptoteAcross(step, -0.1, -1, 0.1, 1000)).toBeNull();
    expect(asymptoteAcross(Math.floor, -0.5, -1, 0.5, 0)).toBeNull();
  });
});
