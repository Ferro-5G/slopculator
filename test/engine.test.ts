import { describe, it, expect } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { formatValue, plainNumber, exactForm } from '../src/engine/format';
import type { Settings } from '../src/engine/evaluator';
import type { Value } from '../src/engine/values';

const DEG: Settings = { deg: true, complex: false, sample: false };

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
const fmt = (v: Value) => formatValue(v, { places: null, exact: false, percent: false });

describe('spec acceptance checks (section 16)', () => {
  it('nCr(8,3) = 56', () => expect(n('nCr(8,3)')).toBe(56));
  it('binompdf(7,0.5,6) = 7/128', () => expect(n('binompdf(7,0.5,6)')).toBeCloseTo(7 / 128, 15));
  it('zscore(180,280,40) = −2.5', () => expect(n('zscore(180,280,40)')).toBe(-2.5));
  it('normalcdf(−inf, −2.5, 0, 1) ≈ 0.0062', () => {
    const v = n('normalcdf(−inf, −2.5, 0, 1)');
    expect(v).toBeCloseTo(0.00620966532577613, 14);
    expect(plainNumber(v, 4)).toBe('0.0062');
  });
  it('wages: P(350 < w < 500), μ = 400, σ = 50 → 81.5% by the rule, CDF close', () => {
    expect(n('empirical(400, 50, 350, 500)')).toBeCloseTo(0.815, 12);
    expect(n('normalcdf(350, 500, 400, 50)')).toBeCloseTo(0.8185946141203637, 12);
  });
  it('det([[1,2],[3,4]]) = −2', () => expect(n('det([[1,2],[3,4]])')).toBe(-2));
  it('inv([[1,2],[3,4]])', () => expect(val('inv([[1,2],[3,4]])')).toEqual({ t: 'matrix', m: [[-2, 1], [1.5, -0.5]] }));
  it('sin(30°) = 0.5 in Deg mode', () => {
    expect(n('sin(30)')).toBe(0.5);
    expect(n('sin(30°)')).toBe(0.5);
    expect(n('sin(π/6)', { ...DEG, deg: false })).toBeCloseTo(0.5, 15);
    expect(n('sin(30°)', { ...DEG, deg: false })).toBeCloseTo(0.5, 15);
  });
  it('plots y = sin(x) and normaldist(0,1) with shaded CDF', () => {
    const rows: RowInput[] = [
      { id: 'a', kind: 'expr', text: 'y = sin(x)' },
      { id: 'b', kind: 'expr', text: 'normaldist(0,1)', dist: { cdf: true, min: '-inf', max: '-2.5' } },
    ];
    const [a, b] = evaluateDocument(rows, DEG);
    expect(a.graph[0].type).toBe('fx');
    expect(b.graph[0]).toMatchObject({ type: 'normal', mu: 0, sigma: 1, shade: [-Infinity, -2.5] });
    expect(b.distProb).toBeCloseTo(0.0062096653, 9);
  });
});

