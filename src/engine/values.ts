import { chargeWork, divisionByZeroText, fail, failEdge, failLazy, failOverflow } from './errors';
import { hypotOf, isWhole, maxOf } from './numeric';

interface Complex { t: 'complex'; re: number; im: number }
interface ListV { t: 'list'; items: Value[] }
interface PointV { t: 'point'; c: number[] }
interface VectorV { t: 'vector'; c: number[] }
interface MatrixV { t: 'matrix'; m: number[][] }
export interface NormalDist { t: 'normal'; mu: number; sigma: number }
export interface BinomDist { t: 'binom'; n: number; p: number }
interface PolygonV { t: 'polygon'; pts: number[][] }
/** `key`: the name a dot reads the row by (A.h), when its label isn't one a line can type. */
export interface RecordRow { label: string; value: Value; key?: string }
/** A drawing to show beside a table, where the platform can draw one. Angle in radians. */
export interface UnitCircleFigure { kind: 'unit-circle'; cos: number; sin: number; angle: number }
/**
 * decimal: the rows are physical readings, so Exact mode doesn't turn them into fractions.
 * alongside: each number shows its exact form and its decimal together, whichever the Exact switch says.
 */
/** `kind`: what the record describes, for a front end that draws it: 'air' is a moist-air state (psych and the like). */
export interface RecordV { t: 'record'; title: string; rows: RecordRow[]; decimal?: boolean; alongside?: boolean; figure?: UnitCircleFigure; kind?: 'air' }
interface TextV { t: 'text'; s: string }

export type Value = number | Complex | ListV | PointV | VectorV | MatrixV | NormalDist | BinomDist | PolygonV | RecordV | TextV;

export const isDist = (v: Value): v is NormalDist | BinomDist => typeof v === 'object' && (v.t === 'normal' || v.t === 'binom');

export const list = (items: Value[]): ListV => ({ t: 'list', items });
export const point = (c: number[]): PointV => ({ t: 'point', c });
export const vector = (c: number[]): VectorV => ({ t: 'vector', c });
export const matrix = (m: number[][]): MatrixV => ({ t: 'matrix', m });
export const complex = (re: number, im: number): Value => (im === 0 ? re : { t: 'complex', re, im });
export const record = (title: string, rows: RecordRow[]): RecordV => ({ t: 'record', title, rows });
export const text = (s: string): TextV => ({ t: 'text', s });

/**
 * The row a dot reads off a record (A.h, stats(L).mean): by its key, then by its label as typed, then by its key in
 * any case (A.tdp). Undefined when the record has no such row.
 */
export function recordField(v: RecordV, name: string): Value | undefined {
  const row = v.rows.find((r) => r.key === name) ?? v.rows.find((r) => r.label === name)
    ?? v.rows.find((r) => r.key !== undefined && r.key.toLowerCase() === name.toLowerCase());
  return row?.value;
}

export function typeName(v: Value): string {
  if (typeof v === 'number') return 'number';
  switch (v.t) {
    case 'complex': return 'complex number';
    case 'list': return 'list';
    case 'point': return 'point';
    case 'vector': return 'vector';
    case 'matrix': return `${v.m.length}×${v.m[0]?.length ?? 0} matrix`;
    case 'normal': return 'normal distribution';
    case 'binom': return 'binomial distribution';
    case 'polygon': return 'polygon';
    case 'record': return 'result table';
    case 'text': return 'text string';
  }
}

export function pos(x: number, what: string): number {
  if (!(x > 0)) fail(`${what} must be positive, got ${x}`);
  return x;
}

export function prob(x: number, what = 'p'): number {
  if (!(x >= 0 && x <= 1)) fail(`${what} must be between 0 and 1, got ${x}`);
  return x;
}

export function whole(x: number, what: string): number {
  if (!isWhole(x)) fail(`${what} must be a whole number, got ${x}`);
  return x;
}

export function num(v: Value, what = 'value'): number {
  if (typeof v === 'number') return v;
  if (v.t === 'complex') fail(`${what} must be real, got a complex number`);
  return fail(`${what} must be a number, got a ${typeName(v)}`);
}

