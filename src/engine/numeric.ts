// Special functions. Everything here is plain float64, and allocation-free outside the quadrature.
import { fail, failOverflow } from './errors';

const SQRT_PI = Math.sqrt(Math.PI);
const SQRT2 = Math.SQRT2;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Series erf(x) = 2/√π · e^(−x²) · Σ (2x²)^n x / (1·3·…·(2n+1)). All terms positive, so no cancellation. */
function erfSeries(x: number): number {
  const x2 = 2 * x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n < 500; n++) {
    term *= x2 / (2 * n + 1);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return (2 / SQRT_PI) * Math.exp(-x * x) * sum;
}

/** Continued fraction erfc(x) = e^(−x²)/√π · 1/(x + ½/(x + 1/(x + 3⁄2/(x + …)))), for x ≥ 3. */
function erfcContinued(x: number): number {
  let f = x;
  for (let n = 90; n >= 1; n--) f = x + n / 2 / f;
  return Math.exp(-x * x) / (SQRT_PI * f);
}

export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 0;
  if (x === -Infinity) return 2;
  if (x < 0) return 2 - erfc(-x);
  if (x < 3) return 1 - erfSeries(x);
  return erfcContinued(x);
}

export function erf(x: number): number {
  if (Math.abs(x) < 3) return x < 0 ? -erfSeries(-x) : erfSeries(x);
  return 1 - erfc(x);
}

export function normCdf(z: number): number {
  return 0.5 * erfc(-z / SQRT2);
}

export function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / SQRT_2PI;
}

/** P(a ≤ Z ≤ b) without losing digits far out in either tail. */
export function normBetween(a: number, b: number): number {
  if (a > b) return 0;
  if (a >= 0) return normCdf(-a) - normCdf(-b);
  return normCdf(b) - normCdf(a);
}

// Acklam's rational approximation, then two Halley steps against our erfc for full double precision.
const A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

export function invNormStd(p: number): number {
  if (!(p >= 0 && p <= 1)) fail(`invNorm needs an area between 0 and 1, got ${p}`);
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const plow = 0.02425;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  } else if (p <= 1 - plow) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  for (let k = 0; k < 2; k++) {
    // Φ(x) − p, computed in whichever tail keeps precision.
    const e = x < 0 ? normCdf(x) - p : 1 - p - normCdf(-x);
    const u = e * SQRT_2PI * Math.exp((x * x) / 2);
    x = x - u / (1 + (x * u) / 2);
  }
  return x;
}

export function roundTo(x: number, places: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const ax = Math.abs(x);
  // Digits that survive the rounding. A double holds at most 17, so with that many the rounding changes nothing
  // (and shifting 1e300 by 10 places overflowed to NaN).
  const sig = Math.floor(Math.log10(ax)) + 1 + places;
  if (sig >= 17) return x;
  // Round half away from zero, using the decimal string so 1.005 → 1.01 like a person expects. Past 15 digits that
  // string has to be the exact shortest one: 15 digits made round(1234567890123456.7) end in 60.
  const s = sig <= 15 ? ax.toPrecision(15) : String(ax);
  const r = shiftDecimal(String(Math.round(shiftDecimal(s, places))), -places);
  return x < 0 ? -r : r;
}

/** s × 10^n through the decimal string. s may already be in exponent form, like "1.23e-16". */
function shiftDecimal(s: string, n: number): number {
  const [mantissa, exponent = '0'] = s.split('e');
  return Number(`${mantissa}e${Number(exponent) + n}`);
}

const FACT: number[] = [1];
for (let n = 1; n <= 170; n++) FACT[n] = FACT[n - 1] * n;

export function isWhole(n: number): boolean {
  return Number.isFinite(n) && Math.floor(n) === n;
}

export function factorial(n: number): number {
  if (!isWhole(n) || n < 0) fail(`Factorial needs a whole number ≥ 0, got ${n}`);
  if (n > 170) failOverflow(`${n}! is too large (170! is the largest a 64-bit float holds)`);
  return FACT[n];
}

export function gcdOf(p: number, q: number): number {
  while (q) [p, q] = [q, p % q];
  return p;
}

// Loops, not Math.max(...xs): spreading a list of more than about 120k items overflows the call stack.
export function maxOf(xs: readonly number[]): number {
  let m = -Infinity;
  for (const x of xs) m = Math.max(m, x);
  return m;
}
export function minOf(xs: readonly number[]): number {
  let m = Infinity;
  for (const x of xs) m = Math.min(m, x);
  return m;
}
/** √(Σ x²) without overflow or underflow, like Math.hypot. */
export function hypotOf(xs: readonly number[]): number {
  let m = 0;
  for (const x of xs) m = Math.max(m, Math.abs(x));
  if (m === 0 || !Number.isFinite(m)) return m;
  let s = 0;
  for (const x of xs) s += (x / m) ** 2;
  return m * Math.sqrt(s);
}

const LN_2PI = 1.837877066409345483560659472811; // ln 2π

/** ln(k!) by summing logs, for the few k ≤ 15 where Stirling's series below isn't accurate yet. */
const LN_FACT_SMALL: number[] = [0];
for (let k = 1; k <= 15; k++) LN_FACT_SMALL[k] = LN_FACT_SMALL[k - 1] + Math.log(k);

/**
 * lnΓ(n + 1) − ((n + ½) ln n − n + ln √(2π)), the error of Stirling's formula, for real n > 0. Catherine Loader's
 * method ("Fast and accurate computation of binomial probabilities", 2000), as R's dbinom uses.
 */
