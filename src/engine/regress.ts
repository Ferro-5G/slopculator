// A regression line, y1 ~ m x1 + b: the names on it that nothing else defines (m and b) are unknowns, the lists on it
// (y1 and x1, usually a table's columns) are the data, and the line fits the unknowns to the data by least squares.
// It defines each unknown for the rest of the sheet, so y = m x + b on another line draws the fit.
import { inParens, type Node } from './parser';
import { compile, type Env, type Fn } from './evaluator';
import { BUILTINS, CONSTANTS, readsAsValue } from './builtins';
import { isGraphVar } from './ast';
import { BudgetError, fail } from './errors';
import { leastSquares } from './fit';
import { maxOf, minOf } from './numeric';
import { anyCase } from './resolve';
import { type Value, record, tidy } from './values';

type Rel = Extract<Node, { k: 'rel' }>;

export const isFitNode = (n: Node): n is Rel => n.k === 'rel' && n.ops.includes('~');

interface FitOutcome {
  value: Value;
  params: Map<string, number>;
  /** The fitted model as a function of its one data name, when it has exactly one. */
  curve?: Fn;
  /** The data as points, for a sheet that doesn't draw them already. */
  points?: number[][];
}

export interface FitPlan {
  /** The unknowns this line fits and defines. */
  params: string[];
  /** A tree that differs whenever the line or a table column it reads does, for telling one fit from another. */
  key: Node;
  run(): FitOutcome;
}

/** The same node with each child put through f. */
function mapChildren(n: Node, f: (c: Node) => Node): Node {
  switch (n.k) {
    case 'num': case 'str': case 'id': return n;
    case 'un': case 'post': case 'abs': return { ...n, a: f(n.a) };
    case 'bin': return { ...n, a: f(n.a), b: f(n.b) };
    case 'call': return { ...n, args: n.args.map(f), base: n.base && f(n.base) };
    case 'point': case 'vec': case 'bracket': case 'list': case 'rel': return { ...n, items: n.items.map(f) };
    case 'piece': return { ...n, branches: n.branches.map((b) => ({ cond: b.cond && f(b.cond), val: b.val && f(b.val) })) };
  }
}

const LETTER = /^\p{L}(_[\p{L}\p{N}]+)?$/u;

/**
 * @param column a table column headed x or y, for a line that reads them: y ~ m x + b
 * @param drawn whether the sheet already draws the points a name holds, as a table does its columns
 */
