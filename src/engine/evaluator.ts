import {
  BudgetError, CalcError, EdgeError, OrderError, OverflowError, arityText, charge, emptyLineText, errorText, fail, orDouble, undefinedNameText, unknownFunctionText, unknownNameText, varErrorText, withFullErrors,
} from './errors';
import type { Node } from './parser';
import { isGraphVar } from './ast';
import { canonicalName } from './lexer';
import { arith, negate, num, type Value, list, point, vector, matrix, complex, typeName, mapNum, text } from './values';
import { factorial, nCr, nPr } from './numeric';
import { BUILTINS, CONSTANTS } from './builtins';
import { MAX_CALL_DEPTH, bracketKind, isConstantE, oddRootOf, resolveCall, resolveId, rewritePower } from './resolve';

export interface Settings {
  deg: boolean;
  complex: boolean;
  sample: boolean;
  lineNames?: boolean;
  /**
   * Adding a percent, as the iPhone Calculator does: a + b% is a plus b% of a, so 80 + 15% = 92. Off, % only divides
   * by 100 (80.15). Missing reads as on.
   */
  percentOf?: boolean;
  /**
   * The extras that explain an answer without changing it: the angle unit under trig answers, substituted formulas, the
   * unit circle's drawing, asymptote lines. Missing reads as on. Notes about what a function did to get its answer (a
   * unit converted, the range searched) stay either way.
   */
  working?: boolean;
}

/**
 * Every setting: what a missing one reads as, and the letters it adds to a cache key when on and off. A Record, so a new
 * field of Settings can't be left out.
 */
export const SETTINGS: Record<keyof Settings, { fallback: boolean; on: string; off?: string }> = {
  deg: { fallback: true, on: 'D', off: 'R' },
  complex: { fallback: false, on: 'C' },
  sample: { fallback: false, on: 'S' },
  lineNames: { fallback: false, on: 'L' },
  percentOf: { fallback: true, on: 'P' },
  working: { fallback: true, on: 'W' },
};

const settingNames = Object.keys(SETTINGS) as (keyof Settings)[];

/** Text that differs for any two settings that could give different answers, for keying caches. */
export function settingsKey(s: Settings): string {
  return settingNames.map((name) => (s[name] ?? SETTINGS[name].fallback ? SETTINGS[name].on : SETTINGS[name].off ?? '')).join('');
}

const showsWorking = (s: Settings): boolean => s.working ?? SETTINGS.working.fallback;

const percentOf = (s: Settings): boolean => s.percentOf ?? SETTINGS.percentOf.fallback;

export const percentOperand = (n: Node, s: Settings): Node | null =>
  percentOf(s) && n.k === 'post' && n.op === '%' ? n.a : null;

function percentNote(op: '+' | '-', a: unknown, b: unknown): string {
  const short = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && String(v).length <= 8;
  const of = short(a) && short(b) ? `${b}% of ${a}` : 'The percent of the number';
  return `${of} ${op === '+' ? 'added' : 'taken off'}`;
}

/** Compiled expression. `s` holds the values of local names (function params, x and y in graphs). */
export type Fn = (s: Value[]) => Value;

export interface FuncDef {
  name: string;
  params: string[];
  body: Node;
  compiled?: Fn;
  compiling?: boolean;
}

interface VarDef {
  name: string;
  node?: Node;
  value?: Value;
  row: number;
  letter?: boolean;
}

interface EnvHooks {
  /**
   * Works out row r if it hasn't been yet, before ans reads it. A definition can be asked for by an earlier row, and
   * its ans still means the row above its own.
   */
  reachRow: (r: number) => void;
  /**
   * The exact-math layer's better double for a variable, given its float value, or for a value the float path called
   * too large (v undefined). Undefined means keep the float result.
   */
  improve: (name: string, v: Value | undefined) => Value | undefined;
}

/** The row number of something that belongs to no row, like a user function's body. ans finds nothing before it. */
export const NO_ROW = -1;

export const RESERVED = new Set(['x', 'y', 'e', 'π', 'i', 'inf', 'ans']);

