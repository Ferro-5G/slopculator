// Exact evaluation of a displayed result. It walks the same syntax tree as compile() and resolves names the same
// way, but computes with exact.ts: rationals while it can, π-rationals for angles, and proven balls past that.
// It only runs after the float path succeeded, and gives up (null) on anything it doesn't cover, so the float
// answer stays. Graphs never come here.
import type { Node } from './parser';
import { type Env, percentOperand, settingsKey } from './evaluator';
import { BUILTINS } from './builtins';
import { MAX_CALL_DEPTH, bracketKind, callsValue, isConstantE, oddRootOf, resolveCall, resolveId, rewritePower } from './resolve';
import type { Builtin } from './builtin-types';
import type { Value } from './values';
import * as X from './exact';
import { Undecided, type Num } from './exact';
import * as R from './real';
import { Lru } from './memo';
import { ExactlyUndefined, orDouble } from './errors';
import type { Fingerprints } from './fingerprint';

interface PList { t: 'list'; items: Precise[] }
interface PCoords { t: 'point' | 'vector'; c: Num[] }
interface PMatrix { t: 'matrix'; m: Num[][] }
/** An exact counterpart of a Value: a number, or a list, point, vector, or matrix of them. Holds bigints, so not JSON. */
export type Precise = Num | PList | PCoords | PMatrix;

const isNum = (v: Precise): v is Num => 'k' in v;

const give = (why: string): never => {
  throw new Undecided(why);
};

/** Working precisions in bits. A result whose balls are too wide at one is recomputed at the next. */
const PRECISIONS = [128, 320, 800, 2000];
const MAX_STEPS = 200000;
const MAX_LOOP = 20000;
const BUDGET_MS = 40;
let deadline = Infinity;
let ticks = 0;

function tick(): void {
  if ((++ticks & 255) === 0 && Date.now() > deadline) give('out of time');
}

interface Local { name: string; v: Precise }

type Impl = (args: Node[], locals: Local[], c: Ctx) => Precise;

class Ctx {
  steps = 0;
  depth = 0;
  constructor(public st: PreciseState, public p: number, public row: number) {}
  get env(): Env {
    return this.st.env;
  }
}

export class PreciseState {
  private vars = new Map<string, Precise | null>();
  private active = new Set<string>();
  private finals = new Map<string, Precise | null>();

  constructor(public env: Env, private prints: Fingerprints) {}

  varFinal(name: string): Precise | null {
    if (!this.finals.has(name)) {
      const def = this.env.varDef(name);
      this.finals.set(name, def?.node ? this.evaluate(def.node, def.row) : null);
    }
    return this.finals.get(name) ?? null;
  }

  varAt(name: string, c: Ctx): Precise {
    const key = `${c.p}|${name}`;
    if (this.vars.has(key)) return this.vars.get(key) ?? give('variable has no exact value');
    const def = this.env.varDef(name);
    if (!def?.node) return give('variable without an expression');
    if (this.active.has(key)) return give('cycle');
    this.active.add(key);
    let v: Precise | null;
    try {
      v = orDouble(() => evalNode(def.node!, [], new Ctx(this, c.p, def.row))) ?? null;
    } finally {
      this.active.delete(key);
    }
    this.vars.set(key, v);
    return v ?? give('variable has no exact value');
  }

  evaluate(node: Node, row: number): Precise | null {
    if (!covered(node, this.env, [], new Set())) return null;
    const print = this.prints.of(node, row);
    if (print.reachesAns) return this.compute(node, row);
    const key = `${settingsKey(this.env.settings)}|${print.key}`;
    const hit = memo.get(key);
    if (hit instanceof ExactlyUndefined) throw hit;
    if (hit !== undefined) return hit;
    try {
      const v = this.compute(node, row);
      memo.set(key, v);
      return v;
    } catch (e) {
      if (e instanceof ExactlyUndefined) memo.set(key, e);
      throw e;
    }
  }

  private compute(node: Node, row: number): Precise | null {
    const outer = deadline;
    if (outer === Infinity) deadline = Date.now() + BUDGET_MS;
    try {
      return this.refine(node, row);
    } finally {
      deadline = outer;
    }
  }

  private refine(node: Node, row: number): Precise | null {
    let last: Precise | null = null;
    for (const p of PRECISIONS) {
      const v = orDouble(() => evalNode(node, [], new Ctx(this, p, row)));
      if (v === undefined) break;
      last = v;
      if (tight(last)) break;
    }
    return last && settled(last) ? last : null;
  }
}

