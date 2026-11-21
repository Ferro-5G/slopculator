import { isGraphVar, lettersOf } from '../engine/ast';
import { BUILTINS, CONSTANTS, readsAsValue } from '../engine/builtins';
import type { RowInput, RowResult } from '../engine/document';
import { isHeading, parse, type Node } from '../engine/parser';

export type MathRole =
  /** 2, 0.0825 */
  | 'num'
  /** One-letter names: x, y, μ. Drawn italic. */
  | 'var'
  /** Longer names, line names and constants: price, monthly_payment, ans, π. Upright. */
  | 'name'
  /** Function names: sin, normalcdf. Upright. */
  | 'fn'
  /** Binary operators and relations, with space around them: +, −, ×, =, ≤, nCr. */
  | 'op'
  /** A leading minus, close to what it negates. */
  | 'sign'
  /** Commas between arguments, with space after. */
  | 'punct'
  /** Postfix marks, an unstacked fraction's slash, and text: !, %, °, /, "mi". */
  | 'text';

export type MathBox =
  | { t: 'run'; s: string; role: MathRole }
  | { t: 'sup'; base: MathBox[]; exp: MathBox[] }
  | { t: 'sub'; base: MathBox[]; sub: MathBox[] }
  | { t: 'frac'; num: MathBox[]; den: MathBox[] }
  | { t: 'sqrt'; body: MathBox[]; index?: MathBox[] }
  /** Brackets around a group. tall when it holds a fraction, root or matrix, so they grow to fit. */
  | { t: 'fence'; open: string; close: string; body: MathBox[]; tall: boolean }
  | { t: 'matrix'; rows: MathBox[][][] }
  | { t: 'cases'; rows: { val?: MathBox[]; cond?: MathBox[] }[] };

export interface TypesetOptions {
  /** Stack short fractions. Retro's printer tape keeps them on one line. */
  stack?: boolean;
  /**
   * The names the sheet defines, so a word is set the way the engine reads it: kx with k defined is k times x, two
   * italic letters, while rate, sin and an unknown word stay one name. Without them only x, y and the constants count.
   */
  names?: SheetNames;
  /**
   * A list of more items than this shows its first BLOCK_LIST_HEAD and an ellipsis, so a block holding 24 readings
   * stays the width of its figure. Unset, every item shows.
   */
  listMax?: number;
}

/** A block's line shows a list longer than BLOCK_LIST_MAX as its first BLOCK_LIST_HEAD items and "…". */
export const BLOCK_LIST_MAX = 6;
export const BLOCK_LIST_HEAD = 4;

/** The variables (sliders, table columns, line letters too) and the functions a sheet defines. */
export interface SheetNames { vars: ReadonlySet<string>; funcs: ReadonlySet<string> }
export const NO_NAMES: SheetNames = { vars: new Set(), funcs: new Set() };

/** What a sheet defines, read the way the engine registers definitions. */
export function sheetNames(rows: readonly RowInput[], results: readonly (RowResult | undefined)[] = [], lineNames = false): SheetNames {
  const vars = new Set<string>(), funcs = new Set<string>();
  rows.forEach((row, k) => {
    const r = results[k];
    if (row.kind === 'table') {
      for (const c of row.columns) if (c.header.trim()) vars.add(c.header.trim());
      return;
    }
    if (r?.slider) vars.add(r.slider.name);
    if (lineNames && r?.lineName) vars.add(r.lineName);
    let tree: Node;
    try {
      tree = parse(row.text);
    } catch {
      return;
    }
    if (tree.k !== 'rel' || tree.ops.length !== 1 || tree.ops[0] !== '=') return;
    const lhs = tree.items[0];
    if (lhs.k === 'id' && !isGraphVar(lhs.name) && !lettersOf(lhs.name, isGraphVar)) vars.add(lhs.name);
    else if (lhs.k === 'call' && !lhs.base && !isGraphVar(lhs.name)) funcs.add(lhs.name);
  });
  return { vars, funcs };
}
/** A short key that changes when what a sheet defines does, for caches of typeset lines. */
export const namesKey = (n: SheetNames): string => `${[...n.vars].sort().join(',')}|${[...n.funcs].sort().join(',')}`;

