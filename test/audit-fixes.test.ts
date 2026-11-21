// Wrong answers and failures found by an engine audit, one block per bug.
import { describe, it, expect } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import type { Settings } from '../src/engine/evaluator';
import type { Value } from '../src/engine/values';
import { plainValue } from '../src/engine/format';
import { readError } from '../src/engine/errors';

const DEG: Settings = { deg: true, complex: false, sample: false };
const CX: Settings = { deg: true, complex: true, sample: false };

function last(lines: string[], settings: Settings = DEG) {
  const rows: RowInput[] = lines.map((text, i) => ({ id: String(i), kind: 'expr', text }));
  return evaluateDocument(rows, settings).at(-1)!;
}
function val(expr: string, settings: Settings = DEG, setup: string[] = []): Value {
  const r = last([...setup, expr], settings);
  if (r.error) throw new Error(`${expr}: ${r.error}`);
  return r.value!;
}
function n(expr: string, settings: Settings = DEG, setup: string[] = []): number {
  const v = val(expr, settings, setup);
  if (typeof v !== 'number') throw new Error(`${expr} gave ${JSON.stringify(v)}`);
  return v;
}
function err(expr: string, settings: Settings = DEG): string {
  const r = last([expr], settings);
  if (!r.error) throw new Error(`${expr} should fail but gave ${JSON.stringify(r.value)}`);
  return r.error;
}

describe('a power of a parenthesized implicit product raises the whole product', () => {
  it('squares (ab) and (P(1 + r))', () => {
    expect(n('(ab)^2', DEG, ['a = 2', 'b = 3'])).toBe(36);
    expect(n('(P(1+r))^2', DEG, ['P = 10', 'r = 0.5'])).toBe(225);
  });
  it('still reads ab^2 and P(1 + r)^2 the textbook way', () => {
    expect(n('ab^2', DEG, ['a = 2', 'b = 3'])).toBe(18);
    expect(n('P(1+r)^2', DEG, ['P = 10', 'r = 0.5'])).toBe(22.5);
  });
});

describe('an input that is exactly 0 fails ln and negative powers even when its double is not 0', () => {
  it('fails ln, log and a negative power of 0.1 + 0.2 − 0.3 as it fails them for 0', () => {
    expect(err('ln(0.1 + 0.2 - 0.3)')).toBe(err('ln(0)'));
    expect(err('log(0.1 + 0.2 - 0.3)')).toBe(err('log(0)'));
    expect(err('(0.1 + 0.2 - 0.3)^-1')).toBe(err('0^-1'));
    expect(err('(0.1 + 0.2 - 0.3)^-0.5')).toBe(err('0^-1'));
  });
  it('keeps the powers of 0 that have a value', () => {
    expect(n('(0.1 + 0.2 - 0.3)^0.5')).toBe(0);
    expect(n('(0.1 + 0.2 - 0.3)^0')).toBe(1);
  });
});

describe('and binds tighter than or', () => {
  it('reads 1 or 0 and 0 as 1 or (0 and 0)', () => {
    expect(n('1 or 0 and 0')).toBe(1);
    expect(n('0 and 1 or 1')).toBe(1);
    expect(n('1 xor 1 and 0')).toBe(1);
  });
  it('takes and/or in a piecewise condition', () => {
    expect(n('{t > 0 and t < 5: t^2, 0}', DEG, ['t = 2'])).toBe(4);
    expect(n('{t > 0 and t < 5: t^2, 0}', DEG, ['t = 7'])).toBe(0);
    expect(n('{t > 0 or t < -5: 1, t < 0 and t > -2: 2, 0}', DEG, ['t = -1'])).toBe(2);
  });
});

