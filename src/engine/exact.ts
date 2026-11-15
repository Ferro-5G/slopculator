// Exact numbers for displayed results: a rational n/d, a rational multiple of π, or a real ball (see real.ts).
// Arithmetic stays rational or π-rational while it can and moves to balls only when it must, so 0.1 + 0.2 is
// exactly 3/10 and sin(30°) is exactly 1/2. Anything this can't decide throws Undecided, and callers fall back to doubles.
import * as R from './real';
import { Undecided, bitLength, type Ball } from './real';

export { Undecided };

export interface Rat { k: 'q'; n: bigint; d: bigint }
interface PiRat { k: 'pi'; n: bigint; d: bigint }
export interface Real { k: 'r'; b: Ball }
export type Num = Rat | PiRat | Real;

/** The points where a number's text changes form, for the exact display here and the double display in format.ts. */
export const DIGITS = {
  /** Significant digits an automatic answer keeps when copied. The screen asks for fewer. */
  fullSig: 12,
  /** On screen, a whole part longer than this many digits shows as d.ddd × 10ⁿ instead. */
  wholeOnScreen: 16,
  /** E notation from 10^maxExp up, and below 10^minExp. above and below are the same bounds as doubles. */
  maxExp: 15,
  minExp: -6,
  above: 1e15,
  below: 1e-6,
};

/** Rationals past this many bits give up, so a keystroke never waits on a giant integer. */
// Hermes, which runs the mobile apps, throws on a BigInt of 65,536 bits or more. Staying a word under keeps SIZE_LIMIT legal there.
const MAX_BITS = 65472;

const abs = (x: bigint): bigint => (x < 0n ? -x : x);

export function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

const SIZE_LIMIT = 1n << BigInt(MAX_BITS);
const NEG_LIMIT = -SIZE_LIMIT;

function checkSize(n: bigint, d: bigint): void {
  if (n >= SIZE_LIMIT || n <= NEG_LIMIT || d >= SIZE_LIMIT) throw new Undecided('number too large to keep exact');
}

export function rat(n: bigint, d = 1n): Rat {
  if (d === 0n) throw new Undecided('division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (d !== 1n) {
    const g = gcd(n, d);
    if (g > 1n) {
      n /= g;
      d /= g;
    }
  }
  checkSize(n, d);
  return { k: 'q', n, d };
}

export function piRat(n: bigint, d = 1n): Num {
  const q = rat(n, d);
  return q.n === 0n ? q : { k: 'pi', n: q.n, d: q.d };
}

export const real = (b: Ball): Real => ({ k: 'r', b });
export const ZERO = rat(0n);
export const ONE = rat(1n);

export function fromDecimal(s: string): Rat {
  const m = /^([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]+))?$/.exec(s.trim());
  if (!m || (m[1] === '' && !m[2])) throw new Undecided(`not a decimal: ${s}`);
  const frac = m[2] ?? '';
  const exp = Number(m[3] ?? 0) - frac.length;
  if (!(Math.abs(exp) <= 20000)) throw new Undecided('exponent too large to keep exact');
  const digits = BigInt((m[1] || '0') + frac);
  return exp >= 0 ? rat(digits * 10n ** BigInt(exp)) : rat(digits, 10n ** BigInt(-exp));
}

/** A double as the decimal it prints as, which is what a person meant by it. */
export function fromDouble(x: number): Rat {
  if (!Number.isFinite(x)) throw new Undecided('not finite');
  const s = String(Math.abs(x));
  const q = fromDecimal(s);
  return x < 0 ? rat(-q.n, q.d) : q;
}

export const isInt = (x: Num): boolean => x.k === 'q' && x.d === 1n;
export const isZeroNum = (x: Num): boolean => x.k !== 'r' && x.n === 0n;

export function toBall(x: Num, p: number): Ball {
  if (x.k === 'q') return R.fromRat(x.n, x.d, p);
  if (x.k === 'pi') return R.div(R.mul(R.pi(p + 4), R.fromInt(x.n, p + 4), p + 4), R.fromInt(x.d, p + 4), p);
  return x.b;
}

export function neg(x: Num): Num {
  if (x.k === 'r') return real(R.neg(x.b));
  return { ...x, n: -x.n };
}