function stirlerr(n: number): number {
  if (n <= 15) return (isWhole(n) ? LN_FACT_SMALL[n] : lgamma(n + 1)) - (n + 0.5) * Math.log(n) + n - LN_SQRT_2PI;
  const S0 = 1 / 12, S1 = 1 / 360, S2 = 1 / 1260, S3 = 1 / 1680, S4 = 1 / 1188;
  const nn = n * n;
  if (n > 500) return (S0 - S1 / nn) / n;
  if (n > 80) return (S0 - (S1 - S2 / nn) / nn) / n;
  if (n > 35) return (S0 - (S1 - (S2 - S3 / nn) / nn) / nn) / n;
  return (S0 - (S1 - (S2 - (S3 - S4 / nn) / nn) / nn) / nn) / n;
}

/**
 * x ln(x/np) + np − x, without the cancellation that formula has when x is near np (Loader). A caller that knows
 * d = x − np more exactly than np itself passes it: near 1e12 an np rounded to a double moves the answer by 1e-10.
 */
function bd0(x: number, np: number, d = x - np): number {
  if (Math.abs(d) < 0.1 * (x + np)) {
    let v = d / (x + np);
    let sum = d * v;
    let ej = 2 * x * v;
    v *= v;
    for (let j = 1; j < 1000; j++) {
      ej *= v;
      const next = sum + ej / (2 * j + 1);
      if (next === sum) return next;
      sum = next;
    }
    return sum;
  }
  return x * Math.log(x / np) + np - x;
}

function checkNR(fn: string, n: number, r: number): void {
  if (!isWhole(n) || !isWhole(r)) fail(`${fn} needs whole numbers, got ${fn}(${n}, ${r})`);
  if (n < 0 || r < 0) fail(`${fn} needs n ≥ 0 and r ≥ 0`);
  if (r > n) fail(`${fn}(${n}, ${r}): r can't be larger than n`);
}

export function nCr(n: number, r: number): number {
  checkNR('nCr', n, r);
  const k = Math.min(r, n - r);
  let res = 1;
  // res only grows (k ≤ n/2), so once it overflows the rest of a loop up to 5e11 steps changes nothing.
  for (let i = 1; i <= k && Number.isFinite(res); i++) {
    res = (res * (n - k + i)) / i;
  }
  if (!Number.isFinite(res)) failOverflow(`nCr(${n}, ${r}) is too large`);
  return res < Number.MAX_SAFE_INTEGER ? Math.round(res) : res;
}

export function nPr(n: number, r: number): number {
  checkNR('nPr', n, r);
  let res = 1;
  for (let i = 0; i < r && Number.isFinite(res); i++) res *= n - i;
  if (!Number.isFinite(res)) failOverflow(`nPr(${n}, ${r}) is too large`);
  return res;
}

function checkBinomial(n: number, p: number): void {
  if (!isWhole(n) || n < 0) fail(`binomial n must be a whole number ≥ 0, got ${n}`);
  // Past 2^53 a double can't hold every whole number, so k and n − k stop being exact.
  if (n > Number.MAX_SAFE_INTEGER) fail(`binomial n must be at most 2^53 − 1 (9007199254740991), got ${n}`);
  if (!(p >= 0 && p <= 1)) fail(`binomial p must be between 0 and 1, got ${p}`);
}

