// Every worked example in docs/guide.md and the palette's homework examples, checked against the engine.
import { describe, it, expect } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { formatValue } from '../src/engine/format';
import type { Settings } from '../src/engine/evaluator';

const DEG: Settings = { deg: true, complex: false, sample: false };
const RAD: Settings = { ...DEG, deg: false };

function sheet(lines: string[], s: Settings = DEG) {
  return evaluateDocument(lines.map((text, i): RowInput => ({ id: String(i), kind: 'expr', text })), s);
}
function num(lines: string[], s: Settings = DEG): number {
  const r = sheet(lines, s).at(-1)!;
  if (r.error) throw new Error(`${lines.at(-1)}: ${r.error}`);
  if (typeof r.value !== 'number') throw new Error(`${lines.at(-1)} gave ${JSON.stringify(r.value)}`);
  return r.value;
}
function noErrors(lines: string[], s: Settings = DEG): void {
  sheet(lines, s).forEach((r, i) => expect(r.error, `line ${i + 1}: ${lines[i]}`).toBeUndefined());
}
const exact = (lines: string[]) => {
  const r = sheet(lines).at(-1)!;
  return formatValue(r.value!, { places: null, exact: true, percent: false });
};

describe('guide: unit 7', () => {
  it('logs and interest', () => {
    expect(num(['log_2(8)'])).toBe(3);
    expect(num(['ln(81)/ln(3)'])).toBeCloseTo(4, 12);
    expect(num(['log_3(81)'])).toBe(4);
    expect(num(['compound(1000, 0.05, 12, 10)'])).toBeCloseTo(1647.00949769, 6);
    expect(num(['continuous(1000, 0.05, 10)'])).toBeCloseTo(1648.7212707, 6);
    expect(num(['solve(1000(1 + 0.05/12)^(12t) = 2000, t)'])).toBeCloseTo(13.8916, 3);
    expect(num(['P = 1000', 'r = 0.05', 'n = 12', 't = 10', 'P(1 + r/n)^(nt)'])).toBeCloseTo(1647.00949769, 6);
  });
});

describe('guide: units 8–10', () => {
  it('graphs without errors', () => {
    noErrors(['y = 1/(x - 2) + 3']);
    noErrors(['x^2 + y^2 = 25', 'x^2/9 + y^2/4 = 1', 'x^2/9 - y^2/4 = 1', 'y = (x - 1)^2 + 2']);
  });
  it('sequences and series', () => {
    expect(formatValue(sheet(['seq(2n + 1, n, 1, 4)'])[0].value!, { places: null, exact: false, percent: false })).toBe('{3, 5, 7, 9}');
    expect(num(['sum(n^2, n, 1, 10)'])).toBe(385);
    expect(num(['sum(2n + 1, n, 1, 20)'])).toBe(440);
    expect(num(['a(n) = 3·2^(n − 1)', 'a(5)'])).toBe(48);
    expect(num(['a(n) = 3·2^(n − 1)', 'sum(a(n), n, 1, 5)'])).toBe(93);
  });
});