export function add(a: Num, b: Num, p: number): Num {
  if (a.k === 'q' && b.k === 'q') return rat(a.n * b.d + b.n * a.d, a.d * b.d);
  if (a.k === 'pi' && b.k === 'pi') return piRat(a.n * b.d + b.n * a.d, a.d * b.d);
  if (isZeroNum(a)) return b;
  if (isZeroNum(b)) return a;
  return real(R.add(toBall(a, p), toBall(b, p), p));
}

export function sub(a: Num, b: Num, p: number): Num {
  return add(a, neg(b), p);
}

export function mul(a: Num, b: Num, p: number): Num {
  if (isZeroNum(a) || isZeroNum(b)) return ZERO;
  if (a.k === 'q' && b.k === 'q') return rat(a.n * b.n, a.d * b.d);
  if (a.k === 'q' && b.k === 'pi') return piRat(a.n * b.n, a.d * b.d);
  if (a.k === 'pi' && b.k === 'q') return piRat(a.n * b.n, a.d * b.d);
  return real(R.mul(toBall(a, p), toBall(b, p), p));
}

export function div(a: Num, b: Num, p: number): Num {
  if (isZeroNum(b)) throw new Undecided('division by zero');
  if (isZeroNum(a)) return ZERO;
  if (a.k === 'q' && b.k === 'q') return rat(a.n * b.d, a.d * b.n);
  if (a.k === 'pi' && b.k === 'q') return piRat(a.n * b.d, a.d * b.n);
  if (a.k === 'pi' && b.k === 'pi') return rat(a.n * b.d, a.d * b.n);
  return real(R.div(toBall(a, p), toBall(b, p), p));
}

/** −1, 0, or 1. Throws when a ball straddles 0. */
export function sign(x: Num): number {
  if (x.k !== 'r') return x.n > 0n ? 1 : x.n < 0n ? -1 : 0;
  const s = R.sign(x.b);
  if (s === null) throw new Undecided('sign unknown');
  return s;
}

export function cmp(a: Num, b: Num, p: number): number {
  return sign(sub(a, b, p));
}

function intRoot(n: bigint, k: number): bigint | null {
  if (n < 0n) return null;
  if (n < 2n) return n;
  if (k === 2) {
    const r = R.isqrt(n);
    return r * r === n ? r : null;
  }
  // Newton from above for the floor of the k-th root.
  const K = BigInt(k);
  let x = 1n << BigInt(Math.ceil(bitLength(n) / k) + 1);
  for (;;) {
    const y = ((K - 1n) * x + n / x ** (K - 1n)) / K;
    if (y >= x) break;
    x = y;
  }
  return x ** K === n ? x : null;
}

/** x^(1/k) for x ≥ 0 and a whole k ≥ 2: exact when x is a perfect power. */
export function root(x: Num, k: number, p: number): Num {
  if (x.k === 'q' && x.n >= 0n) {
    const a = intRoot(x.n, k), b = intRoot(x.d, k);
    if (a !== null && b !== null) return rat(a, b);
  }
  if (sign(x) < 0) throw new Undecided('root of a negative number');
  if (isZeroNum(x)) return ZERO;
  if (k === 2) return real(R.sqrt(toBall(x, p + 4), p));
  return real(R.exp(R.div(R.ln(toBall(x, p + 8), p + 8), R.fromInt(BigInt(k), p + 8), p + 8), p));
}

const SAFE = 1n << 53n;
function bits(x: bigint): number {
  return x < SAFE && x > -SAFE ? Math.ceil(Math.log2(Math.abs(Number(x)) + 1)) : bitLength(x);
}

export function powInt(a: Num, n: bigint, p: number): Num {
  if (n === 0n) return ONE;
  if (n < 0n) return div(ONE, powInt(a, -n, p), p);
  if (a.k === 'q') {
    if (a.d === 1n && a.n >= -1n && a.n <= 1n) return rat(n % 2n === 0n ? a.n * a.n : a.n);
    if (n <= BigInt(MAX_BITS) && Math.max(bits(a.n), bits(a.d)) * Number(n) <= MAX_BITS + 64) return rat(a.n ** n, a.d ** n);
    if (a.n === 0n) return ZERO;
  }
  if (n === 1n) return a;
  if (n > 4096n) {
    // Large powers by e^(n ln|a|), with the sign from the parity of n. Multiplying by n scales the log's error, so carry n's bits.
    const s = sign(a);
    const q = p + 64 + bitLength(n);
    const mag = R.exp(R.mul(R.ln(R.mul(toBall(a, q), R.fromInt(BigInt(s), q), q), q), R.fromInt(n, q), q), p);
    return real(s < 0 && n % 2n === 1n ? R.neg(mag) : mag);
  }
  return real(R.powInt(toBall(a, p + 16), n, p));
}

