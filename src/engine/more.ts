import { chargeWork, fail } from './errors';
import type { Builtin, Def } from './builtin-types';
import type { Env } from './evaluator';
import {
  type Value, num, nums, list, point, matrix, record, complex, text, typeName, mapNum, tidy, pos, prob, whole,
  determinant, matInverse, matMul, arith,
} from './values';
import {
  erf, erfc, gamma, lgamma, betaFn, tPdf, tBetween, invT, chi2Pdf, chi2Between, fPdf, fBetween,
  poissonPdf, poissonCdf, polyRoots, isWhole, hypotOf, maxOf,
} from './numeric';
import { unitConverter } from './units';
import { gcd } from './exact';
import { superscript } from './lexer';
import { coordsOf, mat, one, points2D } from './args';

function textArg(v: Value, what: string): string {
  if (typeof v === 'object' && v.t === 'text') return v.s;
  return fail(`${what} must be text in quotes, like "ff", got a ${typeName(v)}`);
}

const coords = (v: Value, what: string): number[] => coordsOf(v, what, 'point like (1, 2)', what);

function polyPoints(a: Value[], fn: string): number[][] {
  if (a.length === 1 && typeof a[0] === 'object' && a[0].t === 'polygon') return a[0].pts;
  return points2D(a, `${fn} needs 2D points like (1, 2), a list of them, or a polygon`);
}

function each(v: Value, f: (x: Value) => Value): Value {
  if (typeof v === 'object' && v.t === 'list') return list(v.items.map((x) => each(x, f)));
  return f(v);
}

function mapCx(v: Value, f: (re: number, im: number) => Value, what: string): Value {
  if (typeof v === 'number') return f(v, 0);
  if (v.t === 'complex') return f(v.re, v.im);
  if (v.t === 'list') return list(v.items.map((x) => mapCx(x, f, what)));
  return fail(`${what} needs a number, got a ${typeName(v)}`);
}

function pairs(a: Value[], fn: string, min = 2): [number[], number[]] {
  const xs = nums(a[0], 'x list');
  const ys = nums(a[1], 'y list');
  if (xs.length !== ys.length) fail(`${fn} needs lists of the same length (got ${xs.length} x values and ${ys.length} y values)`);
  if (xs.length < min) fail(`${fn} needs at least ${min} points`);
  return [xs, ys];
}

/** sa and sb are the sizes of the terms that summed to a and b, for telling noise from a tiny true value. */
interface LineFit { a: number; b: number; r: number; sa: number; sb: number }

function lineFit(xs: number[], ys: number[]): LineFit {
  const n = xs.length;
  let mx = 0, my = 0;
  for (let k = 0; k < n; k++) { mx += xs[k]; my += ys[k]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0, size = 0;
  for (let k = 0; k < n; k++) {
    const dx = xs[k] - mx, dy = ys[k] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    size += Math.abs(dx * dy);
  }
  if (sxx === 0) fail('All x values are the same, so no line fits');
  const a = sxy / sxx;
  return { a, b: my - a * mx, r: syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy), sa: size / sxx, sb: Math.abs(my) + Math.abs(a * mx) };
}

function fitRecord(title: string, coef: [string, number, number?][], r: number | null, r2: number): Value {
  const rt = r === null ? null : tidy(r, 1);
  return record(title, [
    ...coef.map(([label, value, scale]) => ({ label, value: tidy(value, scale) as Value })),
    ...(rt === null ? [] : [{ label: 'r', value: rt as Value }]),
    { label: r === null ? 'R²' : 'r²', value: rt === 0 ? 0 : tidy(r2, 1) },
  ]);
}

function covariance(xs: number[], ys: number[], sample: boolean): number {
  const n = xs.length;
  if (sample && n < 2) fail('Sample covariance needs at least 2 points');
  const mx = xs.reduce((p, q) => p + q, 0) / n;
  const my = ys.reduce((p, q) => p + q, 0) / n;
  let s = 0, size = 0, bx = 0, by = 0;
  for (let k = 0; k < n; k++) {
    const t = (xs[k] - mx) * (ys[k] - my);
    s += t;
    size += Math.abs(t);
    bx = Math.max(bx, Math.abs(xs[k]));
    by = Math.max(by, Math.abs(ys[k]));
  }
  const den = sample ? n - 1 : n;
  // The second term is for data with no spread at all, where (x − mx)(y − my) is noise times noise.
  return tidy(s / den, size / den + 1e-14 * n * n * bx * by);
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
/** How far under the largest entry rank reads a pivot as zero. Looser than PIVOT_TOL, and either change would move answers. */
const RANK_TOL = 1e-10;

function intArg(x: number, fn: string, min: number): number {
  whole(x, `${fn} input`);
  if (x < min) fail(`${fn} needs a whole number ≥ ${min}, got ${x}`);
  if (x > MAX_SAFE) fail(`${fn}(${x}) is too large to work on exactly (the limit is 2^53 − 1)`);
  return x;
}

function powMod(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

const SMALL_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];

/** Deterministic Miller–Rabin; these 12 bases are exact for every n below 3.3·10²⁴. */
function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (const p of SMALL_PRIMES) {
    if (n === p) return true;
    if (n % p === 0) return false;
  }
  if (n < 1369) return true;
  const N = BigInt(n);
  let d = N - 1n, s = 0;
  while ((d & 1n) === 0n) { d >>= 1n; s++; }
  outer: for (const p of SMALL_PRIMES) {
    let x = powMod(BigInt(p), d, N);
    if (x === 1n || x === N - 1n) continue;
    for (let r = 1; r < s; r++) {
      x = (x * x) % N;
      if (x === N - 1n) continue outer;
    }
    return false;
  }
  return true;
}

