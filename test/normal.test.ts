import { describe, it, expect } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import type { Settings } from '../src/engine/evaluator';

const S: Settings = { deg: true, complex: false, sample: false };

function n(expr: string, setup: string[] = []): number {
  const rows: RowInput[] = [...setup, expr].map((text, i) => ({ id: String(i), kind: 'expr', text }));
  const r = evaluateDocument(rows, S).at(-1)!;
  if (r.error) throw new Error(`${expr}: ${r.error}`);
  if (typeof r.value !== 'number') throw new Error(`${expr} gave ${JSON.stringify(r.value)}`);
  return r.value;
}

describe('standard normal', () => {
  it('normalcdf one bound = P(Z ≤ z)', () => {
    expect(n('normalcdf(0)')).toBe(0.5);
    expect(n('normalcdf(1)')).toBeCloseTo(0.841344746068543, 14);
    expect(n('normalcdf(-1.96)')).toBeCloseTo(0.0249978951482204, 14);
    expect(n('normalcdf(-2.5)')).toBeCloseTo(0.00620966532577613, 14);
    expect(n('normalcdf(3)')).toBeCloseTo(0.998650101968370, 14);
  });
  it('normalcdf(a, b) and with μ, σ', () => {
    expect(n('normalcdf(-1, 1)')).toBeCloseTo(0.682689492137086, 14);
    expect(n('normalcdf(-2, 2)')).toBeCloseTo(0.954499736103642, 14);
    expect(n('normalcdf(-3, 3)')).toBeCloseTo(0.997300203936740, 14);
    expect(n('normalcdf(-inf, inf)')).toBe(1);
  });
  it('far tails keep precision', () => {
    expect(n('normalcdf(-6)')).toBeCloseTo(9.86587645037698e-10, 22);
    expect(n('normright(6)')).toBeCloseTo(9.86587645037698e-10, 22);
    expect(n('normalcdf(-8.5)') / 9.47953482220332e-18).toBeCloseTo(1, 10);
  });
  it('invNorm', () => {
    expect(n('invNorm(0.5)')).toBe(0);
    expect(n('invNorm(0.975)')).toBeCloseTo(1.959963984540054, 13);
    expect(n('invNorm(0.025)')).toBeCloseTo(-1.959963984540054, 13);
    expect(n('invNorm(0.95)')).toBeCloseTo(1.644853626951472, 13);
    expect(n('invNorm(0.00620966532577613)')).toBeCloseTo(-2.5, 12);
    expect(n('invNorm(1e-10)')).toBeCloseTo(-6.361340902404056, 9);
    expect(n('invNorm(0.9, 100, 15)')).toBeCloseTo(119.223273483169, 9);
    for (const z of [-5, -3.3, -1, -0.1, 0.4, 1.7, 4.2]) expect(n(`invNorm(normalcdf(${z}))`)).toBeCloseTo(z, 9);
  });
  it('z-scores and tails', () => {
    expect(n('x_from_z(-2.5, 280, 40)')).toBe(180);
    expect(n('normleft(180, 280, 40)')).toBeCloseTo(0.00620966532577613, 14);
    expect(n('normright(2)')).toBeCloseTo(0.0227501319481792, 14);
    expect(n('normbetween(-1, 1)')).toBeCloseTo(0.682689492137086, 14);
    expect(n('normoutside(-1.96, 1.96)')).toBeCloseTo(0.0499957902964409, 13);
    expect(n('zcrit(0.95)')).toBeCloseTo(1.959963984540054, 13);
    expect(n('normalpdf(0)')).toBeCloseTo(0.398942280401433, 14);
  });
  it('empirical rule', () => {
    expect(n('empirical(400, 50, 350, 500)')).toBeCloseTo(0.815, 12);
    expect(n('empirical(0, 1, -1, 1)')).toBeCloseTo(0.68, 12);
    expect(n('empirical(0, 1, -inf, -2)')).toBeCloseTo(0.025, 12);
  });
  it('normaldist row with cumulative shading', () => {
    const rows: RowInput[] = [
      { id: 'm', kind: 'expr', text: 'μ = 400' },
      { id: 's', kind: 'expr', text: 'σ = 50' },
      { id: 'd', kind: 'expr', text: 'normaldist(μ, σ)', dist: { cdf: true, min: '350', max: '500' } },
    ];
    const r = evaluateDocument(rows, S)[2];
    expect(r.error).toBeUndefined();
    expect(r.distProb).toBeCloseTo(0.818594614120364, 13);
    expect(r.graph[0]).toMatchObject({ type: 'normal', mu: 400, sigma: 50, shade: [350, 500] });
  });
});