export function exp(x: Num, p: number): Num {
  if (isZeroNum(x)) return ONE;
  return real(R.exp(toBall(x, p + 8), p));
}

export function ln(x: Num, p: number): Num {
  if (x.k === 'q' && x.n === x.d) return ZERO;
  return real(R.ln(toBall(x, p + 8), p));
}

export function exactLog(b: Rat, x: Rat): bigint | null {
  if (b.n <= 0n || x.n <= 0n || (b.n === b.d)) return null;
  if (x.n === x.d) return 0n;
  const guess = Math.round(Math.log(Number(x.n) / Number(x.d)) / Math.log(Number(b.n) / Number(b.d)));
  if (!Number.isFinite(guess) || guess === 0 || Math.abs(guess) > 4096) {
    const lx = bitLength(x.n) - bitLength(x.d), lb = bitLength(b.n) - bitLength(b.d);
    if (lb === 0) return null;
    const g2 = Math.round(lx / lb);
    if (g2 === 0 || Math.abs(g2) > 70000) return null;
    for (const k of [g2 - 1, g2, g2 + 1]) if (k !== 0 && matchesPow(b, x, k)) return BigInt(k);
    return null;
  }
  return matchesPow(b, x, guess) ? BigInt(guess) : null;
}

function matchesPow(b: Rat, x: Rat, k: number): boolean {
  const K = BigInt(Math.abs(k));
  const [n, d] = k > 0 ? [b.n, b.d] : [b.d, b.n];
  const bits = Math.max(bitLength(n), bitLength(d)) * Math.abs(k);
  if (bits > MAX_BITS + 64) return false;
  return n ** K === x.n && d ** K === x.d;
}

/** x·2^e, in two steps so neither factor overflows on its own. */
function scale2(x: number, e: number): number {
  if (e > 1000) return x * 2 ** 1000 * 2 ** (e - 1000);
  if (e < -1000) return x * 2 ** -1000 * 2 ** (e + 1000);
  return x * 2 ** e;
}

/** The double nearest n/d (a sticky bit keeps ties honest). */
function ratToNumber(n: bigint, d: bigint): number {
  if (n === 0n) return 0;
  const an = abs(n);
  const LIM = 1n << 53n;
  if (an < LIM && d < LIM) return Number(n) / Number(d);
  const k = 66 + bitLength(d) - bitLength(an);
  let q: bigint, rem: bigint;
  if (k >= 0) {
    const num = an << BigInt(k);
    q = num / d;
    rem = num % d;
  } else {
    const den = d << BigInt(-k);
    q = an / den;
    rem = an % den;
  }
  if (rem !== 0n) q |= 1n;
  const v = scale2(Number(q), -k);
  return n < 0n ? -v : v;
}

function ballToNumber(b: Ball): number {
  if (b.m === 0n) return 0;
  const am = abs(b.m);
  const bl = bitLength(am);
  let q = am, e = b.e;
  if (bl > 66) {
    const k = BigInt(bl - 66);
    q = am >> k;
    if ((q << k) !== am) q |= 1n;
    e += bl - 66;
  }
  const v = scale2(Number(q), e);
  return b.m < 0n ? -v : v;
}

export function toNumber(x: Num): number {
  if (x.k === 'q') return ratToNumber(x.n, x.d);
  return ballToNumber(toBall(x, 80));
}

/** A rounded decimal: the value is 0.d₁d₂… × 10^(exp+1), i.e. d₁.d₂… × 10^exp. digits is '0' for zero. */
interface Decimal { neg: boolean; digits: string; exp: number }

const TEN = 10n;
const pow10 = (k: number): bigint => TEN ** BigInt(k);

function digitCount(x: bigint): number {
  return x === 0n ? 1 : abs(x).toString().length;
}

/** floor(log10(n/d)) for n, d > 0. */
function log10Floor(n: bigint, d: bigint): number {
  let e = digitCount(n) - digitCount(d);
  // 10^e ≤ n/d < 10^(e+1)
  if (e >= 0 ? n < d * pow10(e) : n * pow10(-e) < d) e--;
  return e;
}