describe('arithmetic and parsing', () => {
  it('precedence and operators', () => {
    expect(n('2+3*4')).toBe(14);
    expect(n('-2^2')).toBe(-4);
    expect(n('2^3^2')).toBe(512);
    expect(n('2^-1')).toBe(0.5);
    expect(n('(1+2)(3+4)')).toBe(21);
    expect(n('2π')).toBeCloseTo(2 * Math.PI);
    expect(n('3!')).toBe(6);
    expect(n('50%')).toBe(0.5);
    expect(n('1.5e3')).toBe(1500);
    expect(n('2E-2')).toBe(0.02);
    expect(n('|−3| + |2−5|')).toBe(6);
    expect(n('√16 + ∛27')).toBe(7);
    expect(n('nthroot(32, 5)')).toBe(2);
    expect(n('(-8)^(1/3)')).toBeCloseTo(-2, 14);
    expect(n('5²')).toBe(25);
    expect(n('mod(-7, 3)')).toBe(2);
    expect(n('round(2.345, 2)')).toBe(2.35);
    expect(n('floor(-2.5) + ceil(2.1)')).toBe(0);
    expect(n('8 nCr 3')).toBe(56);
    expect(n('5 nPr 2')).toBe(20);
    expect(n('0.1 + 0.2')).toBeCloseTo(0.3, 15);
  });
  it('variables, names and implicit products', () => {
    expect(n('nt', DEG, ['n = 12', 't = 3'])).toBe(36);
    expect(n('mu + sigma', DEG, ['μ = 400', 'σ = 50'])).toBe(450);
    expect(n('a(b + 1)', DEG, ['a = 2', 'b = 3'])).toBe(8);
    expect(n('P(1 + r/n)^(nt)', DEG, ['P = 1000', 'r = 0.05', 'n = 12', 't = 10'])).toBeCloseTo(1647.00949769028, 8);
    expect(n('f(3)', DEG, ['f(x) = x^2 + 1'])).toBe(10);
    expect(n('g(2, 3)', DEG, ['g(a, b) = a*b + 1'])).toBe(7);
    expect(n('b', DEG, ['b = a + 1', 'a = 2'])).toBe(3);
    expect(n('Pe^(rt)', DEG, ['P = 1000', 'r = 0.05', 't = 10'])).toBeCloseTo(1648.72127070013, 8);
    expect(n('ab^2', DEG, ['a = 3', 'b = 2'])).toBe(12);
  });
  it('ans is the answer from the line above', () => {
    expect(run(['2 + 3', 'ans * 2'])[1].value).toBe(10);
  });
  it('logs', () => {
    expect(n('log(1000)')).toBe(3);
    expect(n('log_2(8)')).toBe(3);
    expect(n('log(2, 8)')).toBe(3);
    expect(n('ln(e^2)')).toBe(2);
    expect(n('log_b(81)', DEG, ['b = 3'])).toBe(4);
  });
  it('compound interest and solve', () => {
    expect(n('compound(1000, 0.05, 12, 10)')).toBeCloseTo(1647.00949769028, 8);
    expect(n('continuous(1000, 0.05, 10)')).toBeCloseTo(1648.72127070013, 8);
    expect(n('solve(1000(1 + 0.05/12)^(12t) = 2000, t)')).toBeCloseTo(13.8916, 3);
    expect(fmt(val('solve(x^2 = 9, x)'))).toBe('{−3, 3}');
    expect(fmt(val('quad(1, -5, 6)'))).toBe('{2, 3}');
    expect(n('sum(n^2, n, 1, 10)')).toBe(385);
    expect(fmt(val('seq(2n + 1, n, 1, 4)'))).toBe('{3, 5, 7, 9}');
  });
  it('fails loudly', () => {
    expect(err('1/0')).toMatch(/Division by zero/);
    expect(err('nCr(8.5, 3)')).toMatch(/whole numbers/);
    expect(err('inv([[1,2],[2,4]])')).toMatch(/singular/);
    expect(err('√(-4)')).toMatch(/Complex mode/);
    expect(err('foo + 1')).toMatch(/Unknown name "foo"/);
    expect(err('(1 + 2')).toMatch(/Expected "\)"/);
    expect(err('tan(90)')).toMatch(/undefined/);
    expect(err('5001!')).toMatch(/too large/);
    expect(err('a = a + 1')).toMatch(/itself/);
  });
  it('complex mode', () => {
    const C = { ...DEG, complex: true };
    expect(fmt(val('√(-4)', C))).toBe('2i');
    expect(fmt(val('(1 + 2i)(3 − i)', C))).toBe('5 + 5i');
    expect(fmt(val('quad(1, 2, 5)', C))).toBe('{−1 − 2i, −1 + 2i}');
    expect(fmt(val('i^2', C))).toBe('−1');
  });
});