export function binomPdf(n: number, p: number, k: number): number {
  checkBinomial(n, p);
  if (!isWhole(k) || k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  if (n <= 1000) {
    const c = nCr(n, k);
    if (Number.isFinite(c)) {
      const v = c * Math.pow(p, k) * Math.pow(1 - p, n - k);
      if (v > 1e-300) return v;
    }
  }
  // Loader's saddle-point form: accurate to near full precision for any n, where ln n! − ln k! − ln (n−k)! cancelled
  // away digits (7 significant at n = 1e7).
  const q = 1 - p;
  if (k === 0) return Math.exp(p < 0.1 ? -bd0(n, n * q) - n * p : n * Math.log1p(-p));
  if (k === n) return Math.exp(q < 0.1 ? -bd0(n, n * p) - n * q : n * Math.log(p));
  const lc = stirlerr(n) - stirlerr(k) - stirlerr(n - k) - bd0(k, n * p) - bd0(n - k, n * q);
  const lf = LN_2PI + Math.log(k) + Math.log1p(-k / n);
  return Math.exp(lc - 0.5 * lf);
}

export function binomRange(n: number, p: number, a: number, b: number): number {
  checkBinomial(n, p);
  const lo = Math.max(0, Math.ceil(a));
  const hi = Math.min(n, Math.floor(b));
  if (!(lo <= hi)) return 0;
  // Terms shrink on both sides of the mode, so the sum starts at the point of [lo, hi] nearest it and walks outward
  // until a term no longer changes it: about 9σ each way, not every k up to n (which hung for n = 1e15).
  const sd = Math.sqrt(n * p * (1 - p));
  if (Math.min(hi - lo, 20 * sd + 100) > 1e7) {
    fail(`Summing this binomial takes more than 10 million terms. For n this large use normalcdf with μ = np and σ = √(np(1 − p))`);
  }
  const start = Math.min(hi, Math.max(lo, Math.floor((n + 1) * p)));
  let s = binomPdf(n, p, start);
  for (let k = start + 1; k <= hi; k++) {
    const t = binomPdf(n, p, k);
    s += t;
    if (t <= s * 1e-17) break;
  }
  for (let k = start - 1; k >= lo; k--) {
    const t = binomPdf(n, p, k);
    s += t;
    if (t <= s * 1e-17) break;
  }
  return Math.min(1, s);
}

/**
 * Smallest whole k in [0, n] with P(X ≤ k) ≥ q for X ~ Binomial(n, p). Binary searches using the regularized
 * incomplete beta function (P(X > k) = I_p(k + 1, n − k)), comparing the smaller tail with a relative slack so q near
 * 0 or 1 isn't swallowed by rounding and huge n like 10^12 finish in a few dozen evaluations.
 */
export function binomQuantile(n: number, p: number, q: number): number {
  checkBinomial(n, p);
  if (!(q >= 0 && q <= 1)) fail(`Probability must be between 0 and 1, got ${q}`);
  if (n === 0 || p === 0 || q === 0) return 0;
  if (p === 1 || q === 1) return n;
  const upper = q > 0.5;
  const target = upper ? (1 - q) * (1 + 1e-13) : q * (1 - 1e-13);
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const [gt, le] = betaRegPair(mid + 1, n - mid, p, 1 - p);
    if (upper ? gt <= target : le >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Lanczos approximation, g = 7, n = 9: about 15 significant digits for Γ.
const LANCZOS_G = 7;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
const LN_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

function lanczosSum(x: number): number {
  let a = LANCZOS[0];
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return a;
}

/** ln|Γ(x)|. Infinity at the poles 0, −1, −2, … */
export function lgamma(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return Infinity;
  if (x <= 0 && isWhole(x)) return Infinity;
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  if (isWhole(x) && x <= 171) return Math.log(FACT[x - 1]);
  const z = x - 1;
  const t = z + LANCZOS_G + 0.5;
  return LN_SQRT_2PI + (z + 0.5) * Math.log(t) - t + Math.log(lanczosSum(z));
}

export function gamma(x: number): number {
  if (x <= 0 && isWhole(x)) fail(`gamma is undefined at 0 and the negative whole numbers, got ${x}`);
  if (isWhole(x) && x <= 171) return FACT[x - 1];
  if (x > 171.6) failOverflow(`gamma(${x}) is too large for a 64-bit float (the limit is about 171.6)`);
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  const z = x - 1;
  const t = z + LANCZOS_G + 0.5;
  // Split t^(z+½) in two so it doesn't overflow before e^−t brings it back down.
  const half = Math.pow(t, (z + 0.5) / 2);
  return Math.sqrt(2 * Math.PI) * half * (half * Math.exp(-t)) * lanczosSum(z);
}

export function betaFn(a: number, b: number): number {
  if (a + b < 171 && a > 0 && b > 0) return (gamma(a) * gamma(b)) / gamma(a + b);
  return Math.exp(lgamma(a) + lgamma(b) - lgamma(a + b));
}

const TINY = 1e-300;
const EPS = 1e-16;
// Past these shapes the series and continued fractions take too many terms or lose their digits (see below).
const GAMMA_SERIES_MAX = 1e5;
const BETA_FRACTION_MAX = 1e4;

/** x^a e^−x / Γ(a). Past a = 16 the Loader form, where a ln x − x − lnΓ(a) cancels: terms of 1e13 for a result of 10. */
function gammaFront(a: number, x: number): number {
  if (a <= 16) return Math.exp(-x + a * Math.log(x) - lgamma(a));
  const k = a - 1;
  return Math.exp(-bd0(k, x) + Math.log(x) - 0.5 * (LN_2PI + Math.log(k)) - stirlerr(k));
}

/**
 * ∫₀^span e^lnf(s) ds for a density falling as s grows, panel by panel with gk15. A panel is at most 2 sd wide and
 * shrinks in the tail so the density drops about e⁴ across it. About 100 evaluations, whatever the shape.
 */
function tailIntegral(lnf: (s: number) => number, sd: number, span: number): number {
  const f = (s: number) => Math.exp(lnf(s));
  let sum = 0, s = 0;
  for (let k = 0; k < 200 && s < span; k++) {
    const here = lnf(s);
    if (here < -750) break; // Below the smallest double.
    const drop = here - lnf(Math.min(s + sd, span));
    const w = Math.min(span - s, sd * (drop > 2 ? 4 / drop : 2));
    const part = gk15(f, s, s + w).value;
    sum += part;
    s += w;
    if (part <= sum * 1e-17) break;
  }
  return sum;
}

/** [P(a, x), Q(a, x)] for huge a, integrating the gamma density away from its mode: the series needs about 9√a terms. */
function gammaLarge(a: number, x: number): [number, number] {
  const k = a - 1, sd = Math.sqrt(k);
  // The bell is narrower than the gap between doubles, so every x is on one side of it.
  if (sd < 8 * Number.EPSILON * k) return x > k ? [1, 0] : x < k ? [0, 1] : [0.5, 0.5];
  const c = -0.5 * (LN_2PI + Math.log(k)) - stirlerr(k);
  if (x >= k) {
    const Q = tailIntegral((s) => c - bd0(k, x + s, k - x - s), sd, Infinity);
    return [1 - Q, Q];
  }
  const P = tailIntegral((s) => c - bd0(k, x - s, k - x + s), sd, x);
  return [P, 1 - P];
}

/** Series for the lower regularized incomplete gamma P(a, x), good for x < a + 1. */
function gammaSeries(a: number, x: number): number {
  let ap = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < 100000; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * gammaFront(a, x);
}

/** Continued fraction (modified Lentz) for the upper regularized incomplete gamma Q(a, x), good for x ≥ a + 1. */
function gammaFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 100000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return gammaFront(a, x) * h;
}

/** Regularized lower incomplete gamma P(a, x) = γ(a, x)/Γ(a). */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x === Infinity) return 1;
  if (a > GAMMA_SERIES_MAX) return gammaLarge(a, x)[0];
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaFraction(a, x);
}