const enum P {
  Rel = 0,
  Add = 1,
  Mul = 2,
  Unary = 3,
  Pow = 4,
  Post = 5,
  Atom = 6,
}

const MINUS = '−';
const REL: Record<string, string> = { '=': '=', '<': '<', '>': '>', '<=': '≤', '>=': '≥', '!=': '≠', '~': '~' };
// Read with Object.hasOwn: a name a line types, like constructor, would otherwise find Object.prototype's.
const CONST: Record<string, string> = { pi: 'π', inf: '∞', infinity: '∞', tau: 'τ', phi: 'φ' };
const STACK_MAX = 12;

function prec(n: Node): P {
  switch (n.k) {
    case 'rel':
      return P.Rel;
    case 'bin':
      if (n.op === '+' || n.op === '-') return P.Add;
      if (n.op === '^') return P.Pow;
      return P.Mul;
    case 'un':
      return P.Unary;
    case 'post':
      return P.Post;
    case 'num':
      // A typed negative never parses as one number, but 1e-3 has a minus in it.
      return P.Atom;
    case 'call':
      // What these are written as has loose ends, so a power or a product next to them needs brackets around them.
      if (n.name === '_with' || n.name === '_and' || n.name === '_or' || n.name === '_xor') return P.Rel;
      return bigOperator(n) || derivativeAlong(n) ? P.Mul : P.Atom;
    default:
      return P.Atom;
  }
}

type Call = Extract<Node, { k: 'call' }>;
const sameName = (a: Node | undefined, b: Node | undefined): boolean => !!a && !!b && a.k === 'id' && b.k === 'id' && a.name === b.name;
/** sum(n^2, n, 1, 10) and its kind: written with the bounds on the sign. */
const bigOperator = (n: Call): string | null =>
  n.args.length === 4 && n.args[1].k === 'id' && !n.base ? ({ sum: 'Σ', Σ: 'Σ', prod: 'Π', Π: 'Π', integral: '∫' } as Record<string, string>)[n.name] ?? null : null;
/** deriv(x^2, x, x), which is what d/dx x^2 means: the derivative along x, at x. */
const derivativeAlong = (n: Call): boolean => n.name === 'deriv' && n.args.length === 3 && sameName(n.args[1], n.args[2]);
/** deriv(f(x), x, 2), which is what f'(2) means. The marks to write after f, or null. */
function primes(n: Call): string | null {
  if ((n.name !== 'deriv' && n.name !== 'deriv2') || n.args.length !== 3) return null;
  const f = n.args[0];
  return f.k === 'call' && !f.base && f.args.length === 1 && sameName(f.args[0], n.args[1]) ? (n.name === 'deriv' ? '′' : '″') : null;
}

const run = (s: string, role: MathRole): MathBox => ({ t: 'run', s, role });

function plainLength(n: Node): number {
  return prettyNode(n).length;
}

function isTall(boxes: MathBox[]): boolean {
  return boxes.some((b) =>
    b.t === 'frac' || b.t === 'sqrt' || b.t === 'matrix' || b.t === 'cases' ? true
    : b.t === 'fence' ? b.tall
    : b.t === 'sup' ? isTall(b.base)
    : false,
  );
}

function fence(open: string, close: string, body: MathBox[]): MathBox {
  return { t: 'fence', open, close, body, tall: isTall(body) };
}

function idBoxes(name: string): MathBox[] {
  if (Object.hasOwn(CONST, name)) return [run(CONST[name], 'name')];
  // x_1 and x1 are both x with a 1 below it.
  const sub = /^(\p{L})_([\p{L}\p{N}]+)$/u.exec(name) ?? /^(\p{L})(\d+)$/u.exec(name);
  if (sub) return [{ t: 'sub', base: [run(sub[1], 'var')], sub: [run(sub[2], /^\d+$/.test(sub[2]) ? 'num' : 'name')] }];
  return [run(name, [...name].length === 1 ? 'var' : 'name')];
}