describe('binomial inversecdf', () => {
  it('reaches the top of the range at p = 1 and for a sure success', () => {
    expect(n('binomdist(50, 0.5).inversecdf(1)')).toBe(50);
    expect(n('binomdist(10, 1).inversecdf(1e-13)')).toBe(10);
    expect(n('binomdist(10, 1).inversecdf(0)')).toBe(0);
    expect(n('binomdist(10, 0).inversecdf(0.7)')).toBe(0);
  });
  it('gives the smallest k with P(X ≤ k) ≥ p', () => {
    // P(X ≤ k) for n = 10, p = 0.3: 0.028, 0.149, 0.383, 0.650, 0.850, 0.953, 0.989, 0.998, 0.99986, 0.999994, 1.
    const v = val('binomdist(10, 0.3).inversecdf({0, 0.01, 0.1, 0.5, 0.9, 0.99, 0.999999, 1})');
    expect(v).toEqual({ t: 'list', items: [0, 0, 1, 3, 5, 7, 10, 10] });
  });
  it('answers for a billion and a trillion trials without summing terms', () => {
    const start = performance.now();
    expect(n('binomdist(10^9, 0.5).inversecdf(0.5)')).toBe(500000000);
    expect(n('binomdist(10^12, 0.5).inversecdf(0.5)')).toBe(500000000000);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('a normal distribution\'s cdf(low, high) in the far tail', () => {
  it('matches normalcdf instead of cancelling to 0', () => {
    expect(n('normaldist(0, 1).cdf(8, 9)')).toBe(n('normalcdf(8, 9)'));
    expect(n('normaldist(0, 1).cdf(8, 9)')).toBeCloseTo(6.219831986e-16, 25);
    expect(n('normaldist(10, 2).cdf(8, 12)')).toBe(n('normalcdf(8, 12, 10, 2)'));
  });
});

describe('normoutside with its bounds the wrong way round', () => {
  it('fails as normalcdf does', () => {
    expect(err('normoutside(2, -2)')).toBe(err('normalcdf(2, -2)'));
    expect(n('normoutside(-2, 2)')).toBeCloseTo(0.04550026390, 10);
  });
});

describe('tand at its poles', () => {
  it('is undefined at 90° and the angles that land on it', () => {
    for (const x of ['90', '-270', '450']) expect(last([`tand(${x})`]).error).toBeTruthy();
    expect(err('tan(90)')).toBeTruthy();
  });
  it('still works next to them', () => {
    expect(n('tand(45)')).toBe(1);
    expect(Math.abs(n('tand(180)'))).toBe(0);
    expect(n('tand(89.9999)')).toBeCloseTo(572957.7951, 3);
  });
});

describe('acsc and asec name their own domain', () => {
  it('asks for an input outside (−1, 1)', () => {
    expect(err('acsc(0.5)')).toBe('acsc(0.5) is undefined: input must be −1 or less, or 1 or more');
    expect(err('asec(0.5)')).toBe('asec(0.5) is undefined: input must be −1 or less, or 1 or more');
    expect(err('asin(2)')).toBe('asin(2) is undefined: input must be between −1 and 1');
  });
});

describe('a negative root of 0', () => {
  it('fails as 0 to a negative power does', () => {
    expect(err('nthroot(0, -3)')).toBe(err('0^(-1/3)'));
    expect(err('nthroot(0.1 + 0.2 - 0.3, -3)')).toBe(err('0^(-1/3)'));
    expect(n('nthroot(0, 3)')).toBe(0);
    expect(n('nthroot(8, -3)')).toBe(0.5);
  });
  it('lets exact math retry when float cancellation rounds a nonzero input to 0', () => {
    expect(n('nthroot(1e16 + 1 - 1e16, -3)')).toBe(1);
  });
});

describe('complex results that are small but not zero', () => {
  const parts = (expr: string) => {
    const v = val(expr, CX);
    if (typeof v !== 'object' || v.t !== 'complex') throw new Error(`${expr} gave ${JSON.stringify(v)}`);
    return v;
  };
  it('keeps both parts of e^(−40 + i)', () => {
    const v = parts('e^(-40 + i)');
    expect(v.re / (Math.exp(-40) * Math.cos(1))).toBeCloseTo(1, 12);
    expect(v.im / (Math.exp(-40) * Math.sin(1))).toBeCloseTo(1, 12);
    expect(val('e^(π i)', CX)).toBe(-1);
  });
  it('fails 0 to a power whose real part is not positive', () => {
    expect(err('0^(-1 + i)', CX)).toBe(err('0^-1', CX));
    expect(last(['0^i'], CX).error).toBeTruthy();
    expect(val('0^(1 + i)', CX)).toBe(0);
  });
  it('divides by a huge imaginary number without overflowing', () => {
    const v = parts('1/(1e200 i)');
    expect(v.re).toBe(0);
    expect(v.im).toBe(-1e-200);
    expect(parts('1/(3+4i)')).toEqual({ t: 'complex', re: 0.12, im: -0.16 });
  });
  it('divides complex numbers near 1e308 without producing Infinity/Infinity', () => {
    expect(val('(1e308 + 1e308 i)/(1e308 + 1e308 i)', CX)).toBe(1);
    expect(val('(1e308 + 1e308 i)/(1 + i)', CX)).toBe(1e308);
    expect(val('(1 + i)/(1e308 + 1e308 i)', CX)).toBe(1e-308);
    expect(val('(1e-315 + 1e-315 i)/(1e-315 + 1e-315 i)', CX)).toBe(1);
  });
});

describe('sum of several terms', () => {
  it('agrees with the sum of the same list', () => {
    expect(n('sum(1e16, 1, -1e16)')).toBe(1);
    expect(n('sum({1e16, 1, -1e16})')).toBe(1);
    expect(n('sum(0.1, 0.2)')).toBe(0.3);
    expect(n('prod(0.1, 3)')).toBe(0.3);
    expect(n('sum(n^2, n, 1, 3)')).toBe(14);
  });
});

describe('hex and binary literals past 2^53', () => {
  const shows = (expr: string) => {
    const r = last([expr]);
    if (r.error) throw new Error(`${expr}: ${r.error}`);
    return plainValue(r.value!, { places: null, exact: false, percent: false }, r.prob, r.precise);
  };
  it('keep every digit, as a decimal literal does', () => {
    expect(shows('0x20000000000001')).toBe('9007199254740993');
    expect(shows('0b100000000000000000000000000000000000000000000000000001')).toBe('9007199254740993');
    expect(shows('0x20000000000001 - 9007199254740992')).toBe('1');
    expect(shows('0x1F')).toBe('31');
  });
});

describe('angle between huge or tiny vectors', () => {
  it('is 0 between a huge vector and itself', () => {
    expect(n('angle([1e200, 0], [1e200, 0])')).toBe(0);
    expect(n('angle([1e-200, 0], [0, 1e200])')).toBe(90);
  });
  it('keeps the ordinary answers', () => {
    expect(n('angle([1, 0], [0, 1])')).toBe(90);
    expect(n('angle([1, 0], [-1, 0])')).toBe(180);
    expect(n('angle([1, 1], [1, 0])')).toBe(45);
    expect(n('angle([1, 2, 3], [4, 5, 6])')).toBeCloseTo(12.9331544918, 9);
  });
});

describe('area of a polygon far from the origin', () => {
  it('measures a small triangle at 1e9 exactly', () => {
    expect(n('area((1000000000,1000000000),(1000000001,1000000000),(1000000000,1000000001))')).toBe(0.5);
    expect(n('area((0,0),(4,0),(4,3))')).toBe(6);
    expect(n('area((1,1),(5,1),(5,4),(1,4))')).toBe(12);
  });
});

/** The number in one row of a result table. */
function row(expr: string, label: string, setup: string[] = []): number {
  const v = val(expr, DEG, setup);
  if (typeof v !== 'object' || v.t !== 'record') throw new Error(`${expr} gave ${JSON.stringify(v)}`);
  const r = v.rows.find((x) => x.label === label);
  if (!r || typeof r.value !== 'number') throw new Error(`${expr} has no number row "${label}"`);
  return r.value;
}

describe('quadreg on x values far from 0', () => {
  it('fits years like 2020…2023', () => {
    const q = 'quadreg({2020, 2021, 2022, 2023}, {1, 4, 9, 16})';
    expect(row(q, 'a')).toBe(1);
    expect(row(q, 'b')).toBe(-4038);
    expect(row(q, 'c')).toBe(4076361);
  });
  it('keeps small fits right', () => {
    const q = 'quadreg({1, 2, 3, 4}, {2.1, 3.9, 9.2, 15.8})';
    expect(row(q, 'a')).toBeCloseTo(1.2, 12);
    expect(row(q, 'b')).toBeCloseTo(-1.36, 12);
    expect(row(q, 'c')).toBeCloseTo(2.15, 12);
    expect(last(['quadreg({1, 1, 1}, {1, 2, 3})']).error).toBeTruthy();
  });
});

describe('eigenvalues of a triangular matrix with entries far apart', () => {
  it('reads them off the diagonal', () => {
    expect(val('eigen([[1e-160, 0], [0, 1]])')).toEqual({ t: 'list', items: [1e-160, 1] });
    expect(val('eigen([[1, 0], [7, 1e-160]])')).toEqual({ t: 'list', items: [1e-160, 1] });
    expect(val('eigen([[3, 1, 2], [0, -1, 5], [0, 0, 2]])')).toEqual({ t: 'list', items: [-1, 2, 3] });
    expect(val('eigen([[4, 1], [2, 3]])')).toEqual({ t: 'list', items: [2, 5] });
  });
  it('handles non-triangular 2×2 matrices with entries far apart in size', () => {
    expect(val('eigen([[1e-160, 1e-170], [1e-170, 1]])')).toEqual({ t: 'list', items: [1e-160, 1] });
    expect(val('eigen([[0, 1e200], [1e-200, 0]])')).toEqual({ t: 'list', items: [-1, 1] });
    expect(val('eigen([[0, 1e200], [-1e-200, 0]])', CX)).toEqual({
      t: 'list',
      items: [{ t: 'complex', re: 0, im: -1 }, { t: 'complex', re: 0, im: 1 }],
    });
    expect(val('eigen([[0.1, 0.2], [0.3, 0.6]])')).toEqual({ t: 'list', items: [0, 0.7] });
    expect(val('eigen([[3, 1], [-1, 1]])')).toEqual({ t: 'list', items: [2, 2] });
    expect(val('eigen([[0.3, 0.1], [-0.1, 0.1]])')).toEqual({ t: 'list', items: [0.2, 0.2] });
  });
});

describe('inverse of a matrix with a small but exact pivot', () => {
  it('inverts a diagonal matrix with a 1e-13 entry', () => {
    expect(val('inv([[1, 0], [0, 1e-13]])')).toEqual({ t: 'matrix', m: [[1, 0], [0, 1e13]] });
    expect(val('inv([[1e-20, 0], [0, 1e-20]])')).toEqual({ t: 'matrix', m: [[1e20, 0], [0, 1e20]] });
  });
  it('skips a cancelled pivot when another row has a clean one', () => {
    expect(val('inv([[1, 1e16, 0], [1, 10000000000000002, 1], [0, 1, 0]])')).toEqual({
      t: 'matrix',
      m: [[1, 0, -1e16], [0, 0, 1], [-1, 1, -2]],
    });
  });
  it('still calls a singular matrix singular', () => {
    for (const m of ['[[1, 2], [2, 4]]', '[[0.1, 0.2], [0.3, 0.6]]', '[[1, 2, 3], [4, 5, 6], [7, 8, 9]]', '[[0, 0], [0, 0]]']) {
      expect(last([`inv(${m})`]).error).toBeTruthy();
    }
  });
});

describe('a number against a bracket of three or more', () => {
  it('multiplies, as it does against two', () => {
    expect(val('a[1, 2, 3]', DEG, ['a = 2'])).toEqual({ t: 'vector', c: [2, 4, 6] });
    expect(val('a[1, 2]', DEG, ['a = 2'])).toEqual({ t: 'vector', c: [2, 4] });
  });
  it('still reads L[2] as an item and refuses three positions on a list', () => {
    expect(n('L[2]', DEG, ['L = {5, 6, 7}'])).toBe(6);
    expect(readError(last(['L = {5, 6, 7}', 'L[1, 2, 3]']).error!)).toMatchObject({ k: 'arity', name: 'item', got: 4 });
  });
});

describe('unit phrases with a typed power', () => {
  it('converts m^2 to ft^2 as it converts m² to ft²', () => {
    expect(n('10 m^2 to ft^2')).toBeCloseTo(107.6391041671, 9);
    expect(n('10 m^2 to ft^2')).toBe(n('10 m² to ft²'));
    expect(n('2 ft^3 in m^3')).toBeCloseTo(0.05663369318, 10);
    expect(n('10 m to ft')).toBeCloseTo(32.80839895, 8);
  });
});

describe('square root of a list in Complex mode', () => {
  it('roots each item, complex or not', () => {
    expect(val('sqrt({-1, -4})', CX)).toEqual({ t: 'list', items: [{ t: 'complex', re: 0, im: 1 }, { t: 'complex', re: 0, im: 2 }] });
    expect(val('sqrt({4, -9})', CX)).toEqual({ t: 'list', items: [2, { t: 'complex', re: 0, im: 3 }] });
  });
  it('still refuses a negative item in Real mode', () => {
    expect(last(['sqrt({-1, -4})']).error).toBeTruthy();
    expect(val('sqrt({1, 4})')).toEqual({ t: 'list', items: [1, 2] });
  });
});

describe('gcd and lcm of an empty list', () => {
  it('say plainly that they need a number', () => {
    expect(err('gcd({})')).toBe('gcd needs at least one number');
    expect(err('lcm({})')).toBe('lcm needs at least one number');
    expect(n('gcd({12, 18})')).toBe(6);
    expect(n('lcm(4, 6)')).toBe(12);
  });
});

describe('a regression over 200,000 points', () => {
  it('fits instead of overflowing the call stack, and lands on the round answer', () => {
    const r = last(['x1 = [1...200000]', 'y1 = 2 * x1 + 1', 'y1 ~ m x1 + b']);
    if (r.error) throw new Error(r.error);
    const v = r.value;
    if (typeof v !== 'object' || v.t !== 'record') throw new Error(JSON.stringify(v));
    expect(v.rows.find((x) => x.label === 'm')?.value).toBe(2);
    expect(v.rows.find((x) => x.label === 'b')?.value).toBe(1);
  });
});