/** Regularized upper incomplete gamma Q(a, x) = 1 − P(a, x), accurate in the far tail. */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x === Infinity) return 0;
  if (a > GAMMA_SERIES_MAX) return gammaLarge(a, x)[1];
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaFraction(a, x);
}

/** Continued fraction for the incomplete beta (modified Lentz). */
function betaFraction(a: number, b: number, x: number): number {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 100000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/**
 * ln of the beta density v^(p−1) w^(q−1) / B(p, q) at v + s, w − s (w = 1 − v), for p ≤ q and q > 16, where lnΓ
 * differences cancel. s stays separate so an offset from a fixed v keeps its digits.
 * p ≥ 2 is Loader's binomial form. Smaller p is R's lbeta for one small shape.
 */
function lnBetaDensity(p: number, q: number): (v: number, w: number, s?: number) => number {
  if (p >= 2) {
    const n = p + q - 2, k = p - 1, m = q - 1;
    const c = Math.log(n + 1) + stirlerr(n) - stirlerr(k) - stirlerr(m) + 0.5 * (Math.log(n) - LN_2PI - Math.log(k) - Math.log(m));
    return (v, w, s = 0) => {
      const nv = n * v, nw = n * w, ns = n * s;
      return c - bd0(k, nv + ns, k - nv - ns) - bd0(m, nw - ns, m - nw + ns);
    };
  }
  const s = p + q;
  const lnB = lgamma(p) + stirlerr(q) - stirlerr(s) + p - p * Math.log(s) + (q - 0.5) * Math.log1p(-p / s);
  return (v, w, s = 0) => (p - 1) * Math.log(v + s) + (q - 1) * (w - s < 0.5 ? Math.log(w - s) : Math.log1p(-v - s)) - lnB;
}

/**
 * [I_v(p, q), 1 − I_v(p, q)] for p ≤ q and q > 16. The fraction in v is fine below the mean. Above it the usual switch to
 * the fraction in w needs 1 − w to about 1/q, so it loses log10(q) digits, and with p large too it takes about 9√p terms.
 * Those cases integrate the density away from its mode instead.
 */
function betaLarge(p: number, q: number, v: number, w: number): [number, number] {
  const lnf = lnBetaDensity(p, q);
  const front = Math.exp(lnf(v, w)) * v * w;
  const below = v < (p + 1) / (p + q + 2);
  if (front === 0) return below ? [0, 1] : [1, 0];
  if (p <= BETA_FRACTION_MAX && (below || q <= BETA_FRACTION_MAX)) {
    if (below) {
      const I = (front * betaFraction(p, q, v)) / p;
      return [I, 1 - I];
    }
    const C = (front * betaFraction(q, p, w)) / q;
    return [1 - C, C];
  }
  const sum = p + q + 2, sd = Math.sqrt((p + 1) / sum) * Math.sqrt((q + 1) / sum) / Math.sqrt(sum);
  const mode = (p - 1) / (p + q - 2);
  // As in gammaLarge: a bell narrower than the gap between doubles.
  if (sd < 8 * Number.EPSILON * v) return v > mode ? [1, 0] : v < mode ? [0, 1] : [0.5, 0.5];
  if (p > BETA_FRACTION_MAX && v < mode) {
    const I = tailIntegral((s) => lnf(v, w, -s), sd, v);
    return [I, 1 - I];
  }
  const C = tailIntegral((s) => lnf(v, w, s), sd, w);
  return [1 - C, C];
}

/**
 * Regularized incomplete beta as the pair [I_x(a, b), 1 − I_x(a, b)]. y = 1 − x is passed separately so callers
 * that know it exactly (like the t distribution) don't lose digits. The smaller of the two is computed directly.
 */
function betaRegPair(a: number, b: number, x: number, y = 1 - x): [number, number] {
  if (x <= 0) return [0, 1];
  if (y <= 0) return [1, 0];
  if (Math.max(a, b) > 16) {
    if (a <= b) return betaLarge(a, b, x, y);
    const [I, C] = betaLarge(b, a, y, x);
    return [C, I];
  }
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(y));
  if (x < (a + 1) / (a + b + 2)) {
    const I = (front * betaFraction(a, b, x)) / a;
    return [I, 1 - I];
  }
  const C = (front * betaFraction(b, a, y)) / b;
  return [1 - C, C];
}

/** P(T > t) for Student's t with ν degrees of freedom. */
function tUpper(t: number, nu: number): number {
  if (nu === Infinity) return normCdf(-t);
  if (t === Infinity) return 0;
  if (t === -Infinity) return 1;
  const t2 = t * t;
  const [I] = betaRegPair(nu / 2, 0.5, nu / (nu + t2), t2 / (nu + t2));
  return t >= 0 ? 0.5 * I : 1 - 0.5 * I;
}