/** n/d (n, d > 0) rounded half away from zero to `sig` significant digits. */
function roundSig(n: bigint, d: bigint, sig: number): { digits: string; exp: number } {
  let e = log10Floor(n, d);
  const sh = sig - 1 - e;
  const N = sh >= 0 ? n * pow10(sh) : n;
  const D = sh >= 0 ? d : d * pow10(-sh);
  let q = (2n * N + D) / (2n * D);
  if (q === pow10(sig)) {
    q /= TEN;
    e++;
  }
  return { digits: q.toString(), exp: e };
}

/** n/d rounded half away from zero to a whole number. */
function roundInt(n: bigint, d: bigint): bigint {
  const q = (2n * abs(n) + d) / (2n * d);
  return n < 0n ? -q : q;
}

function ends(b: Ball): [bigint, bigint, bigint] {
  // [lo, hi] = [(m − r)·2^e, (m + r)·2^e]; returned as numerators over a shared denominator.
  if (b.e >= 0) {
    const s = 1n << BigInt(b.e);
    return [(b.m - b.r) * s, (b.m + b.r) * s, 1n];
  }
  return [b.m - b.r, b.m + b.r, 1n << BigInt(-b.e)];
}

const decimalPrecision = 128;
/** Ball endpoints are expanded into exact rationals only while their exponents stay within this many bits. */
const EXPAND_BITS = 4096;

/** Bit position just above the ball's largest magnitude. */
function topBit(b: Ball): number {
  return b.e + bitLength(abs(b.m) + b.r);
}

/**
 * A huge or tiny ball as y·10^k with y near 1, so its digits come from small rationals: e^(10^9) has a
 * billion-bit exponent that must never become a BigInt.
 */
function scaled(b: Ball): { b: Ball; k: number } {
  const top = topBit(b);
  if (Math.abs(b.e) <= EXPAND_BITS && Math.abs(top) <= EXPAND_BITS) return { b, k: 0 };
  const k = Math.floor((top - 1) * Math.LOG10E * Math.LN2);
  const p = bitLength(abs(b.m)) + 80;
  const q = p + bitLength(BigInt(Math.abs(k))) + 16;
  const tenToMinusK = R.exp(R.mul(R.ln(R.fromInt(10n, q), q), R.fromInt(BigInt(-k), q), q), q);
  return { b: R.mul(b, tenToMinusK, p), k };
}

/**
 * x to `sig` significant digits, or fewer when a ball can't prove that many. A ball that still contains 0
 * reads as 0. precise.ts only lets one through when it lies within 2^−1075 of zero, below the smallest double.
 */
export function toSig(x: Num, sig: number): Decimal {
  if (x.k === 'q') {
    if (x.n === 0n) return { neg: false, digits: '0', exp: 0 };
    return { neg: x.n < 0n, ...roundSig(abs(x.n), x.d, sig) };
  }
  const b0 = toBall(x, decimalPrecision);
  if (R.sign(b0) === null) return { neg: false, digits: '0', exp: 0 };
  const { b, k } = scaled(b0);
  const [lo, hi, d] = ends(b);
  if (lo <= 0n && hi >= 0n) return { neg: false, digits: '0', exp: 0 };
  const neg = hi < 0n;
  const [a, c] = neg ? [-hi, -lo] : [lo, hi];
  for (let s = sig; s >= 1; s--) {
    const A = roundSig(a, d, s), C = roundSig(c, d, s);
    if (A.digits === C.digits && A.exp === C.exp) return { neg, digits: A.digits, exp: A.exp + k };
  }
  const M = roundSig(b.e >= 0 ? abs(b.m) << BigInt(b.e) : abs(b.m), b.e >= 0 ? 1n : 1n << BigInt(-b.e), 1);
  return { neg, digits: M.digits, exp: M.exp + k };
}

/** x rounded half away from zero to `places` decimal places, as a scaled integer (value = q / 10^places). */
function toPlaces(x: Num, places: number): bigint {
  if (x.k === 'q') return roundInt(x.n * pow10(places), x.d);
  const b = toBall(x, decimalPrecision + Math.ceil(places * 3.33));
  if (topBit(b) < -EXPAND_BITS) return 0n;
  const [lo, hi, d] = ends(b);
  const L = roundInt(lo * pow10(places), d), H = roundInt(hi * pow10(places), d);
  return L === H ? L : roundInt(b.m * pow10(places) * (b.e >= 0 ? 1n << BigInt(b.e) : 1n), b.e >= 0 ? 1n : 1n << BigInt(-b.e));
}

