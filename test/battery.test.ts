import { describe, expect, it } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { formatValue } from '../src/engine/format';
import { readError } from '../src/engine/errors';
import type { Settings } from '../src/engine/evaluator';

// Math typed the way students and engineers type it, each checked against a known value. Lines split by \n share a
// sheet and the last one is checked. A number is compared to 1e-9, a string to the answer as shown, { graph } to the
// line's first graph item, { hint } to the name an unknown-name error suggests, and 'error' to any error.
type Want = number | string | 'error' | { graph: string } | { hint: string };
type Mode = '' | 'rad' | 'complex' | 'exact' | 'plain%';
type Case = [string, Want, Mode?];

function check([text, want, mode = '']: Case): void {
  const settings: Settings = { deg: mode !== 'rad', complex: mode === 'complex', sample: false, percentOf: mode !== 'plain%' };
  const rows: RowInput[] = text.split('\n').map((line, i) => ({ id: String(i), kind: 'expr', text: line }));
  const r = evaluateDocument(rows, settings).at(-1)!;
  if (want === 'error') return void expect(r.error, text).toBeTruthy();
  if (typeof want === 'object' && 'hint' in want) {
    const form = readError(r.error ?? '');
    return void expect(form.k === 'unknown' ? form.hint : r.error, text).toBe(want.hint);
  }
  expect(r.error, text).toBeUndefined();
  if (typeof want === 'number') {
    expect(typeof r.value, text).toBe('number');
    return void expect(Math.abs((r.value as number) - want), text).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)));
  }
  if (typeof want === 'string') return void expect(formatValue(r.value!, { places: null, exact: mode === 'exact', percent: false }, false, r.precise), text).toBe(want);
  expect(r.graph[0]?.type, text).toBe(want.graph);
}

const table = (cases: Case[]) => it.each(cases.map((c) => [c[0] + (c[2] ? ` (${c[2]})` : ''), c] as const))('%s', (_, c) => check(c));

describe('a function name typed against its input', () => {
  table([
    ['sin30', 0.5], ['cos45', Math.SQRT1_2], ['sin30+1', 1.5], ['a=15\nsin2a', 0.5], ['tan45°', 1],
    ['ln2', Math.LN2], ['log100', 2], ['sqrt16', 4], ['cbrt27', 3], ['y = sinx', { graph: 'fx' }], ['y = 2lnx', { graph: 'fx' }],
    ['log2(8)', 3], ['log10(1000)', 3], ['log₂(8)', 3], ['log₂ 8', 3], ['log_0.5(4)', -2], ['log2', Math.log10(2)],
    ['atan2(1, 1)', 45], ['atan2 (1, 1)', 45], ['log2 (8)', 3], ['a1 = 2\na1 * 3', 6],
  ]);
});

describe('one-input functions without brackets', () => {
  table([
    ['ln e', 1], ['log 1000', 3], ['ln e^2', 2], ['sqrt 16', 4], ['cbrt 27', 3], ['abs -5', 5], ['sin -30', -0.5],
    ['floor 2.7', 2], ['round 2.5', 3], ['exp 0', 1], ['sqrt 16 + 9', 13], ['2 sin 30', 1], ['sin 30 cos 60', 0.25],
    ['a=15\n2sin a cos a', 0.5], ['sin^2(30) + cos^2(30)', 1], ['sin^-1(0.5)', 30], ['y = sqrt x', { graph: 'fx' }],
  ]);
});

describe('roots', () => {
  table([
    ['∛-8', -2], ['√--4', 2], ['√-9', '3i', 'complex'], ['√-4', 'error'], ['√4!', Math.sqrt(24)], ['√(4)!', 2],
    ['√16+9', 13], ['3√4', 6], ['√4√9', 6], ['nthroot(-32, 5)', -2], ['nthroot(-16, 4)', 'error'], ['√(3²+4²)', 5],
  ]);
});

describe('words between numbers', () => {
  table([
    ['10% of 50', 5], ['15% of 200', 30], ['20% of 50 + 5', 15], ['5 + 20% of 50', 15], ['2 * 10% of 50', 10], ['-10% of 50', -5], ['10% of 50', 5, 'plain%'],
    ['5 mod 3', 2], ['-7 mod 3', 2], ['10 mod 4 + 1', 3], ['2^3 mod 3', 2], ['7.5 mod 2', 1.5],
    ['5 choose 2', 10], ['5C2', 10], ['52C5', 2598960], ['10P3', 720], ['5C2 + 1', 11], ['C = 3\n2C', 6],
  ]);
});

describe('digit groups and number forms', () => {
  table([
    ['1 000 000', 1e6], ['12 000', 12000], ['123 456 789', 123456789], ['-1 000', -1000], ['1 000.5', 1000.5],
    ['1 000 * 2', 2000], ['{1 000, 2}', '{1000, 2}'], ['a = 1 000\na', 1000], ['2 3', 6], ['1234 567', 1234 * 567],
    ['1,000', 'error'], ['6.02×10^23', 6.02e23], ['2.5E-4', 0.00025], ['1.2e+3', 1200], ['.5', 0.5], ['5.', 5],
    ['2e', 2 * Math.E], ['1e-20 + 1', 1], ['2^-1074', 5e-324],
  ]);
});

describe('units written out in words', () => {
  table([
    ['5 mi to km', 8.04672], ['5 mi in km', 8.04672], ['72 F to C', 200 / 9], ['100 C to F', 212], ['1,500 ft to m', 457.2],
    ['3 ft in in', 36], ['5 kg to lb', 11.023113109243878], ['5 mi to kg', 'error'],
  ]);
});