describe('stats and probability', () => {
  const L = ['L = {2, 4, 4, 4, 5, 5, 7, 9}'];
  it('lists', () => {
    expect(n('mean(L)', DEG, L)).toBe(5);
    expect(n('sdp(L)', DEG, L)).toBe(2);
    expect(n('sd(L)', DEG, L)).toBe(2);
    expect(n('sd(L)', { ...DEG, sample: true }, L)).toBeCloseTo(2.138089935299395, 14);
    expect(n('sds(L)', DEG, L)).toBeCloseTo(2.138089935299395, 14);
    expect(n('varp(L)', DEG, L)).toBe(4);
    expect(n('median(L)', DEG, L)).toBe(4.5);
    expect(n('mode(L)', DEG, L)).toBe(4);
    expect(n('range(L)', DEG, L)).toBe(7);
    expect(n('mean({2,5,7})')).toBeCloseTo(14 / 3, 14);
    expect(fmt(val('L * 2', DEG, L))).toBe('{4, 8, 8, 8, 10, 10, 14, 18}');
  });
  it('binomial', () => {
    expect(n('binomcdf(10, 0.3, 3)')).toBeCloseTo(0.6496107184, 10);
    expect(n('binomge(10, 0.3, 4)')).toBeCloseTo(1 - 0.6496107184, 10);
    expect(n('binomgt(10, 0.3, 3)')).toBeCloseTo(1 - 0.6496107184, 10);
    expect(n('binomlt(10, 0.3, 4)')).toBeCloseTo(0.6496107184, 10);
    expect(n('binombetween(10, 0.3, 2, 4)')).toBeCloseTo(0.2334744405 + 0.266827932 + 0.200120949, 9);
    expect(n('binomsd(100, 0.5)')).toBe(5);
  });
  it('EV and proportions', () => {
    expect(n('EV({0, 1, 2}, {0.25, 0.5, 0.25})')).toBe(1);
    expect(run(['EV({1, 2}, {0.5, 0.4})'])[0].notes.join()).toMatch(/add to 0.9/);
    expect(n('moe(400)')).toBe(0.05);
    expect(n('moep(0.5, 100, 1.96)')).toBeCloseTo(0.098, 12);
    expect(n('phat(45, 100)')).toBe(0.45);
    expect(n('count(3, 4, 5)')).toBe(60);
  });
});

describe('matrices, vectors, transforms', () => {
  it('matrix ops', () => {
    expect(fmt(val('[[1,2],[3,4]] * [[5,6],[7,8]]'))).toBe('[[19, 22], [43, 50]]');
    expect(fmt(val('[[1,2],[3,4]] + [[1,1],[1,1]]'))).toBe('[[2, 3], [4, 5]]');
    expect(fmt(val('3[[1,2],[3,4]]'))).toBe('[[3, 6], [9, 12]]');
    expect(fmt(val('transpose([[1,2,3],[4,5,6]])'))).toBe('[[1, 4], [2, 5], [3, 6]]');
    expect(n('det([[2,0,1],[1,3,2],[1,1,2]])')).toBe(6);
    expect(n('det([[2,0,1],[1,3,2],[1,1,1]])')).toBe(0);
    expect(fmt(val('linsolve([[2,1],[1,3]], [3,5])'))).toBe('⟨0.8, 1.4⟩');
    expect(fmt(val('[[1,2],[3,4]]^-1 * [[1,2],[3,4]]'))).toBe('[[1, 0], [0, 1]]');
    expect(err('[[1,2]] + [[1],[2]]')).toMatch(/sizes must match/);
  });
  it('vectors', () => {
    expect(n('mag(⟨3, 4⟩)')).toBe(5);
    expect(n('dot([1,2,3], [4,5,6])')).toBe(32);
    expect(fmt(val('cross([1,0,0], [0,1,0])'))).toBe('⟨0, 0, 1⟩');
    expect(fmt(val('unit(vec(3, 4))'))).toBe('⟨0.6, 0.8⟩');
    expect(fmt(val('⟨1, 2⟩ + 2⟨3, 4⟩'))).toBe('⟨7, 10⟩');
  });
  it('transforms', () => {
    expect(fmt(val('rotation(90) * (1, 0)'))).toBe('(0, 1)');
    expect(fmt(val('reflectx * (2, 3)'))).toBe('(2, −3)');
    expect(fmt(val('apply(dilation(2), {(1, 1), (2, 3)})'))).toBe('{(2, 2), (4, 6)}');
  });
});

describe('trig', () => {
  it('values', () => {
    expect(n('cos(60)')).toBe(0.5);
    expect(n('tan(45)')).toBe(1);
    expect(n('sec(60)')).toBe(2);
    expect(n('asin(0.5)')).toBe(30);
    expect(n('atan2(1, -1)')).toBe(135);
    expect(n('arclen(10, 90)')).toBeCloseTo(5 * Math.PI, 12);
    expect(n('sector(2, 180)')).toBeCloseTo(2 * Math.PI, 12);
    expect(n('period(2)')).toBe(180);
    expect(n('sin^2(30) + cos^2(30)')).toBe(1);
    expect(n('sin^-1(1)')).toBe(90);
  });
  it('exact forms', () => {
    expect(exactForm(Math.sqrt(3) / 2)).toBe('√3/2');
    expect(exactForm(Math.sqrt(2) / 2)).toBe('√2/2');
    expect(exactForm(Math.PI / 6)).toBe('π/6');
    expect(exactForm(0.375)).toBe('3/8');
    expect(exactForm(-2 / 3)).toBe('−2/3');
    expect(exactForm(0.0062096653257761)).toBeNull();
  });
});

