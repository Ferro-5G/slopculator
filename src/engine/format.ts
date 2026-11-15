import type { RecordV, Value } from './values';
import { roundTo } from './numeric';
import * as X from './exact';
import { superscript } from './lexer';
import type { Num } from './exact';
import type { Precise } from './precise';

export type { Precise };

export interface DisplayOpts {
  /** null = automatic (see plainNumber); otherwise fixed decimal places. */
  places: number | null;
  exact: boolean;
  percent: boolean;
  /** Every digit of a huge answer on screen, not d.ddd × 10ⁿ past 16 digits (the "Huge answers" setting). Off when unset. */
  fullDigits?: boolean;
}

const MINUS = '−';

/** Significant digits an automatic answer shows on screen. Copying and history keep FULL_SIG. */
const DISPLAY_SIG = 10;
const FULL_SIG = X.DIGITS.fullSig;

/** Plain ASCII number for pasting into answer boxes. sig caps an automatic answer's significant digits (never the whole part). */
export function plainNumber(x: number, places: number | null, sig = FULL_SIG, full = false): string {
  if (Number.isNaN(x)) return 'undefined';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (places !== null) {
    const r = roundTo(x, places);
    // toFixed switches to its own "1e+21" form from 1e21 on; match the E form used everywhere else.
    if (Math.abs(r) >= 1e21) {
      const [m, e] = r.toExponential().split('e');
      return `${m}E${Number(e)}`;
    }
    return r.toFixed(places).replace(/^-(0\.?0*)$/, '$1');
  }
  // A whole number a double holds exactly shows every digit: 2^40 is 1099511627776, not …780.
  if (Number.isSafeInteger(x)) return String(x);
  // Past that, a double's first 15 digits are still right. Decimals stop at sig (12 when copied, 10 on screen), which hides float noise (0.1 + 0.2 is 0.3) without rounding a long whole part.
  const whole = Math.abs(x) < 1 ? 0 : Math.floor(Math.log10(Math.abs(x))) + 1;
  const screen = sig < FULL_SIG && whole > X.DIGITS.wholeOnScreen && !full;
  const r = Number(x.toPrecision(screen ? sig : Number.isInteger(x) ? 15 : Math.min(15, Math.max(sig, whole))));
  if (r === 0) return '0';
  const abs = Math.abs(r);
  if (abs >= X.DIGITS.above || abs < X.DIGITS.below) {
    const [m, e] = r.toExponential().split('e');
    return `${m}E${Number(e)}`;
  }
  // Between 1e-6 and 1e15 JS never uses exponent form.
  return r.toString();
}

function plainNum(x: number, places: number | null, ex?: Num, sig = FULL_SIG, full = false): string {
  if (!ex) return plainNumber(x, places, sig, full);
  return places !== null ? X.placesString(ex, places) : X.autoString(ex, sig, full);
}

export function prettyNumber(x: number, places: number | null, ex?: Num, full = false): string {
  const p = plainNum(x, places, ex, DISPLAY_SIG, full);
  if (p === 'inf') return '∞';
  if (p === '-inf') return MINUS + '∞';
  const m = /^(-?[\d.]+)E(-?\d+)$/.exec(p);
  if (m) return `${m[1].replace('-', MINUS)} × 10${superscript(m[2])}`;
  return p.replace('-', MINUS);
}

export function toFraction(x: number, maxDen = 100000): [number, number] | null {
  if (!Number.isFinite(x)) return null;
  if (Number.isInteger(x)) return [x, 1];
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  if (ax > 1e9) return null;
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0;
  let b = ax;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    // A nonzero number is never 0/1, however close to zero it is. The match has to be within rounding of the
    // double, or a number that is only near a fraction (0.5 + 4e-13, a probability just over a half) is shown as it.
    if (h1 !== 0 && Math.abs(ax - h1 / k1) <= 1e-14 * Math.max(1, ax)) return [sign * h1, k1];
    const frac = b - a;
    if (frac < 1e-15) break;
    b = 1 / frac;
  }
  return null;
}

function fracString(n: number, d: number, big?: bigint): string {
  const an = big === undefined ? `${Math.abs(n)}` : `${big < 0n ? -big : big}`;
  const s = d === 1 ? an : `${an}/${d}`;
  return (n < 0 ? MINUS : '') + s;
}

const MAX_DEN = 10000;
const MAX_DEN_BIG = BigInt(MAX_DEN);

const SURDS = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23];