describe('guide: unit 11', () => {
  it('counting and lists', () => {
    expect(num(['nCr(8, 3)'])).toBe(56);
    expect(num(['nPr(5, 2)'])).toBe(20);
    expect(num(['count(3, 4, 5)'])).toBe(60);
    const L = 'L = {2, 4, 4, 4, 5, 5, 7, 9}';
    expect(num([L, 'mean(L)'])).toBe(5);
    expect(num([L, 'sdp(L)'])).toBe(2);
    expect(num([L, 'median(L)'])).toBe(4.5);
    noErrors([L, 'fivenum(L)']);
  });
  it('normal distribution', () => {
    expect(num(['zscore(180, 280, 40)'])).toBe(-2.5);
    expect(num(['normalcdf(-inf, -2.5)'])).toBeCloseTo(0.0062, 4);
    expect(num(['normalcdf(350, 500, 400, 50)'])).toBeCloseTo(0.8186, 4);
    expect(num(['empirical(400, 50, 350, 500)'])).toBeCloseTo(0.815, 10);
    expect(num(['invNorm(0.9, 100, 15)'])).toBeCloseTo(119.22, 2);
    expect(num(['zcrit(0.95)'])).toBeCloseTo(1.96, 2);
    const rows: RowInput[] = [
      { id: 'a', kind: 'expr', text: 'μ = 400' },
      { id: 'b', kind: 'expr', text: 'σ = 50' },
      { id: 'c', kind: 'expr', text: 'normaldist(μ, σ)', dist: { cdf: true, min: '350', max: '500' } },
    ];
    expect(evaluateDocument(rows, DEG)[2].distProb).toBeCloseTo(0.8186, 4);
  });
  it('binomial, EV, proportions', () => {
    expect(num(['binompdf(7, 0.5, 6)'])).toBe(0.0546875);
    expect(num(['binomcdf(10, 0.3, 3)'])).toBeCloseTo(0.6496, 4);
    expect(num(['binomge(10, 0.3, 4)'])).toBeCloseTo(0.3504, 4);
    noErrors(['binomstats(10, 0.3)']);
    expect(num(['EV({0, 1, 2}, {0.25, 0.5, 0.25})'])).toBe(1);
    expect(num(['EV({-1, 5}, {0.8, 0.2})'])).toBeCloseTo(0.2, 12);
    expect(num(['netgain({0, 10}, {0.9, 0.1}, 2)'])).toBeCloseTo(-1, 12);
    expect(num(['moe(400)'])).toBe(0.05);
    expect(num(['phat(45, 100)'])).toBe(0.45);
    noErrors(['sep(0.45, 100)']);
  });
});

describe('guide: unit 12', () => {
  it('matrices, vectors, transforms', () => {
    expect(num(['det([[1, 2], [3, 4]])'])).toBe(-2);
    noErrors(['inv([[1, 2], [3, 4]])', 'linsolve([[2, 1], [1, 3]], [3, 5])', 'dot([1, 2, 3], [4, 5, 6])']);
    expect(num(['mag(⟨3, 4⟩)'])).toBe(5);
    noErrors(['T = polygon((0,0), (2,0), (1,2))', 'rotation(90) * T', 'dilation(2) * T']);
    noErrors(['A = [[1, 2], [3, 4]]', 'det(A)', 'inv(A)']);
  });
});

describe('guide: unit 13', () => {
  it('trig', () => {
    expect(num(['sin(30)'])).toBe(0.5);
    expect(num(['sin(pi/6)'], RAD)).toBeCloseTo(0.5, 15);
    expect(num(['sin(30°)'], RAD)).toBeCloseTo(0.5, 15);
    expect(num(['asin(0.5)'])).toBe(30);
    expect(num(['arclen(10, 90)'])).toBeCloseTo(15.708, 3);
    expect(num(['sector(2, 180)'])).toBeCloseTo(6.2832, 4);
    noErrors(['trigform(2, 3, 1, 0)', 'unitcircle(60)', 'unitcircle(135)']);
    noErrors(['a = 2', 'b = 3', 'c = 0', 'd = 1', 'y = a sin(b(x − c)) + d', 'trigform(a, b, c, d)']);
  });
  it('exact unit circle values', () => {
    expect(exact(['cos(60)'])).toBe('1/2');
    expect(exact(['sin(60)'])).toBe('√3/2');
  });
});