function terminating(x: Rat): Decimal | null {
  const maxSig = 60;
  if (x.n === 0n) return { neg: false, digits: '0', exp: 0 };
  let d = x.d, twos = 0, fives = 0;
  while ((d & 1n) === 0n) { d >>= 1n; twos++; }
  while (d % 5n === 0n) { d /= 5n; fives++; }
  if (d !== 1n) return null;
  const k = Math.max(twos, fives);
  const N = abs(x.n) * pow10(k) / x.d;
  let s = N.toString();
  const len = s.length;
  s = s.replace(/0+$/, '');
  if (s.length > maxSig) return null;
  return { neg: x.n < 0n, digits: s, exp: len - 1 - k };
}

function decimalString(dec: Decimal): string {
  const digits = dec.digits.replace(/0+$/, '') || '0';
  if (digits === '0') return '0';
  const sign = dec.neg ? '-' : '';
  const e = dec.exp;
  if (e >= DIGITS.maxExp || e < DIGITS.minExp) return `${sign}${digits[0]}${digits.length > 1 ? '.' + digits.slice(1) : ''}E${e}`;
  if (e < 0) return `${sign}0.${'0'.repeat(-e - 1)}${digits}`;
  if (digits.length <= e + 1) return sign + digits + '0'.repeat(e + 1 - digits.length);
  return `${sign}${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`;
}

export function integerString(n: bigint): string {
  const s = abs(n).toString();
  const sign = n < 0n ? '-' : '';
  if (s.length <= 16) return sign + s;
  const sig = s.replace(/0+$/, '');
  if (sig.length <= 15) return `${sign}${sig[0]}${sig.length > 1 ? '.' + sig.slice(1) : ''}E${s.length - 1}`;
  return sign + s;
}

export function autoString(x: Num, sig = DIGITS.fullSig, full = false): string {
  // Fewer than the full 12 is the screen's request (DISPLAY_SIG in format.ts): a whole part longer than a phone row
  // shows as d.ddd × 10ⁿ there, while copying still gets every digit (9120 × 99^999 has 1998). `full` is the screen
  // asking for every digit anyway (the Huge answers setting).
  const screen = sig < DIGITS.fullSig && !full;
  if (x.k === 'q') {
    if (x.d === 1n) {
      const s = integerString(x.n);
      return screen && !s.includes('E') && s.replace('-', '').length > DIGITS.wholeOnScreen ? decimalString(toSig(x, sig)) : s;
    }
    const t = terminating(x);
    if (t && !(screen && t.exp >= DIGITS.wholeOnScreen)) {
      const decimals = t.digits.length - 1 - t.exp;
      if (t.digits.length <= 20 || decimals <= 6) return t.exp >= 15 ? positional(t) : decimalString(t);
    }
  }
  const first = toSig(x, 15);
  if (first.digits === '0') return '0';
  const whole = first.exp >= 0 && !(screen && first.exp >= DIGITS.wholeOnScreen) ? first.exp + 1 : 0;
  return decimalString(toSig(x, Math.min(15, Math.max(sig, whole))));
}

function positional(dec: Decimal): string {
  const k = dec.exp + 1;
  return `${dec.neg ? '-' : ''}${dec.digits.slice(0, k)}.${dec.digits.slice(k)}`;
}

export function placesString(x: Num, places: number): string {
  if (x.k === 'r' && topBit(x.b) > EXPAND_BITS) return autoString(x);
  const q = toPlaces(x, places);
  const s = abs(q).toString().padStart(places + 1, '0');
  const body = places === 0 ? s : `${s.slice(0, s.length - places)}.${s.slice(s.length - places)}`;
  return (q < 0n ? '-' : '') + body;
}

const HALF = rat(1n, 2n);

/** For a π-rational, its position in [0, 2) as j/den with j counted in steps of π/den, or null. */
function piSteps(x: PiRat, den: bigint): bigint | null {
  const r = ((x.n % (2n * x.d)) + 2n * x.d) % (2n * x.d);
  return (r * den) % x.d === 0n ? (r * den) / x.d : null;
}

function sqrtOf(n: bigint, p: number): Num {
  return root(rat(n), 2, p);
}