export class Env {
  private emptyLines = new Set<string>();
  private vars = new Map<string, VarDef>();
  private funcs = new Map<string, FuncDef>();
  private cache = new Map<string, Value | CalcError>();
  private active = new Set<string>();
  private notes: string[] = [];
  private collectNotes = false;
  private varNotes = new Map<string, string[]>();
  private answers: ({ value: Value; node: Node } | undefined)[] = [];
  private callDepth = 0;

  constructor(public settings: Settings, private hooks: EnvHooks) {}

  note(msg: string): void {
    if (this.collectNotes && !this.notes.includes(msg)) this.notes.push(msg);
  }

  withNotes<T>(into: string[], fn: () => T): T {
    const savedCollect = this.collectNotes;
    const savedNotes = this.notes;
    this.collectNotes = true;
    this.notes = into;
    try {
      return fn();
    } finally {
      this.collectNotes = savedCollect;
      this.notes = savedNotes;
    }
  }

  notesDuring(fn: () => void): string[] {
    const before = this.notes.length;
    fn();
    return this.notes.slice(before);
  }

  /** Runs one row's evaluation. Another row can be part way through (see reachRow), so its state is put back. */
  inRow<T>(notes: string[], fn: () => T): T {
    const outerDepth = this.callDepth;
    this.callDepth = 0;
    try {
      return this.withNotes(notes, fn);
    } finally {
      this.callDepth = outerDepth;
    }
  }

  defineVar(def: VarDef): void {
    this.vars.set(def.name, def);
  }

  defineFunc(def: FuncDef): void {
    this.funcs.set(def.name, def);
  }

  markEmptyLine(letter: string): void {
    this.emptyLines.add(letter);
  }

  hasVar(name: string): boolean {
    return this.vars.has(name);
  }

  hasFunc(name: string): boolean {
    return this.funcs.has(name);
  }

  varDef(name: string): VarDef | undefined {
    return this.vars.get(name);
  }

  funcDef(name: string): FuncDef | undefined {
    return this.funcs.get(name);
  }

  isEmptyLine(name: string): boolean {
    return this.emptyLines.has(name);
  }

  nearbyNames(row: number | undefined): { name: string; isFn: boolean }[] {
    return [
      ...[...this.funcs.keys()].map((name) => ({ name, isFn: true })),
      ...[...this.vars.values()].filter((v) => v.row !== row).map((v) => ({ name: v.name, isFn: false })),
    ];
  }

  getVar(name: string): Value {
    const hit = this.cache.get(name);
    if (hit !== undefined) {
      if (hit instanceof CalcError) throw hit;
      return hit;
    }
    const def = this.vars.get(name);
    if (!def) return fail(unknownNameText(name));
    if (def.value !== undefined) return def.value;
    if (this.active.has(name)) fail(`"${name}" is defined in terms of itself`);
    this.active.add(name);
    const notes: string[] = [];
    try {
      // A graph can be first to ask for a variable. Its value and error message are kept, so compute them for real.
      return this.withNotes(notes, () => withFullErrors(() => this.workOut(name, def)));
    } finally {
      this.active.delete(name);
      this.varNotes.set(name, notes);
    }
  }

  private workOut(name: string, def: VarDef): Value {
    try {
      let v = compile(def.node!, this, [], def.row)([]);
      v = orDouble(() => this.hooks.improve(name, v)) ?? v;
      this.cache.set(name, v);
      return v;
    } catch (e) {
      // Out of time is about the line that asked, not the variable: its own row, with a budget of its own, may finish.
      // So it isn't kept, and stays a BudgetError so solve and integrals stop instead of reading it as "no value here".
      if (e instanceof BudgetError) throw e;
      if (e instanceof OrderError) throw new OrderError(varErrorText(name, e.message));
      const err = e instanceof CalcError ? e : new CalcError(errorText(e));
      // 200! overflows a double but is exact as an integer, and a divisor that only doubles round to 0 isn't 0.
      let saved: Value | undefined;
      if (err instanceof OverflowError || err instanceof EdgeError) {
        try {
          saved = this.hooks.improve(name, undefined);
        } catch {
          // Exact math has no value for it either, so the double's error stands.
        }
      }
      if (saved !== undefined) {
        this.cache.set(name, saved);
        return saved;
      }
      const message = varErrorText(name, err.message);
      const wrapped = err instanceof OverflowError ? new OverflowError(message) : new CalcError(message);
      this.cache.set(name, wrapped);
      throw wrapped;
    }
  }