/** A line's exact value, null where exact math gave up, or its proof that the line has no value. */
const memo = new Lru<string, Precise | null | ExactlyUndefined>(500);

/** Every ball narrow enough for 17+ proven digits. Zero-straddling balls keep refining until the last precision. */
function tight(v: Precise): boolean {
  return every(v, (b) => {
    const am = b.m < 0n ? -b.m : b.m;
    return am > b.r && b.r << 80n <= am;
  });
}

/** Largest magnitude a result may have: 2^(2^30), about 10^(3.2×10^8). Past it the double (inf or 0) stays. */
const MAX_TOP = 2 ** 30;
/** A ball that contains 0 and lies within this of it reads as 0, which is also its nearest double. */
const ZERO_TOP = -1075;

/**
 * Safe to show: every ball is tight, or contains 0 and sits within 2^−1075 of it, below the smallest double.
 * A wide ball straddling 0, like e^10000 + 1 − e^10000 at 2000 bits, is not.
 */
function settled(v: Precise): boolean {
  return every(v, (b) => {
    const am = b.m < 0n ? -b.m : b.m;
    const top = b.e + R.bitLength(am + b.r);
    if (Math.abs(top) > MAX_TOP) return false;
    if (am > b.r && b.r << 80n <= am) return true;
    return am <= b.r && top < ZERO_TOP;
  });
}

function every(v: Precise, f: (b: R.Ball) => boolean): boolean {
  if (isNum(v)) return v.k !== 'r' || f(v.b);
  if (v.t === 'list') return v.items.every((x) => every(x, f));
  if (v.t === 'matrix') return v.m.every((r) => r.every((x) => every(x, f)));
  return v.c.every((x) => every(x, f));
}

export function sameShape(p: Precise, v: Value): boolean {
  if (isNum(p)) return typeof v === 'number';
  if (typeof v === 'number') return false;
  if (p.t === 'list') return v.t === 'list' && v.items.length === p.items.length && p.items.every((x, i) => sameShape(x, v.items[i]));
  if (p.t === 'matrix') return v.t === 'matrix' && v.m.length === p.m.length && v.m.every((r, i) => r.length === p.m[i].length);
  return v.t === p.t && v.c.length === p.c.length;
}

export function toValue(p: Precise): Value {
  if (isNum(p)) return X.toNumber(p);
  if (p.t === 'list') return { t: 'list', items: p.items.map(toValue) };
  if (p.t === 'matrix') return { t: 'matrix', m: p.m.map((r) => r.map(X.toNumber)) };
  return { t: p.t, c: p.c.map(X.toNumber) };
}

function covered(n: Node, env: Env, locals: string[], seen: Set<string>): boolean {
  switch (n.k) {
    case 'num': case 'id': return true;
    case 'str': case 'piece': case 'rel': return false;
    case 'un': case 'post': case 'abs': return covered(n.a, env, locals, seen);
    case 'bin': return covered(n.a, env, locals, seen) && covered(n.b, env, locals, seen);
    case 'point': case 'vec': case 'bracket': case 'list': return n.items.every((i) => covered(i, env, locals, seen));
    case 'call': {
      const { name } = n;
      if (callsValue(name, env, locals)) return n.args.every((a) => covered(a, env, locals, seen));
      const f = env.funcDef(name);
      if (f) {
        if (!n.args.every((a) => covered(a, env, locals, seen))) return false;
        if (seen.has(name)) return true;
        seen.add(name);
        return covered(f.body, env, f.params, seen);
      }
      const b = BUILTINS[name];
      if (!b) return n.args.every((a) => covered(a, env, locals, seen));
      if (!impl(b)) return false;
      if (n.base && !covered(n.base, env, locals, seen)) return false;
      const inner = b.binds && n.args[1]?.k === 'id' ? [...locals, n.args[1].name] : locals;
      return n.args.every((a, i) => covered(a, env, i === 0 ? inner : locals, seen));
    }
  }
}

const literals = new Lru<string, Num>(2000);

function literal(n: Extract<Node, { k: 'num' }>): Num {
  const key = n.s ?? String(n.v);
  let v = literals.get(key);
  if (!v) {
    v = n.s !== undefined ? X.fromDecimal(n.s) : X.fromDouble(n.v);
    literals.set(key, v);
  }
  return v;
}