export function tPdf(t: number, nu: number): number {
  if (nu === Infinity) return normPdf(t);
  const a = nu / 2;
  if (a > 16) {
    // lnΓ(a + ½) − lnΓ(a) in Stirling form, where the two lnΓ are about 1e13 for a difference of 14.
    const ratio = a * Math.log1p(0.5 / (a - 1)) + 0.5 * Math.log(a - 1) - 0.5 + stirlerr(a - 0.5) - stirlerr(a - 1);
    return Math.exp(ratio - 0.5 * Math.log(nu * Math.PI) - ((nu + 1) / 2) * Math.log1p((t * t) / nu));
  }
  return Math.exp(lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - ((nu + 1) / 2) * Math.log1p((t * t) / nu));
}

/** P(a ≤ T ≤ b), working in whichever tail keeps precision. */
export function tBetween(a: number, b: number, nu: number): number {
  if (a > b) return 0;
  if (a >= 0) return tUpper(a, nu) - tUpper(b, nu);
  if (b <= 0) return tUpper(-b, nu) - tUpper(-a, nu);
  return 1 - tUpper(-a, nu) - tUpper(b, nu);
}

/** t with P(T ≤ t) = p. Bracketed Newton on the smaller tail. */
export function invT(p: number, nu: number): number {
  if (!(p >= 0 && p <= 1)) fail(`invT needs an area between 0 and 1, got ${p}`);
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p === 0.5) return 0;
  if (nu === Infinity) return invNormStd(p);
  const q = p < 0.5 ? p : 1 - p;
  let lo = 0, hi = 1;
  while (tUpper(hi, nu) > q && hi < 1e300) {
    lo = hi;
    hi *= 2;
  }
  let t = invNormStd(1 - q);
  if (!(t > lo && t < hi)) t = (lo + hi) / 2;
  for (let k = 0; k < 200; k++) {
    const f = tUpper(t, nu) - q;
    if (f > 0) lo = t; else hi = t;
    let next = t + f / tPdf(t, nu);
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    const done = Math.abs(next - t) <= 1e-15 * Math.abs(next);
    t = next;
    if (done) break;
  }
  return p < 0.5 ? -t : t;
}

export function chi2Pdf(x: number, k: number): number {
  if (x < 0) return 0;
  if (x === 0) return k < 2 ? Infinity : k === 2 ? 0.5 : 0;
  if (k > 32) {
    const m = k / 2 - 1;
    return 0.5 * Math.exp(-stirlerr(m) - bd0(m, x / 2) - 0.5 * (LN_2PI + Math.log(m)));
  }
  return Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.LN2 - lgamma(k / 2));
}

export function chi2Between(a: number, b: number, k: number): number {
  if (a > b) return 0;
  const lo = Math.max(0, a), hi = Math.max(0, b);
  if (lo >= k) return gammaQ(k / 2, lo / 2) - gammaQ(k / 2, hi / 2);
  return gammaP(k / 2, hi / 2) - gammaP(k / 2, lo / 2);
}

export function fPdf(x: number, d1: number, d2: number): number {
  if (x < 0) return 0;
  if (x === 0) return d1 < 2 ? Infinity : d1 === 2 ? 1 : 0;
  if (Math.max(d1, d2) > 32) {
    // The beta density at v = d1 x/(d1 x + d2), times dv/dx = v w / x.
    const v = (d1 * x) / (d1 * x + d2), w = d2 / (d1 * x + d2);
    const ln = d1 <= d2 ? lnBetaDensity(d1 / 2, d2 / 2)(v, w) : lnBetaDensity(d2 / 2, d1 / 2)(w, v);
    return (Math.exp(ln) * v * w) / x;
  }
  const lnB = lgamma(d1 / 2) + lgamma(d2 / 2) - lgamma((d1 + d2) / 2);
  return Math.exp((d1 / 2) * Math.log(d1 / d2) + (d1 / 2 - 1) * Math.log(x) - ((d1 + d2) / 2) * Math.log1p((d1 * x) / d2) - lnB);
}

/** [P(X ≤ x), P(X > x)] for F(d1, d2). */
function fTails(x: number, d1: number, d2: number): [number, number] {
  if (x <= 0) return [0, 1];
  if (x === Infinity) return [1, 0];
  return betaRegPair(d1 / 2, d2 / 2, (d1 * x) / (d1 * x + d2), d2 / (d1 * x + d2));
}

export function fBetween(a: number, b: number, d1: number, d2: number): number {
  if (a > b) return 0;
  const [la, ua] = fTails(a, d1, d2);
  const [lb, ub] = fTails(b, d1, d2);
  return la > 0.5 ? ua - ub : lb - la;
}

export function poissonPdf(lambda: number, k: number): number {
  if (!isWhole(k) || k < 0) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  if (k > 16) return Math.exp(-stirlerr(k) - bd0(k, lambda) - 0.5 * (LN_2PI + Math.log(k)));
  return Math.exp(k * Math.log(lambda) - lambda - lgamma(k + 1));
}

/** P(X ≤ k) = Q(k + 1, λ). */
export function poissonCdf(lambda: number, k: number): number {
  if (k < 0) return 0;
  if (lambda === 0) return 1;
  return gammaQ(Math.floor(k) + 1, lambda);
}

/**
 * Derivative by central differences with Richardson extrapolation (Ridders' method).
 * Order 1 uses (f(x+h) − f(x−h))/2h and order 2 uses (f(x+h) − 2f(x) + f(x−h))/h². Both have error series in
 * powers of h², so the same extrapolation tableau works. Returns the estimate and an error estimate.
 */