function numBoxes(n: Extract<Node, { k: 'num' }>): MathBox[] {
  const s = n.s ?? String(n.v);
  const sci = /^([\d.]+)[eE]([+-]?\d+)$/.exec(s);
  if (sci) return [run(sci[1], 'num'), run('×', 'op'), { t: 'sup', base: [run('10', 'num')], exp: [run(sci[2].replace('-', MINUS).replace('+', ''), 'num')] }];
  return [run(s, 'num')];
}

function isLetter(n: Node): boolean {
  return n.k === 'id' && (Object.hasOwn(CONST, n.name) || /^\p{L}(_[\p{L}\p{N}]+|\d+)?$/u.test(n.name));
}

function startsLetterLike(n: Node): boolean {
  switch (n.k) {
    case 'id':
    case 'call':
    case 'abs':
      return true;
    case 'bin':
      return (n.op === '^' || n.op === '*') && startsLetterLike(n.a);
    default:
      return false;
  }
}

function startsLetter(n: Node): boolean {
  if (n.k === 'call') return [...n.name].length === 1;
  if (n.k === 'bin' && (n.op === '^' || n.op === '*')) return startsLetter(n.a);
  return isLetter(n);
}

function endsWithNumber(n: Node): boolean {
  if (n.k === 'un') return endsWithNumber(n.a);
  return n.k === 'num' && !/[eE]/.test(n.s ?? '');
}

function endsWithLetter(n: Node): boolean {
  if (n.k === 'un') return endsWithLetter(n.a);
  if (n.k === 'bin' && n.op === '*') return endsWithLetter(n.b);
  if (n.k === 'bin' && n.op === '^') return endsWithLetter(n.a);
  return isLetter(n);
}

class Setter {
  constructor(
    private stack: boolean,
    private inFrac = false,
    /** Inside a regression, where mx1 is m times x1 whatever else the sheet holds. */
    private fit = false,
    private names: SheetNames = NO_NAMES,
    /** A function definition's own inputs: in f(t) = kt, t counts as defined. */
    private locals: ReadonlySet<string> = new Set(),
    private listMax = Infinity,
  ) {}

  private sub(stack: boolean, inFrac: boolean): Setter {
    return new Setter(stack, inFrac, this.fit, this.names, this.locals, this.listMax);
  }

  /** A list's items, its first few and "…" when it's longer than listMax. */
  private items(items: Node[]): MathBox[] {
    if (items.length <= this.listMax) return this.list(items);
    return [...this.list(items.slice(0, BLOCK_LIST_HEAD)), run(',', 'punct'), run('…', 'text')];
  }

  /** The letters a word reads as, in the engine's order: a name the sheet or the engine knows stays whole. */
  private letters(name: string): string[] | null {
    const { vars, funcs } = this.names;
    if (this.locals.has(name) || vars.has(name) || name === 'ans' || name in CONSTANTS || Object.hasOwn(CONST, name) || readsAsValue(name) || funcs.has(name)) return null;
    return lettersOf(name, (ch) => isGraphVar(ch) || vars.has(ch) || this.locals.has(ch) || ch in CONSTANTS);
  }

  at(n: Node, min: P): MathBox[] {
    const out = this.node(n);
    return prec(n) < min ? [fence('(', ')', out)] : out;
  }

  list(items: Node[]): MathBox[] {
    const out: MathBox[] = [];
    items.forEach((it, i) => {
      if (i) out.push(run(',', 'punct'));
      out.push(...this.node(it));
    });
    return out;
  }

