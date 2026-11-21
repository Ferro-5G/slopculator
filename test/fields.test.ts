import { describe, expect, it } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { listSummary } from '../src/engine/builtins';
import { moistAir } from '../src/engine/hvac';
import { parse } from '../src/engine/parser';

const settings = { deg: true, complex: false, sample: false };
function run(lines: string[]) {
  const rows: RowInput[] = lines.map((text, k) => ({ id: `r${k}`, kind: 'expr', text }));
  return evaluateDocument(rows, settings);
}
const last = (lines: string[]) => run(lines).at(-1)!;

describe('a dot reads a field', () => {
  it('reads a moist-air state by its chart names', () => {
    const r = run(['A = psych(26, 50, "SI")', 'B = psych(13, 95, "SI")', 'q = A.h − B.h', 'A.Tdp', 'A.W', 'A.RH', 'A.Twb', 'A.tdp']);
    expect(r[2].value).toBeCloseTo(52.91 - 35.45, 9);
    expect(r[3].value).toBe(14.78);
    expect(r[4].value).toBe(0.010496);
    expect(r[5].value).toBe(50);
    expect(r[6].value).toBeGreaterThan(14.78);
    expect(r[7].value).toBe(14.78);
  });
  it('marks a moist-air state as one, in °F too', () => {
    const v = last(['psych(75, 50)']).value;
    expect(typeof v === 'object' && v.t === 'record' && v.kind).toBe('air');
    expect(last(['A = psych(75, 50)', 'A.gr']).value).toBeGreaterThan(60);
  });
  it('a field wins over a function of the same name, and a function still works on what has no such field', () => {
    expect(last(['h(x) = x + 1', 'A = psych(26, 50, "SI")', 'A.h']).value).toBe(52.91);
    expect(last(['L = [3, 1, 2]', 'L.mean']).value).toBe(2);
    expect(last(['P = (1, 2)', 'P.x']).value).toBe(1);
  });
  it('reads summaries and fits', () => {
    expect(last(['L = [3, 1, 2, 6]', 'stats(L).s']).value).toBeCloseTo(2.1602468994693, 12);
    expect(last(['L = [3, 1, 2, 6]', 'quartiles(L).Q2']).value).toBe(2.5);
    expect(last(['L = [3, 1, 2, 6]', 'fivenum(L).IQR']).value).toBe(3);
    const fit = run(['x1 = [1, 2, 3, 5]', 'y1 = [1, 2, 3, 4]', 'y1 ~ m x1 + b', 'linreg(x1, y1).r2', 'linreg(x1, y1).a']);
    const rec = fit[2].value;
    expect(typeof rec === 'object' && rec.t === 'record' && rec.rows.find((x) => x.key === 'R2')?.value).toBeCloseTo(fit[3].value as number, 12);
    expect(fit[4].value).toBeCloseTo(0.742857142857, 10);
    expect(last(['coil(1000, 80, 50, 55, 95).tons']).value).toBe(3.05);
  });
  it('says what has no such field', () => {
    expect(last(['A = psych(26, 50, "SI")', 'A.zz']).error).toBeTruthy();
    expect(last(['5.h']).error).toBeTruthy();
  });
  it('marks the call a dot writes, so it reads apart from h(A)', () => {
    const n = parse('A.h');
    expect(n.k === 'call' && n.dot).toBe(true);
    const m = parse('h(A)');
    expect(m.k === 'call' && !m.dot).toBe(true);
  });
  it('re-reads a field when the state it hangs off changes', () => {
    expect(last(['T = 30', 'A = psych(T, 50, "SI")', 'A.Tdb']).value).toBe(30);
    expect(last(['T = 20', 'A = psych(T, 50, "SI")', 'A.Tdb']).value).toBe(20);
  });
});

describe('listSummary', () => {
  it('works a list out as mean, stdev, median and quartiles do', () => {
    const xs = [31.2, 33.8, 29.6, 32.4, 30.1, 35.0];
    const s = listSummary(xs);
    const r = run([`L = [${xs.join(', ')}]`, 'mean(L)', 'stdev(L)', 'median(L)', 'quartiles(L).Q1', 'quartiles(L).Q3']);
    expect(s.n).toBe(6);
    expect(s.mean).toBeCloseTo(r[1].value as number, 12);
    expect(s.s).toBe(r[2].value);
    expect(s.median).toBe(r[3].value);
    expect(s.q1).toBe(r[4].value);
    expect(s.q3).toBe(r[5].value);
    expect([s.min, s.max]).toEqual([29.6, 35]);
    expect(listSummary([4]).s).toBeNull();
  });
});

describe('moistAir', () => {
  it('draws with the numbers psych gives', () => {
    const p = moistAir.pressure(0, true);
    const w = moistAir.humRatio(26, 0.5, p, true);
    expect(w).toBeCloseTo(last(['A = psych(26, 50, "SI")', 'A.W']).value as number, 6);
    expect(moistAir.enthalpy(26, w, true)).toBeCloseTo(52.91, 2);
    expect(moistAir.dryBulbAt(moistAir.enthalpy(26, w, true), w, true)).toBeCloseTo(26, 9);
    const pf = moistAir.pressure(0, false);
    expect(moistAir.humRatio(75, 0.5, pf, false)).toBeCloseTo(last(['A = psych(75, 50)', 'A.W']).value as number, 6);
  });
});