export function ridders(F: (x: number) => number, x: number, order: 1 | 2): { value: number; err: number } {
  // A fast wiggle like sin(100x) needs a smaller first step, so retry from smaller steps until the estimate settles.
  const scale = Math.max(1, Math.abs(x));
  let best = { value: NaN, err: Infinity };
  for (const h0 of order === 1 ? [0.1, 1e-2, 1e-3, 1e-4] : [0.2, 2e-2, 2e-3]) {
    const r = riddersFrom(F, x, order, h0 * scale);
    if (r.err < best.err || Number.isNaN(best.value)) best = r;
    if (best.err <= (order === 1 ? 1e-10 : 1e-7) * Math.max(1, Math.abs(best.value))) break;
  }
  return best;
}

function riddersFrom(F: (x: number) => number, x: number, order: 1 | 2, h: number): { value: number; err: number } {
  const CON = 1.4, CON2 = CON * CON, NTAB = 12, SAFE = 2;
  const fx = order === 2 ? F(x) : 0;
  const diff = (step: number) =>
    order === 1 ? (F(x + step) - F(x - step)) / (2 * step) : (F(x + step) - 2 * fx + F(x - step)) / (step * step);
  const a: number[][] = Array.from({ length: NTAB }, () => new Array<number>(NTAB).fill(0));
  a[0][0] = diff(h);
  let err = Infinity;
  let value = a[0][0];
  for (let i = 1; i < NTAB; i++) {
    h /= CON;
    a[0][i] = diff(h);
    let fac = CON2;
    for (let j = 1; j <= i; j++) {
      a[j][i] = (a[j - 1][i] * fac - a[j - 1][i - 1]) / (fac - 1);
      fac *= CON2;
      const e = Math.max(Math.abs(a[j][i] - a[j - 1][i]), Math.abs(a[j][i] - a[j - 1][i - 1]));
      if (e <= err) {
        err = e;
        value = a[j][i];
      }
    }
    if (Math.abs(a[i][i] - a[i - 1][i - 1]) >= SAFE * err) break;
  }
  return { value, err };
}

// Gauss–Kronrod 7/15 nodes and weights on [−1, 1].
const XGK = [0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.74153118559939444, 0.58608723546769113, 0.405845151377397167, 0.207784955007898468, 0];
const WGK = [0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919, 0.169004726639267903, 0.19035057806478541, 0.204432940075298892, 0.209482141084727828];
const WG = [0.129484966168869693, 0.279705391489276668, 0.381830050505118945, 0.417959183673469388];

function gk15(F: (x: number) => number, a: number, b: number): { value: number; err: number } {
  const c = (a + b) / 2, h = (b - a) / 2;
  const fc = F(c);
  let k = fc * WGK[7];
  let g = fc * WG[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * XGK[j];
    const f1 = F(c - dx), f2 = F(c + dx);
    k += WGK[j] * (f1 + f2);
    if (j % 2 === 1) g += WG[(j - 1) / 2] * (f1 + f2);
  }
  return { value: k * h, err: Math.abs((k - g) * h) };
}

const NO_SETTLE = 'The integral did not settle to a value. It may diverge, or the integrand may jump or swing too fast';

interface Integral {
  value: number;
  /** Estimated absolute error. */
  err: number;
}

/**
 * Adaptive Gauss–Kronrod on (0, 1] for an integrand G(u) whose only hard end is u = 0, where floats are dense.
 * `at(u)` is the original x, for error messages; `edge(u)` says x has rounded onto an original end, which has
 * no width and counts as 0.
 */
function adaptive(G: (u: number) => number, at: (u: number) => number, edge: (u: number) => boolean, a: number, b: number): Integral {
  const checked = (u: number): number => {
    if (u <= 0 || edge(u)) return 0;
    const v = G(u);
    if (!Number.isFinite(v)) {
      // Blowing up this deep against the end means the integral diverges there.
      if (u < 1e-100) fail(NO_SETTLE);
      const x = at(u);
      fail(Number.isFinite(x)
        ? `The integrand isn't defined everywhere between ${a} and ${b} (it fails near ${Number(x.toPrecision(6))})`
        : `The integrand isn't defined everywhere between ${a} and ${b}`);
    }
    return v;
  };
  const parts = [{ a: 0, b: 1, ...gk15(checked, 0, 1) }];
  let total = parts[0].value, errSum = parts[0].err;
  for (let iter = 0; iter < 600; iter++) {
    total = 0; errSum = 0;
    let worst = 0;
    for (let k = 0; k < parts.length; k++) {
      total += parts[k].value;
      errSum += parts[k].err;
      if (parts[k].err > parts[worst].err) worst = k;
    }
    if (errSum <= Math.max(1e-15, 1e-12 * Math.abs(total))) break;
    const p = parts[worst];
    const mid = (p.a + p.b) / 2;
    if (mid <= p.a || mid >= p.b) break;
    parts.splice(worst, 1, { a: p.a, b: mid, ...gk15(checked, p.a, mid) }, { a: mid, b: p.b, ...gk15(checked, mid, p.b) });
  }
  return { value: total, err: errSum };
}

/**
 * True when |f(x)|·|x − end| doesn't shrink toward a finite end: the integrand blows up like 1/(x − end) or
 * worse, so the integral diverges even if the float grid ran out before the sum could show it.
 */