  notesOf(name: string): readonly string[] {
    return this.varNotes.get(name) ?? [];
  }

  remember(name: string, v: Value | CalcError): void {
    if (!this.cache.has(name)) this.cache.set(name, v);
  }

  known(name: string): boolean {
    return this.cache.has(name);
  }

  getFunc(name: string): Fn {
    const f = this.funcs.get(name)!;
    if (!f.compiled) {
      if (f.compiling) fail(`${name} is defined in terms of itself`);
      f.compiling = true;
      try {
        f.compiled = compile(f.body, this, f.params, NO_ROW);
      } finally {
        f.compiling = false;
      }
    }
    return f.compiled;
  }

  ans(row: number): Value {
    for (let r = row - 1; r >= 0; r--) {
      this.hooks.reachRow(r);
      const a = this.answers[r];
      if (a) return a.value;
    }
    return fail('No earlier answer for ans');
  }

  finishRow(row: number, value: Value | undefined, node: Node | undefined): void {
    this.answers[row] = value !== undefined && node ? { value, node } : undefined;
  }

  answerBefore(row: number): { row: number; node: Node } | null {
    for (let r = row - 1; r >= 0; r--) {
      const a = this.answers[r];
      if (a) return { row: r, node: a.node };
    }
    return null;
  }

  /** One user function call begins. Pair with leaveCall, in a finally. */
  enterCall(name: string): void {
    charge();
    if (++this.callDepth > MAX_CALL_DEPTH) {
      this.callDepth--;
      fail(`${name} calls itself too deeply`);
    }
  }

  leaveCall(): void {
    this.callDepth--;
  }

  /** Whether the sheet shows its working, for the built-ins, which can't import this module's functions. */
  get showsWorking(): boolean {
    return showsWorking(this.settings);
  }

  /** text only runs when the note will be kept: a graph samples these functions for every pixel. */
  workingNote(text: () => string): void {
    if (this.collectNotes && this.showsWorking) this.note(text());
  }

  conversionNote(text: () => string): void {
    if (this.notes.length === 0) this.workingNote(text);
  }

  private angleName = (): string => (this.settings.deg ? 'Degrees' : 'Radians');

  angleNote(): void {
    this.workingNote(this.angleName);
  }

  toRad(x: number): number {
    if (!this.settings.deg) return x;
    return (x % 360) * (Math.PI / 180);
  }

  fromRad(x: number): number {
    return this.settings.deg ? (x * 180) / Math.PI : x;
  }
}