export function nums(v: Value, what = 'list'): number[] {
  if (typeof v === 'number') return [v];
  if (v.t === 'list') return v.items.map((x) => num(x, `each ${what} item`));
  if (v.t === 'vector') return v.c.slice();
  return fail(`${what} must be a list like {1, 2, 3}, got a ${typeName(v)}`);
}

function cx(v: Value): { re: number; im: number } | null {
  if (typeof v === 'number') return { re: v, im: 0 };
  if (v.t === 'complex') return v;
  return null;
}

function cPow(a: { re: number; im: number }, b: { re: number; im: number }): Value {
  if (a.re === 0 && a.im === 0) {
    if (b.re > 0) return 0;
    if (b.re === 0 && b.im === 0) return 1;
    // 0^z is |0|^Re z times a turn, so Re z ≤ 0 has no value: 0^(−1 + i) divides by 0.
    if (b.re < 0) fail(divisionByZeroText(' (0 to a negative power)'));
    fail('0 to an imaginary power is undefined');
  }
  // Integer powers by repeated multiplication stay exact for small cases like i².
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 64) {
    let n = Math.abs(b.re);
    let rr = 1, ri = 0, br = a.re, bi = a.im;
    while (n > 0) {
      if (n & 1) [rr, ri] = [rr * br - ri * bi, rr * bi + ri * br];
      [br, bi] = [br * br - bi * bi, 2 * br * bi];
      n >>= 1;
    }
    return b.re < 0 ? cDiv({ re: 1, im: 0 }, { re: rr, im: ri }) : complex(rr, ri);
  }
  const r = Math.hypot(a.re, a.im);
  const th = Math.atan2(a.im, a.re);
  const lnr = Math.log(r);
  const mag = Math.exp(b.re * lnr - b.im * th);
  const ang = b.im * lnr + b.re * th;
  return complex(clean(mag * Math.cos(ang), mag), clean(mag * Math.sin(ang), mag));
}

/** A part that is rounding noise next to the whole number's size mag: the 1.2e-16i of e^(iπ). e^(−40 + i) keeps both. */
function clean(x: number, mag: number): number {
  return Math.abs(x) < 1e-15 * mag ? 0 : x;
}

const CDIV_HI = 2 ** 1020; // well under MAX_VALUE / 2 so x + y·r can't overflow
const CDIV_LO = 2 ** -960; // above subnormals so b·r doesn't underflow away precision
const CDIV_UP = 2 ** 128;

/** a/b by Smith's method with power-of-2 prescaling so parts near 1e308 or 1e-308 can't overflow or lose digits. */
function cDiv(a: { re: number; im: number }, b: { re: number; im: number }): Value {
  if (b.re === 0 && b.im === 0) fail(divisionByZeroText());
  let ar = a.re, ai = a.im, br = b.re, bi = b.im, shift = 0;
  const sa = Math.max(Math.abs(ar), Math.abs(ai));
  const sb = Math.max(Math.abs(br), Math.abs(bi));
  if (sa > CDIV_HI) { ar *= 0.25; ai *= 0.25; shift += 2; }
  else if (sa > 0 && sa < CDIV_LO) { ar *= CDIV_UP; ai *= CDIV_UP; shift -= 128; }
  if (sb > CDIV_HI) { br *= 0.25; bi *= 0.25; shift -= 2; }
  else if (sb < CDIV_LO) { br *= CDIV_UP; bi *= CDIV_UP; shift += 128; }
  let qr: number, qi: number;
  if (Math.abs(br) >= Math.abs(bi)) {
    const r = bi / br, d = br + bi * r;
    qr = (ar + ai * r) / d;
    qi = (ai - ar * r) / d;
  } else {
    const r = br / bi, d = br * r + bi;
    qr = (ar * r + ai) / d;
    qi = (ai * r - ar) / d;
  }
  if (shift !== 0) {
    const s = Math.pow(2, shift);
    qr *= s;
    qi *= s;
  }
  return complex(qr, qi);
}

export function complexSqrt(x: number): Value {
  return x >= 0 ? Math.sqrt(x) : complex(0, Math.sqrt(-x));
}