/** A nontrivial factor of composite odd n by Pollard's rho. */
function rho(n: number): number {
  const N = BigInt(n);
  for (let c = 1n; ; c++) {
    const f = (v: bigint) => (v * v + c) % N;
    let x = 2n, y = 2n, d = 1n;
    while (d === 1n) {
      x = f(x);
      y = f(f(y));
      d = gcd(x > y ? x - y : y - x, N);
    }
    if (d !== N) return Number(d);
  }
}

/** Prime → exponent, primes ascending. */
function factorize(n: number): Map<number, number> {
  const out = new Map<number, number>();
  const bump = (p: number) => out.set(p, (out.get(p) ?? 0) + 1);
  let m = n;
  for (let p = 2; p <= 1000 && p * p <= m; p += p === 2 ? 1 : 2) {
    while (m % p === 0) { bump(p); m /= p; }
  }
  const stack = m > 1 ? [m] : [];
  while (stack.length) {
    const k = stack.pop()!;
    if (isPrime(k)) { bump(k); continue; }
    const d = rho(k);
    stack.push(d, k / d);
  }
  return new Map([...out].sort((p, q) => p[0] - q[0]));
}

function divisorsOf(n: number): number[] {
  let ds = [1];
  for (const [p, e] of factorize(n)) {
    const next: number[] = [];
    for (const d of ds) {
      let pk = 1;
      for (let k = 0; k <= e; k++) { next.push(d * pk); pk *= p; }
    }
    ds = next;
  }
  return ds.sort((p, q) => p - q);
}

function toBase(n: number, b: number, fn: string): string {
  whole(n, `${fn} input`);
  if (Math.abs(n) > MAX_SAFE) fail(`${fn}(${n}) is too large to convert exactly (the limit is 2^53 − 1)`);
  return (n < 0 ? '-' : '') + Math.abs(n).toString(b).toUpperCase();
}

function baseArg(v: Value): number {
  const b = num(v, 'Base');
  if (!isWhole(b) || b < 2 || b > 36) fail(`Base must be a whole number from 2 to 36, got ${b}`);
  return b;
}

function fromBase(raw: string, b: number | null): number {
  let s = raw.trim().replace(/[\s_]/g, '');
  let sign = 1;
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (b === null) {
    const m = /^0([xbo])/i.exec(s);
    b = m ? { x: 16, b: 2, o: 8 }[m[1].toLowerCase() as 'x' | 'b' | 'o'] : 10;
    if (m) s = s.slice(2);
  }
  if (!s) fail(`"${raw}" has no digits`);
  const [whole_, frac = ''] = s.split('.');
  if (s.split('.').length > 2) fail(`"${raw}" has more than one point`);
  const digit = (ch: string): number => {
    const d = parseInt(ch, 36);
    if (Number.isNaN(d) || d >= b!) fail(`"${ch}" isn't a digit in base ${b}`);
    return d;
  };
  let v = 0;
  for (const ch of whole_) {
    v = v * b + digit(ch);
    if (v > MAX_SAFE) fail(`"${raw}" is too large to convert exactly (the limit is 2^53 − 1)`);
  }
  let scale = 1 / b;
  for (const ch of frac) {
    v += digit(ch) * scale;
    scale /= b;
  }
  return sign * v;
}