function evalNode(n: Node, locals: Local[], c: Ctx): Precise {
  if (++c.steps > MAX_STEPS) give('too much work');
  tick();
  switch (n.k) {
    case 'num': return literal(n);
    case 'id': return evalId(n.name, locals, c);
    case 'un': return negate(evalNode(n.a, locals, c));
    case 'bin': {
      if (n.op === '^') {
        const names = localNames(locals);
        const re = rewritePower(n.a, n.b, c.env, names);
        if (re) return evalNode(re, locals, c);
        if (isConstantE(n.a, c.env, names)) return mapNum(evalNode(n.b, locals, c), (y) => X.exp(y, c.p));
        return power(evalNode(n.a, locals, c), evalNode(n.b, locals, c), c);
      }
      const pct = n.op === '+' || n.op === '-' ? percentOperand(n.b, c.env.settings) : null;
      if (pct) {
        // a ± (a·b)/100, as the float evaluator does: 80 + 15% is exactly 92.
        const a = evalNode(n.a, locals, c), b = evalNode(pct, locals, c);
        return arith(n.op, a, arith('/', arith('*', a, b, c), X.rat(100n), c), c);
      }
      const a = evalNode(n.a, locals, c), b = evalNode(n.b, locals, c);
      if (n.op === 'nCr') return nCr(num(a), num(b));
      if (n.op === 'nPr') return nPr(num(a), num(b));
      return arith(n.op, a, b, c);
    }
    case 'post': {
      const a = evalNode(n.a, locals, c);
      if (n.op === '!') return mapNum(a, factorial);
      if (n.op === '%') return mapNum(a, (x) => X.div(x, X.rat(100n), c.p));
      return c.env.settings.deg ? a : mapNum(a, (x) => X.mul(x, X.piRat(1n, 180n), c.p));
    }
    case 'call': return evalCall(n, locals, c);
    case 'abs': return absValue(evalNode(n.a, locals, c), c);
    case 'point': return { t: 'point', c: n.items.map((i) => num(evalNode(i, locals, c))) };
    case 'vec': return { t: 'vector', c: n.items.map((i) => num(evalNode(i, locals, c))) };
    case 'list': return { t: 'list', items: n.items.map((i) => evalNode(i, locals, c)) };
    case 'bracket': {
      const items = n.items.map((i) => evalNode(i, locals, c));
      switch (bracketKind(items.map((v) => (isNum(v) ? 'number' : v.t)))) {
        case 'empty': return give('empty');
        case 'vector': return { t: 'vector', c: items as Num[] };
        case 'matrix': {
          const rows = (items as PCoords[]).map((v) => v.c);
          if (rows.some((r) => r.length !== rows[0].length)) give('ragged');
          return { t: 'matrix', m: rows };
        }
        case 'points': return { t: 'list', items };
        case 'mixed': return give('bracket contents');
      }
    }
    case 'str': case 'piece': case 'rel': return give('not covered');
  }
}

function constant(name: string, c: Ctx): Precise {
  if (name === 'π') return X.piRat(1n);
  if (name === 'τ') return X.piRat(2n);
  if (name === 'e') return X.real(R.exp(R.ONE, c.p));
  return give('constant');
}

function evalId(name: string, locals: Local[], c: Ctx): Precise {
  const use = resolveId(name, c.env, localNames(locals));
  switch (use.k) {
    case 'local': return locals[use.index].v;
    case 'var': return c.st.varAt(name, c);
    case 'ans': return ans(c);
    case 'i': return give('complex');
    case 'constant': return constant(name, c);
    case 'zeroInput': return give('zero-input built-in');
    case 'function': return give('function without a call');
    case 'builtin': case 'unknown': return give('unknown name');
    case 'letters': {
      let acc = evalId(use.parts[0], locals, c);
      for (let k = 1; k < use.parts.length; k++) acc = arith('*', acc, evalId(use.parts[k], locals, c), c);
      return acc;
    }
  }
}

const localNames = (locals: Local[]): string[] => locals.map((l) => l.name);

function ans(c: Ctx): Precise {
  const src = c.env.answerBefore(c.row);
  return src ? evalNode(src.node, [], new Ctx(c.st, c.p, src.row)) : give('no earlier answer');
}

