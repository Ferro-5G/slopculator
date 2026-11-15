import { describe, it, expect } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { formatValue, plainValue } from '../src/engine/format';
import type { Settings } from '../src/engine/evaluator';
import type { Value } from '../src/engine/values';

const DEG: Settings = { deg: true, complex: false, sample: false };
const RAD: Settings = { deg: false, complex: false, sample: false };
const CX: Settings = { deg: true, complex: true, sample: false };
const OPTS = { places: null, exact: false, percent: false };

function run(lines: string[], settings: Settings = DEG) {
  const rows: RowInput[] = lines.map((text, i) => ({ id: String(i), kind: 'expr', text }));
  return evaluateDocument(rows, settings);
}
function val(expr: string, settings: Settings = DEG, setup: string[] = []): Value {
  const r = run([...setup, expr], settings).at(-1)!;
  if (r.error) throw new Error(`${expr}: ${r.error}`);
  return r.value!;
}
function n(expr: string, settings: Settings = DEG, setup: string[] = []): number {
  const v = val(expr, settings, setup);
  if (typeof v !== 'number') throw new Error(`${expr} gave ${JSON.stringify(v)}`);
  return v;
}
function err(expr: string, settings: Settings = DEG): string {
  const r = run([expr], settings)[0];
  if (!r.error) throw new Error(`${expr} should fail but gave ${JSON.stringify(r.value)}`);
  return r.error;
}
const fmt = (v: Value) => formatValue(v, OPTS);
/** The value of one row of a result table. */
function row(expr: string, label: string, settings: Settings = DEG, setup: string[] = []): number {
  const v = val(expr, settings, setup);
  if (typeof v !== 'object' || v.t !== 'record') throw new Error(`${expr} gave ${JSON.stringify(v)}`);
  const r = v.rows.find((x) => x.label === label);
  if (!r || typeof r.value !== 'number') throw new Error(`${expr} has no number row "${label}"`);
  return r.value;
}
function title(expr: string, settings: Settings = DEG): string {
  const v = val(expr, settings);
  if (typeof v !== 'object' || v.t !== 'record') throw new Error(`${expr} gave ${JSON.stringify(v)}`);
  return v.title;
}
function nums(expr: string, settings: Settings = DEG, setup: string[] = []): number[] {
  const v = val(expr, settings, setup);
  if (typeof v !== 'object' || v.t !== 'list') throw new Error(`${expr} gave ${JSON.stringify(v)}`);
  return v.items.map((x) => x as number);
}
function graphF(line: string, setup: string[] = [], settings: Settings = RAD): (x: number) => number {
  const r = run([...setup, line], settings).at(-1)!;
  if (r.error) throw new Error(`${line}: ${r.error}`);
  const g = r.graph[0];
  if (!g || g.type !== 'fx') throw new Error(`${line} did not graph as y = f(x)`);
  return g.f;
}