describe('guide: HVAC', () => {
  const rec = (line: string): Record<string, number> => {
    const v = sheet([line])[0].value;
    if (typeof v !== 'object' || v.t !== 'record') throw new Error(`${line} gave ${JSON.stringify(v)}`);
    return Object.fromEntries(v.rows.map((r) => [r.label, r.value as number]));
  };
  it('moist air', () => {
    const a = rec('psych(75, 50)');
    expect([a['Wet bulb (°F)'], a['Dew point (°F)'], a['Moisture (gr/lb)'], a['Enthalpy (Btu/lb dry air)']]).toEqual([62.55, 55.12, 64.65, 28.107]);
    const b = rec('psych(75, 50, 5280)');
    expect([b['Wet bulb (°F)'], b['Moisture (gr/lb)'], b['Enthalpy (Btu/lb dry air)']]).toEqual([61.72, 78.77, 30.314]);
    expect(rec('psychwb(75, 62.6)')['Relative humidity (%)']).toBe(50.17);
    expect(num(['enthalpy(75, 50)'])).toBeCloseTo(28.1066, 4);
    expect(num(['dewpoint(75, 50)'])).toBeCloseTo(55.12, 2);
    expect(num(['enthalpy(24, 50, "SI")'])).toBeCloseTo(47.8146, 4);
    expect(num(['units = "SI"', 'enthalpy(24, 50, units)'])).toBeCloseTo(47.8146, 4);
    const m = rec('mixair(800, 75, 50, 200, 95, 40)');
    expect([m['Dry bulb (°F)'], m['Relative humidity (%)']]).toEqual([78.89, 48.38]);
    expect(num(['oapercent(79, 75, 95)'])).toBeCloseTo(20, 10);
    noErrors(['y = grains(x, 100)', 'y = grains(x, 50)', 'y = grains(x, 25)']);
  });
  it('loads and coils', () => {
    expect(num(['sensibleheat(1200, 20)'])).toBeCloseTo(25920, 8);
    expect(num(['latentheat(1200, 10)'])).toBeCloseTo(8160, 8);
    expect(num(['totalheat(1200, 5)'])).toBeCloseTo(27000, 8);
    expect(num(['airflow(36000, 20)'])).toBeCloseTo(1666.67, 2);
    const c = rec('coil(1200, 75, 50, 55, 90)');
    expect([c['Total (Btu/h)'], c['Tons'], c['Sensible heat ratio'], c['Condensate (gal/h)']]).toEqual([31135, 2.59, 0.824, 0.61]);
    expect(rec('coilwb(1200, 75, 62.55, 55, 53.2)')['Tons']).toBeCloseTo(2.6, 0);
    expect(num(['waterheat(10, 12)'])).toBe(60000);
  });
  it('refrigerants', () => {
    const p = rec('ptchart("R410A", 40)');
    expect([p['Bubble, liquid (psig)'], p['Dew, vapor (psig)']]).toEqual([118.79, 118.36]);
    const t = rec('sattemp("R407C", 70)');
    expect([t['Bubble, liquid (°F)'], t['Dew, vapor (°F)'], t['Glide (°F)']]).toEqual([33.55, 44.54, 10.99]);
    expect(num(['superheat("R410A", 118, 50)'])).toBeCloseTo(10.16, 2);
    expect(num(['subcool("R410A", 340, 95)'])).toBeCloseTo(9.61, 2);
    expect(num(['targetsuperheat(62, 85)'])).toBe(10.5);
    const q = rec('refprops("R134a", 40)');
    expect([q['Liquid enthalpy (Btu/lb)'], q['Vapor enthalpy (Btu/lb)'], q['Latent heat (Btu/lb)']]).toEqual([24.87, 108.78, 83.91]);
    const y = rec('refcycle("R454B", 45, 105, 10, 10, 70)');
    expect([y.COP, y.EER, y['kW/ton'], y['Discharge temperature (°F)']]).toEqual([4.682, 15.98, 0.751, 168.1]);
  });
  it('ducts, fans, and pipes', () => {
    expect(num(['ductsize(1000, 0.1)'])).toBeCloseTo(13.65, 2);
    expect(num(['ductvel(1000, 14)'])).toBeCloseTo(935, 0);
    expect(num(['ductloss(1000, 14)'])).toBeCloseTo(0.088, 3);
    expect(num(['eqdia(18, 10)'])).toBeCloseTo(14.51, 2);
    expect(num(['velfromvp(0.1)'])).toBeCloseTo(1266, 0);
    const f = rec('fanlaws(1000, 0.5, 0.25, 900, 1080)');
    expect(f.Flow).toBeCloseTo(1200, 8);
    expect(f['Pressure or head']).toBeCloseTo(0.72, 8);
    expect(f.Power).toBeCloseTo(0.432, 8);
    expect(num(['fanpower(1000, 0.8, 60)'])).toBeCloseTo(0.21, 2);
    expect(num(['pumppower(30, 40, 65)'])).toBeCloseTo(0.47, 2);
    expect(num(['pipeloss(10, 1.025, 150)'])).toBeCloseTo(6.2, 1);
    expect(num(['gasinput(1, 36)'])).toBe(100000);
    expect(num(['convert(36000, "Btu/h", "ton")'])).toBe(3);
  });
});