interface Form {
  n: number;
  d: number;
  surd?: number;
  pi?: boolean;
}

function formText(f: Form): string {
  const unit = f.surd !== undefined ? `√${f.surd}` : f.pi ? 'π' : '';
  if (!unit) return fracString(f.n, f.d);
  const an = Math.abs(f.n);
  return `${f.n < 0 ? MINUS : ''}${an === 1 ? '' : an}${unit}${f.d === 1 ? '' : `/${f.d}`}`;
}

function simpleForm(x: number): Form | null {
  if (!Number.isFinite(x) || Number.isInteger(x)) return null;
  const f = toFraction(x, MAX_DEN);
  if (f) return { n: f[0], d: f[1] };
  for (const k of SURDS) {
    const g = toFraction(x / Math.sqrt(k), 100);
    if (g && Math.abs(g[0]) <= 100) return { n: g[0], d: g[1], surd: k };
  }
  const pi = toFraction(x / Math.PI, 24);
  if (pi && Math.abs(pi[0]) <= 48) return { n: pi[0], d: pi[1], pi: true };
  return null;
}

export function exactForm(x: number): string | null {
  const f = simpleForm(x);
  return f && formText(f);
}

function times100(ex?: Num): Num | undefined {
  return ex && X.mul(ex, X.rat(100n), 128);
}

/** A whole number? Uses the exact value when there is one: 10^20 + 1/2 is not whole even though its double is. */
export function isWholeNum(x: number, ex?: Num): boolean {
  return ex ? X.isInt(ex) : Number.isInteger(x);
}

function confirms(form: Form, ex: X.Real): boolean {
  const p = 160;
  let v: Num = X.rat(BigInt(form.n), BigInt(form.d));
  if (form.surd !== undefined) v = X.mul(v, X.root(X.rat(BigInt(form.surd)), 2, p), p);
  if (form.pi) v = X.mul(v, X.piRat(1n), p);
  try {
    const d = X.toBall(X.sub(ex, v, p), p);
    const scale = X.toBall(ex, p);
    const am = scale.m < 0n ? -scale.m : scale.m;
    const dm = (d.m < 0n ? -d.m : d.m) + d.r;
    // |difference| ≤ 2^−80·|x|, compared at a shared exponent.
    const shift = d.e - scale.e + 80;
    if (Math.abs(shift) > 4096) return shift < 0;
    return shift >= 0 ? (dm << BigInt(shift)) <= am : dm <= am << BigInt(-shift);
  } catch {
    return false;
  }
}

export function fractionText(x: number, ex?: Num): string | null {
  if (ex && ex.k === 'q') return ex.d === 1n || ex.d > MAX_DEN_BIG ? null : `${ex.n}/${ex.d}`;
  if (ex && ex.k === 'pi') return null;
  const f = Number.isInteger(x) ? null : toFraction(x, MAX_DEN);
  if (!f) return null;
  return !ex || confirms({ n: f[0], d: f[1] }, ex) ? `${f[0]}/${f[1]}` : null;
}

export function exactText(x: number, ex?: Num): string | null {
  if (!ex) return exactForm(x);
  if (ex.k === 'q') return ex.d === 1n || ex.d > MAX_DEN_BIG ? null : fracString(Number(ex.n), Number(ex.d), ex.n);
  if (ex.k === 'pi') {
    if (ex.d > MAX_DEN_BIG || ex.n > 1000000n || ex.n < -1000000n) return null;
    return formText({ n: Number(ex.n), d: Number(ex.d), pi: true });
  }
  const c = simpleForm(x);
  return c && confirms(c, ex) ? formText(c) : null;
}

export function formatNumber(x: number, o: DisplayOpts, prob = false, ex?: Num): string {
  if (o.percent && prob && (ex || Number.isFinite(x))) {
    return prettyNumber(x * 100, o.places, times100(ex), o.fullDigits) + '%';
  }
  if (o.exact) {
    const e = exactText(x, ex);
    if (e) return e;
  }
  return prettyNumber(x, o.places, ex, o.fullDigits);
}

const isNum = (v: Precise): v is Num => 'k' in v;

function part(ex: Precise | undefined, i: number): Precise | undefined {
  if (!ex || isNum(ex)) return undefined;
  if (ex.t === 'list') return ex.items[i];
  if (ex.t === 'matrix') return undefined;
  return ex.c[i];
}
const numOf = (ex: Precise | undefined): Num | undefined => (ex && isNum(ex) ? ex : undefined);
const cell = (ex: Precise | undefined, i: number, j: number): Num | undefined => (ex && !isNum(ex) && ex.t === 'matrix' ? ex.m[i]?.[j] : undefined);