function compileId(name: string, env: Env, locals: string[], row: number): Fn {
  const use = resolveId(name, env, locals);
  switch (use.k) {
    case 'local': {
      const idx = use.index;
      return (s) => s[idx];
    }
    case 'var': {
      // A variable's value is fixed for the life of the Env, so look it up once, not once per graph sample.
      let v: Value | undefined;
      return () => (v === undefined ? (v = env.getVar(name)) : v);
    }
    case 'ans': return () => env.ans(row);
    case 'i': {
      if (!env.settings.complex) fail('"i" needs Complex mode. Turn it on in the mode bar');
      const iv = complex(0, 1);
      return () => iv;
    }
    case 'constant': {
      const v = CONSTANTS[name];
      return () => v;
    }
    case 'zeroInput': return compileCall({ k: 'call', name, args: [], pos: 0 }, env, locals, row);
    case 'function': return fail(`${name} is a function. Call it like ${name}(x)`);
    case 'builtin': return fail(`${name} is a function. Call it like ${name}(…)`);
    case 'letters': {
      const fns = use.parts.map((p) => compileId(p, env, locals, row));
      return (s) => {
        let acc = fns[0](s);
        for (let k = 1; k < fns.length; k++) acc = mul(acc, fns[k](s));
        return acc;
      };
    }
    case 'unknown': {
      if (isGraphVar(name)) fail(`"${name}" only means something in a graph, like y = 2x + 1`);
      if (env.isEmptyLine(name)) fail(emptyLineText(name));
      const hint = suggestName(name, env, false, row);
      return fail(undefinedNameText(name, hint));
    }
  }
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function swapped(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const diff = [...a].flatMap((ch, i) => (ch === b[i] ? [] : [i]));
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

function subsequence(a: string, b: string): boolean {
  let i = 0;
  for (const ch of b) if (ch === a[i]) i++;
  return i === a.length;
}

function suggestName(name: string, env: Env, asFunction: boolean, row?: number): string | null {
  // The same letters in another case (Sin, Ln, PI) are always that name, however short.
  const lower = name.toLowerCase();
  if (lower !== name) {
    if (canonicalName(lower) in CONSTANTS) return lower;
    if (lower in BUILTINS) return BUILTINS[lower].max !== 0 ? `${lower}(…)` : lower;
  }
  // Every one or two letters is an edit or two from dozens of names (mi → min), so a guess would mean nothing. Longer
  // names allow about one edit per four letters: "integrl" finds integral, but "binomial" never turns into binomvar.
  if (name.length < 3) return null;
  const max = name.length <= 5 ? 1 : name.length <= 11 ? 2 : 3;
  let best: string | null = null;
  let bestD = max + 1;
  let bestIsFn = false;
  const consider = (cand: string, isFn: boolean) => {
    if (!/^[A-Za-z]/.test(cand) || cand === name) return;
    const c = cand.toLowerCase();
    const d = editDistance(lower, c, max);
    if (d > max) return;
    // Two or more edits only when they're letters left out or added (normcdf → normalcdf), never letters swapped
    // for others: binomial → binomvar is a different function, not a typo.
    if (d >= 2 && !subsequence(lower.length < c.length ? lower : c, lower.length < c.length ? c : lower) && !swapped(lower, c)) return;
    // A short name with one letter replaced is another word (tax isn't max): only letters added, dropped or swapped.
    if (lower.length <= 4 && d === 1 && lower.length === c.length && !swapped(lower, c)) return;
    if (d < bestD || (d === bestD && isFn === asFunction && bestIsFn !== asFunction)) {
      best = cand;
      bestD = d;
      bestIsFn = isFn;
    }
  };
  for (const n of Object.keys(BUILTINS)) consider(n, BUILTINS[n].max !== 0);
  for (const n of env.nearbyNames(row)) consider(n.name, n.isFn);
  // TypeScript can't see the closure's assignments, so widen explicitly.
  const found = best as string | null;
  if (found === null) return null;
  return bestIsFn ? `${found}(…)` : found;
}

function mul(a: Value, b: Value): Value {
  return typeof a === 'number' && typeof b === 'number' ? a * b : arith('*', a, b);
}

function truthy(v: Value): boolean {
  return typeof v === 'number' && v !== 0 && !Number.isNaN(v);
}

function compare(op: string, a: Value, b: Value): boolean {
  const x = num(a, 'Comparison side');
  const y = num(b, 'Comparison side');
  switch (op) {
    case '<': return x < y;
    case '>': return x > y;
    case '<=': return x <= y;
    case '>=': return x >= y;
    case '=': return x === y || (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x), Math.abs(y)));
  }
  return false;
}