function blowsUpAt(f: (x: number) => number, end: number, toward: number): boolean {
  const span = Math.abs(toward - end);
  const dir = Math.sign(toward - end);
  const far = 1e-6 * span;
  const near = Math.max(1e-11 * span, 1024 * Number.EPSILON * Math.abs(end));
  if (near >= far / 10) return false;
  const g = (d: number) => Math.abs(f(end + dir * d)) * d;
  const gFar = g(far), gNear = g(near);
  return Number.isFinite(gFar) && Number.isFinite(gNear) && gNear > 0 && gNear >= 0.5 * gFar;
}

/**
 * Whether f has a pole beside `at`, a point inside (a, b) where its samples were largest. A tall finite peak is not
 * one: 1e-9/(x² + 1e-18) reaches 1e9 at 0 and integrates to π. The difference shows on the way in. At a pole
 * |f|·distance holds or grows right down to the float grid; inside a finite peak it falls away, because |f| has
 * stopped growing.
 */
function poleNear(f: (x: number) => number, at: number, a: number, b: number): boolean {
  const span = b - a;
  const size = (x: number): number => {
    const y = Math.abs(f(x));
    return Number.isNaN(y) ? Infinity : y;
  };
  // Climb to the top of the peak first: the largest sample sits beside it, not on it.
  let lo = Math.max(a, at - 1e-3 * span), hi = Math.min(b, at + 1e-3 * span);
  for (let k = 0; k < 200 && hi - lo > 4 * Number.EPSILON * Math.max(Math.abs(lo), Math.abs(hi)); k++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (size(m1) < size(m2)) lo = m1;
    else hi = m2;
  }
  const c = (lo + hi) / 2;
  const far = 1e-6 * span, near = Math.max(1024 * Number.EPSILON * Math.abs(c), far * 1e-20);
  for (const dir of [-1, 1]) {
    let top = 0, last = 0, probes = 0;
    for (let d = far; d >= near; d /= 10) {
      const x = c + dir * d;
      if (x <= a || x >= b) continue;
      const g = size(x) * d;
      if (!Number.isFinite(g)) continue;
      top = Math.max(top, g);
      last = g;
      probes++;
    }
    if (probes >= 3 && last > 0 && last >= 0.5 * top) return true;
  }
  return false;
}

/**
 * Integral of f over [a, b]. A finite interval is split at its midpoint m and each half is mapped so its outer
 * end sits at u = 0: x = a + L·u² on [a, m] and x = b − L·u² on [m, b], with L = (b − a)/2. The u² also softens
 * end singularities like 1/√(x − a). An infinite end maps to u = 0 through x = c + (1 − u)/u past a unit-width
 * finite piece.
 */
export function integrate(f: (x: number) => number, a: number, b: number): Integral {
  if (Number.isNaN(a) || Number.isNaN(b)) fail('integral bounds must be numbers');
  if (a === b) return { value: 0, err: 0 };
  if (a > b) {
    const r = integrate(f, b, a);
    return { value: -r.value, err: r.err };
  }
  const add = (...rs: Integral[]): Integral => ({ value: rs.reduce((s, r) => s + r.value, 0), err: rs.reduce((s, r) => s + r.err, 0) });
  if (a === -Infinity && b === Infinity) return add(integrate(f, -Infinity, 0), integrate(f, 0, Infinity));
  if (b === Infinity) {
    const c = a + 1;
    const tail = adaptive((u) => f(c + (1 - u) / u) / u / u, (u) => c + (1 - u) / u, () => false, a, b);
    return settle(add(integrate(f, a, c), tail));
  }
  if (a === -Infinity) {
    const c = b - 1;
    const tail = adaptive((u) => f(c - (1 - u) / u) / u / u, (u) => c - (1 - u) / u, () => false, a, b);
    return settle(add(integrate(f, c, b), tail));
  }
  const L = (b - a) / 2;
  // Where the integrand was largest, for the pole check below: refinement crowds samples around a pole.
  let peak = 0, peakAt = a;
  const seen = (x: number): number => {
    const y = f(x), size = Math.abs(y);
    if (size > peak) { peak = size; peakAt = x; }
    return y;
  };
  const left = adaptive((u) => seen(a + L * u * u) * 2 * L * u, (u) => a + L * u * u, (u) => a + L * u * u === a, a, b);
  const right = adaptive((u) => seen(b - L * u * u) * 2 * L * u, (u) => b - L * u * u, (u) => b - L * u * u === b, a, b);
  if (blowsUpAt(f, a, b) || blowsUpAt(f, b, a)) fail(NO_SETTLE);
  const sum = settle(add(left, right));
  // A pole inside the interval, like 1/(x − 0.1)² over −1 to 1: the sum of what the grid reached is a huge finite
  // number, but the integral has no value. Only a peak far taller than the answer is worth the look.
  if (peakAt > a && peakAt < b && peak * (b - a) > 1e6 * Math.abs(sum.value) && poleNear(f, peakAt, a, b)) fail(NO_SETTLE);
  return sum;
}

function settle(r: Integral): Integral {
  if (!(r.err <= 1e-6 * Math.max(1, Math.abs(r.value)))) fail(NO_SETTLE);
  return r;
}

type C2 = [number, number];
const cmul = (a: C2, b: C2): C2 => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C2, b: C2): C2 => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const cabs = (a: C2) => Math.hypot(a[0], a[1]);

