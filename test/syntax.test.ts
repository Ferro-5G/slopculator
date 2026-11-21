// Math written the way other calculators take it: Desmos (typed, and copied out as LaTeX), a TI, and code.
import { describe, it, expect } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { lineWarnings } from '../src/engine/diagnostics';
import { prettyText } from '../src/ui/typeset';
import { run } from './sheet';

const RAD = { deg: false };
/** The last line's value, after the lines before it. */
function value(lines: string | string[], o = RAD): unknown {
  const all = Array.isArray(lines) ? lines : [lines];
  const r = run(all, o).lines;
  const bad = r.find((l) => l.error);
  if (bad) throw new Error(`${bad.input}: ${bad.error}`);
  return r[r.length - 1].value;
}
const near = (lines: string | string[], want: number) => expect(value(lines), String(lines)).toBeCloseTo(want, 6);
const items = (lines: string | string[]): number[] => {
  const v = value(lines) as { items?: number[]; c?: number[] };
  return v.items ?? v.c ?? [];
};
const error = (lines: string[]): string => run(lines, RAD).lines.at(-1)!.error ?? '';
/** Whether a comparison on the last line holds. */
const holds = (line: string): boolean | undefined => run([line], RAD).results.at(-1)!.truth;

describe('a regression line', () => {
  const data = ['x_1 = [1, 2, 3, 4]', 'y_1 = [2.1, 3.9, 6.2, 7.8]'];
  const fit = (lines: string[]) => Object.fromEntries(((value(lines) as { rows: { label: string; value: number }[] }).rows).map((r) => [r.label, r.value]));

  it('fits a line, and says how well', () => {
    const f = fit([...data, 'y_1 ~ m x_1 + b']);
    expect(f.m).toBe(1.94);
    expect(f.b).toBe(0.15);
    expect(f['R²']).toBeCloseTo(0.9956613757, 9);
  });
  it('defines its unknowns for the rest of the sheet', () => {
    near([...data, 'y_1 ~ m x_1 + b', 'm + b'], 2.09);
    const r = evaluateDocument([...data, 'y_1 ~ m x_1 + b', 'y = m x + b'].map((text, i) => ({ id: `r${i}`, kind: 'expr', text })), { deg: false, complex: false, sample: false });
    expect((r[3].graph[0] as { f: (x: number) => number }).f(10)).toBeCloseTo(19.55, 9);
  });
  it('reads names typed against each other, as in y1 ~ mx1 + b', () => {
    const f = fit(['x1 = [1, 2, 3]', 'y1 = [2, 4, 6]', 'y1 ~ mx1 + b']);
    expect(f.m).toBe(2);
    expect(f.b).toBe(0);
    expect(f['R²']).toBe(1);
  });
  it('keeps a power on the last name when names are typed against each other', () => {
    const lists = ['x1 = [1, 2, 3]', 'y1 = [2, 4, 6]'];
    expect(fit([...lists, 'y1 ~ mx1^2']).m).toBe(fit([...lists, 'y1 ~ m x1^2']).m);
    expect(fit([...lists, 'y1 ~ m(x1 - 1)^2 + c']).m).toBe(fit([...lists, 'y1 ~ m (x1 - 1)^2 + c']).m);
    expect(Math.abs(fit(['x1 = [1, 2, 3]', 'y1 = [4, 16, 36]', 'y1 ~ (mx1)^2']).m)).toBeCloseTo(2, 7);
  });
  it('fits data that sits far from zero', () => {
    const f = fit(['x1 = [1000000000, 1000000001, 1000000002]', 'y1 = [1, 3, 5]', 'y1 ~ a x1 + b']);
    expect(f.a).toBe(2);
    expect(f.b).toBe(-1999999999);
    const years = fit(['x1 = [2019, 2020, 2021, 2022]', 'y1 = [10.5, 12, 13.5, 15]', 'y1 ~ a x1 + b']);
    expect(years.a).toBe(1.5);
    expect(years.b).toBe(-3018);
  });
  it('keeps a small slope on a large baseline', () => {
    const f = fit(['x1 = [1, 2, 3]', 'y1 = [1000000000.001, 1000000000.002, 1000000000.003]', 'y1 ~ 1000000000 + m x1']);
    expect(f.m).toBeCloseTo(0.001, 6);
  });
  it('fits any model that is linear in its unknowns exactly', () => {
    const f = fit(['x_1 = [1, 2, 3, 4]', 'y_1 = [2, 9, 22, 41]', 'y_1 ~ a x_1^2 + b x_1 + c']);
    expect([f.a, f.b, f.c]).toEqual([3, -2, 1]);
  });
  it('fits models that are not, like an exponential', () => {
    const f = fit(['x_1 = [0, 1, 2, 3]', 'y_1 = [3, 6, 12, 24]', 'y_1 ~ a b^x_1']);
    expect(f.a).toBeCloseTo(3, 7);
    expect(f.b).toBeCloseTo(2, 7);
    const g = fit(['x_1 = [1, 2, 4, 8]', 'y_1 = [5, 3, 2, 1.5]', 'y_1 ~ p/x_1 + q']);
    expect(g.p).toBeCloseTo(4, 9);
    expect(g.q).toBeCloseTo(1, 9);
  });
  it('reads a table\'s x and y columns, draws the fit, and leaves the points to the table', () => {
    const rows: RowInput[] = [
      { id: 't', kind: 'table', columns: [{ header: 'x', cells: ['1', '2', '3', ''] }, { header: 'y', cells: ['3', '5', '7', ''] }] },
      { id: 'f', kind: 'expr', text: 'y ~ mx + b' },
      { id: 'm', kind: 'expr', text: 'm' },
    ];
    const r = evaluateDocument(rows, { deg: false, complex: false, sample: false });
    expect(r[1].error).toBeUndefined();
    expect(r[2].value).toBe(2);
    expect(r[1].graph.map((g) => g.type)).toEqual(['fx']);
    expect((r[1].graph[0] as { f: (x: number) => number }).f(10)).toBeCloseTo(21, 9);
  });
  it('draws the points itself when the data is two lists', () => {
    const r = evaluateDocument([...data, 'y_1 ~ m x_1 + b'].map((text, i) => ({ id: `r${i}`, kind: 'expr', text })), { deg: false, complex: false, sample: false });
    expect(r[2].graph.map((g) => g.type)).toEqual(['fx', 'points']);
  });
  it('makes a new curve when a table cell changes, and keeps it when another line does', () => {
    const sheet = (y3: string, other: string): RowInput[] => [
      { id: 't', kind: 'table', columns: [{ header: 'x', cells: ['1', '2', '3'] }, { header: 'y', cells: ['3', '5', y3] }] },
      { id: 'f', kind: 'expr', text: 'y ~ mx + b' },
      { id: 'o', kind: 'expr', text: other },
    ];
    const s = { deg: false, complex: false, sample: false };
    const a = evaluateDocument(sheet('7', '1 + 1'), s)[1].graph[0];
    expect(evaluateDocument(sheet('7', '1 + 2'), s)[1].graph[0]).toBe(a);
    expect(evaluateDocument(sheet('8', '1 + 1'), s)[1].graph[0]).not.toBe(a);
  });
  it('says what is missing', () => {
    expect(error(['y_1 ~ m x_1 + b'])).toMatch(/needs data/);
    expect(error(['x_1 = [1, 2, 3]', 'y_1 = [2, 4]', 'y_1 ~ m x_1 + b'])).toMatch(/same number/);
    expect(error(['x_1 = [1, 2, 3]', 'y_1 = [2, 4, 6]', 'm = 2', 'y_1 ~ m x_1'])).toMatch(/Nothing to fit/);
    expect(error(['x_1 = [1, 1, 1]', 'y_1 = [2, 4, 6]', 'y_1 ~ m x_1 + b'])).toMatch(/can't tell/);
    expect(error(['y ~ m x + b'])).toMatch(/no table/);
  });
  it('gives the second of two regressions the first one\'s values, not its unknowns', () => {
    expect(error([...data, 'y_1 ~ m x_1 + b', 'y_1 ~ m x_1 + b'])).toMatch(/Nothing to fit/);
    const f = fit([...data, 'y_1 ~ m x_1 + b', 'y_1 ~ m x_1 + c']);
    expect(f.c).toBeCloseTo(0.15, 9);
  });
});

describe('LaTeX, as Desmos copies an expression', () => {
  it('reads fractions, roots, brackets and powers', () => {
    near('\\frac{1}{2}', 0.5);
    near('\\frac{\\sqrt{3}}{2}', Math.sqrt(3) / 2);
    near('\\sqrt[3]{8}', 2);
    near('\\left(1+2\\right)\\cdot3', 9);
    near('2^{10}', 1024);
    near('10^{-3}', 0.001);
    near('\\left|-3\\right|', 3);
    near('2\\times3', 6);
    near('6\\div3', 2);
    near('50\\%', 0.5);
    near('\\binom{5}{2}', 10);
    near('\\left\\lfloor2.7\\right\\rfloor', 2);
  });
  it('reads function names and Greek letters', () => {
    near('\\sin\\left(0\\right)', 0);
    near('\\ln\\left(e\\right)', 1);
    near('\\log_{2}\\left(8\\right)', 3);
    near('2\\pi', 2 * Math.PI);
    near('\\operatorname{mean}\\left(\\left[1,2,3\\right]\\right)', 2);
    near('\\sin^{2}\\left(1\\right)+\\cos^{2}\\left(1\\right)', 1);
    near('\\sin^{-1}\\left(1\\right)', Math.PI / 2);
    near(['\\theta=3', '2\\theta'], 6);
  });
  it('reads subscripts, sums, integrals and derivatives', () => {
    near(['x_{1}=4', 'x_{1}+1'], 5);
    near(['a_{max}=3', 'a_{max}+1'], 4);
    near('\\sum_{n=1}^{10}n', 55);
    near('\\prod_{n=1}^{5}n', 120);
    near('\\int_{0}^{1}x^{2}dx', 1 / 3);
    near(['a=3', '\\frac{d}{da}a^{2}'], 6);
    near('\\left\\{1<2:5,7\\right\\}', 5);
  });
  it('reads a regression', () => {
    near(['x_{1}=\\left[1,2,3\\right]', 'y_{1}=\\left[2,4,6\\right]', 'y_{1}\\sim mx_{1}+b', 'm'], 2);
  });
  it('gives no warnings, since positions on a rewritten line mean nothing', () => {
    expect(lineWarnings('\\frac{1}{2}x', { deg: true })).toEqual([]);
  });
});

describe('Desmos lists', () => {
  it('counts through a range', () => {
    expect(items('[1...5]')).toEqual([1, 2, 3, 4, 5]);
    expect(items('[1, 3, ..., 9]')).toEqual([1, 3, 5, 7, 9]);
    expect(items('[1,...,4]')).toEqual([1, 2, 3, 4]);
    expect(items('[5...1]')).toEqual([5, 4, 3, 2, 1]);
    expect(items('[0, 0.25, ..., 1]')).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(items('{1..4}')).toEqual([1, 2, 3, 4]);
    near('sum(1...10)', 55);
  });
  it('reads an item, and several', () => {
    near(['L = [4, 5, 6]', 'L[2]'], 5);
    expect(items(['L = [4, 5, 6]', 'L[2...3]'])).toEqual([5, 6]);
    near(['L = {4, 5, 6}', 'L[3]'], 6);
    near(['A = [[1, 2], [3, 4]]', 'A[2, 1]'], 3);
    expect(error(['L = [4, 5, 6]', 'L[4]'])).toMatch(/isn't there/);
  });
  it('still multiplies a number against a bracket, and a matrix against a matrix', () => {
    expect(items(['a = 2', 'a[3, 4]'])).toEqual([6, 8]);
    expect(value('[[1,2],[3,4]][[5,6],[7,8]]')).toEqual({ t: 'matrix', m: [[19, 22], [43, 50]] });
  });
  it('works on each number of a [ ] list', () => {
    expect(items('[1, 2, 3] + 1')).toEqual([2, 3, 4]);
    expect(items('[1, 2, 3]^2')).toEqual([1, 4, 9]);
    expect(items('10 - [1, 2, 3]')).toEqual([9, 8, 7]);
    expect(items('sqrt([1, 4, 9])')).toEqual([1, 2, 3]);
  });
  it('builds a list with for, and swaps a value in with with', () => {
    expect(items('[n^2 for n = [1...4]]')).toEqual([1, 4, 9, 16]);
    near(['a = 3', 'a^2 with a = 5'], 25);
    near('a b where a = 2, b = 3', 6);
  });
  it('knows Desmos\'s list functions', () => {
    near('total([1, 2, 3])', 6);
    near('quantile([1, 2, 3, 4, 5], 0.5)', 3);
    near('quartile([1, 2, 3, 4, 5], 4)', 5);
    near('spearman([1, 2, 3], [2, 4, 7])', 1);
    expect(items('join([1, 2], [3])')).toEqual([1, 2, 3]);
    expect(items('repeat([1, 2], 2)')).toEqual([1, 2, 1, 2]);
    expect(items('unique([1, 1, 2])')).toEqual([1, 2]);
    expect(items('shuffle([1, 2, 3])').sort()).toEqual([1, 2, 3]);
  });
});

describe('a dot reads a part', () => {
  it('of a point', () => {
    near(['P = (3, 4)', 'P.x + P.y'], 7);
  });
  it('of a distribution', () => {
    near('normaldist(0, 1).cdf(1)', 0.8413447461);
    near('normaldist(0, 1).cdf(-1, 1)', 0.6826894921);
    near('normaldist(0, 1).pdf(0)', 0.3989422804);
    near('normaldist(100, 15).inversecdf(0.975)', 129.3994598);
    near('binomialdist(10, 0.5).pdf(5)', 0.24609375);
    near('binomialdist(10, 0.5).cdf(5)', 0.623046875);
  });
  it('leaves decimals alone', () => {
    near(['a = 2', 'a .5'], 1);
    near('1.5 + .5', 2);
  });
});

describe('calculus as it is written', () => {
  it('reads primes', () => {
    near(['f(x) = x^3', "f'(2)"], 12);
    near(['f(x) = x^3', "f''(2)"], 12);
    near("sin'(0)", 1);
  });
  it('reads d/dx', () => {
    near(['t = 3', 'd/dt t^2'], 6);
    const r = evaluateDocument([{ id: 'a', kind: 'expr', text: 'y = d/dx x^3' }], { deg: false, complex: false, sample: false });
    expect((r[0].graph[0] as { f: (x: number) => number }).f(2)).toBeCloseTo(12, 6);
    expect(lineWarnings('d/dx x^2', { deg: true })).toEqual([]);
  });
  it('still divides by a name that starts with d', () => {
    near(['d = 6', 'dx = 3', 'd/dx'], 2);
  });
  it('reads sums and products with bounds', () => {
    near('sum_{n=1}^{10} n', 55);
    near('sum_(n=1)^(10) n^2', 385);
    near('∑_{n=1}^{4} 2n + 1', 21);
    near('prod_{n=1}^{5} n', 120);
    near('sum(1, 2, 3)', 6);
    near('product(2, 3, 4)', 24);
  });
  it('reads an integral with its dx', () => {
    near('int_0^1 x^2 dx', 1 / 3);
    near('∫_0^pi sin(x) dx', 2);
    near('int_{0}^{2} 3t^2 dt', 8);
    near('int_0^1 xdx', 0.5);
    near('2 int_0^1 x dx + 1', 2);
    near('int(x^2, 0, 1)', 1 / 3);
    near('integrate(x^2, x, 0, 1)', 1 / 3);
    expect(lineWarnings('∫_0^1 x^2 dx', { deg: false })).toEqual([]);
  });
  it('leaves a name that starts with int alone', () => {
    near(['int_rate = 3', 'int_rate^2'], 9);
  });
});

describe('a TI\'s keys', () => {
  it('stores with an arrow', () => {
    near(['5 → A', 'A + 1'], 6);
    near(['5 -> k', '2k'], 10);
  });
  it('reads its numbers and roots', () => {
    near('3ᴇ5', 300000);
    near('⁻5 + 2', -3);
    near('³√(8)', 2);
    near('2⁻¹', 0.5);
    expect(holds('1 ≠ 2')).toBe(true);
  });
  it('knows its function names', () => {
    near('nDeriv(X^2, X, 3)', 6);
    near('fnInt(X^2, X, 0, 1)', 1 / 3);
    near('iPart(-2.7)', -2);
    near('fPart(2.75)', 0.75);
    near('int(-2.7)', -3);
    near('logBASE(8, 2)', 3);
    near('remainder(7, 3)', 1);
    near('stdDev({1, 2, 3, 4})', Math.sqrt(5 / 3));
    near('variance({1, 2, 3, 4})', 5 / 3);
    near('dim({1, 2, 3})', 3);
    near('geometpdf(0.5, 3)', 0.125);
    near('χ²cdf(0, 3, 2)', 0.7768698399);
    expect(value('[[1, 2][3, 4]]')).toEqual({ t: 'matrix', m: [[1, 2], [3, 4]] });
    expect(value('[[1, 2], [3, 4]]ᵀ')).toEqual({ t: 'matrix', m: [[1, 3], [2, 4]] });
  });
  it('rolls numbers that stay put while another line is typed', () => {
    const roll = (other: string) => value(['randInt(1, 1000000)', other, 'A']);
    expect(roll('1 + 1')).toBe(roll('1 + 2'));
    const many = items('randInt(1, 6, 200)');
    expect(many).toHaveLength(200);
    expect(many.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)).toBe(true);
    expect(new Set(many).size).toBe(6);
    const u = value('random()') as number;
    expect(u >= 0 && u < 1).toBe(true);
    expect(items('randNorm(0, 1, 5)')).toHaveLength(5);
    expect(error(['randBin(1000000, 0.5, 100000)'])).toMatch(/ten million/);
    expect(items('repeat({}, 1000000000)')).toEqual([]);
  });
});

describe('names from code and other calculators', () => {
  it('knows them', () => {
    near('pow(2, 10)', 1024);
    near('hypot(3, 4)', 5);
    near('trunc(-2.7)', -2);
    near('ceiling(2.1)', 3);
    near('sgn(-3)', -1);
    near('cuberoot(27)', 3);
    near('binomial(5, 2)', 10);
    near('ld(8)', 3);
    near('lg(1000)', 3);
    near('sind(30)', 0.5);
    near('cosd(60)', 0.5);
    near('degrees(pi)', 180);
    near('arcsinh(0)', 0);
    near('asinh(1)', Math.asinh(1));
    near('sech(0)', 1);
    near('arcsec(1)', 0);
    near('clamp(5, 0, 3)', 3);
    near('if(1 < 2, 5, 7)', 5);
    near('if(1, 5, 1/0)', 5);
    near('if(0, ln(-1), 3)', 3);
    near('last([4, 5, 6])', 6);
  });
  it('reads their operators', () => {
    expect(holds('1 != 2')).toBe(true);
    expect(holds('1 == 1')).toBe(true);
    expect(holds('1 <> 1')).toBe(false);
    expect(holds('2 => 1')).toBe(true);
    near('1 < 2 and 2 < 1', 0);
    near('1 < 2 or 2 < 1', 1);
    near('not(1)', 0);
    near(['a := 5', 'a + 1'], 6);
    near('2∙3', 6);
    near('1 ⁄ 2', 0.5);
    near('1½ + ¼', 1.75);
    near('$5 + $3', 8);
    near('0x1F + 0b101', 36);
  });
  it('keeps five factorial equal to 120', () => {
    expect(holds('5!=120')).toBe(true);
  });
  it('reads a name in another case once nothing else has it', () => {
    near('Sqrt(16)', 4);
    near('LOG(100)', 2);
    near('PI', Math.PI);
    near(['1 + 1', 'Ans + 1'], 3);
    const graphOf = (first: string) => evaluateDocument([first, 'y = Ans x'].map((text, i) => ({ id: `r${i}`, kind: 'expr' as const, text })), { deg: false, complex: false, sample: false })[1].graph[0] as { f: (x: number) => number };
    expect(graphOf('2').f(2)).toBe(4);
    expect(graphOf('3').f(2)).toBe(6);
    near(['Sqrt(x) = x + 1', 'Sqrt(16)'], 17);
  });
});

describe('how the new forms are written back', () => {
  it.each([
    ['sum_{n=1}^{10} n^2', 'Σ_(n=1)¹⁰n²'], ['int_0^1 x^2 dx', '∫₀¹x² dx'], ['d/dx x^2', 'd/dx x²'], ["f'(3)", 'f′(3)'], ["f''(x)", 'f″(x)'],
    ['L[2]', 'L[2]'], ['[1...5]', '[1, …, 5]'], ['[n^2 for n=[1...5]]', '[n² for n = [1, …, 5]]'], ['a^2 with a=5', 'a² with a = 5'],
    ['P.x', 'P.x'], ['y1 ~ mx1 + b', 'y₁ ~ mx₁ + b'], ['y1 ~ a x1^2 + c', 'y₁ ~ ax₁² + c'], ['1 != 2', '1 ≠ 2'], ['5→A', 'A = 5'], ['\\frac{1}{2}x', '1/2 × x'],
  ])('%s', (typed, shown) => {
    expect(prettyText(typed)).toBe(shown);
  });
});