export function sin(x: Num, p: number): Num {
  if (isZeroNum(x)) return ZERO;
  if (x.k === 'pi') {
    const j = piSteps(x, 6n);
    if (j !== null) {
      const v = [0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1][Number(j)];
      const mag = Math.abs(v);
      const m = mag === 0 ? ZERO : mag === 1 ? HALF : mag === 3 ? ONE : div(sqrtOf(3n, p + 4), rat(2n), p);
      return v < 0 ? neg(m) : m;
    }
    const k = piSteps(x, 4n);
    if (k !== null) {
      // Odd quarters of π: ±√2/2.
      const m = div(sqrtOf(2n, p + 4), rat(2n), p);
      return k === 5n || k === 7n ? neg(m) : m;
    }
  }
  return real(R.sin(toBall(x, p + 8), p));
}

export function cos(x: Num, p: number): Num {
  if (x.k === 'pi') return sin(add(x, piRat(1n, 2n), p), p);
  if (isZeroNum(x)) return ONE;
  return real(R.cos(toBall(x, p + 8), p));
}

export function tan(x: Num, p: number): Num {
  if (x.k === 'pi') {
    const k = piSteps(x, 4n);
    if (k !== null) {
      const v = [0, 1, null, -1][Number(k % 4n)];
      if (v === null) throw new Undecided('tan undefined');
      return rat(BigInt(v));
    }
  }
  return div(sin(x, p + 4), cos(x, p + 4), p);
}

export function asin(x: Num, p: number): Num {
  if (x.k === 'q') {
    const s = x.n < 0n ? -1n : 1n;
    if (x.n === 0n) return ZERO;
    if (abs(x.n) === 1n && x.d === 2n) return piRat(s, 6n);
    if (abs(x.n) === 1n && x.d === 1n) return piRat(s, 2n);
  }
  // asin x = atan(x / √(1 − x²)) for |x| < 1.
  const q = p + 16;
  const b = toBall(x, q);
  const c = R.sqrt(R.sub(R.ONE, R.mul(b, b, q), q), q);
  return real(R.atan(R.div(b, c, q), p));
}

export function acos(x: Num, p: number): Num {
  if (x.k === 'q') {
    if (x.n === 1n && x.d === 1n) return ZERO;
    if (x.n === -1n && x.d === 1n) return piRat(1n);
    if (x.n === 0n) return piRat(1n, 2n);
    if (abs(x.n) === 1n && x.d === 2n) return piRat(x.n < 0n ? 2n : 1n, 3n);
  }
  return sub(piRat(1n, 2n), asin(x, p + 8), p);
}

export function atan(x: Num, p: number): Num {
  if (x.k === 'q') {
    if (x.n === 0n) return ZERO;
    if (abs(x.n) === 1n && x.d === 1n) return piRat(x.n, 4n);
  }
  return real(R.atan(toBall(x, p + 8), p));
}

/** Angle of (x, y) in (−π, π], like Math.atan2. */
export function atan2(y: Num, x: Num, p: number): Num {
  const sx = sign(x), sy = sign(y);
  if (sx === 0) {
    if (sy === 0) throw new Undecided('atan2(0, 0)');
    return piRat(BigInt(sy), 2n);
  }
  const t = atan(div(y, x, p + 8), p + 8);
  if (sx > 0) return t;
  return add(t, piRat(sy < 0 ? -1n : 1n), p);
}

export function sinh(x: Num, p: number): Num {
  if (isZeroNum(x)) return ZERO;
  const q = p + 16;
  const e = R.exp(toBall(x, q), q);
  return real(R.div(R.sub(e, R.div(R.ONE, e, q), q), R.fromInt(2n, q), p));
}

export function cosh(x: Num, p: number): Num {
  if (isZeroNum(x)) return ONE;
  const q = p + 16;
  const e = R.exp(toBall(x, q), q);
  return real(R.div(R.add(e, R.div(R.ONE, e, q), q), R.fromInt(2n, q), p));
}

export function tanh(x: Num, p: number): Num {
  if (isZeroNum(x)) return ZERO;
  const q = p + 16;
  // Large |x| would overflow e^(2x) for nothing; tanh is ±1 to far more than p bits there.
  const e2 = R.exp(R.mul(toBall(x, q), R.fromInt(2n, q), q), q);
  return real(R.div(R.sub(e2, R.ONE, q), R.add(e2, R.ONE, q), p));
}