function evalCall(n: Extract<Node, { k: 'call' }>, locals: Local[], c: Ctx): Precise {
  const { name } = n;
  const use = resolveCall(name, n.args.length, c.env, localNames(locals));
  if (use.k === 'value' || use.k === 'letters') {
    if (n.args.length !== 1) give('value called with several inputs');
    return arith('*', evalId(name, locals, c), evalNode(n.args[0], locals, c), c);
  }
  if (use.k === 'unknown') return give('unknown function');
  if (use.k === 'user') {
    const f = use.def;
    if (n.args.length !== f.params.length) give('input count');
    const args = n.args.map((a) => evalNode(a, locals, c));
    if (++c.depth > MAX_CALL_DEPTH) give('too deep');
    try {
      return evalNode(f.body, f.params.map((p, i) => ({ name: p, v: args[i] })), c);
    } finally {
      c.depth--;
    }
  }
  const { b } = use;
  if (n.base) {
    if (n.args.length !== 1) give('log_b takes one input');
    const base = num(evalNode(n.base, locals, c));
    return mapNum(evalNode(n.args[0], locals, c), (x) => logBase(base, x, c));
  }
  if (n.args.length < b.min || n.args.length > b.max) give('input count');
  const f2 = impl(b);
  if (!f2) return give('built-in not covered');
  return f2(n.args, locals, c);
}

// ---------- value arithmetic (mirrors values.arith) ----------

function num(v: Precise): Num {
  return isNum(v) ? v : give('not a number');
}

function negate(v: Precise): Precise {
  return isNum(v) ? X.neg(v) : arith('*', X.rat(-1n), v, null);
}

function mapNum(v: Precise, f: (x: Num) => Num): Precise {
  if (isNum(v)) return f(v);
  if (v.t === 'list') return { t: 'list', items: v.items.map((x) => mapNum(x, f)) };
  return give('needs a number');
}

function numOp(op: string, a: Num, b: Num, p: number): Num {
  switch (op) {
    case '+': return X.add(a, b, p);
    case '-': return X.sub(a, b, p);
    case '*': return X.mul(a, b, p);
    case '/': return X.div(a, b, p);
    case '^': return powNum(a, b, p);
  }
  return give('operator');
}

function arith(op: string, a: Precise, b: Precise, c: Ctx | null): Precise {
  const p = c?.p ?? 128;
  // A division by a number that is exactly 0 has no value, whatever doubles made of the divisor. A list, vector or
  // matrix over it is the same division, entry by entry.
  if (op === '/' && isNum(b) && X.isZeroNum(b)) throw new ExactlyUndefined('Division by zero');
  if (isNum(a) && isNum(b)) return numOp(op, a, b, p);
  if (!isNum(a) && a.t === 'list') {
    if (!isNum(b) && b.t === 'list') {
      if (a.items.length !== b.items.length) give('lengths');
      return { t: 'list', items: a.items.map((x, i) => arith(op, x, b.items[i], c)) };
    }
    if (!isNum(b) && b.t === 'matrix') give('list and matrix');
    return { t: 'list', items: a.items.map((x) => arith(op, x, b, c)) };
  }
  if (!isNum(b) && b.t === 'list') return { t: 'list', items: b.items.map((x) => arith(op, a, x, c)) };
  if (isNum(a) || isNum(b)) {
    const s = (isNum(a) ? a : b) as Num;
    const o = (isNum(a) ? b : a) as PCoords | PMatrix;
    const scalarFirst = isNum(a);
    const f = (x: Num): Num => {
      if (op === '*') return X.mul(x, s, p);
      if (op === '/' && !scalarFirst) return X.div(x, s, p);
      return give('scalar operator');
    };
    if (o.t === 'matrix') {
      if (op === '^' && !scalarFirst) return matPow(o.m, s, p);
      return { t: 'matrix', m: o.m.map((r) => r.map(f)) };
    }
    return { t: o.t, c: o.c.map(f) };
  }
  if (a.t === 'matrix' && b.t === 'matrix') {
    if (op === '+' || op === '-') {
      if (a.m.length !== b.m.length || a.m[0].length !== b.m[0].length) give('sizes');
      return { t: 'matrix', m: a.m.map((r, i) => r.map((x, j) => numOp(op, x, b.m[i][j], p))) };
    }
    if (op === '*') return { t: 'matrix', m: matMul(a.m, b.m, p) };
    return give('matrix operator');
  }
  if (a.t === 'matrix' && b.t !== 'matrix' && op === '*') {
    return { t: b.t, c: matMul(a.m, b.c.map((x) => [x]), p).map((r) => r[0]) };
  }
  if (a.t !== 'matrix' && b.t !== 'matrix' && (op === '+' || op === '-')) {
    if (a.c.length !== b.c.length) give('sizes');
    const cc = a.c.map((x, i) => numOp(op, x, b.c[i], p));
    if (a.t === 'point' && b.t === 'point' && op === '-') return { t: 'vector', c: cc };
    return { t: a.t === 'point' || b.t === 'point' ? 'point' : 'vector', c: cc };
  }
  return give('operator for these values');
}

