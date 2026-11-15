// Engine accuracy: the two items left on PR #15's "Not changed" list.
// 1. tidy() snapped anything under 1e-14 to 0, whatever the inputs were.
// 2. t, χ², F and Poisson lost their digits at df or λ around 1e12, where lgamma differences cancel.
import { describe, it, expect } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { plainValue } from '../src/engine/format';
import type { Settings } from '../src/engine/evaluator';
import type { Value } from '../src/engine/values';
import { tidy } from '../src/engine/values';

const DEG: Settings = { deg: true, complex: false, sample: false };

function n(expr: string, setup: string[] = []): number {
  const rows: RowInput[] = [...setup, expr].map((text, i) => ({ id: String(i), kind: 'expr', text }));
  const r = evaluateDocument(rows, DEG).at(-1)!;
  if (r.error) throw new Error(`${expr}: ${r.error}`);
  const v: Value = r.value!;
  if (typeof v !== 'number') throw new Error(`${expr} gave ${JSON.stringify(v)}`);
  return v;
}

function result(expr: string, s: Settings = DEG) {
  const r = evaluateDocument([{ id: '0', kind: 'expr', text: expr }], s).at(-1)!;
  if (r.error) throw new Error(`${expr}: ${r.error}`);
  return r;
}

/** What the line shows with the default display. */
const shows = (expr: string, s: Settings = DEG) => {
  const r = result(expr, s);
  return plainValue(r.value!, { places: null, exact: false, percent: false }, r.prob, r.precise);
};

/** The numbers inside a point, vector, list or matrix. */
function numbers(expr: string): number[] {
  const v = result(expr).value!;
  if (typeof v === 'object' && (v.t === 'point' || v.t === 'vector')) return v.c;
  if (typeof v === 'object' && v.t === 'matrix') return v.m.flat();
  if (typeof v === 'object' && v.t === 'list') return v.items.map((x) => x as number);
  throw new Error(`${expr} gave ${JSON.stringify(v)}`);
}

/** Relative closeness: |a − b| ≤ tol·|b|. */
const rel = (a: number, b: number, tol: number) => {
  expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol * Math.abs(b));
};