describe('graph classification', () => {
  it('kinds', () => {
    const r = run(['y = 2x + 1', 'x^2', 'x = 3', 'y > x^2', 'x^2 + y^2 = 25', 'f(x) = x^3', '(1, 2)', 'y = ax', 'a = 2', '2x + 1 = y']);
    expect(r.map((x) => x.graph[0]?.type)).toEqual(['fx', 'fx', 'fy', 'fx', 'implicit', 'fx', 'points', 'fx', undefined, 'fx']);
    expect((r[3].graph[0] as { ineq?: string }).ineq).toBe('>');
    expect((r[7].graph[0] as { f: (x: number) => number }).f(3)).toBe(6);
    expect(r[8].slider).toEqual({ name: 'a', value: 2 });
  });
  it('domain restriction and piecewise', () => {
    const r = run(['y = x^2 {x > 0}', 'y = {x < 0: -x, x}']);
    const f = (r[0].graph[0] as { f: (x: number) => number }).f;
    expect(f(2)).toBe(4);
    expect(f(-2)).toBeNaN();
    const g = (r[1].graph[0] as { f: (x: number) => number }).f;
    expect(g(-3)).toBe(3);
    expect(g(3)).toBe(3);
  });
  it('identity check without x', () => {
    expect(run(['sin(30)^2 + cos(30)^2 = 1'])[0].truth).toBe(true);
  });
  it('duplicate definitions', () => {
    expect(run(['a = 1', 'a = 2'])[0].error).toMatch(/more than once/);
  });
});

describe('tables', () => {
  it('computes columns, sums, EV', () => {
    const rows: RowInput[] = [
      { id: 't', kind: 'table', columns: [{ header: 'x', cells: ['0', '1', '2', ''] }, { header: 'P', cells: ['0.25', '0.5', '0.25'] }, { header: 'x^2', cells: [] }] },
    ];
    const [t] = evaluateDocument(rows, DEG);
    expect(t.table!.columns[2].values).toEqual([0, 1, 4]);
    expect(t.table!.columns[1].sum).toBe(1);
    expect(t.table!.ev).toBe(1);
  });
  it('data columns are list variables', () => {
    const rows: RowInput[] = [
      { id: 't', kind: 'table', columns: [{ header: 'x_1', cells: ['1', '2', '3'] }, { header: 'y_1', cells: ['2', '4', '9'] }] },
      { id: 'm', kind: 'expr', text: 'mean(y_1)' },
    ];
    expect(evaluateDocument(rows, DEG)[1].value).toBe(5);
  });
});

describe('infinity, named distributions and local inputs', () => {
  it('compares infinite values without making finite values equal infinity', () => {
    const r = run(['1 = inf', '-inf = inf', '1*inf = inf', '-inf = -inf', '1 = -inf']);
    expect(r.map((x) => x.truth)).toEqual([false, false, true, true, false]);
  });

  it('computes the shaded probability on named distributions too', () => {
    for (const [text, expected] of [['d = normaldist(0,1)', 0.6826894921370859], ['d = binomdist(4,0.5)', 0.3125]] as const) {
      const [r] = evaluateDocument([{ id: 'd', kind: 'expr', text, dist: { cdf: true, min: '-1', max: '1' } }], DEG);
      expect(r.error).toBeUndefined();
      expect(r.distProb).toBeCloseTo(expected, 12);
      expect(r.graph[0]).toHaveProperty('shade', [-1, 1]);
    }
  });

  it('does not follow a global function when a local input shadows it', () => {
    const r = run(['f(t) = t+y', 'g(f) = f(2)', 'g(3)']);
    expect(r[2].error).toBeUndefined();
    expect(r[2].value).toBe(6);
  });
});