/**
 * x^y. In an expression, a negative base with a fractional power follows the float path's rule: when 1/y is an odd
 * whole number (within 1e-9) the result is the real root, so (−8)^(1/3) = −2.
 */
function power(a: Precise, b: Precise, c: Ctx): Precise {
  if (isNum(a) && isNum(b)) {
    if (!X.isInt(b) && X.sign(a) < 0) {
      const yf = X.toNumber(b);
      if (Number.isInteger(yf)) give('ambiguous whole power');
      if (oddRootOf(yf) !== null) return X.neg(powNum(X.neg(a), b, c.p));
      return give('complex power');
    }
    return powNum(a, b, c.p);
  }
  return arith('^', a, b, c);
}

function powNum(a: Num, b: Num, p: number): Num {
  if (X.isInt(b)) {
    if (X.isZeroNum(a) && X.sign(b) < 0) give('0 to a negative power');
    return X.powInt(a, (b as X.Rat).n, p);
  }
  if (X.isZeroNum(a)) return X.sign(b) > 0 ? X.ZERO : give('0 to a non-positive power');
  if (X.sign(a) < 0) give('negative base');
  if (b.k === 'q' && b.d <= 64n) {
    const r = X.root(a, Number(b.d), p + 16);
    if (r.k === 'q') return X.powInt(r, b.n, p);
  }
  const q = p + 32;
  return X.real(R.exp(R.mul(X.toBall(b, q), R.ln(X.toBall(a, q), q), q), p));
}

function matMul(a: Num[][], b: Num[][], p: number): Num[][] {
  const k = b.length;
  if (a[0].length !== k) give('inner sizes');
  return a.map((row) => b[0].map((_, j) => {
    let s: Num = X.ZERO;
    for (let t = 0; t < k; t++) {
      tick();
      s = X.add(s, X.mul(row[t], b[t][j], p), p);
    }
    return s;
  }));
}

function square(m: Num[][]): void {
  if (m.length > 20 || m.some((r) => r.length !== m.length)) give('not square');
}

function pivotRow(m: Num[][], c: number): number {
  for (let r = c; r < m.length; r++) {
    const x = m[r][c];
    if (x.k !== 'r') { if (!X.isZeroNum(x)) return r; continue; }
    if (R.sign(x.b) !== null && R.sign(x.b) !== 0) return r;
    if (R.sign(x.b) === null) give('pivot sign unknown');
  }
  return -1;
}

function det(a: Num[][], p: number): Num {
  square(a);
  const m = a.map((r) => r.slice());
  const n = m.length;
  let d: Num = X.ONE;
  for (let c = 0; c < n; c++) {
    tick();
    const pr = pivotRow(m, c);
    if (pr < 0) return X.ZERO;
    if (pr !== c) {
      [m[c], m[pr]] = [m[pr], m[c]];
      d = X.neg(d);
    }
    d = X.mul(d, m[c][c], p);
    for (let r = c + 1; r < n; r++) {
      if (X.isZeroNum(m[r][c])) continue;
      const f = X.div(m[r][c], m[c][c], p);
      for (let j = c; j < n; j++) m[r][j] = X.sub(m[r][j], X.mul(f, m[c][j], p), p);
    }
  }
  return d;
}

function inverse(a: Num[][], p: number): Num[][] {
  square(a);
  const n = a.length;
  const m = a.map((r, i) => [...r, ...r.map((_, j) => (i === j ? X.ONE : X.ZERO))]);
  for (let c = 0; c < n; c++) {
    tick();
    const pr = pivotRow(m, c);
    if (pr < 0) give('singular');
    [m[c], m[pr]] = [m[pr], m[c]];
    const pv = m[c][c];
    m[c] = m[c].map((x) => X.div(x, pv, p));
    for (let r = 0; r < n; r++) {
      if (r === c || X.isZeroNum(m[r][c])) continue;
      const f = m[r][c];
      m[r] = m[r].map((x, j) => X.sub(x, X.mul(f, m[c][j], p), p));
    }
  }
  return m.map((r) => r.slice(n));
}

function matPow(m: Num[][], s: Num, p: number): Precise {
  square(m);
  if (!X.isInt(s)) give('matrix power');
  let k = (s as X.Rat).n;
  let base = m;
  if (k < 0n) {
    base = inverse(m, p);
    k = -k;
  }
  if (k > 4096n) give('matrix power too large');
  let res: Num[][] = m.map((r, i) => r.map((_, j) => (i === j ? X.ONE : X.ZERO)));
  while (k > 0n) {
    if (k & 1n) res = matMul(res, base, p);
    k >>= 1n;
    if (k > 0n) base = matMul(base, base, p);
  }
  return { t: 'matrix', m: res };
}