function compileCall(n: Extract<Node, { k: 'call' }>, env: Env, locals: string[], row: number): Fn {
  const { name } = n;
  const use = resolveCall(name, n.args.length, env, locals);
  if (use.k === 'value') {
    if (n.args.length !== 1) fail(`${name} is a value, not a function`);
    const a = compileId(name, env, locals, row);
    const b = compile(n.args[0], env, locals, row);
    return (s) => mul(a(s), b(s));
  }
  if (use.k === 'user') {
    const { def } = use;
    if (n.args.length !== def.params.length)
      fail(arityText(name, def.params.length, def.params.length, n.args.length));
    const args = n.args.map((a) => compile(a, env, locals, row));
    if (args.length === 1) {
      const a0 = args[0];
      let body: Fn | undefined;
      return (s) => {
        body ??= env.getFunc(name);
        env.enterCall(name);
        try {
          return body([a0(s)]);
        } finally {
          env.leaveCall();
        }
      };
    }
    return (s) => {
      const body = env.getFunc(name);
      env.enterCall(name);
      try {
        return body(args.map((a) => a(s)));
      } finally {
        env.leaveCall();
      }
    };
  }
  if (use.k === 'letters') {
    const a = compileId(name, env, locals, row);
    const arg = compile(n.args[0], env, locals, row);
    return (s) => mul(a(s), arg(s));
  }
  if (use.k === 'unknown') {
    const hint = suggestName(name, env, true, row);
    return fail(unknownFunctionText(name, hint));
  }
  const { b } = use;
  if (n.base) {
    if (n.args.length !== 1) fail('log_b(x) takes one input');
    const base = compile(n.base, env, locals, row);
    const arg = compile(n.args[0], env, locals, row);
    const log = BUILTINS.log.fn!;
    return (s) => log([base(s), arg(s)], env);
  }
  if (n.args.length < b.min || n.args.length > b.max) fail(arityText(name, b.min, b.max, n.args.length, b.usage));
  if (b.lazy) return b.lazy(n.args, locals, env, (node, loc) => compile(node, env, loc, row));
  const fn = b.fn!;
  const args = n.args.map((a) => compile(a, env, locals, row));
  switch (args.length) {
    case 0: return () => fn([], env);
    case 1: {
      const a0 = args[0];
      const fast = b.fast1;
      if (fast) return (s) => { const v = a0(s); return typeof v === 'number' ? fast(v, env) : fn([v], env); };
      return (s) => fn([a0(s)], env);
    }
    case 2: {
      const [a0, a1] = args;
      return (s) => fn([a0(s), a1(s)], env);
    }
    default:
      return (s) => fn(args.map((a) => a(s)), env);
  }
}

