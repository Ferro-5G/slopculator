import { describe, expect, it } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { listSummary } from '../src/engine/builtins';
import { figureData, figureKind, figureLabel, figureQuiet, figureScene, figureSize, FIGURE_SIZE, histogramBins, MAX_BINS, pairedRows, type PairsData, type StatsData } from '../src/ui/figures';

const settings = { deg: true, complex: false, sample: false };
function scope(lines: string[]) {
  const rows: RowInput[] = lines.map((text, k) => ({ id: `r${k}`, kind: 'expr', text }));
  return { rows, results: evaluateDocument(rows, settings), settings };
}
const STRENGTH = [31.2, 33.8, 29.6, 32.4, 30.9, 31.7, 34.1, 32.8, 28.9, 33.2, 31.5, 30.4, 32.1, 35.3, 31.9, 29.9, 32.6, 33.5, 30.7, 31.3, 34.6, 32.3, 31.1, 27.8];

describe('which lines are stats blocks', () => {
  it('a list of four or more numbers, and paired data: a fit, linreg, or a list of points', () => {
    const s = scope([`d = [${STRENGTH}]`, '{1, 2, 3, 4}', 'v = [1, 2, 3]', 'x1 = [2, 4, 6, 8]', 'y1 = [1, 2, 2.9, 4.2]', 'y1 ~ m x1 + b', 'linreg(x1, y1)', 'P = [(1, 2), (2, 3.9), (3, 6.1)]']);
    const kinds = s.rows.map((r, k) => figureKind(r.kind === 'expr' ? r.text : '', s.results[k]));
    expect(kinds).toEqual(['stats', 'stats', null, 'stats', 'stats', 'pairs', 'pairs', 'pairs']);
  });
  it('the lists a fit reads show as values, its scatter showing them', () => {
    const s = scope(['x1 = [2, 4, 6, 8]', 'y1 = [1, 2, 2.9, 4.2]', 'y1 ~ m x1 + b', `d = [${STRENGTH}]`]);
    const paired = pairedRows(s.rows, s.results);
    expect([...paired].sort()).toEqual(['r0', 'r1']);
    expect(figureKind('x1 = [2, 4, 6, 8]', s.results[0], paired.has('r0'))).toBeNull();
  });
});

describe('histogramBins', () => {
  it('Freedman–Diaconis, never coarser than Sturges, on round edges', () => {
    const b = histogramBins(STRENGTH);
    expect(b.width).toBe(1);
    expect(b.lo).toBe(27);
    expect(b.counts.reduce((p, q) => p + q, 0)).toBe(STRENGTH.length);
    expect(b.lo + b.counts.length * b.width).toBe(b.hi);
    expect(b.hi).toBeGreaterThan(Math.max(...STRENGTH));
  });
  it('counts a value on an edge in the bin above it, and the top value in the last bin', () => {
    const b = histogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 10]);
    expect(b.counts.reduce((p, q) => p + q, 0)).toBe(10);
    expect(b.hi).toBeGreaterThanOrEqual(10);
  });
  it('one value, or a long spread list, still bins', () => {
    expect(histogramBins([5, 5, 5, 5]).counts).toEqual([4]);
    const wide = Array.from({ length: 2000 }, (_, k) => k * k);
    expect(histogramBins(wide).counts.length).toBeLessThanOrEqual(MAX_BINS);
  });
});

describe('stats figure', () => {
  it('reads its numbers from the engine', () => {
    const s = scope([`d = [${STRENGTH}]`]);
    const d = figureData({ ...s, id: 'r0' }) as StatsData;
    expect(d.sum).toEqual(listSummary(STRENGTH));
    expect(figureQuiet(d)).toBe(true);
    expect(figureLabel(d)).toMatch(/24 values/);
  });
  it('draws bars, the ±s band, the box plot and the mean, with ticks', () => {
    const s = scope([`d = [${STRENGTH}]`]);
    const d = figureData({ ...s, id: 'r0' }) as StatsData;
    const sc = figureScene(d, FIGURE_SIZE.stats);
    expect(sc.marks.filter((m) => m.t === 'path' && m.fill === 'violet').length).toBe(2);
    const t = sc.marks.flatMap((m) => (m.t === 'text' ? [m.s] : []));
    expect(t).toEqual(expect.arrayContaining(['x̄', 's', '28', '30', '32', '34']));
    expect(figureSize('stats', 358).w).toBe(358);
  });
});

describe('paired figure', () => {
  it('a fit: its points, the fitted line from the engine, and its unknowns as slope and intercept', () => {
    const s = scope(['x1 = [2, 4, 6, 8, 10]', 'y1 = [0.41, 0.79, 1.22, 1.6, 2.02]', 'y1 ~ m x1 + b']);
    const d = figureData({ ...s, id: 'r2' }) as PairsData;
    expect(d.pts).toEqual([[2, 0.41], [4, 0.79], [6, 1.22], [8, 1.6], [10, 2.02]]);
    expect(d.params.map((p) => [p.port, p.label])).toEqual([['m', 'slope'], ['b', 'intercept']]);
    expect(d.line!.slope).toBeCloseTo(0.2015, 12);
    expect(d.r2).toBeGreaterThan(0.999);
    const t = figureScene(d, FIGURE_SIZE.pairs).marks.flatMap((m) => (m.t === 'text' ? [m.s] : []));
    expect(t.some((x) => x.startsWith('ŷ = 0.2015x'))).toBe(true);
  });
  it('a curve fit keeps its unknowns’ names', () => {
    const s = scope(['x1 = [0, 1, 2, 3, 4]', 'y1 = [1, 2, 5, 10, 17]', 'y1 ~ a x1^2 + c']);
    const d = figureData({ ...s, id: 'r2' }) as PairsData;
    expect(d.line).toBeNull();
    expect(d.params.map((p) => p.label)).toEqual(['a', 'c']);
  });
  it('linreg and a list of points', () => {
    const s = scope(['x1 = [1, 2, 3, 4]', 'y1 = [2, 4.1, 5.9, 8]', 'linreg(x1, y1)', 'P = [(1, 2), (2, 4.1), (3, 5.9), (4, 8)]']);
    const a = figureData({ ...s, id: 'r2' }) as PairsData, b = figureData({ ...s, id: 'r3' }) as PairsData;
    expect(a.source).toBe('linreg');
    expect(b.source).toBe('points');
    expect(b.line!.slope).toBeCloseTo(a.line!.slope, 12);
    expect(b.r2).toBeCloseTo(a.r2!, 12);
  });
});