function complexOp(op: string, a: { re: number; im: number }, b: { re: number; im: number }): Value {
  switch (op) {
    case '+': return complex(a.re + b.re, a.im + b.im);
    case '-': return complex(a.re - b.re, a.im - b.im);
    case '*': return complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
    case '/': return cDiv(a, b);
    case '^': return cPow(a, b);
  }
  return fail(`Can't use ${op} with complex numbers`);
}

/** A pivot this far under the largest entry reads as zero (matInverse, rref). */
export const PIVOT_TOL = 1e-12;

export function matMulTidy(a: number[][], b: number[][]): number[][] {
  return matMul(a, b).map((row, i) => row.map((x, j) => {
    chargeWork(b.length);
    let size = 0;
    for (let t = 0; t < b.length; t++) size += Math.abs(a[i][t] * b[t][j]);
    return tidy(x, size);
  }));
}

export function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length, m = b[0].length, k = b.length;
  if (a[0].length !== k) fail(`Can't multiply ${n}×${a[0].length} by ${k}×${m}: inner sizes must match`);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    chargeWork(m * k);
    const row = new Array<number>(m).fill(0);
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += a[i][t] * b[t][j];
      row[j] = s;
    }
    out.push(row);
  }
  return out;
}

export function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

/** Gauss–Jordan with partial pivoting. Returns null when singular. */
export function matInverse(a: number[][]): number[][] | null {
  const n = a.length;
  if (a.some((r) => r.length !== n)) fail(`Only square matrices have inverses (this one is ${n}×${a[0].length})`);
  const id = identity(n);
  const m = a.map((r, i) => [...r, ...id[i]]);
  // What each entry's size would be with no cancellation, for telling noise from a tiny true entry.
  const size = m.map((r) => r.map(Math.abs));
  for (let c = 0; c < n; c++) {
    // Pick the largest candidate that isn't cancellation noise next to what made it, rather than taking the largest
    // raw entry and giving up if that row cancelled: [[1, 1e16, 0], [1, 1e16 + 2, 1], [0, 1, 0]] has pivot 1 in row 3.
    let p = -1;
    for (let r = c; r < n; r++) {
      const v = Math.abs(m[r][c]);
      if (v > 0 && v >= PIVOT_TOL * size[r][c] && (p < 0 || v > Math.abs(m[p][c]))) p = r;
    }
    if (p < 0) return null;
    [m[c], m[p]] = [m[p], m[c]];
    [size[c], size[p]] = [size[p], size[c]];
    chargeWork(2 * n * n);
    const pv = m[c][c];
    for (let j = 0; j < 2 * n; j++) { m[c][j] /= pv; size[c][j] /= Math.abs(pv); }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) { m[r][j] -= f * m[c][j]; size[r][j] += Math.abs(f) * size[c][j]; }
    }
  }
  return m.map((r, i) => r.slice(n).map((x, j) => tidy(x, size[i][n + j])));
}

export function determinant(a: number[][]): number {
  const n = a.length;
  if (a.some((r) => r.length !== n)) fail(`Only square matrices have determinants (this one is ${n}×${a[0].length})`);
  if (n === 1) return a[0][0];
  if (n === 2) return a[0][0] * a[1][1] - a[0][1] * a[1][0];
  if (n === 3)
    return (
      a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
      a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
      a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
    );
  const m = a.map((r) => r.slice());
  let det = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (m[p][c] === 0) return 0;
    if (p !== c) {
      [m[c], m[p]] = [m[p], m[c]];
      det = -det;
    }
    det *= m[c][c];
    chargeWork((n - c) * (n - c));
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let j = c; j < n; j++) m[r][j] -= f * m[c][j];
    }
  }
  // The largest a determinant of these rows can be (Hadamard), so a matrix of tiny entries keeps its tiny determinant.
  let scale = 1;
  for (const r of a) scale *= hypotOf(r);
  return tidy(det, scale);
}

/**
 * Snap float noise like 0.30000000000000004 → 0.3 when a short decimal sits within a few ulps.
 * scale is the size of the inputs that were added or cancelled to make x. Under 1e-14 of it, and under 1e-14 outright, x is
 * cancellation noise and becomes 0. The outright limit keeps a correct 1 from range(1e15, 1e15 + 1). No scale, no snapping.
 */
