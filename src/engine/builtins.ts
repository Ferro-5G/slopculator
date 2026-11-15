import { charge, fail, failEdge, failLazy, warningNote } from './errors';
import { TRIG, type Node } from './parser';
import { children, lettersOf } from './ast';
import type { Env, Fn } from './evaluator';
import type { Builtin, Compile } from './builtin-types';
import { coordsOf, mat, numberFn, one, points2D } from './args';
import { exactForm } from './format';
import {
  type Value, num, nums, list, point, vector, matrix, record, complex, complexSqrt, mapNum, typeName,
  determinant, matInverse, identity, matMulTidy, tidy, arith, pos, prob, whole, weightedTotal, PIVOT_TOL,
} from './values';
import {
  factorial, nCr, nPr, normCdf, normPdf, normBetween, invNormStd, binomPdf, binomRange, isWhole, ridders, integrate,
  maxOf, minOf, hypotOf, roundTo, gcdOf,
} from './numeric';
import { registerMore } from './more';
import { registerHvac } from './hvac';

export const CONSTANTS: Record<string, Value> = Object.assign(Object.create(null) as Record<string, Value>, {
  π: Math.PI,
  e: Math.E,
  inf: Infinity,
  τ: 2 * Math.PI,
});

const B: Record<string, Builtin> = Object.create(null);

function def(names: string | string[], b: Builtin): void {
  for (const n of Array.isArray(names) ? names : [names]) {
    if (n in B) throw new Error(`The built-in "${n}" is defined twice`);
    B[n] = b;
  }
}

const isNum = (v: Value): v is number => typeof v === 'number';

function snapTrig(r: number): number {
  const h = Math.round(r * 2) / 2;
  return Math.abs(r - h) < 1e-15 ? h : r;
}


// ---------- arithmetic ----------
function sqrtNum(v: number, env: Env): Value {
  if (v < 0) {
    if (env.settings.complex) return complexSqrt(v);
    failEdge(() => `√ of a negative number (${v}) isn't real. Turn on Complex mode to get i`);
  }
  return Math.sqrt(v);
}
def('sqrt', {
  min: 1, max: 1, fast1: sqrtNum, fn: (a, env) => {
    const v = a[0];
    if (isNum(v)) return sqrtNum(v, env);
    if (v.t === 'complex') return arith('^', v, 0.5);
    return mapNum(v, (x) => { if (x < 0) failLazy(() => `√ of a negative number (${x}) isn't real`); return Math.sqrt(x); }, '√');
  },
});
def('cbrt', one(Math.cbrt, '∛'));
def(['nthroot', 'root'], {
  min: 2, max: 2, usage: 'nthroot(x, n)', fn: (a) => {
    const n = num(a[1], 'Root index');
    return mapNum(a[0], (x) => {
      if (n === 0) fail('The 0th root is undefined');
      if (x < 0) {
        if (Number.isInteger(n) && Math.abs(n) % 2 === 1) return -Math.pow(-x, 1 / n);
        failLazy(() => `Even root of a negative number (${x}) isn't real`);
      }
      return Math.pow(x, 1 / n);
    }, 'nthroot');
  },
});
def('abs', {
  min: 1, max: 1, fast1: Math.abs, fn: (a) => {
    const v = a[0];
    if (isNum(v)) return Math.abs(v);
    if (v.t === 'complex') return Math.hypot(v.re, v.im);
    if (v.t === 'vector') return hypotOf(v.c);
    if (v.t === 'matrix') return determinant(v.m);
    return mapNum(v, Math.abs, '|x|');
  },
});
def('floor', one(Math.floor, 'floor'));
def('ceil', one(Math.ceil, 'ceil'));
def('sign', one(Math.sign, 'sign'));
def('round', {
  min: 1, max: 2, usage: 'round(x) or round(x, places)', fn: (a) => {
    const places = a.length > 1 ? whole(num(a[1], 'places'), 'places') : 0;
    return mapNum(a[0], (x) => roundTo(x, places), 'round');
  },
});
def('mod', {
  min: 2, max: 2, usage: 'mod(a, b)', fn: (a) => {
    const m = num(a[1], 'Divisor');
    if (m === 0) fail('mod by zero');
    return mapNum(a[0], (x) => tidy(((x % m) + m) % m, Math.abs(x)), 'mod');
  },
});
def('exp', one(Math.exp, 'exp'));
def('ln', one((x) => {
  if (x <= 0) failEdge(() => `ln is only defined for positive numbers, got ${x}`);
  return Math.log(x);
}, 'ln'));
def('log', {
  min: 1, max: 2, usage: 'log(x), log(b, x), or log_b(x)', fn: (a) => {
    if (a.length === 1) return mapNum(a[0], (x) => {
      if (x <= 0) failEdge(() => `log is only defined for positive numbers, got ${x}`);
      return tidy(Math.log10(x));
    }, 'log');
    const b = num(a[0], 'Log base');
    if (b <= 0 || b === 1) fail(`Log base must be positive and not 1, got ${b}`);
    return mapNum(a[1], (x) => {
      if (x <= 0) failEdge(() => `log is only defined for positive numbers, got ${x}`);
      return tidy(Math.log(x) / Math.log(b));
    }, 'log');
  },
});
def('gcd', {
  min: 1, max: Infinity, fn: (a) => {
    const xs = a.flatMap((v) => nums(v)).map((x) => Math.abs(whole(x, 'gcd input')));
    return xs.reduce((p, q) => gcdOf(p, q));
  },
});
def('lcm', {
  min: 1, max: Infinity, fn: (a) => {
    const xs = a.flatMap((v) => nums(v)).map((x) => Math.abs(whole(x, 'lcm input')));
    return xs.reduce((p, q) => (p === 0 || q === 0 ? 0 : (p / gcdOf(p, q)) * q));
  },
});

// ---------- combinatorics ----------
def(['factorial', 'fact'], one(factorial, 'factorial'));
def(['nCr', 'C', 'choose'], { min: 2, max: 2, usage: 'nCr(n, r)', fn: (a) => nCr(num(a[0], 'n'), num(a[1], 'r')) });
def(['nPr', 'perm'], { min: 2, max: 2, usage: 'nPr(n, r)', fn: (a) => nPr(num(a[0], 'n'), num(a[1], 'r')) });
def('count', {
  min: 1, max: Infinity, usage: 'count(a, b, c) multiplies choices: Fundamental Counting Principle',
  fn: (a) => a.flatMap((v) => nums(v)).reduce((p, q) => p * q, 1),
});