export function compile(n: Node, env: Env, locals: string[], row: number): Fn {
  switch (n.k) {
    case 'num': {
      const v = n.v;
      return () => v;
    }
    case 'str': {
      const v = text(n.s);
      return () => v;
    }
    case 'id':
      return compileId(n.name, env, locals, row);
    case 'un': {
      const a = compile(n.a, env, locals, row);
      return (s) => {
        const v = a(s);
        return typeof v === 'number' ? -v : negate(v);
      };
    }
    case 'bin': {
      if (n.op === '^') {
        const re = rewritePower(n.a, n.b, env, locals);
        if (re) return compile(re, env, locals, row);
        // e^x through Math.exp: Math.pow(Math.E, x) starts from a rounded e, so e^100 lost its 15th digit.
        if (isConstantE(n.a, env, locals)) {
          const b = compile(n.b, env, locals, row);
          return (s) => { const y = b(s); return typeof y === 'number' ? Math.exp(y) : arith('^', Math.E, y); };
        }
      }
      const a = compile(n.a, env, locals, row);
      // a ± b% on the iPhone's terms: a ± (a·b)/100, in that order, so 80 + 15% is exactly 92.
      const pct = n.op === '+' || n.op === '-' ? percentOperand(n.b, env.settings) : null;
      if (pct) {
        const p = compile(pct, env, locals, row);
        const op = n.op as '+' | '-';
        return (s) => {
          const x = a(s), y = p(s);
          env.note(percentNote(op, x, y));
          if (typeof x === 'number' && typeof y === 'number') { const d = (x * y) / 100; return op === '+' ? x + d : x - d; }
          return arith(op, x, arith('/', arith('*', x, y), 100));
        };
      }
      const b = compile(n.b, env, locals, row);
      switch (n.op) {
        case '+': return (s) => { const x = a(s), y = b(s); return typeof x === 'number' && typeof y === 'number' ? x + y : arith('+', x, y); };
        case '-': return (s) => { const x = a(s), y = b(s); return typeof x === 'number' && typeof y === 'number' ? x - y : arith('-', x, y); };
        case '*': return (s) => { const x = a(s), y = b(s); return typeof x === 'number' && typeof y === 'number' ? x * y : arith('*', x, y); };
        case '/': return (s) => { const x = a(s), y = b(s); return typeof x === 'number' && typeof y === 'number' && y !== 0 ? x / y : arith('/', x, y); };
        case '^': return (s) => {
          const x = a(s), y = b(s);
          if (typeof x === 'number' && typeof y === 'number') {
            if (x < 0 && !Number.isInteger(y)) {
              if (oddRootOf(y) !== null) return -Math.pow(-x, y);
              if (env.settings.complex) return arith('^', { t: 'complex', re: x, im: 0 }, y);
            } else if (x !== 0 || y >= 0) {
              // Same as arith: a non-negative base or a whole exponent can't give a non-real result.
              return Math.pow(x, y);
            }
          }
          return arith('^', x, y);
        };
        case 'nCr': return (s) => nCr(num(a(s), 'n'), num(b(s), 'r'));
        case 'nPr': return (s) => nPr(num(a(s), 'n'), num(b(s), 'r'));
      }
      break;
    }
    case 'post': {
      const a = compile(n.a, env, locals, row);
      switch (n.op) {
        case '!': return (s) => mapNum(a(s), factorial, '!');
        case '%': return (s) => mapNum(a(s), (x) => x / 100, '%');
        case '°': return (s) => mapNum(a(s), (x) => (env.settings.deg ? x : (x * Math.PI) / 180), '°');
      }
      break;
    }
    case 'call':
      return compileCall(n, env, locals, row);
    case 'abs': {
      const a = compile(n.a, env, locals, row);
      const abs = BUILTINS.abs.fn!;
      return (s) => { const v = a(s); return typeof v === 'number' ? Math.abs(v) : abs([v], env); };
    }
    case 'point': {
      const items = n.items.map((it) => compile(it, env, locals, row));
      return (s) => point(items.map((f) => num(f(s), 'Point coordinate')));
    }
    case 'vec': {
      const items = n.items.map((it) => compile(it, env, locals, row));
      return (s) => vector(items.map((f) => num(f(s), 'Vector component')));
    }
    case 'list': {
      const items = n.items.map((it) => compile(it, env, locals, row));
      return (s) => list(items.map((f) => f(s)));
    }
    case 'bracket': {
      const items = n.items.map((it) => compile(it, env, locals, row));
      return (s) => bracketValue(items.map((f) => f(s)));
    }
    case 'piece': {
      const br = n.branches.map((b) => ({
        cond: b.cond ? compile(b.cond, env, locals, row) : null,
        val: b.val ? compile(b.val, env, locals, row) : null,
      }));
      return (s) => {
        for (const b of br) {
          if (!b.cond) return b.val!(s);
          if (truthy(b.cond(s))) return b.val ? b.val(s) : 1;
        }
        return NaN;
      };
    }
    case 'rel': {
      const items = n.items.map((it) => compile(it, env, locals, row));
      const ops = n.ops;
      return (s) => {
        let left = items[0](s);
        for (let k = 0; k < ops.length; k++) {
          const right = items[k + 1](s);
          if (!compare(ops[k], left, right)) return 0;
          left = right;
        }
        return 1;
      };
    }
  }
  return fail('Internal error: unknown expression');
}

function bracketValue(items: Value[]): Value {
  switch (bracketKind(items.map((v) => (typeof v === 'number' ? 'number' : v.t)))) {
    case 'empty': return fail('Empty brackets');
    case 'vector': return vector(items as number[]);
    case 'matrix': {
      const rows = (items as { c: number[] }[]).map((v) => v.c);
      const w = rows[0].length;
      if (rows.some((r) => r.length !== w)) fail('Every matrix row needs the same number of entries');
      return matrix(rows);
    }
    case 'points': return list(items);
    case 'mixed': return fail(`Can't put a ${typeName(items.find((v) => typeof v !== 'number')!)} inside [ ]. Use [[1,2],[3,4]] for matrices`);
  }
}