describe('solve and equations', () => {
  table([
    ['solve(3x = 12)', 4], ['solve(x^2 = 9)', '{−3, 3}'], ['solve(x^3 - x = 0, x)', '{−1, 0, 1}'],
    ['solve(e^x = 5, x)', Math.log(5)], ['solve(t^2 = 9, t)', '{−3, 3}'], ['solve(t^2 = 9)', '{−3, 3}'], ['a = 2\nsolve(a t = 8)', 4], ['a = 2\nsolve(at = 8)', 4], ['solve(sum(t k, k, 1, 3) = 12)', 2], ['solve(price = 12)', 12], ['solve(2 speed = 12)', 6], ['solve(x^2 + 1 = 0, x)', 'error'],
    ['xy = 1', { graph: 'implicit' }], ['x^2/9 + y^2/4 = 1', { graph: 'implicit' }], ['3x + 2y < 6', { graph: 'implicit' }],
    ['y - 2 = 3(x - 1)', { graph: 'implicit' }], ['y ≥ 2x', { graph: 'fx' }], ['x = y^2', { graph: 'fy' }],
    ['y = x^2 - 4 {-2 < x < 2}', { graph: 'fx' }], ['f(x) = x^2\ny = f(x)', { graph: 'fx' }],
  ]);
});

describe('names in the wrong case are read as the name, and one capital letter gets a hint', () => {
  table([
    ['Sin(30)', 0.5], ['Ln(e)', 1], ['PI*2', 2 * Math.PI], ['Pi', Math.PI], ['SQRT(16)', 4], ['E', { hint: 'e' }],
  ]);
});

describe('everyday math', () => {
  table([
    ['6/2(1+2)', 1], ['6 ÷ 2(1+2)', 1], ['6/2*(1+2)', 9], ['a=2\n1/2a', 0.25], ['a=2\n1/2*a', 1], ['2^-1^2', 0.5], ['-3!', -6], ['3!^2', 36], ['2^3!', 64], ['3!!', 720], ['2-−3', 5],
    ['(-8)^(1/3)', -2], ['0^0', 1], ['0/0', 'error'], ['2(5)!', 240], ['|2-|3-5||', 0], ['||-1|-2|', 1], ['|-3|!', 6],
    ['2·3', 6], ['2¹⁰', 1024], ['τ', 2 * Math.PI], ['r=2\nπr^2', 4 * Math.PI], ['r=3\nV=4/3*πr^3\nV', 36 * Math.PI], ['r=3\n4/3πr^3', 4 / (81 * Math.PI)],
    ['a=2\nb=3\n2ab', 12], ['3 * 4 5', 60], ['25% + 25%', 0.3125], ['50 + 10% - 10%', 49.5], ['(80)(15%)', 12],
    ['sin(30)', Math.sin(30), 'rad'], ['180°', Math.PI, 'rad'], ['tan(90)', 'error'], ['acos(-1)', 180], ['csc 30', 2],
    ['avg(2, 4)', 3], ['average({1, 2, 3})', 2], ['mean({1, 2, 3, 4, 100})', 22], ['median({1, 2, 3, 4, 100})', 3],
    ['mode({1,1,2,2,3})', '{1, 2}'], ['sds({1,2,3,4})', Math.sqrt(5 / 3)], ['stdev({1,2,3,4})', Math.sqrt(5 / 3)],
    ['normalcdf(90, 110, 100, 10)', 0.6826894921370859], ['normalcdf(-∞, 0)', 0.5], ['invNorm(0.05)', -1.6448536269514729],
    ['binompdf(3, 0.5)', '{0.125, 0.375, 0.375, 0.125}'], ['poissoncdf(3, 2)', 0.42319008112684353], ['invT(0.975, 10)', 2.2281388519649385],
    ['[[1,2],[3,4]][[5,6],[7,8]]', '[[19, 22], [43, 50]]'], ['A=[[1,2],[3,4]]\nB=[[0,1],[1,0]]\nAB', '[[2, 1], [4, 3]]'],
    ['A=[[4,7],[2,6]]\ninv(A)*A', '[[1, 0], [0, 1]]'], ['inv([[1,2],[2,4]])', 'error'], ['det([[1,2,3],[4,5,6],[7,8,10]])', -3],
    ['deriv(sin(x), x, 0)', 1, 'rad'], ['deriv(sin(x), x, 0)', Math.PI / 180], ['integral(1/x^2, x, 1, inf)', 1],
    ['integral(x^2, x, 3, 0)', -9], ['sum(2^k, k, 0, 10)', 2047], ['f(x)=x^2\nf({1,2,3})', '{1, 4, 9}'], ['f(x)=2x\nf(f(3))', 12],
    ['a=2\nf(x)=ax\nf(3)', 6], ['convert(60, "mph", "km/h")', 96.56064], ['convert(32, "°F", "°C")', 0],
    ['1/3+1/6', '1/2', 'exact'], ['sqrt(50)/5', '√2', 'exact'], ['sin(45)*sqrt(2)', '1', 'exact'], ['1.5 + 1/3', '11/6', 'exact'],
    ['tan(30)', '√3/3', 'exact'], ['30!', '2.652528598 × 10³²'], ['2^64', 18446744073709551616],
    ['(1+i)(1-i)', 2, 'complex'], ['(2+3i)/(1-i)', '−0.5 + 2.5i', 'complex'], ['1/i', '−i', 'complex'], ['arg(i)', 90, 'complex'],
  ]);
});