// ---------- lists & descriptive stats ----------
function data(a: Value[], fn: string): number[] {
  const xs = a.length === 1 ? nums(a[0]) : a.flatMap((v) => nums(v));
  if (xs.length === 0) fail(`${fn} needs at least one number`);
  return xs;
}
function mean(xs: number[]): number {
  let s = 0, big = 0;
  for (const x of xs) { s += x; big = Math.max(big, Math.abs(x)); }
  return tidy(s / xs.length, big);
}
function median(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
function variance(xs: number[], sample: boolean): number {
  const n = xs.length;
  if (sample && n < 2) fail('Sample variance needs at least 2 values');
  const m = xs.reduce((p, q) => p + q, 0) / n;
  let ss = 0;
  let big = 0;
  for (const x of xs) { ss += (x - m) * (x - m); big = Math.max(big, Math.abs(x)); }
  // The noise in x − m is about 1e-14 of n·big, and here it's squared. A fixed cutoff called sd(1, 1 + 1e-8) zero.
  return tidy(ss / (sample ? n - 1 : n), n * big * n * big * 1e-14);
}
const tidySum = (xs: number[]) => {
  let s = 0, size = 0;
  for (const x of xs) { s += x; size += Math.abs(x); }
  return tidy(s, size);
};
const sorted = (xs: number[]) => xs.slice().sort((p, q) => p - q);
/** Q1 and Q3 of a sorted list as the medians of its lower and upper halves (the middle value of an odd list in neither), and the IQR. */
function quartileSplit(xs: number[]): { q1: number; q3: number; iqr: number } {
  const n = xs.length;
  const lower = xs.slice(0, Math.floor(n / 2));
  const upper = xs.slice(Math.ceil(n / 2));
  const q1 = lower.length ? median(lower) : xs[0];
  const q3 = upper.length ? median(upper) : xs[n - 1];
  return { q1, q3, iqr: tidy(q3 - q1, Math.max(Math.abs(q1), Math.abs(q3))) };
}

def(['mean', 'avg', 'average'], { min: 1, max: Infinity, fn: (a) => mean(data(a, 'mean')) });
def('median', { min: 1, max: Infinity, fn: (a) => median(sorted(data(a, 'median'))) });
def('mode', {
  min: 1, max: Infinity, fn: (a) => {
    const xs = data(a, 'mode');
    const counts = new Map<number, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const top = maxOf([...counts.values()]);
    if (top === 1 && xs.length > 1) fail('No mode: every value appears once');
    const modes = [...counts].filter(([, c]) => c === top).map(([v]) => v).sort((p, q) => p - q);
    if (modes.length === counts.size && counts.size > 1) fail('No mode: every value appears equally often');
    return modes.length === 1 ? modes[0] : list(modes);
  },
});
def('range', { min: 1, max: Infinity, fn: (a) => { const xs = data(a, 'range'); const hi = maxOf(xs), lo = minOf(xs); return tidy(hi - lo, Math.max(Math.abs(hi), Math.abs(lo))); } });
def('min', { min: 1, max: Infinity, fn: (a) => minOf(data(a, 'min')) });
def('max', { min: 1, max: Infinity, fn: (a) => maxOf(data(a, 'max')) });
def(['len', 'length'], { min: 1, max: 1, fn: (a) => nums(a[0]).length });
def('sort', { min: 1, max: 1, fn: (a) => list(sorted(nums(a[0]))) });
def(['varp', 'var_p'], { min: 1, max: Infinity, fn: (a) => variance(data(a, 'varp'), false) });
def(['vars', 'var_s'], { min: 1, max: Infinity, fn: (a) => variance(data(a, 'vars'), true) });
def(['sdp', 'sd_p', 'stdevp'], { min: 1, max: Infinity, fn: (a) => tidy(Math.sqrt(variance(data(a, 'sdp'), false))) });
def(['sds', 'sd_s', 'stdev'], { min: 1, max: Infinity, fn: (a) => tidy(Math.sqrt(variance(data(a, 'sds'), true))) });
def('var', {
  min: 1, max: Infinity, fn: (a, env) => {
    env.note(env.settings.sample ? 'Sample variance (÷ n−1)' : 'Population variance (÷ n)');
    return variance(data(a, 'var'), env.settings.sample);
  },
});
def('sd', {
  min: 1, max: Infinity, fn: (a, env) => {
    env.note(env.settings.sample ? 'Sample SD (÷ n−1)' : 'Population SD (÷ n)');
    return tidy(Math.sqrt(variance(data(a, 'sd'), env.settings.sample)));
  },
});
def('fivenum', {
  min: 1, max: Infinity, fn: (a) => {
    const xs = sorted(data(a, 'fivenum'));
    const { q1, q3, iqr } = quartileSplit(xs);
    return record('Five-number summary', [
      { label: 'min', value: xs[0] },
      { label: 'Q1', value: q1 },
      { label: 'median', value: median(xs) },
      { label: 'Q3', value: q3 },
      { label: 'max', value: xs[xs.length - 1] },
      { label: 'IQR', value: iqr },
    ]);
  },
});
def('stats', {
  min: 1, max: Infinity, fn: (a) => {
    const xs = data(a, 'stats');
    return record('Summary', [
      { label: 'n', value: xs.length },
      { label: 'mean', value: mean(xs) },
      { label: 'σ (population)', value: tidy(Math.sqrt(variance(xs, false))) },
      ...(xs.length > 1 ? [{ label: 's (sample)', value: tidy(Math.sqrt(variance(xs, true))) }] : []),
      { label: 'Σx', value: tidySum(xs) },
    ]);
  },
});

def('percentile', {
  min: 2, max: 2, usage: 'percentile(list, p) with p from 0 to 100, interpolating between values', fn: (a) => {
    const xs = sorted(data([a[0]], 'percentile'));
    const p = num(a[1], 'p');
    if (!(p >= 0 && p <= 100)) fail(`p must be a percent from 0 to 100, got ${p}`);
    const rank = (p / 100) * (xs.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.min(lo + 1, xs.length - 1);
    return tidy(xs[lo] + (rank - lo) * (xs[hi] - xs[lo]), Math.max(Math.abs(xs[lo]), Math.abs(xs[hi])));
  },
});
def('quartiles', {
  min: 1, max: Infinity, usage: 'quartiles(list): Q1, median, Q3 (same method as fivenum)', fn: (a) => {
    const xs = sorted(data(a, 'quartiles'));
    const { q1, q3, iqr } = quartileSplit(xs);
    return record('Quartiles', [
      { label: 'Q1', value: q1 },
      { label: 'Q2 (median)', value: median(xs) },
      { label: 'Q3', value: q3 },
      { label: 'IQR', value: iqr },
    ]);
  },
});
def(['gmean', 'geomean'], {
  min: 1, max: Infinity, usage: 'gmean(list): geometric mean of positive numbers', fn: (a) => {
    const xs = data(a, 'gmean');
    if (xs.some((x) => x <= 0)) fail('gmean needs every value to be positive');
    return tidy(Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length));
  },
});
def(['hmean', 'harmean'], {
  min: 1, max: Infinity, usage: 'hmean(list): harmonic mean of positive numbers', fn: (a) => {
    const xs = data(a, 'hmean');
    if (xs.some((x) => x <= 0)) fail('hmean needs every value to be positive');
    return tidy(xs.length / xs.reduce((s, x) => s + 1 / x, 0));
  },
});
def('wmean', {
  min: 2, max: 2, usage: 'wmean(values, weights)', fn: (a) => {
    const xs = nums(a[0], 'values'), ws = nums(a[1], 'weights');
    if (xs.length !== ws.length) fail(`${xs.length} values but ${ws.length} weights`);
    if (ws.some((w) => w < 0)) fail('Weights can\'t be negative');
    const total = ws.reduce((s, w) => s + w, 0);
    if (total === 0) fail('The weights add to 0');
    return tidy(xs.reduce((s, x, k) => s + x * ws[k], 0) / total, xs.reduce((s, x, k) => s + Math.abs(x * ws[k]), 0) / total);
  },
});
def('mad', {
  min: 1, max: Infinity, usage: 'mad(list): mean absolute deviation from the mean', fn: (a) => {
    const xs = data(a, 'mad');
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    return tidy(xs.reduce((s, x) => s + Math.abs(x - m), 0) / xs.length, xs.length * maxOf(xs.map(Math.abs)));
  },
});
def('zscores', {
  min: 1, max: 1, usage: 'zscores(list): each value as (x − mean)/σ, population SD', fn: (a) => {
    const xs = data(a, 'zscores');
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(variance(xs, false));
    if (sd === 0) fail('Every value is the same (SD is 0), so z-scores are undefined');
    return list(xs.map((x) => tidy((x - m) / sd, (Math.abs(x) + Math.abs(m)) / sd)));
  },
});
def('cumsum', {
  min: 1, max: 1, usage: 'cumsum(list): running totals', fn: (a) => {
    let s = 0, size = 0;
    return list(nums(a[0]).map((x) => { size += Math.abs(x); return tidy((s += x), size); }));
  },
});
def(['dedupe', 'unique'], {
  min: 1, max: 1, usage: 'dedupe(list): drop repeats, keeping the first of each', fn: (a) => {
    const v = a[0];
    if (typeof v !== 'object' || v.t !== 'list') return fail(`dedupe needs a list like {1, 2, 2}, got a ${typeName(v)}`);
    const seen = new Set<string>();
    return list(v.items.filter((x) => {
      const key = JSON.stringify(x);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  },
});

// ---------- normal distribution ----------
function sigma(x: Value): number {
  return pos(num(x, 'σ'), 'σ');
}
def('zscore', { min: 3, max: 3, usage: 'zscore(x, μ, σ)', fn: (a) => { const s = sigma(a[2]); const m = num(a[1], 'μ'); return mapNum(a[0], (x) => tidy((x - m) / s, (Math.abs(x) + Math.abs(m)) / s), 'zscore'); } });
def(['x_from_z', 'xfromz'], { min: 3, max: 3, usage: 'x_from_z(z, μ, σ)', fn: (a) => { const s = sigma(a[2]); const m = num(a[1], 'μ'); return mapNum(a[0], (z) => tidy(m + z * s, Math.abs(m) + Math.abs(z * s)), 'x_from_z'); } });
def('normalpdf', {
  min: 1, max: 3, usage: 'normalpdf(x) or normalpdf(x, μ, σ)', fn: (a) => {
    const m = a.length === 3 ? num(a[1], 'μ') : 0;
    const s = a.length === 3 ? sigma(a[2]) : 1;
    if (a.length === 2) fail('normalpdf takes (x) or (x, μ, σ)');
    return mapNum(a[0], (x) => normPdf((x - m) / s) / s, 'normalpdf');
  },
});
def('normalcdf', {
  min: 1, max: 4, prob: true, usage: 'normalcdf(z), normalcdf(a, b), or normalcdf(a, b, μ, σ)', fn: (a) => {
    if (a.length === 1) return mapNum(a[0], normCdf, 'normalcdf');
    if (a.length === 3) fail('normalcdf takes (z), (a, b), or (a, b, μ, σ). For one bound with μ and σ use normleft(x, μ, σ)');
    const lo = num(a[0], 'Lower bound');
    const hi = num(a[1], 'Upper bound');
    const m = a.length === 4 ? num(a[2], 'μ') : 0;
    const s = a.length === 4 ? sigma(a[3]) : 1;
    if (lo > hi) fail(`Lower bound ${lo} is above upper bound ${hi}`);
    return normBetween((lo - m) / s, (hi - m) / s);
  },
});
function normArgs(a: Value[], k: number): [number, number] {
  return [a.length > k ? num(a[k], 'μ') : 0, a.length > k + 1 ? sigma(a[k + 1]) : 1];
}
def('normleft', { min: 1, max: 3, prob: true, usage: 'normleft(x, μ, σ) = P(X < x)', fn: (a) => { const [m, s] = normArgs(a, 1); return normCdf((num(a[0], 'x') - m) / s); } });
def('normright', { min: 1, max: 3, prob: true, usage: 'normright(x, μ, σ) = P(X > x)', fn: (a) => { const [m, s] = normArgs(a, 1); return normCdf(-(num(a[0], 'x') - m) / s); } });
def('normbetween', { min: 2, max: 4, prob: true, usage: 'normbetween(a, b, μ, σ)', fn: (a) => { const [m, s] = normArgs(a, 2); return normBetween((num(a[0], 'a') - m) / s, (num(a[1], 'b') - m) / s); } });
def('normoutside', {
  min: 2, max: 4, prob: true, usage: 'normoutside(a, b, μ, σ) = P(X < a or X > b)', fn: (a) => {
    const [m, s] = normArgs(a, 2);
    const lo = (num(a[0], 'a') - m) / s, hi = (num(a[1], 'b') - m) / s;
    return normCdf(lo) + normCdf(-hi);
  },
});
def(['invNorm', 'invnorm'], {
  min: 1, max: 3, usage: 'invNorm(p) or invNorm(p, μ, σ)', fn: (a) => {
    if (a.length === 2) fail('invNorm takes (p) or (p, μ, σ)');
    const [m, s] = normArgs(a, 1);
    return mapNum(a[0], (p) => { const d = s * invNormStd(prob(p, 'Area')); return tidy(m + d, Math.abs(m) + Math.abs(d)); }, 'invNorm');
  },
});
def('zcrit', {
  min: 1, max: 1, usage: 'zcrit(0.95) → 1.96, the z that leaves the middle 95%', fn: (a) => {
    let c = num(a[0], 'Confidence');
    if (c > 1 && c < 100) c /= 100;
    return invNormStd((1 + prob(c, 'Confidence')) / 2);
  },
});
def('normaldist', {
  min: 0, max: 2, usage: 'normaldist(μ, σ)', fn: (a) => ({
    t: 'normal', mu: a.length > 0 ? num(a[0], 'μ') : 0, sigma: a.length > 1 ? sigma(a[1]) : 1,
  }),
});

const EMPIRICAL_SLICES = [0.15, 2.35, 13.5, 34, 34, 13.5, 2.35, 0.15];
def('empirical', {
  min: 2, max: 4, prob: true, usage: 'empirical(μ, σ) or empirical(μ, σ, a, b)', fn: (a) => {
    const m = num(a[0], 'μ');
    const s = sigma(a[1]);
    if (a.length === 2) {
      const rows = [-3, -2, -1, 0, 1, 2, 3].map((k) => ({
        label: k === 0 ? 'μ' : `μ ${k < 0 ? '−' : '+'} ${Math.abs(k) === 1 ? '' : Math.abs(k)}σ`,
        value: tidy(m + k * s, Math.abs(m) + Math.abs(k * s)) as Value,
      }));
      return record('Empirical rule (68–95–99.7)', [
        ...rows,
        { label: 'within 1σ', value: 0.68 },
        { label: 'within 2σ', value: 0.95 },
        { label: 'within 3σ', value: 0.997 },
        { label: 'slices, left to right (%)', value: list(EMPIRICAL_SLICES) },
      ]);
    }
    if (a.length === 3) fail('empirical takes (μ, σ) or (μ, σ, a, b)');
    const cut = (x: number, what: string): number => {
      if (x === -Infinity) return -4;
      if (x === Infinity) return 4;
      const k = (x - m) / s;
      const r = Math.round(k);
      if (Math.abs(k - r) > 1e-9 || Math.abs(r) > 3)
        fail(`${what} = ${x} is not on a cut point (μ ± 0, 1, 2, or 3σ). Use normalcdf for other values`);
      return r;
    };
    const lo = cut(num(a[2], 'a'), 'a'), hi = cut(num(a[3], 'b'), 'b');
    if (lo > hi) fail('a must be below b');
    let pct = 0;
    for (let k = Math.max(lo, -4); k < Math.min(hi, 4); k++) pct += EMPIRICAL_SLICES[k + 4];
    return tidy(pct / 100);
  },
});

// ---------- binomial ----------
function binArgs(a: Value[]): [number, number] {
  const n = num(a[0], 'n');
  if (!isWhole(n) || n < 0) fail(`n must be a whole number ≥ 0, got ${n}`);
  if (n > Number.MAX_SAFE_INTEGER) fail(`n must be at most 2^53 − 1 (9007199254740991), got ${n}`);
  return [n, prob(num(a[1], 'p'))];
}
/** The list forms hold one entry per k. A million-entry list took seconds and gigabytes; a homework n is far smaller. */
function binList(fn: string, n: number): void {
  if (n > 100_000) fail(`${fn}(n, p) lists every k, which works up to n = 100000. Ask for one k with ${fn}(n, p, k)`);
}
def('binompdf', {
  min: 2, max: 3, prob: true, usage: 'binompdf(n, p, k)', fn: (a) => {
    const [n, p] = binArgs(a);
    if (a.length === 2) {
      binList('binompdf', n);
      return list(Array.from({ length: n + 1 }, (_, k) => binomPdf(n, p, k)));
    }
    return mapNum(a[2], (k) => binomPdf(n, p, whole(k, 'k')), 'binompdf');
  },
});
def(['binomcdf', 'binomle'], {
  min: 2, max: 3, prob: true, usage: 'binomcdf(n, p, k) = P(X ≤ k)', fn: (a) => {
    const [n, p] = binArgs(a);
    if (a.length === 2) {
      binList('binomcdf', n);
      let s = 0;
      return list(Array.from({ length: n + 1 }, (_, k) => (s = Math.min(1, s + binomPdf(n, p, k)))));
    }
    return mapNum(a[2], (k) => binomRange(n, p, 0, k), 'binomcdf');
  },
});
def('binomlt', { min: 3, max: 3, prob: true, usage: 'binomlt(n, p, k) = P(X < k)', fn: (a) => { const [n, p] = binArgs(a); return binomRange(n, p, 0, Math.ceil(num(a[2], 'k')) - 1); } });
def('binomge', { min: 3, max: 3, prob: true, usage: 'binomge(n, p, k) = P(X ≥ k)', fn: (a) => { const [n, p] = binArgs(a); return binomRange(n, p, num(a[2], 'k'), n); } });
def('binomgt', { min: 3, max: 3, prob: true, usage: 'binomgt(n, p, k) = P(X > k)', fn: (a) => { const [n, p] = binArgs(a); return binomRange(n, p, Math.floor(num(a[2], 'k')) + 1, n); } });
def('binombetween', { min: 4, max: 4, prob: true, usage: 'binombetween(n, p, a, b) = P(a ≤ X ≤ b)', fn: (a) => { const [n, p] = binArgs(a); return binomRange(n, p, num(a[2], 'a'), num(a[3], 'b')); } });
def('binommean', { min: 2, max: 2, usage: 'binommean(n, p) = np', fn: (a) => { const [n, p] = binArgs(a); return tidy(n * p); } });
def('binomvar', { min: 2, max: 2, usage: 'binomvar(n, p) = np(1−p)', fn: (a) => { const [n, p] = binArgs(a); return tidy(n * p * (1 - p)); } });
def('binomsd', { min: 2, max: 2, usage: 'binomsd(n, p) = √(np(1−p))', fn: (a) => { const [n, p] = binArgs(a); return tidy(Math.sqrt(n * p * (1 - p))); } });
def('binomstats', {
  min: 2, max: 2, usage: 'binomstats(n, p)', fn: (a) => {
    const [n, p] = binArgs(a);
    return record(`Binomial n = ${n}, p = ${p}`, [
      { label: 'mean np', value: tidy(n * p) },
      { label: 'variance np(1−p)', value: tidy(n * p * (1 - p)) },
      { label: 'SD √(np(1−p))', value: tidy(Math.sqrt(n * p * (1 - p))) },
    ]);
  },
});
def('binomdist', { min: 2, max: 2, usage: 'binomdist(n, p)', fn: (a) => { const [n, p] = binArgs(a); return { t: 'binom', n, p }; } });

// ---------- expected value, margin of error, proportions ----------
function evParts(a: Value[], env: Env): number {
  const xs = nums(a[0], 'values');
  const ps = nums(a[1], 'probabilities');
  if (xs.length !== ps.length) fail(`${xs.length} values but ${ps.length} probabilities`);
  ps.forEach((p) => prob(p, 'Each probability'));
  const total = tidy(ps.reduce((p, q) => p + q, 0));
  if (Math.abs(total - 1) > 1e-9) env.note(warningNote(`probabilities add to ${total}, not 1`));
  return weightedTotal(xs, ps);
}
def(['EV', 'ev', 'expected'], { min: 2, max: 2, usage: 'EV({values}, {probabilities})', fn: (a, env) => evParts(a, env) });
def('netgain', { min: 3, max: 3, usage: 'netgain({values}, {probs}, cost) = EV − cost', fn: (a, env) => { const ev = evParts(a, env), cost = num(a[2], 'cost'); return tidy(ev - cost, Math.abs(ev) + Math.abs(cost)); } });
def('moe', {
  min: 1, max: 2, usage: 'moe(n) = 1/√n, or moe(z, n) = z/√n', fn: (a) => {
    const n = pos(num(a[a.length - 1], 'n'), 'n');
    const z = a.length === 2 ? num(a[0], 'z') : 1;
    return z / Math.sqrt(n);
  },
});
def('moep', {
  min: 3, max: 3, usage: 'moep(p̂, n, z) = z·√(p̂(1−p̂)/n)', fn: (a) => {
    const p = prob(num(a[0], 'p̂'), 'p̂');
    const n = pos(num(a[1], 'n'), 'n');
    return num(a[2], 'z') * Math.sqrt((p * (1 - p)) / n);
  },
});
def(['phat', 'p_hat'], {
  min: 2, max: 2, prob: true, usage: 'phat(x, n) = x/n', fn: (a) => {
    const x = num(a[0], 'x'), n = pos(num(a[1], 'n'), 'n');
    if (x < 0 || x > n) fail(`phat(x, n) is x successes out of n, so x must be from 0 to n. Got x = ${x}, n = ${n}`);
    return tidy(x / n);
  },
});
def(['sep', 'se_p'], {
  min: 2, max: 2, usage: 'sep(p, n) = √(p(1−p)/n)', fn: (a) => {
    const p = prob(num(a[0], 'p'));
    return Math.sqrt((p * (1 - p)) / pos(num(a[1], 'n'), 'n'));
  },
});

// ---------- algebra helpers ----------
def('compound', {
  min: 4, max: 4, usage: 'compound(P, r, n, t) = P(1 + r/n)^(nt)', fn: (a) => {
    const [P, r, n, t] = a.map((v, k) => num(v, ['P', 'r', 'n', 't'][k]));
    pos(n, 'n (compounds per year)');
    return P * Math.pow(1 + r / n, n * t);
  },
});
def('continuous', {
  min: 3, max: 3, usage: 'continuous(P, r, t) = Pe^(rt)', fn: (a) => {
    const [P, r, t] = a.map((v, k) => num(v, ['P', 'r', 't'][k]));
    return P * Math.exp(r * t);
  },
});
def('quad', {
  min: 3, max: 3, usage: 'quad(a, b, c) solves ax² + bx + c = 0', fn: (a, env) => {
    const [qa, qb, qc] = a.map((v, k) => num(v, ['a', 'b', 'c'][k]));
    if (qa === 0) {
      if (qb === 0) fail('Not an equation in x (a and b are both 0)');
      return tidy(-qc / qb);
    }
    const d = qb * qb - 4 * qa * qc;
    if (d < 0) {
      if (!env.settings.complex) fail(`No real roots (discriminant ${tidy(d, qb * qb + Math.abs(4 * qa * qc))} < 0). Turn on Complex mode for complex roots`);
      const re = tidy(-qb / (2 * qa)), im = tidy(Math.sqrt(-d) / (2 * Math.abs(qa)));
      return list([complex(re, -im), complex(re, im)]);
    }
    if (d === 0) return tidy(-qb / (2 * qa));
    // Stable form avoids cancellation when b² ≫ 4ac.
    const q = -0.5 * (qb + Math.sign(qb || 1) * Math.sqrt(d));
    const r1 = q / qa, r2 = qc / q;
    return list([tidy(Math.min(r1, r2)), tidy(Math.max(r1, r2))]);
  },
});

/**
 * solve(t^2 = 9) solves for the equation's one unknown name, as solve(3x = 12) does for x; with none or several, x.
 * A name a sum or integral binds isn't unknown, and with a = 2 the unknown in at = 8 is t, as at reads a·t.
 */
export function soleUnknown(eq: Node, known: (name: string) => boolean): string {
  const unknown = new Set<string>();
  const isKnown = (n: string, bound: ReadonlySet<string>) => bound.has(n) || known(n) || n in B || n in CONSTANTS;
  const visit = (n: Node, bound: ReadonlySet<string>): void => {
    if (n.k === 'id' && !isKnown(n.name, bound)) {
      // Split only when one letter is left unknown: price stays a name though e is a constant.
      const rest = new Set(lettersOf(n.name)?.filter((l) => !isKnown(l, bound)));
      unknown.add(rest.size === 1 ? [...rest][0] : n.name);
    }
    if (n.k === 'call' && B[n.name]?.binds && n.args[1]?.k === 'id') {
      visit(n.args[0], new Set([...bound, n.args[1].name]));
      n.args.slice(2).forEach((a) => visit(a, bound));
      return;
    }
    children(n).forEach((c) => visit(c, bound));
  };
  visit(eq, new Set());
  return unknown.size === 1 ? [...unknown][0] : 'x';
}

function boundVar(args: Node[], fallback: string): string {
  const n = args[1];
  if (!n) return fallback;
  if (n.k !== 'id') fail('The variable must be a plain name, like x or n');
  return n.name;
}

function equationNode(n: Node): Node {
  if (n.k === 'rel') {
    if (n.ops.length !== 1 || n.ops[0] !== '=') fail('solve needs an equation like 2^x = 10, or an expression equal to 0');
    return { k: 'bin', op: '-', a: n.items[0], b: n.items[1] };
  }
  return n;
}

def('solve', {
  min: 1, max: 4, binds: true, usage: 'solve(equation, x) or solve(equation, x, guess) or solve(equation, x, low, high)',
  lazy: (args, locals, env, compile) => {
    const v = boundVar(args, args[1] ? 'x' : soleUnknown(args[0], (n) => locals.includes(n) || env.hasVar(n) || env.hasFunc(n)));
    const f = compile(equationNode(args[0]), [...locals, v]);
    const guessFn = args.length === 3 ? compile(args[2], locals) : null;
    const lowFn = args.length === 4 ? compile(args[2], locals) : null;
    const highFn = args.length === 4 ? compile(args[3], locals) : null;
    const hasTrig = usesTrig(args[0]);
    return (s) => {
      const F = numberFn(f, s);
      if (lowFn && highFn) {
        const lo = num(lowFn(s), 'The low end'), hi = num(highFn(s), 'The high end');
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) fail(`Both ends of the range have to be numbers: solve(…, ${v}, low, high)`);
        if (lo >= hi) fail(`The low end comes first: solve(…, ${v}, low, high)`);
        const roots = scanRoots(F, lo, hi, true);
        const unit = hasTrig && env.settings.deg ? '°' : '';
        const range = `${v} from ${angleText(lo)}${unit} to ${angleText(hi)}${unit}`;
        if (roots.length === 0) fail(`No solution found for ${range}`);
        env.note(`Scanned ${range}, ends included: ${roots.length} solution${roots.length === 1 ? '' : 's'}`);
        // The scan takes SCAN_STEPS steps and finds at most one crossing in each, so a curve that crosses this often
        // has crossings it stepped over: sin(10000x) = 0 from 0° to 360° has 20,001 and the scan saw a sixth of them.
        if (roots.length > SCAN_STEPS / 10) env.note(warningNote('These are packed too closely for the scan to find them all. Narrow the range to be sure of every one'));
        return roots.length === 1 ? roots[0] : list(roots);
      }
      if (guessFn) {
        const g = num(guessFn(s), 'Guess');
        const r = secant(F, g);
        if (r !== null) {
          env.note(`Started from ${v} = ${shortNumber(g)}, so this is one solution near it`);
          return tidy(r, 1); // The search stops at 1e-14, so a smaller answer is its own noise.
        }
      }
      const roots = scanRoots(F, -100, 100);
      if (roots.length === 0)
        fail(`No solution found for ${v} between −100 and 100. Add a starting guess: solve(…, ${v}, guess)`);
      env.note(`Searched ${v} from −100 to 100${hasTrig ? `. Trig repeats, so there may be more: solve(…, ${v}, ${env.settings.deg ? '0, 360' : '0, 2π'}) lists a range` : ''}`);
      return roots.length === 1 ? roots[0] : list(roots);
    };
  },
});

function secant(F: (x: number) => number, x0: number): number | null {
  let a = x0, b = x0 + 1e-4 * Math.max(1, Math.abs(x0));
  let fa = F(a), fb = F(b);
  for (let k = 0; k < 100; k++) {
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
    if (fb === 0) return b;
    const d = fb - fa;
    if (d === 0) break;
    const c = b - (fb * (b - a)) / d;
    a = b; fa = fb; b = c; fb = F(b);
    if (Math.abs(b - a) < 1e-14 * Math.max(1, Math.abs(b))) break;
  }
  return Number.isFinite(fb) && Math.abs(fb) < 1e-9 ? b : null;
}

function bisect(F: (x: number) => number, lo: number, hi: number, flo = F(lo)): number {
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = F(mid);
    if (fm === 0 || mid === lo || mid === hi) return mid;
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The x where a curve touches zero between three samples without crossing it (sin x = 1 at 90°), or null. A touch has no
 * sign change, so it's found as the zero of the slope, good to about 10 digits.
 */
function touchRoot(F: (x: number) => number, a: number, m: number, b: number, fa: number, fm: number, fb: number): number | null {
  if (!(fa * fm > 0 && fm * fb > 0)) return null;
  const A = Math.abs(fa), M = Math.abs(fm), B = Math.abs(fb);
  const bend = A - 2 * M + B;
  if (M > A || M >= B || bend <= 0) return null;
  if (M - (A - B) ** 2 / (8 * bend) > 0.1 * Math.max(A, B)) return null;
  const d = Math.min(1e-5 * Math.max(1, Math.abs(m)), (b - a) / 8);
  const slope = (x: number) => F(x + d) - F(x - d);
  const sa = slope(a);
  if (!(sa * slope(b) < 0)) return null;
  const x = bisect(slope, a, b, sa);
  const close = 1e-10 * Math.max(1, A, B);
  const rounded = Number(x.toPrecision(10));
  if (Math.abs(F(rounded)) <= close) return rounded;
  return Math.abs(F(x)) <= close ? x : null;
}

const SCAN_STEPS = 4000;
function scanRoots(F: (x: number) => number, lo: number, hi: number, touching = false): number[] {
  const steps = SCAN_STEPS;
  const out: number[] = [];
  const h = (hi - lo) / steps;
  let x0 = lo, f0 = F(lo), before = NaN;
  for (let k = 1; k <= steps; k++) {
    const x1 = k === steps ? hi : lo + k * h, f1 = F(x1);
    if (f0 === 0) out.push(x0);
    else if (Number.isFinite(f0) && Number.isFinite(f1) && f0 * f1 < 0) {
      const r = bisect(F, x0, x1, f0);
      // A sign change across a pole (like 1/x at 0) is not a root.
      if (Math.abs(F(r)) < 1e-6 * Math.max(1, Math.abs(f0), Math.abs(f1))) out.push(r);
    }
    if (touching && k >= 2) {
      const r = touchRoot(F, x0 - h, x0, x1, before, f0, f1);
      if (r !== null) out.push(r);
    }
    before = f0;
    x0 = x1; f0 = f1;
  }
  if (f0 === 0) out.push(x0);
  const roots = [...new Set(out.map((r) => tidy(Number(r.toPrecision(13)), 1)))];
  if (!touching) return roots;
  return roots.sort((a, b) => a - b).filter((r, k, all) => k === 0 || r - all[k - 1] > 1e-9 * Math.max(1, Math.abs(r)));
}

// ---------- calculus ----------
const usesTrig = (n: Node): boolean => ((n.k === 'id' || n.k === 'call') && TRIG.has(n.name)) || children(n).some(usesTrig);
const DEG_CALCULUS_NOTE = 'Deg mode is on, so trig inside uses degrees. Switch to Rad for the usual calculus results';

function derivative(order: 1 | 2): Builtin {
  const name = order === 1 ? 'deriv' : 'deriv2';
  return {
    min: 2, max: 3, binds: true, readsBound: true, usage: `${name}(expression, x, a) at x = a, or ${name}(expression, x) at the current x`,
    lazy: (args, locals, env, compile) => {
      const v = boundVar(args, 'x');
      if (args.length === 2 && !locals.includes(v) && !env.hasVar(v))
        fail(`${name}(expression, ${v}) needs a point to work at: ${name}(expression, ${v}, 2). In a graph, y = ${name}(x^3, x) works`);
      const body = compile(args[0], [...locals, v]);
      const at = compile(args[2] ?? args[1], locals);
      const degNote = env.settings.deg && usesTrig(args[0]);
      return (s) => {
        if (degNote) env.note(DEG_CALCULUS_NOTE);
        const a = num(at(s), 'The point');
        const F = numberFn(body, s);
        const fa = F(a);
        if (!Number.isFinite(fa)) fail(`The expression isn't defined at ${v} = ${a}`);
        const { value, err } = ridders(F, a, order);
        const scale = Math.max(1, Math.abs(value));
        if (!Number.isFinite(value) || err > (order === 1 ? 1e-6 : 1e-4) * scale)
          fail(`The ${order === 1 ? '' : 'second '}derivative at ${v} = ${a} doesn't settle. The curve may have a corner, cusp, jump, or vertical tangent there`);
        if (order === 1) {
          // A corner like |x| at 0 has matching central differences but different one-sided slopes.
          const gap = (h: number) => Math.abs((F(a + h) - fa) / h - (fa - F(a - h)) / h);
          const h = 1e-5 * Math.max(1, Math.abs(a));
          const g1 = gap(h), g2 = gap(h / 10);
          if (g1 > 1e-4 * Math.max(scale, Math.abs(fa)) && g2 > 0.5 * g1)
            fail(`The slope from the left and right differ at ${v} = ${a}, so there's no derivative there (a corner)`);
        }
        // The estimate's own error, or rounding in the function's values, is where a small answer turns into noise.
        return tidy(value, Math.abs(fa) + err * 1e14);
      };
    },
  };
}
def('deriv', derivative(1));
def('deriv2', derivative(2));
def('integral', {
  min: 4, max: 4, binds: true, usage: 'integral(expression, x, a, b), with -inf or inf allowed as bounds',
  lazy: (args, locals, env, compile) => {
    const v = boundVar(args, 'x');
    const body = compile(args[0], [...locals, v]);
    const lo = compile(args[2], locals);
    const hi = compile(args[3], locals);
    const degNote = env.settings.deg && usesTrig(args[0]);
    return (s) => {
      if (degNote) env.note(DEG_CALCULUS_NOTE);
      const F = numberFn(body, s), a = num(lo(s), 'Lower bound'), b = num(hi(s), 'Upper bound');
      let big = 0;
      const { value, err } = integrate((x) => { const y = F(x); big = Math.max(big, Math.abs(y)); return y; }, a, b);
      const rel = err / Math.max(1e-300, Math.abs(value));
      if (rel > 1e-9) env.note(`Accurate to about ${Math.max(1, Math.floor(-Math.log10(rel)))} significant digits`);
      return tidy(value, big * (Number.isFinite(b - a) ? Math.abs(b - a) : 1));
    };
  },
});

function seriesArgs(args: Node[], locals: string[], compile: Compile, fn: string) {
  if (args.length !== 4) fail(`${fn} takes (list) or (expression, n, start, end)`);
  const v = boundVar(args, 'n');
  const body = compile(args[0], [...locals, v]);
  const from = compile(args[2], locals);
  const to = compile(args[3], locals);
  return { body, from, to };
}

function seriesLoop(s: Value[], body: Fn, from: Fn, to: Fn, each: (v: Value) => void): void {
  const a = num(from(s), 'Start'), b = num(to(s), 'End');
  if (!isWhole(a) || !isWhole(b)) fail('Start and end must be whole numbers');
  if (b - a > 1e6) fail('That is more than a million terms');
  const sc = s.slice();
  const slot = s.length;
  for (let k = a; k <= b; k++) {
    sc[slot] = k;
    const v = body(sc);
    charge(typeof v === 'object' && v.t === 'list' ? v.items.length : 0);
    each(v);
  }
}

def(['sum', 'Σ'], {
  min: 1, max: 4, binds: true, usage: 'sum(list) or sum(expression, n, start, end)',
  lazy: (args, locals, _env, compile) => {
    if (args.length === 1) {
      const a = compile(args[0], locals);
      return (s) => tidySum(nums(a(s)));
    }
    const { body, from, to } = seriesArgs(args, locals, compile, 'sum');
    return (s) => {
      let acc: Value = 0, size = 0;
      seriesLoop(s, body, from, to, (v) => {
        if (typeof v === 'number') size += Math.abs(v);
        acc = typeof acc === 'number' && typeof v === 'number' ? acc + v : arith('+', acc, v);
      });
      return typeof acc === 'number' ? tidy(acc, size) : acc;
    };
  },
});
def(['prod', 'Π'], {
  min: 1, max: 4, binds: true, usage: 'prod(list) or prod(expression, n, start, end)',
  lazy: (args, locals, _env, compile) => {
    if (args.length === 1) {
      const a = compile(args[0], locals);
      return (s) => nums(a(s)).reduce((p, q) => p * q, 1);
    }
    const { body, from, to } = seriesArgs(args, locals, compile, 'prod');
    return (s) => {
      let acc = 1;
      seriesLoop(s, body, from, to, (v) => { acc *= num(v, 'Each term'); });
      return acc;
    };
  },
});
def('seq', {
  min: 4, max: 4, binds: true, usage: 'seq(expression, n, start, end)',
  lazy: (args, locals, _env, compile) => {
    const { body, from, to } = seriesArgs(args, locals, compile, 'seq');
    return (s) => {
      const out: Value[] = [];
      seriesLoop(s, body, from, to, (v) => out.push(v));
      return list(out);
    };
  },
});

// ---------- matrices & vectors ----------
const vec = (v: Value, what = 'Input'): number[] => coordsOf(v, what, 'vector like ⟨3, 4⟩ or [3, 4]');

def('det', { min: 1, max: 1, fn: (a) => determinant(mat(a[0])) });
def(['inv', 'inverse'], {
  min: 1, max: 1, fn: (a) => {
    const m = mat(a[0]);
    const r = matInverse(m);
    if (!r) fail('Matrix is singular (determinant 0), so it has no inverse');
    return matrix(r);
  },
});
def(['transpose', 'trans'], { min: 1, max: 1, fn: (a) => { const m = mat(a[0]); return matrix(m[0].map((_, j) => m.map((r) => r[j]))); } });
def('identity', {
  min: 1, max: 1, usage: 'identity(n)', fn: (a) => {
    const n = whole(num(a[0], 'Size'), 'Size');
    if (n < 1 || n > 20) fail('Size must be between 1 and 20');
    return matrix(identity(n));
  },
});
def('rref', {
  min: 1, max: 1, fn: (a) => {
    const m = mat(a[0]).map((r) => r.slice());
    const rows = m.length, cols = m[0].length;
    // "Zero" is relative to the matrix's own entries: a fixed 1e-12 left [[1e-13, 2e-13], [3e-13, 4e-13]] unreduced.
    const tol = PIVOT_TOL * Math.max(1e-300, maxOf(m.flat().map(Math.abs)));
    // What each entry's size would be with no cancellation, for telling noise from a tiny true entry.
    const size = m.map((r) => r.map(Math.abs));
    let lead = 0, rank = 0;
    for (let r = 0; r < rows && lead < cols; r++) {
      // The largest entry in the column is the pivot (partial pivoting), which keeps rounding error small.
      let i = -1;
      for (; lead < cols; lead++) {
        let best = r;
        for (let k = r + 1; k < rows; k++) if (Math.abs(m[k][lead]) > Math.abs(m[best][lead])) best = k;
        if (Math.abs(m[best][lead]) > tol) {
          i = best;
          break;
        }
      }
      if (i < 0) break;
      [m[i], m[r]] = [m[r], m[i]];
      [size[i], size[r]] = [size[r], size[i]];
      const lv = m[r][lead];
      m[r] = m[r].map((x) => x / lv);
      size[r] = size[r].map((x) => x / Math.abs(lv));
      for (let k = 0; k < rows; k++) {
        if (k === r) continue;
        const f = m[k][lead];
        m[k] = m[k].map((x, j) => x - f * m[r][j]);
        size[k] = size[k].map((x, j) => x + Math.abs(f) * size[r][j]);
      }
      lead++;
      rank++;
    }
    // Rows past the rank hold what the pivot search already called zero.
    return matrix(m.map((x, i) => x.map((y, j) => tidy(y, i < rank ? size[i][j] : tol * 1e14) || 0)));
  },
});
def('linsolve', {
  min: 2, max: 2, usage: 'linsolve(A, B) solves AX = B as A⁻¹B', fn: (a) => {
    const A = mat(a[0], 'A');
    const inv = matInverse(A);
    if (!inv) fail('A is singular (determinant 0): no unique solution');
    const b = a[1];
    const rows = (n: number) => { if (n !== A.length) fail(`B needs one row for each of A's ${A.length} rows, got ${n}`); };
    if (typeof b === 'object' && (b.t === 'vector' || b.t === 'list')) {
      const bs = vec(b);
      rows(bs.length);
      return vector(matMulTidy(inv, bs.map((x) => [x])).map((r) => r[0]));
    }
    const B = mat(b, 'B');
    rows(B.length);
    return matrix(matMulTidy(inv, B));
  },
});
def('vec', { min: 2, max: 3, usage: 'vec(x, y) or vec(x, y, z)', fn: (a) => vector(a.map((v) => num(v, 'Component'))) });
def('dot', {
  min: 2, max: 2, fn: (a) => {
    const u = vec(a[0], 'u'), v = vec(a[1], 'v');
    if (u.length !== v.length) fail(`Vectors have different sizes (${u.length} and ${v.length})`);
    return tidy(u.reduce((s, x, k) => s + x * v[k], 0), u.reduce((s, x, k) => s + Math.abs(x * v[k]), 0));
  },
});
def('cross', {
  min: 2, max: 2, fn: (a) => {
    const u = vec(a[0], 'u'), v = vec(a[1], 'v');
    if (u.length !== 3 || v.length !== 3) fail('cross needs two 3D vectors');
    const minor = (p: number, q: number, r: number, t: number) => tidy(p * q - r * t, Math.abs(p * q) + Math.abs(r * t));
    return vector([minor(u[1], v[2], u[2], v[1]), minor(u[2], v[0], u[0], v[2]), minor(u[0], v[1], u[1], v[0])]);
  },
});
def('mag', { min: 1, max: 1, fn: (a) => tidy(hypotOf(vec(a[0]))) });
def('unit', {
  min: 1, max: 1, fn: (a) => {
    const u = vec(a[0]);
    const m = hypotOf(u);
    if (m === 0) fail('The zero vector has no direction');
    return vector(u.map((x) => tidy(x / m)));
  },
});
def('angle', {
  min: 2, max: 2, usage: 'angle(u, v): angle between two vectors', fn: (a, env) => {
    const u = vec(a[0], 'u'), v = vec(a[1], 'v');
    if (u.length !== v.length) fail(`angle needs two vectors of the same size, got ${u.length} and ${v.length} entries`);
    const nu = hypotOf(u), nv = hypotOf(v);
    if (nu === 0 || nv === 0) fail('A zero vector has no direction, so it makes no angle');
    const d = u.reduce((s, x, k) => s + x * v[k], 0) / (nu * nv);
    return tidy(env.fromRad(Math.acos(Math.max(-1, Math.min(1, d)))));
  },
});

// Transformations (2×2 matrices).
def('rotation', {
  min: 1, max: 1, usage: 'rotation(θ): counterclockwise', fn: (a, env) => {
    const t = env.toRad(num(a[0], 'θ'));
    const c = snapTrig(Math.cos(t)), s = snapTrig(Math.sin(t));
    return matrix([[c, -s], [s, c]]);
  },
});
def('reflectx', { min: 0, max: 0, usage: 'reflection over the x-axis', fn: () => matrix([[1, 0], [0, -1]]) });
def('reflecty', { min: 0, max: 0, usage: 'reflection over the y-axis', fn: () => matrix([[-1, 0], [0, 1]]) });
def('reflectyx', { min: 0, max: 0, usage: 'reflection over y = x', fn: () => matrix([[0, 1], [1, 0]]) });
def('dilation', { min: 1, max: 1, usage: 'dilation(k)', fn: (a) => { const k = num(a[0], 'k'); return matrix([[k, 0], [0, k]]); } });
def('apply', { min: 2, max: 2, usage: 'apply(M, points)', fn: (a) => arith('*', a[0], a[1]) });
def('polygon', {
  min: 1, max: Infinity, usage: 'polygon((0,0), (1,0), (0,1)) or polygon(list of points)', fn: (a) => {
    const pts = points2D(a, 'polygon needs 2D points like (1, 2)');
    if (pts.length < 2) fail('polygon needs at least 2 points');
    return { t: 'polygon', pts };
  },
});
def('vertices', {
  min: 1, max: 1, fn: (a) => {
    const v = a[0];
    if (typeof v === 'object' && v.t === 'polygon') return list(v.pts.map((p) => point(p)));
    return fail('vertices needs a polygon');
  },
});

// ---------- trig ----------
function trig(f: (r: number) => number, name: string, undefinedWhen?: (r: number) => boolean): Builtin {
  return one((x, env) => {
    const r = env.toRad(x);
    env.angleNote();
    if (undefinedWhen && undefinedWhen(r)) fail(`${name}(${x}${env.settings.deg ? '°' : ''}) is undefined`);
    return snapTrig(f(r));
  }, name);
}
const cosZero = (r: number) => Math.abs(snapTrig(Math.cos(r))) === 0;
const sinZero = (r: number) => Math.abs(snapTrig(Math.sin(r))) === 0;
def('sin', trig(Math.sin, 'sin'));
def('cos', trig(Math.cos, 'cos'));
def('tan', trig((r) => Math.sin(r) / Math.cos(r), 'tan', cosZero));
def('sec', trig((r) => 1 / Math.cos(r), 'sec', cosZero));
def('csc', trig((r) => 1 / Math.sin(r), 'csc', sinZero));
def('cot', trig((r) => Math.cos(r) / Math.sin(r), 'cot', sinZero));

function invTrig(f: (x: number) => number, name: string, range: [string, string], domain?: (x: number) => boolean): Builtin {
  return one((x, env) => {
    if (domain && !domain(x)) failLazy(() => `${name}(${x}) is undefined: input must be between −1 and 1`);
    env.note(`${name} gives angles in ${env.settings.deg ? range[0] : range[1]}`);
    return tidy(env.fromRad(f(x)));
  }, name);
}
const unitDomain = (x: number) => x >= -1 && x <= 1;
const outsideDomain = (x: number) => x <= -1 || x >= 1;
def(['asin', 'arcsin'], invTrig(Math.asin, 'asin', ['[−90°, 90°]', '[−π/2, π/2]'], unitDomain));
def(['acos', 'arccos'], invTrig(Math.acos, 'acos', ['[0°, 180°]', '[0, π]'], unitDomain));
def(['atan', 'arctan'], invTrig(Math.atan, 'atan', ['(−90°, 90°)', '(−π/2, π/2)']));
def('acsc', invTrig((x) => Math.asin(1 / x), 'acsc', ['[−90°, 90°], not 0', '[−π/2, π/2], not 0'], outsideDomain));
def('asec', invTrig((x) => Math.acos(1 / x), 'asec', ['[0°, 180°], not 90°', '[0, π], not π/2'], outsideDomain));
def('acot', invTrig((x) => (x === 0 ? Math.PI / 2 : Math.atan(1 / x) + (x < 0 ? Math.PI : 0)), 'acot', ['(0°, 180°)', '(0, π)']));
def('atan2', {
  min: 2, max: 2, usage: 'atan2(y, x)', fn: (a, env) => {
    const y = num(a[0], 'y'), x = num(a[1], 'x');
    if (x === 0 && y === 0) fail('atan2(0, 0) is undefined');
    env.angleNote();
    return tidy(env.fromRad(Math.atan2(y, x)));
  },
});
def('sinh', one(Math.sinh, 'sinh'));
def('cosh', one(Math.cosh, 'cosh'));
def('tanh', one(Math.tanh, 'tanh'));
function shortNumber(x: number): string {
  return String(Number(x.toPrecision(6))).replace('-', '−');
}
function angleText(x: number): string {
  const e = exactForm(x);
  return e && e.includes('π') ? e : shortNumber(x);
}
def(['torad', 'rad'], one((x, env) => {
  const r = (x * Math.PI) / 180;
  env.conversionNote(() => `${shortNumber(x)}° = ${angleText(r)} rad`);
  return r;
}, 'torad'));
def(['todeg', 'deg'], one((x, env) => {
  const d = tidy((x * 180) / Math.PI);
  env.conversionNote(() => `${angleText(x)} rad = ${shortNumber(d)}°`);
  return d;
}, 'todeg'));
function radians(x: number, env: Env, formula: (theta: string) => string): number {
  const rad = env.settings.deg ? (x * Math.PI) / 180 : x;
  if (env.showsWorking) {
    env.workingNote(() => {
      const t = angleText(rad);
      return `${env.settings.deg ? `θ = ${shortNumber(x)}° = ${t} rad, so ` : ''}${formula(t)}`;
    });
  } else if (env.settings.deg) env.note('θ converted from degrees to radians');
  return rad;
}
def(['arclen', 'arclength'], { min: 2, max: 2, usage: 'arclen(r, θ) = rθ', fn: (a, env) => {
  const r = num(a[0], 'r');
  return tidy(r * radians(num(a[1], 'θ'), env, (t) => `s = rθ = ${shortNumber(r)} × ${t}`));
} });
def(['sector', 'sectorarea'], { min: 2, max: 2, usage: 'sector(r, θ) = ½r²θ', fn: (a, env) => {
  const r = num(a[0], 'r');
  return tidy(0.5 * r * r * radians(num(a[1], 'θ'), env, (t) => `A = ½r²θ = ½ × ${shortNumber(r)}² × ${t}`));
} });
def('period', {
  min: 1, max: 1, usage: 'period(b) for a·sin(b(x−c))+d', fn: (a, env) => {
    const b = num(a[0], 'b');
    if (b === 0) fail('b = 0 has no period');
    env.note(env.settings.deg ? '360/|b| (degrees). Tangent repeats every 180/|b|' : '2π/|b| (radians). Tangent repeats every π/|b|');
    return tidy((env.settings.deg ? 360 : 2 * Math.PI) / Math.abs(b));
  },
});
def('trigform', {
  min: 4, max: 4, usage: 'trigform(a, b, c, d) for a·sin(b(x − c)) + d', fn: (a, env) => {
    const [A, b, c, d] = a.map((v, k) => num(v, ['a', 'b', 'c', 'd'][k]));
    if (b === 0) fail('b = 0 has no period');
    const full = env.settings.deg ? 360 : 2 * Math.PI;
    return record('a·sin(b(x − c)) + d', [
      { label: 'amplitude |a|', value: Math.abs(A) },
      { label: `period ${env.settings.deg ? '360' : '2π'}/|b|`, value: tidy(full / Math.abs(b)) },
      { label: 'phase shift c', value: c },
      { label: 'midline y = d', value: d },
      { label: 'max', value: tidy(d + Math.abs(A), Math.abs(d) + Math.abs(A)) },
      { label: 'min', value: tidy(d - Math.abs(A), Math.abs(d) + Math.abs(A)) },
    ]);
  },
});
def('tanform', {
  min: 4, max: 4, usage: 'tanform(a, b, c, d) for a·tan(b(x − c)) + d', fn: (a, env) => {
    const [A, b, c, d] = a.map((v, k) => num(v, ['a', 'b', 'c', 'd'][k]));
    if (b === 0) fail('b = 0 has no period');
    const full = env.settings.deg ? 180 : Math.PI;
    const period = tidy(full / Math.abs(b));
    return record('a·tan(b(x − c)) + d', [
      { label: 'vertical stretch |a|', value: Math.abs(A) },
      { label: `period ${env.settings.deg ? '180' : 'π'}/|b|`, value: period },
      { label: 'phase shift c', value: c },
      { label: 'midline y = d', value: d },
      { label: 'asymptote x = c + period/2', value: tidy(c + full / (2 * Math.abs(b)), Math.abs(c) + full) },
      { label: 'asymptotes repeat every', value: period },
    ]);
  },
});
def('unitcircle', {
  min: 1, max: 1, usage: 'unitcircle(θ)', fn: (a, env) => {
    const t = num(a[0], 'θ');
    const r = env.toRad(t);
    const c = snapTrig(Math.cos(r)), s = snapTrig(Math.sin(r));
    const table = record(`Unit circle at ${angleText(t)}${env.settings.deg ? '°' : ' rad'}`, [
      { label: 'point (cos θ, sin θ)', value: point([c, s]) },
      { label: 'cos θ', value: c },
      { label: 'sin θ', value: s },
      { label: 'tan θ', value: c === 0 ? NaN : snapTrig(s / c) },
      { label: 'sin²θ + cos²θ', value: tidy(s * s + c * c) },
    ]);
    return env.showsWorking ? { ...table, alongside: true, figure: { kind: 'unit-circle' as const, cos: c, sin: s, angle: r } } : table;
  },
});

registerMore(def);
registerHvac(def);

export const BUILTINS = B;

export const readsAsValue = (name: string): boolean => B[name]?.min === 0;

export const BUILTIN_NAMES = Object.keys(B);