export function tidy(x: number, scale = 0): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const ax = Math.abs(x);
  if (ax < 1e-14 * Math.min(1, scale)) return 0;
  // A whole number under 13 digits is already its shortest form: any shorter rounding is at least 1 away.
  if (ax < 1e13 && Number.isInteger(x)) return x;
  const tol = ax * Number.EPSILON * 4;
  // 13 digits is the closest of the candidates, so if it misses, they all do. Most results are like this.
  const r13 = Number(x.toPrecision(13));
  if (!(Math.abs(r13 - x) <= tol)) return x;
  for (let p = 1; p < 13; p++) {
    const r = Number(x.toPrecision(p));
    if (Math.abs(r - x) <= tol) return r;
  }
  return r13;
}

export function weightedTotal(xs: readonly number[], ps: readonly number[]): number {
  let s = 0, size = 0;
  for (let k = 0; k < xs.length; k++) { s += xs[k] * ps[k]; size += Math.abs(xs[k] * ps[k]); }
  return tidy(s, size);
}

function sameDims(a: number[][], b: number[][], op: string): void {
  if (a.length !== b.length || a[0].length !== b[0].length)
    fail(`Can't ${op} a ${a.length}×${a[0].length} and a ${b.length}×${b[0].length} matrix: sizes must match`);
}

function vecOp(op: string, a: number[], b: number[], kind: string): number[] {
  if (a.length !== b.length) fail(`Can't ${op === '+' ? 'add' : 'subtract'} ${kind}s of different sizes (${a.length} and ${b.length})`);
  return a.map((x, i) => (op === '+' ? x + b[i] : x - b[i]));
}

export function arith(op: '+' | '-' | '*' | '/' | '^', a: Value, b: Value): Value {
  if (typeof a === 'number' && typeof b === 'number') {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) failEdge(divisionByZeroText());
        return a / b;
      case '^': {
        if (a === 0 && b < 0) fail(divisionByZeroText(' (0 to a negative power)'));
        const r = Math.pow(a, b);
        if (Number.isNaN(r) && a < 0) failLazy(() => `${a}^${b} is not a real number`);
        return r;
      }
    }
  }
  if (typeof a === 'object' && a.t === 'list') {
    if (typeof b === 'object' && b.t === 'list') {
      if (a.items.length !== b.items.length) fail(`Lists have different lengths (${a.items.length} and ${b.items.length})`);
      return list(a.items.map((x, i) => arith(op, x, b.items[i])));
    }
    if (typeof b === 'object' && b.t === 'matrix') fail(`Can't combine a list and a matrix with ${op}`);
    return list(a.items.map((x) => arith(op, x, b)));
  }
  if (typeof b === 'object' && b.t === 'list') {
    if (typeof a === 'object' && a.t === 'matrix' && op === '*') {
      return list(b.items.map((x) => arith('*', a, x)));
    }
    return list(b.items.map((x) => arith(op, a, x)));
  }
  const ca = cx(a), cb = cx(b);
  if (ca && cb) return complexOp(op, ca, cb);

  const A = a as Exclude<Value, number>;
  const B = b as Exclude<Value, number>;
  if (typeof a === 'number' || typeof b === 'number') {
    const s = (typeof a === 'number' ? a : b) as number;
    const o = (typeof a === 'number' ? B : A);
    const scalarFirst = typeof a === 'number';
    const f = (x: number) => {
      switch (op) {
        case '*': return x * s;
        case '/':
          if (scalarFirst) fail(`Can't divide a number by a ${typeName(o)}`);
          if (s === 0) failEdge(divisionByZeroText());
          return x / s;
        default: return fail(`Can't use ${op} between a number and a ${typeName(o)}`);
      }
    };
    // A [ ] of numbers is a list as well as a vector: [1, 2, 3] + 1 and [1, 2, 3]^2 work on each number, as Desmos has it.
    if (o.t === 'vector' && op !== '*' && op !== '/') {
      return vector(o.c.map((x) => num(arith(op, scalarFirst ? s : x, scalarFirst ? x : s), 'Each number')));
    }
    if (o.t === 'matrix') {
      if (op === '^' && !scalarFirst) return matPow(o.m, s);
      return matrix(o.m.map((r) => r.map(f)));
    }
    if (o.t === 'vector') return vector(o.c.map(f));
    if (o.t === 'point') return point(o.c.map(f));
    if (o.t === 'polygon') return { t: 'polygon', pts: o.pts.map((p) => p.map(f)) };
    return fail(`Can't use ${op} between a number and a ${typeName(o)}`);
  }
  if (A.t === 'matrix' && B.t === 'matrix') {
    if (op === '+' || op === '-') {
      sameDims(A.m, B.m, op === '+' ? 'add' : 'subtract');
      return matrix(A.m.map((r, i) => r.map((x, j) => (op === '+' ? x + B.m[i][j] : x - B.m[i][j]))));
    }
    if (op === '*') return matrix(matMulTidy(A.m, B.m));
    if (op === '/') fail('Matrices don\'t divide. Use A*inv(B) or inv(A)*B');
  }
  if (A.t === 'matrix' && (B.t === 'vector' || B.t === 'point') && op === '*') {
    const col = matMulTidy(A.m, B.c.map((x) => [x])).map((r) => r[0]);
    return B.t === 'vector' ? vector(col) : point(col);
  }
  if (A.t === 'matrix' && B.t === 'polygon' && op === '*') {
    return { t: 'polygon', pts: B.pts.map((p) => matMulTidy(A.m, p.map((x) => [x])).map((r) => r[0])) };
  }
  if ((A.t === 'vector' || A.t === 'point') && (B.t === 'vector' || B.t === 'point')) {
    if (op === '+' || op === '-') {
      const kind = A.t === 'point' || B.t === 'point' ? 'point' : 'vector';
      const c = vecOp(op, A.c, B.c, kind);
      if (A.t === 'point' && B.t === 'point' && op === '-') return vector(c);
      return kind === 'point' ? point(c) : vector(c);
    }
    if (op === '*') fail('Vectors don\'t multiply directly. Use dot(u, v) or cross(u, v)');
  }
  if (A.t === 'polygon' && (B.t === 'point' || B.t === 'vector') && (op === '+' || op === '-')) {
    return { t: 'polygon', pts: A.pts.map((p) => vecOp(op, p, B.c, 'point')) };
  }
  return fail(`Can't use ${op} between a ${typeName(a)} and a ${typeName(b)}`);
}