  node(n: Node): MathBox[] {
    switch (n.k) {
      case 'num':
        return numBoxes(n);
      case 'str':
        return [run(`"${n.s}"`, 'text')];
      case 'id': {
        const glued = this.fit ? /^(\p{L}+)(\p{L}\d+)$/u.exec(n.name) : null;
        if (glued) return [...[...glued[1]].map((ch) => run(ch, 'var')), ...idBoxes(glued[2])];
        const split = this.letters(n.name);
        return split ? split.flatMap(idBoxes) : idBoxes(n.name);
      }
      case 'un':
        return [run(MINUS, 'sign'), ...this.at(n.a, P.Unary)];
      case 'post':
        return [...this.at(n.a, P.Post), run(n.op, 'text')];
      case 'abs':
        return [fence('|', '|', this.node(n.a))];
      case 'rel': {
        const head = n.items[0];
        if (n.ops.length === 1 && n.ops[0] === '=' && head.k === 'call' && !head.base && head.args.every((a) => a.k === 'id')) {
          const inner = new Setter(this.stack, this.inFrac, this.fit, this.names, new Set([...this.locals, ...head.args.map((a) => (a as { name: string }).name)]));
          return [...inner.node(head), run('=', 'op'), ...inner.node(n.items[1])];
        }
        const out = this.node(head);
        n.ops.forEach((op, i) => out.push(run(REL[op], 'op'), ...this.node(n.items[i + 1])));
        return out;
      }
      case 'point':
        return [fence('(', ')', this.list(n.items))];
      case 'vec':
        return [fence('⟨', '⟩', this.list(n.items))];
      case 'list':
        return [fence('{', '}', this.items(n.items))];
      case 'bracket':
        if (n.items.length && n.items.every((r) => r.k === 'bracket' && r.items.length > 0)) {
          const width = (n.items[0] as { items: Node[] }).items.length;
          if (n.items.every((r) => (r as { items: Node[] }).items.length === width))
            return [{ t: 'matrix', rows: n.items.map((r) => (r as { items: Node[] }).items.map((c) => this.node(c))) }];
        }
        return [fence('[', ']', this.items(n.items))];
      case 'piece':
        return [{ t: 'cases', rows: n.branches.map((b) => ({ val: b.val && this.node(b.val), cond: b.cond && this.node(b.cond) })) }];
      case 'call':
        return this.call(n);
      case 'bin':
        return this.bin(n);
    }
  }

  private call(n: Extract<Node, { k: 'call' }>): MathBox[] {
    if ((n.name === 'sqrt' || n.name === 'cbrt') && n.args.length === 1)
      return [{ t: 'sqrt', body: this.node(n.args[0]), index: n.name === 'cbrt' ? [run('3', 'num')] : undefined }];
    if ((n.name === 'nthroot' || n.name === 'root') && n.args.length === 2)
      return [{ t: 'sqrt', body: this.node(n.args[0]), index: this.node(n.args[1]) }];
    if (n.name === 'abs' && n.args.length === 1) return [fence('|', '|', this.node(n.args[0]))];
    const written = this.written(n);
    if (written) return written;
    // A word that names no function, before a bracket, is its letters times the bracket, as the engine reads it.
    const split = !n.base && !(n.name in BUILTINS) && !this.names.funcs.has(n.name) ? this.letters(n.name) : null;
    if (split) return [...split.flatMap(idBoxes), fence('(', ')', this.list(n.args))];
    const name: MathBox[] = [run(n.name, [...n.name].length === 1 ? 'var' : 'fn')];
    const head: MathBox[] = n.base ? [{ t: 'sub', base: name, sub: this.node(n.base) }] : name;
    return [...head, fence('(', ')', this.list(n.args))];
  }