function wholeBig(x: Num): bigint {
  if (!X.isInt(x)) give('needs a whole number');
  return (x as X.Rat).n;
}

function factorial(x: Num): Num {
  const n = wholeBig(x);
  if (n < 0n || n > 5000n) give('factorial range');
  let r = 1n;
  for (let k = 2n; k <= n; k++) {
    tick();
    r *= k;
  }
  return X.rat(r);
}

function nCr(a: Num, b: Num): Num {
  const n = wholeBig(a), r = wholeBig(b);
  if (r < 0n || r > n) give('nCr range');
  const k = r < n - r ? r : n - r;
  if (k > 5000n) give('nCr too large');
  let res = 1n;
  for (let i = 1n; i <= k; i++) {
    tick();
    res = (res * (n - k + i)) / i;
  }
  return X.rat(res);
}

function nPr(a: Num, b: Num): Num {
  const n = wholeBig(a), r = wholeBig(b);
  if (r < 0n || r > n || r > 5000n) give('nPr range');
  let res = 1n;
  for (let i = 0n; i < r; i++) {
    tick();
    res *= n - i;
  }
  return X.rat(res);
}

function floorNum(x: Num, p: number): bigint {
  if (x.k === 'q') {
    const q = x.n / x.d;
    return x.n < 0n && q * x.d !== x.n ? q - 1n : q;
  }
  const b = X.toBall(x, p);
  if (b.e > 4096) give('floor of a huge ball');
  const f = (m: bigint): bigint => (b.e >= 0 ? m << BigInt(b.e) : m >> BigInt(-b.e));
  const a = f(b.m - b.r), c = f(b.m + b.r);
  if (a !== c) give('floor undecided');
  return a;
}

function logBase(b: Num, x: Num, c: Ctx): Num {
  const P = c.p;
  if (X.sign(b) <= 0 || (b.k === 'q' && b.n === b.d)) give('log base');
  if (X.sign(x) <= 0) give('log of a non-positive number');
  if (b.k === 'q' && x.k === 'q') {
    const k = X.exactLog(b, x);
    if (k !== null) return X.rat(k);
  }
  const q = P + 16;
  return X.real(R.div(R.ln(X.toBall(x, q), q), R.ln(X.toBall(b, q), q), P));
}

function absValue(v: Precise, c: Ctx): Precise {
  if (isNum(v)) return X.sign(v) < 0 ? X.neg(v) : v;
  if (v.t === 'vector') return hypot(v.c, c.p);
  if (v.t === 'matrix') return det(v.m, c.p);
  if (v.t === 'list') return mapNum(v, (x) => (X.sign(x) < 0 ? X.neg(x) : x));
  return give('abs');
}

function hypot(cs: Num[], p: number): Num {
  let s: Num = X.ZERO;
  for (const x of cs) s = X.add(s, X.mul(x, x, p + 8), p + 8);
  return X.root(s, 2, p);
}

function nums(v: Precise): Num[] {
  if (isNum(v)) return [v];
  if (v.t === 'list') return v.items.map(num);
  if (v.t === 'vector') return v.c;
  return give('needs a list');
}

const all = (args: Node[], locals: Local[], c: Ctx): Precise[] => args.map((a) => evalNode(a, locals, c));
const one = (f: (x: Num, c: Ctx) => Num): Impl => (args, locals, c) => mapNum(evalNode(args[0], locals, c), (x) => f(x, c));

const toRad = (x: Num, c: Ctx): Num => (c.env.settings.deg ? X.mul(x, X.piRat(1n, 180n), c.p + 8) : x);
const fromRad = (y: Num, c: Ctx): Num => (c.env.settings.deg ? X.div(X.mul(y, X.rat(180n), c.p + 8), X.piRat(1n), c.p) : y);
const nonzero = (x: Num): Num => (X.isZeroNum(x) ? give('undefined') : x);
const inUnit = (x: Num, c: Ctx): Num => (X.cmp(x, X.ONE, c.p) > 0 || X.cmp(x, X.rat(-1n), c.p) < 0 ? give('domain') : x);
const outsideUnit = (x: Num, c: Ctx): Num => (X.cmp(x, X.ONE, c.p) < 0 && X.cmp(x, X.rat(-1n), c.p) > 0 ? give('domain') : x);

