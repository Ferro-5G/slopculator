// Real numbers as balls: a midpoint m·2^e and a radius r·2^e, so the true value lies in [(m − r)·2^e, (m + r)·2^e].
// Every operation returns a ball that contains the exact result, so the digits a ball pins down are proven.
// p is the number of bits kept in the midpoint. Elementary functions work in fixed point (an integer X meaning X·2^−w)
// with guard bits and a counted error bound, then widen the result by how far the input ball could move it.

export interface Ball {
  m: bigint;
  e: number;
  r: bigint;
}

/** Thrown when a ball can't decide something (a divisor that might be 0, a log of a ball reaching ≤ 0). Callers fall back to doubles. */
export class Undecided extends Error {}

const ZERO: Ball = { m: 0n, e: 0, r: 0n };
export const ONE: Ball = { m: 1n, e: 0, r: 0n };

const abs = (x: bigint): bigint => (x < 0n ? -x : x);

export function bitLength(x: bigint): number {
  if (x < 0n) x = -x;
  if (x === 0n) return 0;
  const s = x.toString(16);
  return s.length * 4 - (Math.clz32(parseInt(s[0], 16)) - 28);
}

/** x·2^k, flooring when k < 0. */
function shiftFloor(x: bigint, k: number): bigint {
  return k >= 0 ? x << BigInt(k) : x >> BigInt(-k);
}

/** x·2^k, rounding up when k < 0. */
function shiftCeil(x: bigint, k: number): bigint {
  if (k >= 0) return x << BigInt(k);
  const K = BigInt(-k);
  return (x + (1n << K) - 1n) >> K;
}

/** x·2^−k rounded to nearest, ties away from zero. */
function roundShift(x: bigint, k: number): bigint {
  if (k <= 0) return x << BigInt(-k);
  const K = BigInt(k);
  const q = (abs(x) + (1n << (K - 1n))) >> K;
  return x < 0n ? -q : q;
}

/** ⌈x·r·2^e⌉ for x, r ≥ 0. */
function scaleUp(x: bigint, r: bigint, e: number): bigint {
  return shiftCeil(x * r, e);
}

/** Keep at most p bits of the midpoint, and drop midpoint bits far below the radius. */
function norm(m: bigint, e: number, r: bigint, p: number): Ball {
  let k = bitLength(m) - p;
  const rb = bitLength(r);
  if (rb > 40) k = Math.max(k, rb - 40);
  if (k <= 0) return { m, e, r };
  const K = BigInt(k);
  return { m: roundShift(m, k), e: e + k, r: ((r + (1n << K) - 1n) >> K) + 1n };
}

/** Widen a short midpoint to p bits so that adding a tiny term costs at most one unit at p bits. */
function pad(a: Ball, p: number): Ball {
  const b = bitLength(a.m);
  if (a.m === 0n || b >= p) return a;
  const s = BigInt(p - b);
  return { m: a.m << s, e: a.e - (p - b), r: a.r << s };
}

const isZero = (a: Ball): boolean => a.m === 0n && a.r === 0n;
/** Sign the whole ball shares: 1, −1, or 0 when it is exactly 0. Null when it straddles 0. */
export function sign(a: Ball): number | null {
  if (isZero(a)) return 0;
  if (abs(a.m) <= a.r) return null;
  return a.m > 0n ? 1 : -1;
}

/** Bit position just above the largest magnitude in the ball. */
function top(a: Ball): number {
  return a.e + bitLength(abs(a.m) + a.r);
}

export function fromInt(n: bigint, p: number): Ball {
  return norm(n, 0, 0n, p);
}

export function fromRat(n: bigint, d: bigint, p: number): Ball {
  if (n === 0n) return ZERO;
  if (d === 1n) return norm(n, 0, 0n, p);
  if ((d & (d - 1n)) === 0n) return norm(n, -(bitLength(d) - 1), 0n, p);
  const an = abs(n);
  const k = p + 2 + bitLength(d) - bitLength(an);
  const q = k >= 0 ? (an << BigInt(k)) / d : an / (d << BigInt(-k));
  return norm(n < 0n ? -q : q, -k, 1n, p);
}

