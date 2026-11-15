import { BudgetError, charge, fail } from './errors';
import type { Env, Fn } from './evaluator';
import type { Builtin } from './builtin-types';
import { type Value, mapNum, nums, typeName } from './values';

export function one(f: (x: number, env: Env) => number, what: string): Builtin {
  return { min: 1, max: 1, fast1: f, fn: (a, env) => mapNum(a[0], (x) => f(x, env), what) };
}

export function mat(v: Value, what = 'Input'): number[][] {
  if (typeof v === 'object' && v.t === 'matrix') return v.m;
  return fail(`${what} must be a matrix like [[1,2],[3,4]], got a ${typeName(v)}`);
}

export function coordsOf(v: Value, what: string, like: string, listName?: string): number[] {
  if (typeof v === 'object' && (v.t === 'point' || v.t === 'vector')) return v.c;
  if (typeof v === 'object' && v.t === 'list') return nums(v, listName);
  return fail(`${what} must be a ${like}, got a ${typeName(v)}`);
}

export function points2D(a: Value[], message: string): number[][] {
  const items = a.length === 1 && typeof a[0] === 'object' && a[0].t === 'list' ? a[0].items : a;
  return items.map((v) => {
    if (typeof v === 'object' && v.t === 'point' && v.c.length === 2) return v.c;
    return fail(message);
  });
}

export function numberFn(body: Fn, s: Value[]): (x: number) => number {
  const slot = s.length;
  const sc = s.slice();
  return (x) => {
    sc[slot] = x;
    charge();
    try {
      const r = body(sc);
      return typeof r === 'number' ? r : NaN;
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      return NaN;
    }
  };
}