function sumLike(product: boolean): Impl {
  return (args, locals, c) => {
    if (args.length === 1) {
      const xs = nums(evalNode(args[0], locals, c));
      return xs.reduce<Num>((s, x) => (product ? X.mul(s, x, c.p) : X.add(s, x, c.p)), product ? X.ONE : X.ZERO);
    }
    if (args.length !== 4 || args[1].k !== 'id') give('series form');
    const v = (args[1] as { name: string }).name;
    const a = wholeBig(num(evalNode(args[2], locals, c))), b = wholeBig(num(evalNode(args[3], locals, c)));
    if (b - a > BigInt(MAX_LOOP)) give('too many terms');
    let acc: Precise = product ? X.ONE : X.ZERO;
    const slot: Local = { name: v, v: X.ZERO };
    const inner = [...locals, slot];
    for (let k = a; k <= b; k++) {
      slot.v = X.rat(k);
      const term = evalNode(args[0], inner, c);
      acc = product ? X.mul(num(acc), num(term), c.p) : arith('+', acc, term, c);
    }
    return acc;
  };
}

function gcdAll(vs: Precise[], lcm: boolean): Num {
  const xs = vs.flatMap(nums).map((x) => { const n = wholeBig(x); return n < 0n ? -n : n; });
  return X.rat(xs.reduce((p, q) => (lcm ? (p === 0n || q === 0n ? 0n : (p / X.gcd(p, q)) * q) : X.gcd(p, q))));
}

function data(vs: Precise[]): Num[] {
  const xs = vs.length === 1 ? nums(vs[0]) : vs.flatMap(nums);
  if (xs.length === 0) give('empty');
  return xs;
}

function matrixArg(v: Precise): Num[][] {
  return !isNum(v) && v.t === 'matrix' ? v.m : give('needs a matrix');
}