describe('zero-snapping is relative to the inputs, not a fixed 1e-14', () => {
  it('keeps tiny results of operations on tiny inputs', () => {
    expect(n('convert(1e-18, "m", "m")')).toBe(1e-18);
    expect(n('convert(1e-18, "km", "m")')).toBe(1e-15);
    expect(n('mean(1e-18, 3e-18)')).toBe(2e-18);
    expect(n('mod(7e-16, 3e-16)')).toBe(1e-16); // The float remainder, within an ulp or two of the decimal answer.
    expect(n('mod(1e-15, 1)')).toBe(1e-15); // Under the divisor, so nothing was cancelled.
    expect(n('rem(1e-15, 1)')).toBe(1e-15);
    expect(n('distance((0, 0), (3e-17, 4e-17))')).toBeCloseTo(5e-17, 30);
    expect(numbers('midpoint((0, 0), (2e-17, 0))')).toEqual([1e-17, 0]);
    expect(n('dot({1e-15, 0}, {1e-15, 0})')).toBe(1e-30);
    expect(n('det([[1e-9, 0], [0, 1e-9]])')).toBe(1e-18);
    expect(n('trace([[1e-16, 0], [0, 2e-16]])')).toBe(3e-16);
    expect(n('zscore(1e-15, 0, 1)')).toBe(1e-15);
    expect(n('phat(1, 1e16)')).toBe(1e-16);
    expect(n('range(1e-18, 3e-18)')).toBe(2e-18);
    expect(n('sds(1e-8, 2e-8, 3e-8)')).toBe(1e-8);
    expect(n('sd(1, 1 + 1e-8)')).toBeCloseTo(5e-9, 15);
    expect(n('covp({1e-9, 2e-9}, {1e-9, 2e-9})')).toBe(2.5e-19);
    expect(n('integral(1e-18, x, 0, 1)')).toBe(1e-18);
    expect(n('deriv(1e-18 * x, x, 0)')).toBe(1e-18);
    expect(n('sum(1e-18 * k, k, 1, 3)')).toBe(6e-18);
    expect(n('area((0, 0), (1e-9, 0), (0, 1e-9))')).toBe(5e-19);
    expect(n('polyval({1, -1e-18}, 0)')).toBe(-1e-18);
    expect(numbers('roots(1, 0, -1e-36)')).toEqual([-1e-18, 1e-18]);
    expect(numbers('eigen([[1e-9, 0], [0, 2e-9]])')).toEqual([1e-9, 2e-9]);
    expect(numbers('inv([[1e20, 0], [0, 1e20]])')).toEqual([1e-20, 0, 0, 1e-20]);
    expect(numbers('[[1e-10, 0], [0, 1e-10]] ^ 2')).toEqual([1e-20, 0, 0, 1e-20]);
    expect(numbers('[[1e-10, 0], [0, 1e-10]] * [[1e-10, 0], [0, 1e-10]]')).toEqual([1e-20, 0, 0, 1e-20]);
    expect(numbers('linsolve([[1e20, 0], [0, 1e20]], {1, 2})')).toEqual([1e-20, 2e-20]);
    expect(numbers('rref([[1, 1e-20, 0], [0, 0, 1]])')).toEqual([1, 1e-20, 0, 0, 0, 1]);
    expect(numbers('cross({1e-10, 0, 0}, {0, 1e-10, 0})')).toEqual([0, 0, 1e-20]);
  });
  it('never zeroes a correct answer because the inputs are large', () => {
    expect(n('range(1e15, 1e15 + 1)')).toBe(1);
    expect(n('mod(1e15 + 1, 1e15)')).toBe(1);
    expect(n('zscore(1e15 + 1, 1e15, 1)')).toBe(1);
    expect(n('mean(2^53, 2 - 2^53)')).toBe(1);
  });
  it('still snaps cancellation noise of ordinary-sized inputs', () => {
    expect(n('mean(0.1, 0.2) - 0.15')).toBe(0);
    expect(n('det([[1, 2], [2, 4]])')).toBe(0);
    expect(n('det([[0.1, 0.2], [0.3, 0.6]])')).toBe(0);
    expect(n('range(0.3, 0.1 + 0.2)')).toBe(0);
    expect(n('sds(1, 1, 1)')).toBe(0);
    expect(n('convert(32, "F", "C")')).toBe(0);
    expect(n('convert(-40, "C", "F")')).toBe(-40);
    expect(n('zscore(0.3, 0.1 + 0.2, 1)')).toBe(0);
    expect(n('dot({1, 2}, {2, -1})')).toBe(0);
    expect(n('trace([[0.1, 0], [0, -0.1]])')).toBe(0);
    expect(n('mod(0.3, 0.1)')).toBe(0); // The right answer, though 0.3 % 0.1 alone is a hair under 0.1 in floats.
    expect(n('mod(1.5, 0.3)')).toBe(0);
    expect(n('rem(1.5, 0.3)')).toBe(0);
    expect(n('rem(-1.5, 0.3)')).toBe(0);
    expect(n('integral(x^2 - 1/3, x, 1, 0)')).toBe(0); // A reversed range makes noise of the same size.
    expect(n('sds(0.1, 0.1, 0.1)')).toBe(0);
    expect(n('mad(0.1, 0.1, 0.1)')).toBe(0);
    expect(n('covp({0.1, 0.1, 0.1}, {0.1, 0.1, 0.1})')).toBe(0);
    expect(n('distance((0.1 + 0.2, 0), (0.3, 0))')).toBe(0);
    expect(n('slope((0, 0.3), (1, 0.1 + 0.2))')).toBe(0);
    expect(n('integral(sin(x), x, -1, 1)')).toBe(0);
    expect(n('deriv(cos(x), x, 0)')).toBe(0);
    expect(n('det([[0.1, 0.2, 0.3, 0.4], [0.5, 0.6, 0.7, 0.8], [0.9, 1, 1.1, 1.2], [1.3, 1.4, 1.5, 1.6]])')).toBe(0);
    expect(numbers('zscores({0.1, 0.2, 0.3})')[1]).toBe(0);
    expect(numbers('[[0.3, -0.1], [0.9, -0.3]] ^ 2')).toEqual([0, 0, 0, 0]);
  });
  it('shows 0 for the classic cases of float noise', () => {
    const RAD: Settings = { ...DEG, deg: false };
    expect(shows('sin(pi)', RAD)).toBe('0');
    expect(shows('cos(pi/2)', RAD)).toBe('0');
    expect(shows('sin(180)')).toBe('0');
    expect(shows('0.1 + 0.2 - 0.3')).toBe('0');
    expect(shows('det([[1, 2], [2, 4]])')).toBe('0');
    expect(shows('det([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]])')).toBe('0');
  });
  it('tidy without a scale never invents a zero', () => {
    expect(tidy(1e-18)).toBe(1e-18);
    expect(tidy(-1e-300)).toBe(-1e-300);
    expect(tidy(0.1 + 0.2)).toBe(0.3);
    expect(tidy(1e-17, 1)).toBe(0);
    expect(tidy(1e-17, 1e-10)).toBe(1e-17);
    expect(tidy(1e-15, 1e10)).toBe(0);
    expect(tidy(2e-14, 1e10)).toBe(2e-14); // Never above the old cutoff, however large the inputs.
  });
});