/** p(z) and p′(z) by Horner. Coefficients run from the leading term down. */
function hornerC(c: number[], z: C2): [C2, C2] {
  let p: C2 = [c[0], 0], dp: C2 = [0, 0];
  for (let i = 1; i < c.length; i++) {
    dp = cmul(dp, z); dp[0] += p[0]; dp[1] += p[1];
    p = cmul(p, z); p[0] += c[i];
  }
  return [p, dp];
}

function derivCoeffs(c: number[]): number[] {
  const n = c.length - 1;
  return c.slice(0, -1).map((x, i) => x * (n - i));
}

/** Σ|c_i|·r^k: the size of the terms, for judging when p(z) is zero up to rounding. */
function polyScale(c: number[], r: number): number {
  let s = 0;
  for (const x of c) s = s * r + Math.abs(x);
  return s;
}

/**
 * All complex roots of a polynomial (leading coefficient first) by Aberth–Ehrlich iteration, polished with
 * Newton steps. Estimates that cluster around one multiple root are replaced by their average, which is far
 * more accurate than any one of them.
 */
export function polyRoots(coeffs: number[]): C2[] {
  let c = coeffs.slice();
  while (c.length && c[0] === 0) c.shift();
  if (c.length <= 1) return [];
  const zeros: C2[] = [];
  while (c[c.length - 1] === 0) { c.pop(); zeros.push([0, 0]); }
  const n = c.length - 1;
  if (n === 0) return zeros;
  const lead = c[0];
  c = c.map((x) => x / lead);
  if (n === 1) return [[-c[1], 0], ...zeros];
  const center = -c[1] / n;
  let radius = 0;
  for (let i = 1; i <= n; i++) radius = Math.max(radius, Math.pow(Math.abs(c[i]), 1 / i));
  const z: C2[] = Array.from({ length: n }, (_, k): C2 => {
    const th = (2 * Math.PI * k) / n + 0.4;
    return [center + radius * Math.cos(th), radius * Math.sin(th)];
  });
  for (let iter = 0; iter < 1000; iter++) {
    let moved = 0;
    for (let k = 0; k < n; k++) {
      const [p, dp] = hornerC(c, z[k]);
      if (p[0] === 0 && p[1] === 0) continue;
      const ratio = cdiv(p, dp);
      let s: C2 = [0, 0];
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        const inv = cdiv([1, 0], [z[k][0] - z[j][0], z[k][1] - z[j][1]]);
        s = [s[0] + inv[0], s[1] + inv[1]];
      }
      const rs = cmul(ratio, s);
      const w = cdiv(ratio, [1 - rs[0], -rs[1]]);
      if (!Number.isFinite(w[0]) || !Number.isFinite(w[1])) continue;
      z[k] = [z[k][0] - w[0], z[k][1] - w[1]];
      moved = Math.max(moved, cabs(w) / Math.max(1, cabs(z[k])));
    }
    if (moved < 1e-16) break;
  }
  // Newton polish; keep a step only when it lowers |p|.
  for (let k = 0; k < n; k++) {
    for (let it = 0; it < 4; it++) {
      const [p, dp] = hornerC(c, z[k]);
      if (cabs(dp) === 0) break;
      const step = cdiv(p, dp);
      const next: C2 = [z[k][0] - step[0], z[k][1] - step[1]];
      if (cabs(hornerC(c, next)[0]) < cabs(p)) z[k] = next; else break;
    }
  }
  // Merge clusters that are really one multiple root. An m-fold root of p is a simple root of its (m−1)th
  // derivative, so Newton on that derivative, started from the cluster's average, pins it down to full precision.
  const used = new Array<boolean>(n).fill(false);
  for (let k = 0; k < n; k++) {
    if (used[k]) continue;
    const group = [k];
    for (let j = k + 1; j < n; j++) {
      if (!used[j] && cabs([z[j][0] - z[k][0], z[j][1] - z[k][1]]) < 1e-3 * Math.max(1, cabs(z[k]))) group.push(j);
    }
    if (group.length > 1) {
      let m: C2 = [0, 0];
      for (const g of group) { m[0] += z[g][0] / group.length; m[1] += z[g][1] / group.length; }
      let dc = c;
      for (let j = 1; j < group.length; j++) dc = derivCoeffs(dc);
      for (let it = 0; it < 30; it++) {
        const [p, dp] = hornerC(dc, m);
        if (cabs(dp) === 0) break;
        const step = cdiv(p, dp);
        m = [m[0] - step[0], m[1] - step[1]];
        if (cabs(step) <= 1e-16 * Math.max(1, cabs(m))) break;
      }
      if (cabs(hornerC(c, m)[0]) <= 1e-13 * polyScale(c, cabs(m))) {
        for (const g of group) { z[g] = [m[0], m[1]]; used[g] = true; }
      }
    }
    used[k] = true;
  }
  // Noise is relative to the largest root: a fixed 1 here zeroed the roots of x² − 1e-36.
  let big = 0;
  for (const r of z) big = Math.max(big, cabs(r));
  const unit = Math.min(1, big);
  for (const r of z) {
    if (Math.abs(r[1]) <= 1e-10 * Math.max(unit, Math.abs(r[0]))) r[1] = 0;
    if (Math.abs(r[0]) <= 1e-14 * Math.max(unit, Math.abs(r[1]))) r[0] = 0;
  }
  return [...z, ...zeros];
}