  /** The notation a call was typed in, where it has one of its own: Σ with bounds, d/dx, f′(2), L[2], [1, …, 5]. */
  private written(n: Call): MathBox[] | null {
    const a = n.args;
    const word = (s: string): MathBox => run(s, 'op');
    const sign = bigOperator(n);
    if (sign) {
      const v = this.node(a[1]);
      const low = sign === '∫' ? this.node(a[2]) : [...v, run('=', 'text'), ...this.node(a[2])];
      const head: MathBox = { t: 'sup', base: [{ t: 'sub', base: [run(sign, 'fn')], sub: low }], exp: this.sub(false, true).node(a[3]) };
      return sign === '∫' ? [head, ...this.at(a[0], P.Add), run(' d', 'fn'), ...v] : [head, ...this.at(a[0], P.Mul)];
    }
    if (derivativeAlong(n)) {
      const v = this.node(a[1]);
      const d: MathBox[] = this.stack && !this.inFrac ? [{ t: 'frac', num: [run('d', 'fn')], den: [run('d', 'fn'), ...v] }] : [run('d', 'fn'), run('/', 'text'), run('d', 'fn'), ...v, run(' ', 'text')];
      return [...d, ...this.at(a[0], P.Mul)];
    }
    const marks = primes(n);
    if (marks) {
      const f = a[0] as Call;
      // The point is what was typed; inside, f's input is only the name the slope is taken along.
      return [run(f.name, [...f.name].length === 1 ? 'var' : 'fn'), run(marks, 'text'), fence('(', ')', this.node(a[2]))];
    }
    switch (n.name) {
      case '_item':
        return [...this.at(a[0], P.Post), fence('[', ']', this.list(a.slice(1)))];
      case '_span':
        return [fence('[', ']', [...this.list(a.slice(0, -1)), run(',', 'punct'), run('…', 'text'), run(',', 'punct'), ...this.node(a[a.length - 1])])];
      case '_each':
        return [fence('[', ']', [...this.node(a[0]), word('for'), ...this.node(a[1]), run('=', 'op'), ...this.node(a[2])])];
      case '_with':
        return [...this.node(a[0]), word('with'), ...this.node(a[1]), run('=', 'op'), ...this.node(a[2])];
      case '_and': case '_or': case '_xor':
        return [...this.at(a[0], P.Rel), word(n.name.slice(1)), ...this.at(a[1], P.Rel)];
      case '_x': case '_y': case '_z':
        return [...this.at(a[0], P.Post), run(`.${n.name.slice(1)}`, 'text')];
      default:
        // A part read after a dot, as it was typed: A.h, L.mean.
        if (n.dot && a.length === 1) return [...this.at(a[0], P.Post), run('.', 'text'), ...(n.name in BUILTINS || this.names.funcs.has(n.name) ? [run(n.name, 'fn')] : idBoxes(n.name))];
        return null;
    }
  }

  private bin(n: Extract<Node, { k: 'bin' }>): MathBox[] {
    switch (n.op) {
      case '+':
        return [...this.at(n.a, P.Add), run('+', 'op'), ...this.at(n.b, P.Mul)];
      case '-':
        return [...this.at(n.a, P.Add), run(MINUS, 'op'), ...this.at(n.b, P.Mul)];
      case 'nCr':
      case 'nPr':
        return [...this.at(n.a, P.Mul), run(n.op, 'op'), ...this.at(n.b, P.Unary)];
      case '^': {
        if (n.a.k === 'call' && n.a.args.length === 1 && /^(sin|cos|tan|csc|sec|cot)h?$/.test(n.a.name) && n.b.k === 'num') {
          const [head, args] = this.call(n.a);
          return [{ t: 'sup', base: [head], exp: numBoxes(n.b) }, args];
        }
        // The exponent never stacks: a fraction up there is too small to read.
        const exp = this.sub(false, true).node(n.b);
        return [{ t: 'sup', base: this.at(n.a, P.Atom), exp }];
      }
      case '/': {
        if (this.stack && !this.inFrac && plainLength(n.a) <= STACK_MAX && plainLength(n.b) <= STACK_MAX) {
          const inner = this.sub(this.stack, true);
          return [{ t: 'frac', num: inner.node(n.a), den: inner.node(n.b) }];
        }
        return [...this.at(n.a, P.Mul), run('/', 'text'), ...this.at(n.b, P.Unary)];
      }
      case '*': {
        const a = this.at(n.a, P.Mul);
        const b = this.at(n.b, n.b.k === 'un' ? P.Atom : P.Unary);
        // A longer name keeps its times sign, or price(1 + tax) would read as a function call.
        const aNum = endsWithNumber(n.a) || (a.length === 1 && a[0].t === 'frac');
        const aLetter = endsWithLetter(n.a);
        const aParen = prec(n.a) < P.Mul;
        const bParen = prec(n.b) < P.Unary && n.b.k !== 'un';
        if ((aNum && startsLetterLike(n.b)) || (aLetter && startsLetter(n.b)) || (bParen && (aNum || aLetter || aParen))) return [...a, ...b];
        return [...a, run('×', 'op'), ...b];
      }
    }
  }
}