// Reference values: the normal limit, with its first Fisher correction where it matters (ν ≥ 1e12 puts the next term
// below 1e-20), and closed forms. Each of these failed on main by between 1e-6 and everything.
describe('t, χ², F and Poisson at df or λ around 1e12 and above', () => {
  it('t with huge df matches the normal distribution', () => {
    const Phi2 = 0.9772498680518208; // Φ(2)
    rel(n('tcdf(2, 1e12)'), Phi2, 1e-12);
    rel(n('tcdf(-inf, -2, 1e12)'), 1 - Phi2, 1e-11);
    rel(n('tcdf(-1.96, 1.96, 1e13)'), 0.9500042097035591, 1e-12);
    rel(n('tcdf(5, inf, 1e14)'), 2.866515718791939e-7, 1e-10);
    rel(n('tpdf(0, 1e12)'), 1 / Math.sqrt(2 * Math.PI), 1e-12);
    rel(n('tpdf(2, 1e15)'), Math.exp(-2) / Math.sqrt(2 * Math.PI), 1e-12);
    rel(n('invT(0.975, 1e12)'), 1.959963984540054, 1e-11);
    rel(n('invT(0.9772498680518208, 1e13)'), 2, 1e-10);
  });
  it('χ² with huge df', () => {
    // χ²(k) at k + z√(2k): Φ(z) + the first Edgeworth term ≈ −φ(z)(z² − 1)·√(2/k)/3.
    const k = 1e12, z = 2;
    const x = k + z * Math.sqrt(2 * k);
    const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    const ref = 0.9772498680518208 - (phi * (z * z - 1) * Math.sqrt(2 / k)) / 3;
    rel(n(`chi2cdf(${x}, ${k})`), ref, 1e-9);
    rel(n(`chi2pdf(${k}, ${k})`), 1 / Math.sqrt(4 * Math.PI * k), 1e-6);
    rel(n(`chi2cdf(${k}, inf, ${k})`), 0.5, 1e-6);
    expect(n(`chi2cdf(0, ${k}, ${k}) + chi2cdf(${k}, inf, ${k})`)).toBeCloseTo(1, 14);
  });
  it('F with one or two huge df', () => {
    // F(d1, ∞)·d1 is χ²(d1): Fcdf(x, 5, 1e14) = chi2cdf(5x, 5).
    rel(n('Fcdf(2, 5, 1e14)'), n('chi2cdf(10, 5)'), 1e-9);
    rel(n('Fcdf(1, 1e12, 1e12)'), 0.5, 1e-6);
    rel(n('Fpdf(1, 1e12, 1e12)'), Math.sqrt(1e12 / (8 * Math.PI)), 1e-6);
  });
  it('Poisson with huge λ', () => {
    const l = 1e12;
    rel(n(`poissonpdf(${l}, ${l})`), 1 / Math.sqrt(2 * Math.PI * l), 1e-9);
    rel(n(`poissonpdf(${l}, ${l + 2e6})`), Math.exp(-2) / Math.sqrt(2 * Math.PI * l), 1e-6);
    // P(X ≤ λ) = ½ + 2/(3√(2πλ)) + O(1/λ) at whole λ (Ramanujan), about 0.5000002659615203 here.
    rel(n(`poissoncdf(${l}, ${l})`), 0.5 + 2 / (3 * Math.sqrt(2 * Math.PI * l)), 1e-11);
    rel(n(`poissoncdf(${l}, ${l + 2e6})`), 0.9772498680518208, 1e-6);
  });
  // mpmath at 50 digits, integrating each density from its definition (lnΓ and all) panel by panel.
  it('matches high-precision values, in the tails too', () => {
    rel(n('tcdf(30, inf, 1e20)'), 4.906713927148197e-198, 1e-13);
    rel(n('tcdf(10, inf, 1e12)'), 7.6198530435893876e-24, 1e-13);
    rel(n('tcdf(5, inf, 1e8)'), 2.866520550633643e-7, 1e-13);
    rel(n('tcdf(2, inf, 1e5)'), 0.022751481728753232, 1e-13);
    rel(n('tcdf(1.8, inf, 1e6)'), 0.035930469749841685, 1e-13);
    rel(n('chi2cdf(1000010000000, inf, 1e12)'), 7.688578856497886e-13, 1e-12);
    rel(n('chi2cdf(0, 999990000000, 1e12)'), 7.6860192816223757e-13, 1e-12);
    rel(n('chi2cdf(2e15, inf, 2e15)'), 0.49999999579477913, 1e-13);
    rel(n('poissoncdf(1e6, 1e6)'), 0.50026596148628365, 1e-13);
    rel(n('poissoncdf(1e12, 1e12 - 5e6)'), 2.8664636839496291e-7, 1e-12);
    rel(n('Fcdf(1.5, inf, 5, 1e12)'), 0.186029833603951, 1e-13);
    rel(n('Fcdf(3, inf, 1, 1e14)'), 0.083264516663553485, 1e-13);
    rel(n('Fcdf(1.5, inf, 1e12, 5)'), 0.351257641332321695, 1e-13);
    rel(n('Fcdf(1.001, inf, 1e7, 1e7)'), 0.057013514704199588, 1e-11);
    // Both df huge: an F near 1 only has 16 digits, and at df = 1e12 the bell is 2e-6 wide, so about 1e-10 is the most
    // an input can carry.
    rel(n('Fcdf(1.000002, inf, 1e12, 1e12)'), 0.15865549589510256, 1e-9);
  });
  it('is continuous where the method changes', () => {
    rel(n('chi2cdf(2e5, inf, 2e5)'), 0.49957947788963482, 1e-13);
    rel(n('chi2cdf(200002, inf, 200002)'), 0.49957947999222984, 1e-13);
    expect(n('chi2cdf(1e300, 1e300)')).toBe(0.5);
    expect(n('Fcdf(1, 1e300, 1e300)')).toBe(0.5);
    expect(n('poissoncdf(1e300, 1e300)')).toBe(0.5);
  });
  it('keeps ordinary df, against closed forms and exact sums', () => {
    rel(n('tcdf(2, 10)'), 0.963305982614629817, 1e-14);
    // erf(√x) − 2√(x/π)·e^−x·(1 + 2x/3) at x = 3.75.
    rel(n('chi2cdf(7.5, 5)'), 0.813970166397132981, 1e-14);
    // 1 − (6/11)⁶·(41/11).
    rel(n('Fcdf(2.5, 4, 12)'), 0.901838188826895397, 1e-14);
    // Σₖ₌₀²⁵ e⁻²⁰ 20ᵏ/k!.
    rel(n('poissoncdf(20, 25)'), 0.887815027282030154, 1e-14);
    rel(n('poissonpdf(20, 25)'), 0.0445876491082678804, 1e-14);
  });
  // lnΓ differences left about 1e-11 of error by df = 1e4. mpmath at 50 digits: these moved, toward the truth.
  it('fixes the eleventh digit at df around 1e4', () => {
    rel(n('poissonpdf(1e4, 1e4)'), 0.0039893895589628256, 1e-14);
    rel(n('poissoncdf(1e4, 1e4)'), 0.50265958121900763, 1e-14);
    rel(n('chi2pdf(1e4, 1e4)'), 0.0028209009023320113, 1e-14);
    rel(n('Fcdf(0.7, 1e4, 3)'), 0.23228735406921349, 1e-13);
    rel(n('Fcdf(2.8, inf, 1, 5000)'), 0.094326860779583077, 1e-13);
    rel(n('tcdf(1.5, inf, 1e4)'), 0.066822985911809806, 1e-13);
  });
});