export function formatValue(v: Value, o: DisplayOpts, prob = false, ex?: Precise): string {
  if (typeof v === 'number') return formatNumber(v, o, prob, numOf(ex));
  switch (v.t) {
    case 'complex': {
      const re = v.re === 0 ? '' : formatNumber(v.re, o);
      const mag = Math.abs(v.im);
      const im = (mag === 1 ? '' : formatNumber(mag, o)) + 'i';
      if (!re) return (v.im < 0 ? MINUS : '') + im;
      return `${re} ${v.im < 0 ? MINUS : '+'} ${im}`;
    }
    case 'list': return `{${v.items.map((it, i) => formatValue(it, o, prob, part(ex, i))).join(', ')}}`;
    case 'point': return `(${v.c.map((c, i) => formatNumber(c, o, false, numOf(part(ex, i)))).join(', ')})`;
    case 'vector': return `⟨${v.c.map((c, i) => formatNumber(c, o, false, numOf(part(ex, i)))).join(', ')}⟩`;
    case 'matrix': return `[${v.m.map((r, i) => `[${r.map((c, j) => formatNumber(c, o, false, cell(ex, i, j))).join(', ')}]`).join(', ')}]`;
    case 'normal': return `Normal(μ = ${formatNumber(v.mu, o)}, σ = ${formatNumber(v.sigma, o)})`;
    case 'binom': return `Binomial(n = ${v.n}, p = ${formatNumber(v.p, o)})`;
    case 'polygon': return `polygon with ${v.pts.length} vertices`;
    case 'record': return v.title;
    case 'text': return `"${v.s}"`;
  }
}

function recordOpts(v: RecordV, o: DisplayOpts): DisplayOpts {
  return v.decimal ? { ...o, exact: false } : o;
}

export function plainValue(v: Value, o: DisplayOpts, prob = false, ex?: Precise): string {
  if (typeof v === 'number') {
    const e = numOf(ex);
    if (o.percent && prob) return plainNum(v * 100, o.places, times100(e)) + '%';
    if (o.exact) {
      const f = fractionText(v, e);
      if (f) return f;
    }
    return plainNum(v, o.places, e);
  }
  switch (v.t) {
    case 'complex': return `${plainNumber(v.re, o.places)}${v.im < 0 ? '-' : '+'}${plainNumber(Math.abs(v.im), o.places)}i`;
    case 'list': return `{${v.items.map((it, i) => plainValue(it, o, prob, part(ex, i))).join(', ')}}`;
    case 'point': return `(${v.c.map((c, i) => plainNum(c, o.places, numOf(part(ex, i)))).join(', ')})`;
    case 'vector': return `<${v.c.map((c, i) => plainNum(c, o.places, numOf(part(ex, i)))).join(', ')}>`;
    case 'matrix': return `[${v.m.map((r, i) => `[${r.map((c, j) => plainNum(c, o.places, cell(ex, i, j))).join(', ')}]`).join(', ')}]`;
    case 'record': return v.rows.map((r) => `${r.label}: ${v.alongside ? recordCell(v, r.value, o) : plainValue(r.value, recordOpts(v, o))}`).join('\n');
    case 'text': return v.s;
    default: return formatValue(v, o, prob);
  }
}

export function recordCell(v: RecordV, value: Value, o: DisplayOpts, prob = false): string {
  const opts = recordOpts(v, o);
  if (!v.alongside) return formatValue(value, opts, prob);
  if (typeof value !== 'number') return formatValue(value, { ...opts, exact: true }, prob);
  const exact = exactForm(value);
  return exact ? `${exact} ≈ ${formatValue(value, { ...opts, exact: false }, prob)}` : formatValue(value, { ...opts, exact: false }, prob);
}

export const DIGIT_GAP = ' ';

/**
 * A long number in groups of three for reading (Every digit's box): 1 152 921 504 606 846 976, with thin spaces, the
 * whole part grouped from the right and any fraction from the left. Display only; copying takes the raw digits.
 */
export function groupDigits(text: string): string {
  const m = /^([−-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return text;
  const whole = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, DIGIT_GAP);
  const frac = m[3] ? '.' + m[3].replace(/(\d{3})(?=\d)/g, `$1${DIGIT_GAP}`) : '';
  return m[1] + whole + frac;
}