describe('calculus', () => {
  it('deriv at a point', () => {
    expect(n('deriv(t^3, t, 2)')).toBeCloseTo(12, 12);
    expect(n('deriv(e^t, t, 1)')).toBeCloseTo(Math.E, 12);
    expect(n('deriv(ln(t), t, 4)')).toBeCloseTo(0.25, 12);
    expect(n('deriv(sin(t), t, 1)', RAD)).toBeCloseTo(Math.cos(1), 12);
    expect(n('deriv(1/t, t, -2)')).toBeCloseTo(-0.25, 12);
    expect(n('deriv(sin(100t), t, 1)', RAD) / (100 * Math.cos(100))).toBeCloseTo(1, 11);
    expect(n('deriv(1000t^2, t, 0)')).toBe(0);
    expect(n('deriv(f(t), t, 3)', DEG, ['f(x) = x^2 + 1'])).toBeCloseTo(6, 12);
    expect(n('deriv(a t^2, t, 1)', DEG, ['a = 5'])).toBeCloseTo(10, 12);
  });
  it('deriv2', () => {
    expect(n('deriv2(t^4, t, 2)')).toBeCloseTo(48, 8);
    expect(n('deriv2(sin(t), t, 1)', RAD)).toBeCloseTo(-Math.sin(1), 8);
    expect(n('deriv2(e^(2t), t, 0)')).toBeCloseTo(4, 8);
  });
  it('deriv fails at corners, cusps, and holes', () => {
    expect(err('deriv(|t|, t, 0)')).toMatch(/corner/);
    expect(err('deriv(t^(1/3), t, 0)')).toMatch(/doesn't settle|vertical tangent|corner/);
    expect(err('deriv(ln(t), t, -1)')).toMatch(/isn't defined at t = -1/);
    expect(err('deriv(t^2, t)')).toMatch(/needs a point/);
  });
  it('notes Deg mode when trig is inside', () => {
    expect(run(['deriv(sin(t), t, 0)'])[0].notes.join()).toMatch(/Deg mode/);
    expect(n('deriv(sin(t), t, 0)')).toBeCloseTo(Math.PI / 180, 12);
  });
  it('graphs with x as the point', () => {
    const f = graphF('y = deriv(t^3, t, x)');
    expect(f(2)).toBeCloseTo(12, 10);
    expect(f(-1)).toBeCloseTo(3, 10);
    const g = graphF('y = deriv(x^3, x)');
    expect(g(2)).toBeCloseTo(12, 10);
    const h = graphF('y = deriv2(x^3, x)');
    expect(h(2)).toBeCloseTo(12, 7);
    const k = graphF('g(x) = deriv(x^2, x)');
    expect(k(3)).toBeCloseTo(6, 10);
    expect(run(['y = deriv(|t|, t, x)'], RAD)[0].graph[0].type).toBe('fx');
    expect(graphF('y = deriv(|t|, t, x)')(0)).toBeNaN();
  });
  it('integral on finite intervals', () => {
    expect(n('integral(t^2, t, 0, 3)')).toBeCloseTo(9, 12);
    expect(n('integral(sin(t), t, 0, π)', RAD)).toBeCloseTo(2, 12);
    expect(n('integral(t, t, 3, 0)')).toBeCloseTo(-4.5, 12);
    expect(n('integral(t, t, 2, 2)')).toBe(0);
    expect(n('integral(1/sqrt(t), t, 0, 1)')).toBeCloseTo(2, 12);
    expect(n('integral(1/sqrt(1 - t^2), t, -1, 1)')).toBeCloseTo(Math.PI, 12);
    expect(n('integral(ln(t), t, 0, 1)')).toBeCloseTo(-1, 12);
    expect(n('integral(e^t, t, 0, 1)')).toBeCloseTo(Math.E - 1, 12);
  });
  it('integral with infinite bounds', () => {
    expect(n('integral(e^(-t^2), t, -inf, inf)')).toBeCloseTo(Math.sqrt(Math.PI), 11);
    expect(n('integral(1/t^2, t, 1, inf)')).toBeCloseTo(1, 11);
    expect(n('integral(e^t, t, -inf, 0)')).toBeCloseTo(1, 11);
    expect(n('integral(normalpdf(t), t, -inf, 1.5)')).toBeCloseTo(0.933192798731142, 11);
    expect(n('integral(1/(1 + t^2), t, -inf, inf)')).toBeCloseTo(Math.PI, 12);
    expect(n('integral(e^(-t)/sqrt(t), t, 0, inf)')).toBeCloseTo(Math.sqrt(Math.PI), 12);
  });
  it('integral errors', () => {
    expect(err('integral(1/t, t, 1, inf)')).toMatch(/did not settle/);
    expect(err('integral(1/t, t, 0, 1)')).toMatch(/did not settle/);
    expect(err('integral(1/(1 + t), t, -1, 1)')).toMatch(/did not settle/);
    expect(err('integral(sin(t)/t, t, 0, inf)')).toMatch(/did not settle/);
    expect(err('integral(1/t, t, -1, 1)')).toMatch(/fails near 0/);
    expect(err('integral(ln(t), t, -2, 1)')).toMatch(/isn't defined everywhere/);
    expect(err('integral(t, t, 0)')).toMatch(/takes 4 inputs/);
  });
  it('integral graphs as an accumulation function', () => {
    const f = graphF('y = integral(t, t, 0, x)');
    expect(f(2)).toBeCloseTo(2, 12);
    expect(f(-3)).toBeCloseTo(4.5, 12);
  });
  it('solve inside a graph now binds its own variable', () => {
    expect(n('solve(x^2 = 4, x, 1)')).toBeCloseTo(2, 12);
  });
});

describe('regression', () => {
  const XY = ['X = {1, 2, 3, 4, 5}', 'Y = {2, 4, 5, 4, 5}'];
  it('linreg', () => {
    expect(row('linreg(X, Y)', 'a', DEG, XY)).toBeCloseTo(0.6, 14);
    expect(row('linreg(X, Y)', 'b', DEG, XY)).toBeCloseTo(2.2, 14);
    expect(row('linreg(X, Y)', 'r', DEG, XY)).toBeCloseTo(6 / Math.sqrt(60), 14);
    expect(row('linreg(X, Y)', 'r²', DEG, XY)).toBeCloseTo(0.6, 14);
    expect(row('linreg({1, 2, 3, 4}, {3, 5, 7, 9})', 'r')).toBe(1);
  });
  it('quadreg, expreg, powreg, lnreg', () => {
    const q = 'quadreg({0, 1, 2, 3}, {3, 2, 3, 6})';
    expect(row(q, 'a')).toBeCloseTo(1, 12);
    expect(row(q, 'b')).toBeCloseTo(-2, 12);
    expect(row(q, 'c')).toBeCloseTo(3, 12);
    expect(row(q, 'R²')).toBeCloseTo(1, 12);
    expect(row('expreg({0, 1, 2, 3}, {3, 6, 12, 24})', 'a')).toBeCloseTo(3, 12);
    expect(row('expreg({0, 1, 2, 3}, {3, 6, 12, 24})', 'b')).toBeCloseTo(2, 12);
    expect(row('powreg({1, 2, 3}, {2, 16, 54})', 'a')).toBeCloseTo(2, 12);
    expect(row('powreg({1, 2, 3}, {2, 16, 54})', 'b')).toBeCloseTo(3, 12);
    expect(row('lnreg({1, e, e^2}, {1, 3, 5})', 'a')).toBeCloseTo(1, 12);
    expect(row('lnreg({1, e, e^2}, {1, 3, 5})', 'b')).toBeCloseTo(2, 12);
  });
  it('corr and covariance', () => {
    expect(n('corr(X, Y)', DEG, XY)).toBeCloseTo(0.7745966692414834, 14);
    expect(n('covp(X, Y)', DEG, XY)).toBeCloseTo(1.2, 14);
    expect(n('covs(X, Y)', DEG, XY)).toBeCloseTo(1.5, 14);
    expect(n('cov(X, Y)', DEG, XY)).toBeCloseTo(1.2, 14);
    expect(n('cov(X, Y)', { ...DEG, sample: true }, XY)).toBeCloseTo(1.5, 14);
  });
  it('errors', () => {
    expect(err('linreg({1, 2}, {1, 2, 3})')).toMatch(/same length/);
    expect(err('linreg({2, 2, 2}, {1, 2, 3})')).toMatch(/All x values are the same/);
    expect(err('expreg({1, 2}, {1, -2})')).toMatch(/positive/);
    expect(err('quadreg({1, 1, 1}, {1, 2, 3})')).toMatch(/3 different x values/);
  });
});

describe('distributions and special functions', () => {
  it('gamma, lgamma, beta, erf', () => {
    expect(n('gamma(5)')).toBe(24);
    expect(n('gamma(0.5)')).toBeCloseTo(Math.sqrt(Math.PI), 14);
    expect(n('gamma(1.5)')).toBeCloseTo(Math.sqrt(Math.PI) / 2, 14);
    expect(n('gamma(-0.5)')).toBeCloseTo(-2 * Math.sqrt(Math.PI), 13);
    expect(n('gamma(1.3)')).toBeCloseTo(0.8974706963062772, 14);
    expect(n('gamma(10.3) / (gamma(1.3) prod(k + 0.3, k, 1, 9))')).toBeCloseTo(1, 12);
    expect(n('lgamma(100)')).toBeCloseTo(359.1342053695754, 10);
    expect(n('lgamma(0.5)')).toBeCloseTo(0.5723649429247001, 14);
    expect(n('beta(2, 3)')).toBeCloseTo(1 / 12, 15);
    expect(n('beta(0.5, 0.5)')).toBeCloseTo(Math.PI, 13);
    expect(n('erf(1)')).toBeCloseTo(0.8427007929497149, 15);
    expect(n('erfc(2)') / 0.004677734981047266).toBeCloseTo(1, 12);
    expect(err('gamma(0)')).toMatch(/undefined at 0/);
    expect(err('gamma(-3)')).toMatch(/undefined/);
    expect(err('gamma(200)')).toMatch(/too large/);
  });
  it('Student t', () => {
    // df = 1 is the Cauchy distribution and df = 2 has a closed form.
    expect(n('tcdf(-inf, 2, 1)')).toBeCloseTo(0.5 + Math.atan(2) / Math.PI, 14);
    expect(n('tcdf(1, 2)')).toBeCloseTo(0.5 + 1 / (2 * Math.sqrt(3)), 14);
    expect(n('tcdf(-1, 1, 1)')).toBeCloseTo(0.5, 14);
    expect(n('tcdf(-inf, inf, 7)')).toBe(1);
    // With a million degrees of freedom t is within about 3·10⁻⁷ of the normal here.
    expect(n('tcdf(-1.96, 1.96, 1e6)')).toBeCloseTo(n('normalcdf(-1.96, 1.96)'), 6);
    expect(n('tcdf(-30, 2)') / (0.5 - 30 / (2 * Math.sqrt(902)))).toBeCloseTo(1, 10);
    expect(n('tpdf(0, 1)')).toBeCloseTo(1 / Math.PI, 15);
    expect(n('tpdf(1, 2)')).toBeCloseTo(3 ** -1.5, 15);
    expect(n('invT(0.9, 1)')).toBeCloseTo(Math.tan(0.4 * Math.PI), 12);
    expect(n('invT(0.975, 2)')).toBeCloseTo(Math.sqrt((2 * 0.95 ** 2) / (1 - 0.95 ** 2)), 12);
    expect(n('invT(0.025, 2)')).toBeCloseTo(-Math.sqrt((2 * 0.95 ** 2) / (1 - 0.95 ** 2)), 12);
    expect(n('invT(0.5, 9)')).toBe(0);
    for (const t of [-4, -1.2, 0.3, 2.5]) expect(n(`invT(tcdf(${t}, 7), 7)`)).toBeCloseTo(t, 10);
    expect(err('tcdf(1, 0)')).toMatch(/df must be positive/);
    expect(err('invT(1.5, 3)')).toMatch(/between 0 and 1/);
  });
  it('chi-square and F', () => {
    expect(n('chi2cdf(3, 2)')).toBeCloseTo(1 - Math.exp(-1.5), 15);
    expect(n('chi2cdf(0, 1.959963984540054^2, 1)')).toBeCloseTo(0.95, 13);
    expect(n('chi2cdf(2, 6, 4)')).toBeCloseTo(2 * Math.exp(-1) - 4 * Math.exp(-3), 14);
    expect(n('chi2cdf(40, inf, 4)')).toBeCloseTo(Math.exp(-20) * 21, 20);
    expect(n('chi2pdf(2, 2)')).toBeCloseTo(0.5 * Math.exp(-1), 15);
    expect(n('chi2pdf(1, 1)')).toBeCloseTo(Math.exp(-0.5) / Math.sqrt(2 * Math.PI), 15);
    expect(n('Fpdf(1, 2, 2)')).toBeCloseTo(0.25, 15);
    expect(n('Fcdf(3, 2, 2)')).toBeCloseTo(0.75, 14);
    expect(n('Fcdf(1, 3, 2, 2)')).toBeCloseTo(0.25, 14);
    expect(n('Fcdf(1, 1, 1)')).toBeCloseTo(0.5, 14);
    expect(n('Fcdf(4, 1, 2)')).toBeCloseTo(2 / Math.sqrt(6), 13);
  });
  it('discrete and uniform', () => {
    expect(n('poissonpdf(3, 2)')).toBeCloseTo(4.5 * Math.exp(-3), 15);
    expect(n('poissoncdf(3, 2)')).toBeCloseTo(8.5 * Math.exp(-3), 15);
    expect(n('poissoncdf(3, -1)')).toBe(0);
    expect(n('poissonpdf(0, 0)')).toBe(1);
    expect(n('poissonpdf(3, 2.5)')).toBe(0);
    expect(n('geompdf(0.2, 3)')).toBeCloseTo(0.128, 15);
    expect(n('geomcdf(0.2, 3)')).toBeCloseTo(0.488, 15);
    expect(n('uniformcdf(2, 4, 0, 10)')).toBe(0.2);
    expect(n('uniformcdf(5, 0, 10)')).toBe(0.5);
    expect(n('uniformpdf(3, 0, 4)')).toBe(0.25);
    expect(err('poissonpdf(-1, 2)')).toMatch(/0 or more/);
    expect(err('geompdf(0, 2)')).toMatch(/above 0/);
  });
  it('probability results show as percents', () => {
    const r = run(['geomcdf(0.2, 3)'])[0];
    expect(r.prob).toBe(true);
    expect(formatValue(r.value!, { ...OPTS, percent: true }, r.prob)).toBe('48.8%');
  });
});

describe('number theory', () => {
  it('isprime', () => {
    expect(nums('seq(isprime(k), k, 0, 12)')).toEqual([0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0]);
    expect(n('isprime(2147483647)')).toBe(1);
    expect(n('isprime(9007199254740881)')).toBe(1);
    expect(n('isprime(9007199254740991)')).toBe(0);
    expect(n('isprime(3215031751)')).toBe(0);
    expect(n('isprime(-7)')).toBe(0);
  });
  it('factor', () => {
    expect(title('factor(360)')).toBe('360 = 2³ · 3² · 5');
    expect(row('factor(360)', '2')).toBe(3);
    expect(title('factor(97)')).toBe('97 is prime');
    expect(title('factor(600851475143)')).toBe('600851475143 = 71 · 839 · 1471 · 6857');
    expect(title('factor(9007199254740991)')).toBe('9007199254740991 = 6361 · 69431 · 20394401');
    expect(title('factor(1)')).toBe('1 has no prime factors');
    expect(err('factor(0)')).toMatch(/≥ 1/);
    expect(err('factor(2.5)')).toMatch(/whole number/);
    expect(err('factor(2^60)')).toMatch(/too large/);
  });
  it('divisors, totient, quot, rem', () => {
    expect(nums('divisors(12)')).toEqual([1, 2, 3, 4, 6, 12]);
    expect(nums('divisors(1)')).toEqual([1]);
    expect(n('totient(36)')).toBe(12);
    expect(n('totient(97)')).toBe(96);
    expect(n('totient(1)')).toBe(1);
    expect(n('quot(17, 5)')).toBe(3);
    expect(n('rem(17, 5)')).toBe(2);
    expect(n('quot(-7, 3)')).toBe(-2);
    expect(n('rem(-7, 3)')).toBe(-1);
    expect(n('mod(-7, 3)')).toBe(2);
    expect(err('rem(4, 0)')).toMatch(/by zero/);
  });
});

describe('polynomials', () => {
  it('real roots', () => {
    expect(nums('roots(1, -6, 11, -6)')).toEqual([1, 2, 3]);
    const r = nums('roots({1, 0, -2})');
    expect(r[0]).toBeCloseTo(-Math.SQRT2, 15);
    expect(r[1]).toBeCloseTo(Math.SQRT2, 15);
    expect(n('roots(1, -2, 1)')).toBe(1);
    expect(n('roots(1, -3, 3, -1)')).toBe(1);
    expect(nums('roots(1, 0, -1, 0)')).toEqual([-1, 0, 1]);
    expect(n('roots(2, -3)')).toBe(1.5);
    expect(nums('roots([1, -5, 6])')).toEqual([2, 3]);
  });
  it('a quintic and a degree-10 product', () => {
    const r = n('roots(1, 0, 0, 0, -1, -1)');
    expect(Math.abs(r ** 5 - r - 1)).toBeLessThan(1e-14);
    let c = [1];
    for (let k = 1; k <= 10; k++) c = [...c, 0].map((x, i) => x - k * (i > 0 ? c[i - 1] : 0));
    const got = nums(`roots({${c.join(', ')}})`);
    got.forEach((x, i) => expect(x).toBeCloseTo(i + 1, 8));
  });
  it('complex roots', () => {
    const r = run(['roots(1, 0, 0, -8)'])[0];
    expect(r.value).toBe(2);
    expect(r.notes.join()).toMatch(/2 complex roots/);
    expect(err('roots(1, 0, 1)')).toMatch(/No real roots.*Complex mode/);
    expect(fmt(val('roots(1, 0, 1)', CX))).toBe('{−i, i}');
    const v = val('roots(1, 0, 0, -8)', CX);
    expect(fmt(v)).toMatch(/^\{2, −1 − 1\.7320508\d+i, −1 \+ 1\.7320508\d+i\}$/);
    expect(err('roots(5)')).toMatch(/degree 1 or more/);
  });
  it('polyval', () => {
    expect(n('polyval({1, -3, 2}, 5)')).toBe(12);
    expect(nums('polyval({1, 0}, {1, 2, 3})')).toEqual([1, 2, 3]);
    expect(n('polyval({1, 0, 1}, i)', CX)).toBe(0);
  });
});

describe('geometry', () => {
  it('points', () => {
    expect(n('distance((0, 0), (3, 4))')).toBe(5);
    expect(n('distance((1, 2, 3), (4, 6, 3))')).toBe(5);
    expect(fmt(val('midpoint((0, 0), (4, 6))'))).toBe('(2, 3)');
    expect(n('slope((1, 2), (3, 8))')).toBe(3);
    expect(err('slope((1, 2), (1, 5))')).toMatch(/vertical/);
    expect(err('distance((0, 0), (1, 2, 3))')).toMatch(/same size/);
  });
  it('polygons and circles', () => {
    expect(n('area((0, 0), (4, 0), (4, 3))')).toBe(6);
    expect(n('area(polygon((0, 0), (2, 0), (2, 2), (0, 2)))')).toBe(4);
    expect(n('area({(0, 0), (4, 0), (0, 3)})')).toBe(6);
    expect(n('perimeter((0, 0), (4, 0), (4, 3))')).toBe(12);
    expect(n('circlearea(2)')).toBeCloseTo(4 * Math.PI, 14);
    expect(n('circumference(1)')).toBeCloseTo(2 * Math.PI, 14);
    expect(err('area((0, 0), (1, 1))')).toMatch(/at least 3/);
    expect(err('circlearea(-1)')).toMatch(/negative/);
  });
});

describe('finance', () => {
  it('interest, loans, annuities', () => {
    expect(n('simple(1000, 0.05, 3)')).toBe(1150);
    const r = 0.05 / 12;
    expect(n('pmt(0.05/12, 360, 200000)')).toBeCloseTo((200000 * r) / (1 - (1 + r) ** -360), 9);
    expect(n('pmt(0, 12, 1200)')).toBe(100);
    expect(n('fvannuity(0.05, 10, 100)')).toBeCloseTo((100 * (1.05 ** 10 - 1)) / 0.05, 10);
    expect(n('pvannuity(0.05, 10, 100)')).toBeCloseTo((100 * (1 - 1.05 ** -10)) / 0.05, 10);
    expect(n('pctchange(50, 75)')).toBe(50);
    expect(n('pctchange(80, 60)')).toBe(-25);
    expect(err('pctchange(0, 5)')).toMatch(/from 0/);
    expect(err('pmt(0.01, 0, 100)')).toMatch(/periods must be positive/);
  });
});

describe('text, bases, units', () => {
  it('string literals', () => {
    expect(val('"km"')).toEqual({ t: 'text', s: 'km' });
    expect(val('“curly”')).toEqual({ t: 'text', s: 'curly' });
    expect(fmt(val('"km"'))).toBe('"km"');
    expect(plainValue(val('"km"'), OPTS)).toBe('km');
    expect(err('"km')).toMatch(/closing quote/);
    expect(err('"a" + 1')).toMatch(/Can't use \+/);
    expect(err('sin("a")')).toMatch(/got a text string/);
  });
  it('base conversion', () => {
    expect(val('hex(255)')).toEqual({ t: 'text', s: 'FF' });
    expect(plainValue(val('bin(10)'), OPTS)).toBe('1010');
    expect(plainValue(val('oct(8)'), OPTS)).toBe('10');
    expect(plainValue(val('base(35, 36)'), OPTS)).toBe('Z');
    expect(plainValue(val('base(-10, 2)'), OPTS)).toBe('-1010');
    expect(fmt(val('hex({10, 255})'))).toBe('{"A", "FF"}');
    expect(n('dec("ff", 16)')).toBe(255);
    expect(n('dec("0xff")')).toBe(255);
    expect(n('dec("0b101")')).toBe(5);
    expect(n('dec(1010, 2)')).toBe(10);
    expect(n('dec("1.1", 2)')).toBe(1.5);
    expect(n('dec(hex(48879), 16)')).toBe(48879);
    expect(err('dec("g", 16)')).toMatch(/"g" isn't a digit in base 16/);
    expect(err('hex(1.5)')).toMatch(/whole number/);
    expect(err('base(5, 1)')).toMatch(/2 to 36/);
  });
  it('convert', () => {
    expect(n('convert(5, "mi", "km")')).toBe(8.04672);
    expect(n('convert(212, "°F", "°C")')).toBe(100);
    expect(n('convert(98.6, "F", "C")')).toBe(37);
    expect(n('convert(0, "C", "F")')).toBe(32);
    expect(n('convert(300, "K", "C")')).toBe(26.85);
    expect(n('convert(1, "gal", "L")')).toBe(3.785411784);
    expect(n('convert(1, "acre", "ft2")')).toBe(43560);
    expect(n('convert(60, "mph", "km/h")')).toBe(96.56064);
    expect(n('convert(1, "GiB", "MB")')).toBe(1073.741824);
    expect(n('convert(180, "deg", "rad")')).toBeCloseTo(Math.PI, 15);
    expect(n('convert(1, "day", "h")')).toBe(24);
    expect(n('convert(1, "lb", "oz")')).toBe(16);
    expect(n('convert(1, "ft³", "in³")')).toBe(1728);
    expect(nums('convert({1, 2}, "km", "m")')).toEqual([1000, 2000]);
    expect(n('convert(1, u, "cm")', DEG, ['u = "in"'])).toBe(2.54);
  });
  it('convert errors', () => {
    expect(err('convert(5, "mi", "kg")')).toMatch(/Can't convert mi \(length\) to kg \(mass\)/);
    expect(err('convert(5, mi, km)')).toMatch(/quotes/);
    expect(err('convert(1, "gb", "MB")')).toMatch(/ambiguous/);
    expect(err('convert(1, "xyz", "m")')).toMatch(/Unknown unit "xyz"/);
  });
});

describe('more stats', () => {
  const L = ['L = {2, 4, 4, 4, 5, 5, 7, 9}'];
  it('percentiles and quartiles', () => {
    expect(n('percentile({1, 2, 3, 4, 5}, 50)')).toBe(3);
    expect(n('percentile({1, 2, 3, 4}, 25)')).toBe(1.75);
    expect(n('percentile({1, 2, 3, 4}, 100)')).toBe(4);
    expect(row('quartiles(L)', 'Q1', DEG, L)).toBe(4);
    expect(row('quartiles(L)', 'Q3', DEG, L)).toBe(6);
    expect(row('quartiles(L)', 'IQR', DEG, L)).toBe(2);
    expect(err('percentile({1, 2}, 150)')).toMatch(/0 to 100/);
  });
  it('means and spread', () => {
    expect(n('gmean({1, 4, 16})')).toBe(4);
    expect(n('hmean({1, 2, 4})')).toBeCloseTo(12 / 7, 15);
    expect(n('wmean({90, 80}, {3, 1})')).toBe(87.5);
    expect(n('mad({2, 4, 6, 8})')).toBe(2);
    expect(nums('zscores(L)', DEG, L)).toEqual([-1.5, -0.5, -0.5, -0.5, 0, 0, 1, 2]);
    expect(nums('cumsum({1, 2, 3, 4})')).toEqual([1, 3, 6, 10]);
    expect(nums('dedupe({3, 1, 3, 2, 1})')).toEqual([3, 1, 2]);
    expect(err('gmean({1, -2})')).toMatch(/positive/);
    expect(err('zscores({3, 3, 3})')).toMatch(/SD is 0/);
  });
});

describe('matrix extras', () => {
  it('trace, rank, augment', () => {
    expect(n('trace([[1,2],[3,4]])')).toBe(5);
    expect(n('rank([[1,2],[2,4]])')).toBe(1);
    expect(n('rank(identity(3))')).toBe(3);
    expect(n('rank([[1,2,3],[4,5,6],[7,8,9]])')).toBe(2);
    expect(fmt(val('augment([[1,2],[3,4]], [5,6])'))).toBe('[[1, 2, 5], [3, 4, 6]]');
    expect(fmt(val('augment([[1,2],[3,4]], identity(2))'))).toBe('[[1, 2, 1, 0], [3, 4, 0, 1]]');
    expect(err('trace([[1,2,3],[4,5,6]])')).toMatch(/square/);
    expect(err('augment([[1,2]], [[1],[2]])')).toMatch(/same number of rows/);
  });
  it('eigenvalues', () => {
    expect(nums('eigen([[2,0],[0,3]])')).toEqual([2, 3]);
    expect(nums('eigen([[4,1],[2,3]])')).toEqual([2, 5]);
    expect(nums('eigen([[2,0,0],[0,3,4],[0,4,9]])')).toEqual([1, 2, 11]);
    expect(nums('eigen(identity(2))')).toEqual([1, 1]);
    const e = nums('eigen([[2,1,0],[1,2,1],[0,1,2]])');
    [2 - Math.SQRT2, 2, 2 + Math.SQRT2].forEach((x, i) => expect(e[i]).toBeCloseTo(x, 12));
    expect(err('eigen([[0,-1],[1,0]])')).toMatch(/complex eigenvalues.*Complex mode/);
    expect(fmt(val('eigen([[0,-1],[1,0]])', CX))).toBe('{−i, i}');
    expect(err('eigen(identity(4))')).toMatch(/2×2 and 3×3/);
  });
  it('A^n already covers matrix powers', () => {
    expect(fmt(val('[[1,1],[1,0]]^10'))).toBe('[[89, 55], [55, 34]]');
  });
});

describe('complex helpers', () => {
  it('parts, conjugate, angle', () => {
    expect(n('re(3 + 4i)', CX)).toBe(3);
    expect(n('im(3 + 4i)', CX)).toBe(4);
    expect(fmt(val('conj(3 + 4i)', CX))).toBe('3 − 4i');
    expect(n('arg(i)', CX)).toBe(90);
    expect(n('arg(-1)', CX)).toBe(180);
    expect(n('arg(1 + i)', { ...CX, deg: false })).toBeCloseTo(Math.PI / 4, 15);
    expect(n('re(5)')).toBe(5);
    expect(n('im(5)')).toBe(0);
    expect(nums('re({1 + i, 2})', CX)).toEqual([1, 2]);
    expect(row('polar(1 + i)', 'r', CX)).toBeCloseTo(Math.SQRT2, 15);
    expect(row('polar(1 + i)', 'θ', CX)).toBe(45);
    expect(err('arg(0)')).toMatch(/undefined/);
  });
});

describe('names next to the new functions', () => {
  it('a bare built-in name still splits into known letters', () => {
    expect(n('re', DEG, ['r = 2'])).toBeCloseTo(2 * Math.E, 14);
    expect(n('re^2', DEG, ['r = 2'])).toBeCloseTo(2 * Math.E ** 2, 13);
    expect(err('re')).toMatch(/re is a function/);
    // With x free it graphs: e·x·p.
    const r = run(['p = 2', 'exp']);
    expect((r[1].graph[0] as { f: (x: number) => number }).f(3)).toBeCloseTo(6 * Math.E, 12);
  });
  it('beta(a, b) works even though "beta" is also spelled β', () => {
    expect(n('β(2, 3)')).toBeCloseTo(1 / 12, 15);
    expect(n('β(2)', DEG, ['β = 3'])).toBe(6);
  });
});