/** How many boxes deep a list goes, which is how deeply a page nests elements to draw it. */
function nesting(list: MathBox[]): number {
  let deepest = 0;
  for (const b of list) {
    const inner = b.t === 'run' ? []
      : b.t === 'sup' ? [b.base, b.exp]
      : b.t === 'sub' ? [b.base, b.sub]
      : b.t === 'frac' ? [b.num, b.den]
      : b.t === 'sqrt' ? [b.body, b.index ?? []]
      : b.t === 'fence' ? [b.body]
      : b.t === 'matrix' ? b.rows.flat()
      : b.rows.flatMap((r) => [r.val ?? [], r.cond ?? []]);
    for (const l of inner) deepest = Math.max(deepest, 1 + nesting(l));
  }
  return deepest;
}
/** Chrome's layout crashed the tab at about 300 nested roots, which a link can supply; past this the line stays text. */
const NESTING_MAX = 100;

export function typeset(src: string, opts: TypesetOptions = {}): MathBox[] | null {
  const text = src.trim();
  if (!text || isHeading(text)) return null;
  let tree: Node;
  try {
    tree = parse(text);
  } catch {
    return null;
  }
  const boxes = new Setter(opts.stack ?? true, false, tree.k === 'rel' && tree.ops.includes('~'), opts.names, new Set(), opts.listMax ?? Infinity).node(tree);
  return nesting(boxes) > NESTING_MAX ? null : boxes;
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', [MINUS]: '⁻', '-': '⁻', '+': '⁺', n: 'ⁿ', x: 'ˣ', i: 'ⁱ' };
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };

function prettyBoxes(boxes: MathBox[]): string {
  let out = '';
  for (const b of boxes) {
    switch (b.t) {
      case 'run':
        out += b.role === 'op' ? ` ${b.s} ` : b.role === 'punct' ? `${b.s} ` : b.s;
        break;
      case 'sup': {
        const exp = prettyBoxes(b.exp);
        const raised = [...exp].every((c) => SUP[c]) ? [...exp].map((c) => SUP[c]).join('') : null;
        out += prettyBoxes(b.base) + (raised ?? `^${exp.length > 1 ? `(${exp})` : exp}`);
        break;
      }
      case 'sub': {
        const sub = prettyBoxes(b.sub);
        const low = [...sub].every((c) => SUB[c]) ? [...sub].map((c) => SUB[c]).join('') : null;
        out += prettyBoxes(b.base) + (low ?? ([...sub].length > 1 && /[^\p{L}\p{N}]/u.test(sub) ? `_(${sub})` : `_${sub}`));
        break;
      }
      case 'frac': {
        const wrap = (s: string, bs: MathBox[]) => (bs.length === 1 && bs[0].t !== 'frac' ? s : `(${s})`);
        out += `${wrap(prettyBoxes(b.num), b.num)}/${wrap(prettyBoxes(b.den), b.den)}`;
        break;
      }
      case 'sqrt': {
        const body = prettyBoxes(b.body);
        const idx = b.index ? prettyBoxes(b.index) : '';
        const head = idx === '3' ? '∛' : idx === '4' ? '∜' : idx ? `${[...idx].map((c) => SUP[c] ?? c).join('')}√` : '√';
        out += head + (b.body.length === 1 && b.body[0].t === 'run' ? body : `(${body})`);
        break;
      }
      case 'fence':
        out += b.open + prettyBoxes(b.body) + b.close;
        break;
      case 'matrix':
        out += `[${b.rows.map((r) => `[${r.map(prettyBoxes).join(', ')}]`).join(', ')}]`;
        break;
      case 'cases':
        out += `{${b.rows.map((r) => (r.cond ? `${prettyBoxes(r.cond)}: ` : '') + (r.val ? prettyBoxes(r.val) : '')).join(', ')}}`;
        break;
    }
  }
  return out;
}

function prettyNode(n: Node): string {
  return prettyBoxes(new Setter(false, true).node(n));
}

export function prettyText(src: string): string {
  const boxes = typeset(src, { stack: false });
  return boxes ? prettyBoxes(boxes) : src.trim();
}

export function assignsLiteral(src: string): boolean {
  let tree: Node;
  try {
    tree = parse(src.trim());
  } catch {
    return false;
  }
  if (tree.k !== 'rel' || tree.ops.length !== 1 || tree.ops[0] !== '=' || tree.items[0].k !== 'id') return false;
  const v = tree.items[1];
  return v.k === 'num' || (v.k === 'un' && v.a.k === 'num');
}