export function neg(a: Ball): Ball {
  return { m: -a.m, e: a.e, r: a.r };
}

export function add(a: Ball, b: Ball, p: number): Ball {
  if (isZero(a)) return norm(b.m, b.e, b.r, p);
  if (isZero(b)) return norm(a.m, a.e, a.r, p);
  // A term far below the other's last bit only widens the radius.
  const ta = top(a), tb = top(b);
  if (tb < ta - p - 8) {
    const A = pad(a, p);
    return norm(A.m, A.e, A.r + (tb <= A.e ? 1n : 1n << BigInt(tb - A.e)), p);
  }
  if (ta < tb - p - 8) return add(b, a, p);
  const e = Math.min(a.e, b.e);
  const sa = BigInt(a.e - e), sb = BigInt(b.e - e);
  return norm((a.m << sa) + (b.m << sb), e, (a.r << sa) + (b.r << sb), p);
}

export function sub(a: Ball, b: Ball, p: number): Ball {
  return add(a, neg(b), p);
}

export function mul(a: Ball, b: Ball, p: number): Ball {
  if (isZero(a) || isZero(b)) return ZERO;
  return norm(a.m * b.m, a.e + b.e, abs(a.m) * b.r + abs(b.m) * a.r + a.r * b.r, p);
}

export function div(a: Ball, b: Ball, p: number): Ball {
  const bm = abs(b.m);
  if (bm <= b.r) throw new Undecided('divisor may be 0');
  if (isZero(a)) return ZERO;
  const am = abs(a.m);
  const k = Math.max(0, p + 2 + bitLength(bm) - bitLength(am));
  const K = BigInt(k);
  const q = (am << K) / bm;
  // |x/y − am/bm| ≤ (ar·bm + am·br) / (bm·(bm − br)), plus one unit for truncating q.
  const num = (a.r * bm + am * b.r) << K;
  const den = bm * (bm - b.r);
  const r = (num + den - 1n) / den + 1n;
  return norm((a.m < 0n) !== (b.m < 0n) ? -q : q, a.e - b.e - k, r, p);
}

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt((bitLength(n) >> 1) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export function sqrt(a: Ball, p: number): Ball {
  if (isZero(a)) return ZERO;
  const lo = a.m - a.r, hi = a.m + a.r;
  if (lo < 0n) throw new Undecided('square root of a ball reaching below 0');
  let k = 2 * (p + 2) - bitLength(hi);
  if ((a.e - k) % 2 !== 0) k++;
  const L = isqrt(shiftFloor(lo, k));
  const U = isqrt(shiftCeil(hi, k)) + 1n;
  const m = (L + U) >> 1n;
  return norm(m, (a.e - k) / 2, U - m, p);
}

/** a^n for a whole n ≥ 0, by squaring with enough guard bits that the radius stays a few units. */
export function powInt(a: Ball, n: bigint, p: number): Ball {
  const q = p + bitLength(n) + 8;
  let res = ONE, base = a;
  while (n > 0n) {
    if (n & 1n) res = mul(res, base, q);
    n >>= 1n;
    if (n > 0n) base = mul(base, base, q);
  }
  return norm(res.m, res.e, res.r, p);
}

/** Σ ±1/((2k+1)·n^(2k+1)) at w bits: atan(1/n) when alternating, atanh(1/n) otherwise. Error under 2 units per term. */
function arcInv(n: bigint, w: number, alternate: boolean): bigint {
  let power = (1n << BigInt(w)) / n;
  const n2 = n * n;
  let sum = 0n;
  let neg = false;
  for (let k = 1n; power !== 0n; k += 2n) {
    const t = power / k;
    sum += neg ? -t : t;
    if (alternate) neg = !neg;
    power /= n2;
  }
  return sum;
}

let piCache: { w: number; v: bigint } = { w: 0, v: 0n };
/** π·2^w within 2 units. */
function piFixed(w: number): bigint {
  if (piCache.w < w) {
    const W = w + 40;
    piCache = { w: W, v: roundShift(16n * arcInv(5n, W + 32, true) - 4n * arcInv(239n, W + 32, true), 32) };
  }
  return roundShift(piCache.v, piCache.w - w);
}

let ln2Cache: { w: number; v: bigint } = { w: 0, v: 0n };
/** ln 2·2^w within 2 units: ln 2 = 2·atanh(1/3). */
function ln2Fixed(w: number): bigint {
  if (ln2Cache.w < w) {
    const W = w + 40;
    ln2Cache = { w: W, v: roundShift(2n * arcInv(3n, W + 32, false), 32) };
  }
  return roundShift(ln2Cache.v, ln2Cache.w - w);
}

export function pi(p: number): Ball {
  return norm(piFixed(p + 8), -(p + 8), 2n, p);
}

/** The midpoint m·2^e as fixed point at w bits; error under one unit. */
function toFixed(m: bigint, e: number, w: number): bigint {
  return shiftFloor(m, e + w);
}

/** Rough double for a midpoint, for choosing reductions only. */
function approx(m: bigint, e: number): number {
  const b = bitLength(m);
  if (b <= 60) return Number(m) * 2 ** e;
  const x = Number(m >> BigInt(b - 60));
  return x * 2 ** (e + b - 60);
}

/** Extra radius from the input's own radius when |f′| ≤ 1 near it: ⌈r·2^(e − ey)⌉. */
function lipschitz1(x: Ball, ey: number): bigint {
  return x.r === 0n ? 0n : shiftCeil(x.r, x.e - ey) + 1n;
}

export function exp(x: Ball, p: number): Ball {
  if (isZero(x)) return ONE;
  // The input radius must be small, so e^rad − 1 ≤ rad·(1 + 2^−9).
  if (x.r !== 0n && top({ m: 0n, e: x.e, r: x.r }) > -10) throw new Undecided('exp of a wide ball');
  const c = approx(x.m, x.e);
  if (!(Math.abs(c) < 2 ** 40)) throw new Undecided('exp argument too large');
  const s = Math.max(8, Math.round(Math.sqrt(p) / 2));
  const w = p + s + 40;
  const W = BigInt(w);
  const k = Math.round(c / Math.LN2);
  const kb = bitLength(BigInt(Math.abs(k))) + 2;
  // t = x − k·ln 2, at w bits within 2 units.
  const T = roundShift(toFixed(x.m, x.e, w + kb) - BigInt(k) * ln2Fixed(w + kb), kb);
  const t = T >> BigInt(s);
  const one = 1n << W;
  let sum = one, term = one, n = 0;
  for (let i = 1n; ; i++) {
    term = ((term * t) >> W) / i;
    if (term === 0n) break;
    sum += term;
    n++;
  }
  for (let i = 0; i < s; i++) sum = (sum * sum) >> W;
  // Taylor and the first reduction stay within 2n + 6 units; each squaring at most doubles the relative error.
  const err = (BigInt(2 * n + 8) * 3n) << BigInt(s);
  const ey = k - w;
  const r = err + (x.r === 0n ? 0n : (() => { const v = scaleUp(sum, x.r, x.e); return v + (v >> 9n) + 1n; })());
  return norm(sum, ey, r, p);
}

export function ln(x: Ball, p: number): Ball {
  if (x.m - x.r <= 0n) throw new Undecided('log of a ball reaching ≤ 0');
  if (x.r === 0n && x.e <= 0 && x.m === 1n << BigInt(-x.e)) return ZERO;
  const w = p + 40;
  const W = BigInt(w);
  const one = 1n << W;
  const b = bitLength(x.m);
  // x = y·2^E with y in [1/√2, √2).
  let Y = shiftFloor(x.m, w - b);
  let E = x.e + b;
  if (2n * Y * Y < one * one) {
    Y <<= 1n;
    E -= 1;
  }
  // ln y = 2·atanh(z), z = (y − 1)/(y + 1), |z| ≤ 0.172.
  const Z = ((Y - one) << W) / (Y + one);
  // atanh is odd, so sum with |z| and restore the sign.
  const az = abs(Z);
  const Z2 = (az * az) >> W;
  let term = az, sum = az, n = 1;
  for (let k = 3n; ; k += 2n) {
    term = (term * Z2) >> W;
    if (term === 0n) break;
    sum += term / k;
    n++;
  }
  let R = 2n * (Z < 0n ? -sum : sum);
  if (E !== 0) {
    const eb = bitLength(BigInt(Math.abs(E))) + 2;
    R += roundShift(BigInt(E) * ln2Fixed(w + eb), eb);
  }
  const err = BigInt(4 * n + 12);
  // |ln(c ± rad) − ln c| ≤ rad / (c − rad), which is r / (m − r) relative to the units of x.
  const r = err + (x.r === 0n ? 0n : (((x.r << W) + (x.m - x.r) - 1n) / (x.m - x.r)) + 1n);
  return norm(R, -w, r, p);
}

/** sin and cos of the midpoint at w bits, each within err units. */
function sinCosFixed(m: bigint, e: number, w: number): { s: bigint; c: bigint; err: bigint } {
  const kb = Math.max(0, bitLength(m) + e + 1) + 4;
  if (kb > 40000) throw new Undecided('trig argument too large');
  const Wx = w + kb;
  const HP = piFixed(Wx) >> 1n;
  const X = toFixed(m, e, Wx);
  const k = (2n * X + HP) / (2n * HP) - (X < 0n && (2n * X + HP) % (2n * HP) !== 0n ? 1n : 0n);
  const T = roundShift(X - k * HP, kb);
  const W = BigInt(w);
  const one = 1n << W;
  const T2 = (T * T) >> W;
  let s = T, term = T, n = 0;
  for (let i = 2n; ; i += 2n) {
    term = -((term * T2) >> W) / (i * (i + 1n));
    if (term === 0n) break;
    s += term;
    n++;
  }
  let c = one;
  term = one;
  for (let i = 1n; ; i += 2n) {
    term = -((term * T2) >> W) / (i * (i + 1n));
    if (term === 0n) break;
    c += term;
    n++;
  }
  const q = Number(((k % 4n) + 4n) % 4n);
  const S = [s, c, -s, -c][q], C = [c, -s, -c, s][q];
  return { s: S, c: C, err: BigInt(2 * n + 8) };
}

export function sin(x: Ball, p: number): Ball {
  if (isZero(x)) return ZERO;
  const w = p + 40;
  const { s, err } = sinCosFixed(x.m, x.e, w);
  return norm(s, -w, err + lipschitz1(x, -w), p);
}

export function cos(x: Ball, p: number): Ball {
  if (isZero(x)) return ONE;
  const w = p + 40;
  const { c, err } = sinCosFixed(x.m, x.e, w);
  return norm(c, -w, err + lipschitz1(x, -w), p);
}

export function atan(x: Ball, p: number): Ball {
  if (isZero(x)) return ZERO;
  const w = p + 48;
  const W = BigInt(w);
  const one = 1n << W;
  const am = abs(x.m);
  // |x| > 1: atan x = π/2 − atan(1/x).
  const big = x.e + bitLength(am) > 1 || (x.e + bitLength(am) === 1 && am !== 1n << BigInt(bitLength(am) - 1));
  let X: bigint;
  if (big) X = w - x.e >= 0 ? (1n << BigInt(w - x.e)) / am : 0n;
  else X = toFixed(am, x.e, w);
  // Halve the angle 4 times: x ← x / (1 + √(1 + x²)), so |x| ≤ tan(π/64).
  const halvings = 4;
  for (let j = 0; j < halvings; j++) X = (X << W) / (one + isqrt(one * one + X * X));
  const X2 = (X * X) >> W;
  let term = X, sum = X, n = 0;
  for (let k = 3n; ; k += 2n) {
    term = -((term * X2) >> W);
    if (term === 0n) break;
    sum += term / k;
    n++;
  }
  let R = sum << BigInt(halvings);
  if (big) R = (piFixed(w) >> 1n) - R;
  if (x.m < 0n) R = -R;
  const err = BigInt((2 * n + 16) << halvings);
  return norm(R, -w, err + lipschitz1(x, -w), p);
}