export function planFit(ast: Rel, row: number, env: Env, column: (name: string) => Node | null, drawn: (name: string) => boolean): FitPlan {
  let problem: string | null = ast.ops.length === 1 ? null : 'A regression has one ~ and stands alone, like y1 ~ m x1 + b';
  const params: string[] = [];
  const columns = new Map<string, Node>();
  const known = (name: string): boolean => env.hasVar(name) || env.hasFunc(name) || name in CONSTANTS || readsAsValue(name) || name === 'ans' || name === 'i';
  const isData = (name: string): boolean => known(name) || (isGraphVar(name) && column(name) !== null);

  /** mx1 as m and x1: the longest names that mean something, with single letters between them as unknowns. */
  const split = (name: string): string[] | null => {
    const chars = [...name];
    const out: string[] = [];
    let hit = false;
    for (let i = 0; i < chars.length;) {
      let took = 0;
      for (let len = chars.length - i; len >= 1 && !took; len--) {
        if (len === chars.length) continue;
        if (isData(chars.slice(i, i + len).join(''))) took = len;
      }
      if (took) {
        out.push(chars.slice(i, i + took).join(''));
        hit = true;
        i += took;
        continue;
      }
      if (!/\p{L}/u.test(chars[i])) return null;
      out.push(chars[i]);
      i++;
    }
    return hit ? out : null;
  };

  const unknown = (name: string, pos: number): Node => {
    if (!params.includes(name)) params.push(name);
    return { k: 'id', name, pos };
  };

  /** What a name stands for, as the factors of a product: mx1 is m and x1. */
  const factors = (n: Extract<Node, { k: 'id' }>): Node[] => {
    if (known(n.name) || params.includes(n.name)) return [n];
    if (isGraphVar(n.name)) {
      const col = column(n.name);
      if (col) columns.set(n.name, col);
      else problem ??= `There is no table with ${n.name === 'x' ? 'an x' : 'a y'} column for "${n.name}" to read. Name the data's columns, like x1 and y1, and write y1 ~ m x1 + b`;
      return [n];
    }
    const parts = split(n.name);
    if (parts) return parts.flatMap((p) => (isData(p) ? factors({ k: 'id', name: p, pos: n.pos }) : [unknown(p, n.pos)]));
    // A whole word nothing defines is one unknown, unless it is a function missing its brackets.
    return [n.name in BUILTINS ? n : unknown(n.name, n.pos)];
  };
  const product = (parts: Node[]): Node => parts.reduce((a, b) => ({ k: 'bin', op: '*', a, b }));
  /** The unknown m of m(x1 − 3), where nothing is called m: a letter against a bracket. */
  const letterCall = (n: Node, bound: ReadonlySet<string>): Extract<Node, { k: 'call' }> | null =>
    n.k === 'call' && !n.base && n.args.length === 1 && LETTER.test(n.name) && !bound.has(n.name) && !known(n.name) && !isFunction(n.name) ? n : null;
  const isFunction = (called: string): boolean => env.hasFunc(called) || called in BUILTINS || anyCase(called) !== undefined;

  const rewrite = (n: Node, bound: ReadonlySet<string>): Node => {
    if (n.k === 'id') return bound.has(n.name) ? n : product(factors(n));
    // A power belongs to the last factor only: mx1^2 is m times x1 squared, and m(x1 − 3)^2 is m times the square.
    // Brackets around the base say otherwise: (mx1)^2 squares the product.
    if (n.k === 'bin' && n.op === '^' && !inParens(n.a)) {
      const exp = rewrite(n.b, bound);
      if (n.a.k === 'id' && !bound.has(n.a.name)) {
        const parts = factors(n.a);
        return product([...parts.slice(0, -1), { k: 'bin', op: '^', a: parts[parts.length - 1], b: exp }]);
      }
      const scaled = letterCall(n.a, bound);
      if (scaled) return { k: 'bin', op: '*', a: unknown(scaled.name, scaled.pos), b: { k: 'bin', op: '^', a: rewrite(scaled.args[0], bound), b: exp } };
      return { ...n, a: rewrite(n.a, bound), b: exp };
    }
    if (n.k === 'call') {
      const base = n.base && rewrite(n.base, bound);
      const scaled = letterCall(n, bound);
      if (scaled) return { k: 'bin', op: '*', a: unknown(scaled.name, scaled.pos), b: rewrite(scaled.args[0], bound) };
      const isFn = isFunction(n.name);
      const binder = isFn && !env.hasFunc(n.name) && !!BUILTINS[n.name]?.binds && n.args.length >= 2 && n.args[1].k === 'id';
      if (!binder) return { ...n, base, args: n.args.map((a) => rewrite(a, bound)) };
      const inner = new Set(bound).add((n.args[1] as { name: string }).name);
      return { ...n, base, args: n.args.map((a, i) => (i === 0 ? rewrite(a, inner) : i === 1 ? a : rewrite(a, bound))) };
    }
    return mapChildren(n, (c) => rewrite(c, bound));
  };

  const none: ReadonlySet<string> = new Set();
  const lhs = rewrite(ast.items[0], none);
  const rhs = rewrite(ast.items[1] ?? ast.items[0], none);
  const key: Node = { k: 'call', name: '~', args: [lhs, rhs, ...columns.values()], pos: 0 };

  const freeNames = (n: Node, bound: ReadonlySet<string>, out: Set<string>): Set<string> => {
    if (n.k === 'id') {
      if (!bound.has(n.name)) out.add(n.name);
    } else if (n.k === 'call' && !!BUILTINS[n.name]?.binds && n.args.length >= 2 && n.args[1].k === 'id') {
      const inner = new Set(bound).add(n.args[1].name);
      n.args.forEach((a, i) => { if (i !== 1) freeNames(a, i === 0 ? inner : bound, out); });
    } else mapChildren(n, (c) => (freeNames(c, bound, out), c));
    return out;
  };

  let done: FitOutcome | undefined;
  const run = (): FitOutcome => {
    if (done) return done;
    if (problem) fail(problem);
    if (!params.length) fail('Nothing to fit: every name on this line already has a value. A regression needs unknowns, like m and b in y1 ~ m x1 + b');
    const data = new Map<string, number[]>();
    const rhsNames = freeNames(rhs, none, new Set());
    for (const n of freeNames(lhs, none, new Set(rhsNames))) {
      if (params.includes(n)) continue;
      const col = columns.get(n);
      const v = col ? compile(col, env, [], row)([]) : env.hasVar(n) ? env.getVar(n) : undefined;
      if (typeof v !== 'object') continue;
      if (v.t === 'list') data.set(n, v.items.map((x) => (typeof x === 'number' ? x : NaN)));
      else if (v.t === 'vector') data.set(n, v.c);
    }
    const names = [...data.keys()];
    if (!names.length) fail('A regression needs data: lists of the same length, like table columns x1 and y1 in y1 ~ m x1 + b');
    const length = data.get(names[0])!.length;
    for (const n of names) {
      if (data.get(n)!.length !== length) fail(`${names[0]} has ${length} values and ${n} has ${data.get(n)!.length}. A regression needs the same number in each`);
    }
    // A blank cell leaves its whole row out, as it does in a table's plot.
    const kept: number[] = [];
    for (let i = 0; i < length; i++) if (names.every((n) => Number.isFinite(data.get(n)![i]))) kept.push(i);
    if (kept.length < params.length) fail(`${params.length} unknown${params.length === 1 ? '' : 's'} need${params.length === 1 ? 's' : ''} at least ${params.length} data point${params.length === 1 ? '' : 's'}, and there ${kept.length === 1 ? 'is' : 'are'} ${kept.length}`);

    const locals = [...names, ...params];
    const L = compile(lhs, env, locals, row), R = compile(rhs, env, locals, row);
    const slots = kept.map((i) => names.map((n) => data.get(n)![i] as Value));
    const sides = (theta: number[]): [number, number][] | null => {
      const out: [number, number][] = [];
      for (const point of slots) {
        const s = [...point, ...theta];
        let a: Value, b: Value;
        try {
          a = L(s);
          b = R(s);
        } catch (e) {
          if (e instanceof BudgetError) throw e;
          return null;
        }
        if (typeof a !== 'number' || typeof b !== 'number') return null;
        out.push([a, b]);
      }
      return out;
    };
    const fit = leastSquares((theta) => sides(theta)?.map(([a, b]) => a - b) ?? null, params.length);
    // The solve leaves rounding in the last few of a double's 16 digits: 0.15000000000000058 for 0.15, and 3e-15 for an
    // unknown the data puts at 0. Twelve digits is what an answer shows, and an unknown that moves no point is 0.
    // "Moves" is against how far the data itself ranges, so a small slope on a large baseline is kept.
    const lefts = (sides(fit.params) ?? []).map(([a]) => a);
    // maxOf, not Math.max(...): spreading 200,000 points overflowed the call stack.
    const spread = lefts.length ? maxOf(lefts) - minOf(lefts) : 0;
    const big = spread > 0 ? spread : Math.max(maxOf(lefts.map(Math.abs)), 0);
    const theta = fit.params.map((x, j) => {
      const without = fit.params.slice();
      without[j] = 0;
      const moved = sides(without), here = sides(fit.params);
      const none = moved && here && moved.every(([a, b], i) => Math.abs(a - b - (here[i][0] - here[i][1])) <= 1e-11 * big);
      return none ? 0 : Number(x.toPrecision(12));
    });
    const at = sides(theta);
    const rows: { label: string; value: Value; key?: string }[] = params.map((label, j) => ({ label, value: theta[j] as Value }));
    if (at) {
      const mean = at.reduce((s, [a]) => s + a, 0) / at.length;
      const sst = at.reduce((s, [a]) => s + (a - mean) ** 2, 0);
      const rss = at.reduce((s, [a, b]) => s + (a - b) ** 2, 0);
      if (sst > 0) rows.push({ label: 'R²', value: tidy(Math.max(0, 1 - rss / sst), 1), key: 'R2' });
    }
    // Fitted values are estimates, so Exact mode leaves them as decimals: m is 1.94, not 97/50.
    done = { value: { ...record('Best fit', rows), decimal: true }, params: new Map(params.map((p, j) => [p, theta[j]])) };

    // y1 ~ f(x1) draws f: one data name on the right, another alone on the left.
    const left = ast.items[0].k === 'id' && lhs.k === 'id' && data.has(lhs.name) ? lhs.name : null;
    const right = names.filter((n) => rhsNames.has(n));
    if (left && right.length === 1 && right[0] !== left) {
      const slot = names.indexOf(right[0]);
      const blank = names.map(() => NaN as Value);
      done.curve = (s) => {
        const sc = [...blank, ...theta];
        sc[slot] = s[0];
        return R(sc);
      };
      if (!(drawn(left) && drawn(right[0]))) done.points = kept.map((i) => [data.get(right[0])![i], data.get(left)![i]]);
    }
    return done;
  };
  return { params, key, run };
}