const TABLE: Record<string, Impl> = {
  sqrt: one((x, c) => (X.sign(x) < 0 ? give('complex') : X.root(x, 2, c.p))),
  cbrt: one((x, c) => (X.sign(x) < 0 ? X.neg(X.root(X.neg(x), 3, c.p)) : X.root(x, 3, c.p))),
  nthroot: (args, locals, c) => {
    const n = num(evalNode(args[1], locals, c));
    if (X.isZeroNum(n)) give('0th root');
    return mapNum(evalNode(args[0], locals, c), (x) => {
      if (X.isInt(n)) {
        const k = (n as X.Rat).n;
        const ak = k < 0n ? -k : k;
        if (ak > 64n) give('root index');
        const neg = X.sign(x) < 0;
        if (neg && ak % 2n === 0n) give('even root of a negative');
        const mag = ak === 1n ? (neg ? X.neg(x) : x) : X.root(neg ? X.neg(x) : x, Number(ak), c.p + 8);
        const r = k < 0n ? X.div(X.ONE, mag, c.p) : mag;
        return neg ? X.neg(r) : r;
      }
      if (X.sign(x) < 0) give('root of a negative');
      return powNum(x, X.div(X.ONE, n, c.p + 16), c.p);
    });
  },
  abs: (args, locals, c) => absValue(evalNode(args[0], locals, c), c),
  floor: one((x, c) => X.rat(floorNum(x, c.p))),
  ceil: one((x, c) => X.rat(-floorNum(X.neg(x), c.p))),
  sign: one((x) => X.rat(BigInt(X.sign(x)))),
  round: (args, locals, c) => {
    const places = args.length > 1 ? wholeBig(num(evalNode(args[1], locals, c))) : 0n;
    if (places < 0n || places > 1000n) give('places');
    const s = X.rat(10n ** places);
    return mapNum(evalNode(args[0], locals, c), (x) => {
      const y = X.mul(x, s, c.p + 16);
      // Half away from zero: floor(|y| + 1/2) with the sign put back.
      const neg = X.sign(y) < 0;
      const r = floorNum(X.add(neg ? X.neg(y) : y, X.rat(1n, 2n), c.p + 16), c.p + 16);
      return X.div(X.rat(neg ? -r : r), s, c.p);
    });
  },
  mod: (args, locals, c) => {
    const m = num(evalNode(args[1], locals, c));
    if (X.isZeroNum(m)) give('mod by zero');
    return mapNum(evalNode(args[0], locals, c), (x) => X.sub(x, X.mul(m, X.rat(floorNum(X.div(x, m, c.p + 16), c.p + 16)), c.p), c.p));
  },
  exp: one((x, c) => X.exp(x, c.p)),
  ln: one((x, c) => (X.sign(x) <= 0 ? give('ln domain') : X.ln(x, c.p))),
  log: (args, locals, c) => {
    if (args.length === 1) return mapNum(evalNode(args[0], locals, c), (x) => logBase(X.rat(10n), x, c));
    const b = num(evalNode(args[0], locals, c));
    return mapNum(evalNode(args[1], locals, c), (x) => logBase(b, x, c));
  },
  gcd: (args, locals, c) => gcdAll(all(args, locals, c), false),
  lcm: (args, locals, c) => gcdAll(all(args, locals, c), true),
  factorial: one(factorial),
  nCr: (args, locals, c) => { const [a, b] = all(args, locals, c); return nCr(num(a), num(b)); },
  nPr: (args, locals, c) => { const [a, b] = all(args, locals, c); return nPr(num(a), num(b)); },
  count: (args, locals, c) => all(args, locals, c).flatMap(nums).reduce<Num>((s, x) => X.mul(s, x, c.p), X.ONE),
  mean: (args, locals, c) => {
    const xs = data(all(args, locals, c));
    return X.div(xs.reduce<Num>((s, x) => X.add(s, x, c.p), X.ZERO), X.rat(BigInt(xs.length)), c.p);
  },
  min: (args, locals, c) => data(all(args, locals, c)).reduce((m, x) => (X.cmp(x, m, c.p) < 0 ? x : m)),
  max: (args, locals, c) => data(all(args, locals, c)).reduce((m, x) => (X.cmp(x, m, c.p) > 0 ? x : m)),
  sin: one((x, c) => X.sin(toRad(x, c), c.p)),
  cos: one((x, c) => X.cos(toRad(x, c), c.p)),
  tan: one((x, c) => X.tan(toRad(x, c), c.p)),
  sec: one((x, c) => X.div(X.ONE, nonzero(X.cos(toRad(x, c), c.p + 8)), c.p)),
  csc: one((x, c) => X.div(X.ONE, nonzero(X.sin(toRad(x, c), c.p + 8)), c.p)),
  cot: one((x, c) => { const r = toRad(x, c); return X.div(X.cos(r, c.p + 8), nonzero(X.sin(r, c.p + 8)), c.p); }),
  asin: one((x, c) => fromRad(X.asin(inUnit(x, c), c.p + 8), c)),
  acos: one((x, c) => fromRad(X.acos(inUnit(x, c), c.p + 8), c)),
  atan: one((x, c) => fromRad(X.atan(x, c.p + 8), c)),
  acsc: one((x, c) => fromRad(X.asin(X.div(X.ONE, outsideUnit(x, c), c.p + 16), c.p + 8), c)),
  asec: one((x, c) => fromRad(X.acos(X.div(X.ONE, outsideUnit(x, c), c.p + 16), c.p + 8), c)),
  acot: one((x, c) => {
    if (X.isZeroNum(x)) return fromRad(X.piRat(1n, 2n), c);
    const t = X.atan(X.div(X.ONE, x, c.p + 16), c.p + 8);
    return fromRad(X.sign(x) < 0 ? X.add(t, X.piRat(1n), c.p + 8) : t, c);
  }),
  atan2: (args, locals, c) => {
    const [y, x] = all(args, locals, c).map(num);
    return fromRad(X.atan2(y, x, c.p + 8), c);
  },
  sinh: one((x, c) => X.sinh(x, c.p)),
  cosh: one((x, c) => X.cosh(x, c.p)),
  tanh: one((x, c) => X.tanh(x, c.p)),
  torad: one((x, c) => X.mul(x, X.piRat(1n, 180n), c.p)),
  todeg: one((x, c) => X.div(X.mul(x, X.rat(180n), c.p + 8), X.piRat(1n), c.p)),
  sum: sumLike(false),
  prod: sumLike(true),
  det: (args, locals, c) => det(matrixArg(evalNode(args[0], locals, c)), c.p),
  inv: (args, locals, c) => ({ t: 'matrix', m: inverse(matrixArg(evalNode(args[0], locals, c)), c.p) }),
  transpose: (args, locals, c) => {
    const m = matrixArg(evalNode(args[0], locals, c));
    return { t: 'matrix', m: m[0].map((_, j) => m.map((r) => r[j])) };
  },
};

let implByDef: Map<Builtin, Impl> | null = null;
function impl(b: Builtin): Impl | undefined {
  if (!implByDef) {
    implByDef = new Map();
    for (const [name, f] of Object.entries(TABLE)) {
      // A renamed built-in would otherwise lose its exact math without a sound.
      if (!BUILTINS[name]) throw new Error(`Exact math covers "${name}", which isn't a built-in`);
      implByDef.set(BUILTINS[name], f);
    }
  }
  return implByDef.get(b);
}