export function registerMore(def: Def): void {
  // Regression on two lists.
  def('linreg', {
    min: 2, max: 2, usage: 'linreg(xs, ys) fits y = ax + b', fn: (a) => {
      const [xs, ys] = pairs(a, 'linreg');
      const f = lineFit(xs, ys);
      return fitRecord('Linear regression y = ax + b', [['a', f.a, f.sa], ['b', f.b, f.sb]], f.r, f.r * f.r);
    },
  });
  def('quadreg', {
    min: 2, max: 2, usage: 'quadreg(xs, ys) fits y = ax² + bx + c', fn: (a) => {
      const [xs, ys] = pairs(a, 'quadreg', 3);
      const S = (p: number) => xs.reduce((s, x) => s + x ** p, 0);
      const T = (p: number) => xs.reduce((s, x, k) => s + x ** p * ys[k], 0);
      const A = [[S(4), S(3), S(2)], [S(3), S(2), S(1)], [S(2), S(1), xs.length]];
      const inv = matInverse(A);
      if (!inv) fail('quadreg needs at least 3 different x values');
      const [qa, qb, qc] = matMul(inv, [[T(2)], [T(1)], [T(0)]]).map((r) => r[0]);
      const my = ys.reduce((p, q) => p + q, 0) / ys.length;
      let ssr = 0, sst = 0;
      xs.forEach((x, k) => { ssr += (ys[k] - (qa * x * x + qb * x + qc)) ** 2; sst += (ys[k] - my) ** 2; });
      // Solving the normal equations squares the conditioning, so noise here is far above an ulp of y.
      const by = 1e3 * maxOf(ys.map(Math.abs)), bx = Math.max(1e-300, maxOf(xs.map(Math.abs)));
      return fitRecord('Quadratic regression y = ax² + bx + c', [['a', qa, by / (bx * bx)], ['b', qb, by / bx], ['c', qc, by]], null, sst === 0 ? NaN : 1 - ssr / sst);
    },
  });
  def('expreg', {
    min: 2, max: 2, usage: 'expreg(xs, ys) fits y = a·b^x (needs y > 0)', fn: (a) => {
      const [xs, ys] = pairs(a, 'expreg');
      if (ys.some((y) => y <= 0)) fail('expreg needs every y value to be positive');
      const f = lineFit(xs, ys.map(Math.log));
      return fitRecord('Exponential regression y = a·b^x', [['a', Math.exp(f.b)], ['b', Math.exp(f.a)]], f.r, f.r * f.r);
    },
  });
  def('powreg', {
    min: 2, max: 2, usage: 'powreg(xs, ys) fits y = a·x^b (needs x > 0 and y > 0)', fn: (a) => {
      const [xs, ys] = pairs(a, 'powreg');
      if (xs.some((x) => x <= 0) || ys.some((y) => y <= 0)) fail('powreg needs every x and y value to be positive');
      const f = lineFit(xs.map(Math.log), ys.map(Math.log));
      return fitRecord('Power regression y = a·x^b', [['a', Math.exp(f.b)], ['b', f.a, f.sa]], f.r, f.r * f.r);
    },
  });
  def('lnreg', {
    min: 2, max: 2, usage: 'lnreg(xs, ys) fits y = a + b·ln(x) (needs x > 0)', fn: (a) => {
      const [xs, ys] = pairs(a, 'lnreg');
      if (xs.some((x) => x <= 0)) fail('lnreg needs every x value to be positive');
      const f = lineFit(xs.map(Math.log), ys);
      return fitRecord('Logarithmic regression y = a + b·ln(x)', [['a', f.b, f.sb], ['b', f.a, f.sa]], f.r, f.r * f.r);
    },
  });
  def(['corr', 'correlation'], {
    min: 2, max: 2, usage: 'corr(xs, ys): correlation coefficient r', fn: (a) => {
      const [xs, ys] = pairs(a, 'corr');
      const r = lineFit(xs, ys).r;
      if (Number.isNaN(r)) fail('All y values are the same, so r is undefined');
      return tidy(r, 1);
    },
  });
  def(['covp', 'cov_p'], { min: 2, max: 2, usage: 'covp(xs, ys): population covariance (÷ n)', fn: (a) => covariance(...pairs(a, 'covp', 1), false) });
  def(['covs', 'cov_s'], { min: 2, max: 2, usage: 'covs(xs, ys): sample covariance (÷ n−1)', fn: (a) => covariance(...pairs(a, 'covs'), true) });
  def('cov', {
    min: 2, max: 2, usage: 'cov(xs, ys) follows the Pop/Sample switch', fn: (a, env) => {
      env.note(env.settings.sample ? 'Sample covariance (÷ n−1)' : 'Population covariance (÷ n)');
      return covariance(...pairs(a, 'cov', env.settings.sample ? 2 : 1), env.settings.sample);
    },
  });

  // Distributions and special functions.
  const df = (v: Value, what = 'df'): number => pos(num(v, what), what);
  const bounds = (a: Value[]): [number, number] => {
    const lo = num(a[0], 'Lower bound'), hi = num(a[1], 'Upper bound');
    if (lo > hi) fail(`Lower bound ${lo} is above upper bound ${hi}`);
    return [lo, hi];
  };
  def('tpdf', { min: 2, max: 2, usage: 'tpdf(t, df)', fn: (a) => { const nu = df(a[1]); return mapNum(a[0], (t) => tPdf(t, nu), 'tpdf'); } });
  def('tcdf', {
    min: 2, max: 3, prob: true, usage: 'tcdf(a, b, df) = P(a ≤ T ≤ b), or tcdf(t, df) = P(T ≤ t)', fn: (a) => {
      const nu = df(a[a.length - 1]);
      if (a.length === 2) return mapNum(a[0], (t) => tBetween(-Infinity, t, nu), 'tcdf');
      const [lo, hi] = bounds(a);
      return tBetween(lo, hi, nu);
    },
  });
  def(['invT', 'invt'], {
    min: 2, max: 2, usage: 'invT(p, df): t with area p to its left', fn: (a) => {
      const nu = df(a[1]);
      return mapNum(a[0], (p) => invT(prob(p, 'Area'), nu), 'invT');
    },
  });
  def('chi2pdf', { min: 2, max: 2, usage: 'chi2pdf(x, df)', fn: (a) => { const k = df(a[1]); return mapNum(a[0], (x) => chi2Pdf(x, k), 'chi2pdf'); } });
  def('chi2cdf', {
    min: 2, max: 3, prob: true, usage: 'chi2cdf(a, b, df) = P(a ≤ X ≤ b), or chi2cdf(x, df) = P(X ≤ x)', fn: (a) => {
      const k = df(a[a.length - 1]);
      if (a.length === 2) return mapNum(a[0], (x) => chi2Between(0, x, k), 'chi2cdf');
      const [lo, hi] = bounds(a);
      return chi2Between(lo, hi, k);
    },
  });
  def(['Fpdf', 'fpdf'], {
    min: 3, max: 3, usage: 'Fpdf(x, df1, df2)', fn: (a) => {
      const d1 = df(a[1], 'df1'), d2 = df(a[2], 'df2');
      return mapNum(a[0], (x) => fPdf(x, d1, d2), 'Fpdf');
    },
  });
  def(['Fcdf', 'fcdf'], {
    min: 3, max: 4, prob: true, usage: 'Fcdf(a, b, df1, df2) = P(a ≤ X ≤ b), or Fcdf(x, df1, df2) = P(X ≤ x)', fn: (a) => {
      const d1 = df(a[a.length - 2], 'df1'), d2 = df(a[a.length - 1], 'df2');
      if (a.length === 3) return mapNum(a[0], (x) => fBetween(0, x, d1, d2), 'Fcdf');
      const [lo, hi] = bounds(a);
      return fBetween(lo, hi, d1, d2);
    },
  });
  const lambdaArg = (v: Value): number => {
    const l = num(v, 'λ');
    if (!(l >= 0) || l === Infinity) fail(`λ (the mean) must be 0 or more, got ${l}`);
    return l;
  };
  def('poissonpdf', { min: 2, max: 2, prob: true, usage: 'poissonpdf(λ, k) = P(X = k)', fn: (a) => { const l = lambdaArg(a[0]); return mapNum(a[1], (k) => poissonPdf(l, k), 'poissonpdf'); } });
  def('poissoncdf', { min: 2, max: 2, prob: true, usage: 'poissoncdf(λ, k) = P(X ≤ k)', fn: (a) => { const l = lambdaArg(a[0]); return mapNum(a[1], (k) => poissonCdf(l, k), 'poissoncdf'); } });
  const geoP = (v: Value): number => {
    const p = prob(num(v, 'p'));
    if (p === 0) fail('p must be above 0, or the first success never comes');
    return p;
  };
  def('geompdf', {
    min: 2, max: 2, prob: true, usage: 'geompdf(p, k) = P(first success on trial k)', fn: (a) => {
      const p = geoP(a[0]);
      return mapNum(a[1], (k) => (isWhole(k) && k >= 1 ? p * Math.pow(1 - p, k - 1) : 0), 'geompdf');
    },
  });
  def('geomcdf', {
    min: 2, max: 2, prob: true, usage: 'geomcdf(p, k) = P(first success by trial k)', fn: (a) => {
      const p = geoP(a[0]);
      return mapNum(a[1], (k) => (k < 1 ? 0 : p === 1 ? 1 : -Math.expm1(Math.floor(k) * Math.log1p(-p))), 'geomcdf');
    },
  });
  const uniformArgs = (a: Value[], k: number): [number, number] => {
    const lo = num(a[k], 'Lower end'), hi = num(a[k + 1], 'Upper end');
    if (!(lo < hi)) fail(`The lower end ${lo} must be below the upper end ${hi}`);
    return [lo, hi];
  };
  def('uniformpdf', {
    min: 3, max: 3, usage: 'uniformpdf(x, lo, hi)', fn: (a) => {
      const [lo, hi] = uniformArgs(a, 1);
      return mapNum(a[0], (x) => (x >= lo && x <= hi ? 1 / (hi - lo) : 0), 'uniformpdf');
    },
  });
  def('uniformcdf', {
    min: 3, max: 4, prob: true, usage: 'uniformcdf(a, b, lo, hi) = P(a ≤ X ≤ b), or uniformcdf(x, lo, hi) = P(X ≤ x)', fn: (a) => {
      const [lo, hi] = uniformArgs(a, a.length - 2);
      const between = (x1: number, x2: number) => {
        const t = Math.min(x2, hi), f = Math.max(x1, lo);
        return tidy(Math.max(0, t - f) / (hi - lo), (Math.abs(t) + Math.abs(f)) / (hi - lo));
      };
      if (a.length === 3) return mapNum(a[0], (x) => between(-Infinity, x), 'uniformcdf');
      const [x1, x2] = bounds(a);
      return between(x1, x2);
    },
  });
  def('gamma', one(gamma, 'gamma'));
  def('lgamma', one((x) => {
    if (x <= 0 && isWhole(x)) fail(`lgamma is undefined at 0 and the negative whole numbers, got ${x}`);
    return lgamma(x);
  }, 'lgamma'));
  def(['beta', 'β'], {
    min: 2, max: 2, usage: 'beta(a, b) = Γ(a)Γ(b)/Γ(a+b)', fn: (a) => {
      const p = pos(num(a[0], 'a'), 'a'), q = pos(num(a[1], 'b'), 'b');
      return tidy(betaFn(p, q));
    },
  });
  def('erf', one(erf, 'erf'));
  def('erfc', one(erfc, 'erfc'));

  // Number theory.
  def(['isprime', 'isPrime'], { min: 1, max: 1, usage: 'isprime(n) → 1 or 0', fn: (a) => mapNum(a[0], (n) => (isWhole(n) && n >= 2 && isPrime(intArg(n, 'isprime', 2)) ? 1 : 0), 'isprime') });
  def(['factor', 'factorize'], {
    min: 1, max: 1, usage: 'factor(n): prime factorization', fn: (a) => {
      const n = intArg(num(a[0], 'n'), 'factor', 1);
      if (n === 1) return record('1 has no prime factors', []);
      const f = factorize(n);
      const title = f.size === 1 && [...f.values()][0] === 1
        ? `${n} is prime`
        : `${n} = ${[...f].map(([p, e]) => (e === 1 ? `${p}` : `${p}${superscript(String(e))}`)).join(' · ')}`;
      return record(title, [...f].map(([p, e]) => ({ label: `${p}`, value: e })));
    },
  });
  def('divisors', { min: 1, max: 1, usage: 'divisors(n): every whole number that divides n', fn: (a) => list(divisorsOf(intArg(num(a[0], 'n'), 'divisors', 1))) });
  def(['totient', 'phi'], {
    min: 1, max: 1, usage: 'totient(n): how many of 1…n share no factor with n', fn: (a) => mapNum(a[0], (x) => {
      let t = intArg(x, 'totient', 1);
      for (const p of factorize(t).keys()) t = (t / p) * (p - 1);
      return t;
    }, 'totient'),
  });
  def('quot', {
    min: 2, max: 2, usage: 'quot(a, b): a ÷ b with the remainder dropped (rounds toward 0)', fn: (a) => {
      const b = num(a[1], 'Divisor');
      if (b === 0) fail('quot by zero');
      return mapNum(a[0], (x) => tidy((x - (x % b)) / b), 'quot');
    },
  });
  def('rem', {
    min: 2, max: 2, usage: 'rem(a, b): remainder with the sign of a (mod uses the sign of b)', fn: (a) => {
      const b = num(a[1], 'Divisor');
      if (b === 0) fail('rem by zero');
      return mapNum(a[0], (x) => tidy(x % b, Math.abs(x)), 'rem');
    },
  });

  // Polynomials.
  const coeffArgs = (a: Value[]): number[] => {
    if (a.length === 1 && typeof a[0] === 'object' && (a[0].t === 'list' || a[0].t === 'vector')) return nums(a[0], 'coefficient list');
    return a.map((v) => num(v, 'Each coefficient'));
  };
  def(['roots', 'polyroots'], {
    min: 1, max: Infinity, usage: 'roots(a, b, c, …) or roots({a, b, c, …}), highest power first', fn: (a, env) => {
      const c = coeffArgs(a);
      if (c.some((x) => !Number.isFinite(x))) fail('Every coefficient must be a finite number');
      while (c.length && c[0] === 0) c.shift();
      if (c.length < 2) fail('roots needs a polynomial of degree 1 or more, like roots(1, -3, 2) for x² − 3x + 2');
      // The root finder's work grows with the square of the degree: degree 3000 took 18 seconds.
      if (c.length > 501) fail(`roots works up to degree 500; this polynomial has degree ${c.length - 1}`);
      const zs = polyRoots(c);
      const real = [...new Set(zs.filter((z) => z[1] === 0).map((z) => tidy(z[0]) || 0))].sort((p, q) => p - q);
      const cx = zs.filter((z) => z[1] !== 0);
      if (!env.settings.complex) {
        if (cx.length && !real.length) fail(`No real roots. Turn on Complex mode to see the ${cx.length} complex roots`);
        if (cx.length) env.note(`Also has ${cx.length} complex roots. Turn on Complex mode to see them`);
        return real.length === 1 ? real[0] : list(real);
      }
      const seen = new Set<string>();
      const cxv: Value[] = [];
      for (const z of cx.sort((p, q) => p[0] - q[0] || p[1] - q[1])) {
        const re = tidy(z[0]) || 0, im = tidy(z[1]);
        const key = `${re},${im}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cxv.push(complex(re, im));
      }
      const all: Value[] = [...real, ...cxv];
      return all.length === 1 ? all[0] : list(all);
    },
  });
  def('polyval', {
    min: 2, max: 2, usage: 'polyval({a, b, c}, x) = ax² + bx + c', fn: (a) => {
      const c = coeffArgs([a[0]]);
      if (c.length === 0) fail('polyval needs at least one coefficient');
      let acc: Value = c[0], size = Math.abs(c[0]);
      for (let k = 1; k < c.length; k++) {
        acc = arith('+', arith('*', acc, a[1]), c[k]);
        if (typeof a[1] === 'number') size = size * Math.abs(a[1]) + Math.abs(c[k]);
      }
      return typeof acc === 'number' ? tidy(acc, size) : acc;
    },
  });

  // Geometry.
  const twoPoints = (a: Value[], fn: string): [number[], number[]] => {
    const p = coords(a[0], 'p'), q = coords(a[1], 'q');
    if (p.length !== q.length) fail(`${fn} needs two points of the same size (${p.length} and ${q.length} coordinates)`);
    return [p, q];
  };
  def(['distance', 'dist'], { min: 2, max: 2, usage: 'distance(p, q)', fn: (a) => { const [p, q] = twoPoints(a, 'distance'); return tidy(hypotOf(p.map((x, k) => x - q[k])), hypotOf(p) + hypotOf(q)); } });
  def('midpoint', { min: 2, max: 2, usage: 'midpoint(p, q)', fn: (a) => { const [p, q] = twoPoints(a, 'midpoint'); return point(p.map((x, k) => tidy((x + q[k]) / 2, (Math.abs(x) + Math.abs(q[k])) / 2))); } });
  def('slope', {
    min: 2, max: 2, usage: 'slope(p, q) = (y₂ − y₁)/(x₂ − x₁)', fn: (a) => {
      const [p, q] = twoPoints(a, 'slope');
      if (p.length !== 2) fail('slope needs 2D points like (1, 2)');
      if (p[0] === q[0]) fail('The line through these points is vertical, so its slope is undefined');
      const run = Math.abs(q[0] - p[0]);
      return tidy((q[1] - p[1]) / (q[0] - p[0]), (Math.abs(q[1]) + Math.abs(p[1])) / run);
    },
  });
  def('area', {
    min: 1, max: Infinity, usage: 'area(polygon) or area((0,0), (4,0), (4,3)): shoelace formula', fn: (a) => {
      const pts = polyPoints(a, 'area');
      if (pts.length < 3) fail('area needs at least 3 points');
      let s = 0, size = 0;
      for (let k = 0; k < pts.length; k++) {
        const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % pts.length];
        s += x1 * y2 - x2 * y1;
        size += Math.abs(x1 * y2) + Math.abs(x2 * y1);
      }
      return tidy(Math.abs(s) / 2, size / 2);
    },
  });
  def('perimeter', {
    min: 1, max: Infinity, usage: 'perimeter(polygon) or perimeter((0,0), (4,0), (4,3))', fn: (a) => {
      const pts = polyPoints(a, 'perimeter');
      if (pts.length < 2) fail('perimeter needs at least 2 points');
      let s = 0, size = 0;
      for (let k = 0; k < pts.length; k++) {
        const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % pts.length];
        s += Math.hypot(x2 - x1, y2 - y1);
        size += Math.hypot(x1, y1);
      }
      return tidy(s, size);
    },
  });
  const radius = (r: number) => { if (r < 0) fail(`A radius can't be negative, got ${r}`); return r; };
  def('circlearea', one((r) => tidy(Math.PI * radius(r) ** 2), 'circlearea'));
  def('circumference', one((r) => tidy(2 * Math.PI * radius(r)), 'circumference'));

  // Finance.
  const money = (a: Value[], names: string[]) => a.map((v, k) => num(v, names[k]));
  const periods = (n: number) => { if (!(n > 0)) fail(`The number of periods must be positive, got ${n}`); return n; };
  def('simple', {
    min: 3, max: 3, usage: 'simple(P, r, t) = P(1 + rt), the balance with simple interest', fn: (a) => {
      const [P, r, t] = money(a, ['P', 'r', 't']);
      return tidy(P * (1 + r * t));
    },
  });
  def('pmt', {
    min: 3, max: 3, usage: 'pmt(rate per period, periods, loan amount): the payment each period', fn: (a) => {
      const [r, n, pv] = money(a, ['rate', 'periods', 'loan amount']);
      periods(n);
      if (r <= -1) fail(`The rate must be above −1 (−100%), got ${r}`);
      return r === 0 ? tidy(pv / n) : (pv * r) / -Math.expm1(-n * Math.log1p(r));
    },
  });
  def('fvannuity', {
    min: 3, max: 3, usage: 'fvannuity(rate per period, periods, payment): future value of regular payments', fn: (a) => {
      const [r, n, p] = money(a, ['rate', 'periods', 'payment']);
      periods(n);
      if (r <= -1) fail(`The rate must be above −1 (−100%), got ${r}`);
      return r === 0 ? tidy(p * n) : (p * Math.expm1(n * Math.log1p(r))) / r;
    },
  });
  def('pvannuity', {
    min: 3, max: 3, usage: 'pvannuity(rate per period, periods, payment): present value of regular payments', fn: (a) => {
      const [r, n, p] = money(a, ['rate', 'periods', 'payment']);
      periods(n);
      if (r <= -1) fail(`The rate must be above −1 (−100%), got ${r}`);
      return r === 0 ? tidy(p * n) : (p * -Math.expm1(-n * Math.log1p(r))) / r;
    },
  });
  def('pctchange', {
    min: 2, max: 2, usage: 'pctchange(old, new): percent change, so 50 → 75 gives 50', fn: (a) => {
      const o = num(a[0], 'Old value');
      if (o === 0) fail('Percent change from 0 is undefined');
      return mapNum(a[1], (n) => tidy(((n - o) / Math.abs(o)) * 100, ((Math.abs(n) + Math.abs(o)) / Math.abs(o)) * 100), 'pctchange');
    },
  });

  // Text: base conversion and units.
  const baseFn = (b: number, name: string): Builtin => ({
    min: 1, max: 1, usage: `${name}(n) gives base-${b} digits as text`,
    fn: (a) => each(a[0], (v) => text(toBase(num(v, 'n'), b, name))),
  });
  def('bin', baseFn(2, 'bin'));
  def('oct', baseFn(8, 'oct'));
  def('hex', baseFn(16, 'hex'));
  def('base', {
    min: 2, max: 2, usage: 'base(n, b) gives the digits of n in base b (2 to 36) as text', fn: (a) => {
      const b = baseArg(a[1]);
      return each(a[0], (v) => text(toBase(num(v, 'n'), b, 'base')));
    },
  });
  def('dec', {
    min: 1, max: 2, usage: 'dec("ff", 16) reads digits in a base; dec("0xff") reads 0x, 0b, 0o prefixes', fn: (a) => {
      const b = a.length > 1 ? baseArg(a[1]) : null;
      return each(a[0], (v) => {
        if (typeof v === 'number') {
          whole(v, 'dec input');
          return fromBase(String(v), b);
        }
        return fromBase(textArg(v, 'dec input'), b);
      });
    },
  });
  def('convert', {
    min: 3, max: 3, usage: 'convert(x, "from", "to"), like convert(5, "mi", "km")',
    lazy: (args, locals, env, compile) => {
      for (const n of [args[1], args[2]]) {
        const isName = n.k === 'id' && (locals.includes(n.name) || env.hasVar(n.name));
        if (n.k !== 'str' && !isName) fail('Units go in quotes, like convert(5, "mi", "km")');
      }
      const [x, from, to] = args.map((n) => compile(n, locals));
      return (s) => {
        const conv = unitConverter(textArg(from(s), 'The "from" unit'), textArg(to(s), 'The "to" unit'));
        return mapNum(x(s), conv, 'convert');
      };
    },
  });

  // Matrix extras. A^n already handles powers.
  const square = (m: number[][], fn: string) => {
    if (m.some((r) => r.length !== m.length)) fail(`${fn} needs a square matrix (this one is ${m.length}×${m[0].length})`);
    return m;
  };
  def('trace', { min: 1, max: 1, usage: 'trace(A): sum of the main diagonal', fn: (a) => { const m = square(mat(a[0]), 'trace'); return tidy(m.reduce((s, r, i) => s + r[i], 0), m.reduce((s, r, i) => s + Math.abs(r[i]), 0)); } });
  def('rank', {
    min: 1, max: 1, usage: 'rank(A): number of independent rows', fn: (a) => {
      // Each row is scaled to its own largest entry first. Scaling a row never changes the rank, and without it a row
      // of ordinary numbers under a row of 1e20s fell below the tolerance and counted as zero.
      const m = mat(a[0]).map((r) => {
        const big = maxOf(r.map(Math.abs));
        return big > 0 && Number.isFinite(big) ? r.map((x) => x / big) : r.slice();
      });
      const rows = m.length, cols = m[0].length;
      const tol = RANK_TOL * Math.max(1e-300, maxOf(m.flat().map(Math.abs)));
      let rank = 0;
      for (let c = 0; c < cols && rank < rows; c++) {
        let p = rank;
        for (let r = rank + 1; r < rows; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
        if (Math.abs(m[p][c]) <= tol) continue;
        [m[rank], m[p]] = [m[p], m[rank]];
        for (let r = rank + 1; r < rows; r++) {
          const f = m[r][c] / m[rank][c];
          for (let j = c; j < cols; j++) m[r][j] -= f * m[rank][j];
        }
        rank++;
      }
      return rank;
    },
  });
  def(['eigen', 'eigenvalues', 'eig'], {
    min: 1, max: 1, usage: 'eigen(A): eigenvalues of a 2×2 or 3×3 matrix', fn: (a, env) => {
      const given = square(mat(a[0]), 'eigen');
      const n = given.length;
      // Worked out on the matrix divided by its smallest entry, then scaled back: the root finder's idea of "zero" is
      // absolute, so a matrix of 1e-20s came back with made-up imaginary parts. The smallest entry, not the largest,
      // so that a matrix of mixed sizes keeps its small eigenvalues: [[1, 0], [0, 1e20]] still has 1.
      const sizes = given.flat().map(Math.abs).filter((x) => x > 0);
      const small = sizes.length ? Math.min(...sizes) : 1;
      const scale = Number.isFinite(maxOf(sizes.length ? sizes : [1]) / small) ? small : 1;
      const m = given.map((r) => r.map((x) => x / scale));
      let coeffs: number[];
      if (n === 1) coeffs = [1, -m[0][0]];
      else if (n === 2) coeffs = [1, -(m[0][0] + m[1][1]), determinant(m)];
      else if (n === 3) {
        const minors = m[0][0] * m[1][1] - m[0][1] * m[1][0] + m[0][0] * m[2][2] - m[0][2] * m[2][0] + m[1][1] * m[2][2] - m[1][2] * m[2][1];
        coeffs = [1, -(m[0][0] + m[1][1] + m[2][2]), minors, -determinant(m)];
      } else return fail(`eigen works on 2×2 and 3×3 matrices (this one is ${n}×${n})`);
      const zs = polyRoots(coeffs);
      const real = zs.filter((z) => z[1] === 0).map((z) => tidy(tidy(z[0]) * scale) || 0).sort((p, q) => p - q);
      const cx = zs.filter((z) => z[1] !== 0).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      if (cx.length && !env.settings.complex) fail('This matrix has complex eigenvalues. Turn on Complex mode to see them');
      return list([...real, ...cx.map((z) => complex(tidy(tidy(z[0]) * scale) || 0, tidy(tidy(z[1]) * scale)))]);
    },
  });
  def('augment', {
    min: 2, max: 2, usage: 'augment(A, B) puts B to the right of A', fn: (a) => {
      const A = mat(a[0], 'A');
      const b = a[1];
      const B = typeof b === 'object' && (b.t === 'vector' || b.t === 'list') ? nums(b, 'B').map((x) => [x]) : mat(b, 'B');
      if (A.length !== B.length) fail(`augment needs the same number of rows (A has ${A.length}, B has ${B.length})`);
      const cols = (A[0]?.length ?? 0) + (B[0]?.length ?? 0);
      if (A.length * cols > 1_000_000) fail(`augment would make a ${A.length}×${cols} matrix; the limit is a million entries`);
      chargeWork(A.length * cols);
      return matrix(A.map((r, i) => [...r, ...B[i]]));
    },
  });

  // Complex helpers.
  def(['re', 'real'], { min: 1, max: 1, usage: 're(z): real part', fn: (a) => mapCx(a[0], (re) => re, 're') });
  def(['im', 'imag'], { min: 1, max: 1, usage: 'im(z): imaginary part', fn: (a) => mapCx(a[0], (_re, im) => im, 'im') });
  def(['conj', 'conjugate'], { min: 1, max: 1, usage: 'conj(z): complex conjugate', fn: (a) => mapCx(a[0], (re, im) => complex(re, -im === 0 ? 0 : -im), 'conj') });
  const argOf = (re: number, im: number, env: Env): number => {
    if (re === 0 && im === 0) fail('arg(0) is undefined');
    return tidy(env.fromRad(Math.atan2(im, re)));
  };
  def('arg', { min: 1, max: 1, usage: 'arg(z): angle of z (uses Deg/Rad)', fn: (a, env) => mapCx(a[0], (re, im) => argOf(re, im, env), 'arg') });
  def('polar', {
    min: 1, max: 1, usage: 'polar(z): modulus r and angle θ', fn: (a, env) => {
      const v = a[0];
      const z = typeof v === 'number' ? { re: v, im: 0 } : v.t === 'complex' ? v : fail(`polar needs a number, got a ${typeName(v)}`);
      return record(`Polar form r·(cos θ + i sin θ)${env.settings.deg ? ', θ in degrees' : ''}`, [
        { label: 'r', value: tidy(Math.hypot(z.re, z.im)) },
        { label: 'θ', value: argOf(z.re, z.im, env) },
      ]);
    },
  });
}