function matPow(m: number[][], p: number): Value {
  if (m.length !== m[0].length) fail('Only square matrices have powers');
  if (!Number.isInteger(p)) fail('Matrix powers must be whole numbers (use -1 for the inverse)');
  let base = m;
  if (p < 0) {
    const inv = matInverse(m);
    if (!inv) fail('Matrix is singular (determinant 0), so it has no inverse');
    base = inv;
    p = -p;
  }
  // The product of p copies of the largest row sum bounds every entry of the power.
  const scale = maxOf(base.map((r) => r.reduce((s, x) => s + Math.abs(x), 0))) ** p;
  let res = identity(m.length);
  // Arithmetic, not & and >>=: those work on 32 bits, so A^(2^32) came out as the identity.
  while (p > 0) {
    if (p % 2 === 1) res = matMul(res, base);
    base = matMul(base, base);
    p = Math.floor(p / 2);
  }
  // Past a double's range, ∞ · 0 turns whole rows into NaN; say so, as other overflows do.
  if (res.some((r) => r.some((x) => !Number.isFinite(x)))) failOverflow('That matrix power is too large for a 64-bit float');
  return matrix(res.map((r) => r.map((x) => tidy(x, scale))));
}

export function negate(v: Value): Value {
  if (typeof v === 'number') return -v;
  return arith('*', -1, v);
}

export function mapNum(v: Value, f: (x: number) => number, what: string): Value {
  if (typeof v === 'number') return f(v);
  if (v.t === 'list') return list(v.items.map((x) => mapNum(x, f, what)));
  if (v.t === 'vector') return vector(v.c.map(f));
  if (v.t === 'complex') return fail(`${what} needs a real number, got a complex number`);
  return fail(`${what} needs a number, got a ${typeName(v)}`);
}
