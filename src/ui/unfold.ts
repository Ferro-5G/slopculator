// Unfold, shared by every front end: a line's working, as steps. Each step is a part of the line with a value of its
// own (b² − 4ac, √(b² − 4ac), 2a), worked out by the engine where the line sits on the sheet, and the steps form the
// line's tree. No DOM here; the platforms draw the steps.
import { BUILTINS } from '../engine/builtins';
import { evaluateParts, lineDefines, parseLineSpanned, type PartResult, type RowInput, type RowResult } from '../engine/document';
import { readError, type ErrorForm } from '../engine/errors';
import { shortError } from './errortext';

export { shortError };
import type { Settings } from '../engine/evaluator';
import { Lru } from '../engine/memo';
import { inParens, type Node, type Spanned } from '../engine/parser';
import type { Precise } from '../engine/precise';
import type { Value } from '../engine/values';
import { formatValue, plainValue, type DisplayOpts } from '../engine/format';
import { namesRead, sheetDefiners, type CanvasRow, type Point, type Rect, type Size } from './canvas';
import { formatChange, tagNumber } from './wiretags';

/** The control that opens and closes a line's steps. */
export const UNFOLD_LABEL = 'Steps';
/** Significant figures a step's number shows; the line itself shows its full answer. */
export const STEP_SIG = 6;
/** What a step shows when a step it reads failed: it has no value, and the failure is told where it happened. */
export const NO_VALUE = '—';

/**
 * ok: it has a value. fails: it is where the line goes wrong (its own operation fails, and nothing it reads did).
 * after: it fails because a step it reads failed.
 */
export type StepStatus = 'ok' | 'fails' | 'after';

export interface UnfoldStep {
  /** Stable for a given line text: the step's path in the line's tree, like "0.1". */
  id: string;
  /** The part as typed, to typeset: "b² − 4ac". */
  text: string;
  /**
   * Where the part sits in the line's text, to mark it in the line while its step is pointed at. Null when the line
   * is rewritten before it's read (LaTeX, "5 mi to km").
   */
  span: readonly [number, number] | null;
  /** 1 for a step the line reads directly, 2 for a step one of those reads, and so on. */
  depth: number;
  /** 0 for a step that reads no steps, else one more than the tallest step it reads: a wide sheet's column. */
  height: number;
  /** The step that reads this one, or null for the line. */
  parent: string | null;
  /** The steps this one reads, in the order they're typed. */
  reads: string[];
  /** The sheet's names it reads, itself or through its steps. */
  names: string[];
  /** The sheet's names it reads itself, not through a step: where a wide sheet's wires for those names come in. */
  inputs: string[];
  value?: Value;
  precise?: Precise;
  /** True when the step is a comparison or logic test (a > 0), whose numeric 1/0 shows as true/false. */
  truth?: boolean;
  /** Its error, read through readError, never by its wording. */
  error?: { text: string; form: ErrorForm };
  status: StepStatus;
}

export interface Unfolded {
  /** Working order: each step after the steps it reads. */
  steps: UnfoldStep[];
  /** Reading order, for a phone's indented tree: each step, then the steps it reads. */
  outline: string[];
  /** The line itself: the steps it reads, its value or error, and its status. */
  line: { reads: string[]; inputs: string[]; value?: Value; precise?: Precise; error?: { text: string; form: ErrorForm }; status: StepStatus };
  /** For each sheet name, the steps that read it, in working order. */
  byName: Map<string, string[]>;
  /** The first step (in working order) where the line goes wrong, or null. */
  failure: string | null;
}

/** What a line is worked out on: the sheet it sits on, and its row. */
export interface UnfoldScope {
  rows: readonly CanvasRow[];
  settings: Settings;
  /** The line's row. */
  id: string;
  /** The sheet's results, for which names the sheet defines; worked out when left out. */
  results?: readonly (RowResult | undefined)[];
}

/** A line read for its steps: its tree with places, and the part that has the line's value. */
interface Shape { read: Spanned; root: Node }
const shapes = new Lru<string, Shape | false>(500);

/**
 * The part of a line that has its value (a definition's right side, or the whole line) in a tree with places, or null
 * when the line has no one value to work out. Memoized by text, so asking whether each line can unfold is cheap.
 */
function lineShape(text: string): Shape | null {
  let hit = shapes.get(text);
  if (hit === undefined) {
    hit = false;
    try {
      const read = parseLineSpanned(text);
      const n = read.tree;
      const lhs = n.k === 'rel' ? n.items[0] : null;
      // r = … works out its right side; truth comparisons (3² + 4² = 5², 2·3 > 5) work out their sides;
      // f(x) = …, y = …, and regressions (~) aren't worked out as one value.
      if (n.k !== 'rel') hit = { read, root: n };
      else if (n.ops.length === 1 && n.ops[0] === '=' && lhs?.k === 'id' && lineDefines(text) === lhs.name) hit = { read, root: n.items[1] };
      else if (!n.ops.includes('~') && !(n.ops.length === 1 && n.ops[0] === '=' && (lhs?.k === 'call' || (lhs?.k === 'id' && (lhs.name === 'x' || lhs.name === 'y'))))) hit = { read, root: n };
    } catch {
      // A line that doesn't parse has no steps.
    }
    shapes.set(text, hit);
  }
  return hit || null;
}

/**
 * A leaf isn't a step: a name, a number, a slider's input, text, and literal data made of those (−3, 5%, 30°,
 * {9.6, 10.4}). So is a part with no place in the text (the fraction ½ stands for).
 */
function isLeaf(n: Node, read: Spanned): boolean {
  switch (n.k) {
    case 'num': case 'str': case 'id': return true;
    case 'un': return !read.spanOf(n) || isLeaf(n.a, read);
    case 'post': return !read.spanOf(n) || (n.op !== '!' && (n.a.k === 'num' || (n.a.k === 'un' && n.a.a.k === 'num')));
    case 'list': case 'point': case 'vec': case 'bracket': return n.items.every((c) => isLeaf(c, read));
    default: return !read.spanOf(n);
  }
}

const family = (op: string): string | null => (op === '+' || op === '-' ? '+' : op === '*' ? '*' : null);

/** Internal call names whose arguments are ordinary value expressions (no bound variable). */
const OPEN_INTERNAL = new Set(['_and', '_or', '_xor', '_item', '_span', '_x', '_y', '_z']);
/** Builtin calls whose argument at `bindIdx` names a local variable bound inside `exprIdx`. */
const BINDER_ARGS: Record<string, { bind: number; expr: number }> = {
  sum: { bind: 1, expr: 0 },
  prod: { bind: 1, expr: 0 },
  integral: { bind: 1, expr: 0 },
  riemann: { bind: 1, expr: 0 },
  deriv: { bind: 1, expr: 0 },
  deriv2: { bind: 1, expr: 0 },
  tangent: { bind: 1, expr: 0 },
  solve: { bind: 1, expr: 0 },
  seq: { bind: 1, expr: 0 },
  _each: { bind: 1, expr: 0 },
};

/** Whether a tree references x or y outside a binder (a curve rather than solve(x^2 = -1, x)). */
function hasFreeGraphVar(n: Node, bound: ReadonlySet<string> = new Set()): boolean {
  switch (n.k) {
    case 'id': return (n.name === 'x' || n.name === 'y') && !bound.has(n.name);
    case 'num': case 'str': return false;
    case 'un': case 'post': case 'abs': return hasFreeGraphVar(n.a, bound);
    case 'bin': return hasFreeGraphVar(n.a, bound) || hasFreeGraphVar(n.b, bound);
    case 'list': case 'point': case 'vec': case 'bracket': case 'rel': return n.items.some((c) => hasFreeGraphVar(c, bound));
    case 'piece': return n.branches.some((b) => (b.cond ? hasFreeGraphVar(b.cond, bound) : false) || (b.val ? hasFreeGraphVar(b.val, bound) : false));
    case 'call': {
      const b = BINDER_ARGS[n.name];
      if (b && n.args[b.bind]?.k === 'id' && (n.name !== 'sum' && n.name !== 'prod' || n.args.length === 4)) {
        const inner = new Set(bound);
        inner.add((n.args[b.bind] as Extract<Node, { k: 'id' }>).name);
        return n.args.some((arg, i) => (i === b.bind ? false : hasFreeGraphVar(arg, i === b.expr ? inner : bound)));
      }
      if (n.name === '_with' && n.args.length >= 2) {
        const inner = new Set(bound);
        for (const a of n.args.slice(1)) if (a.k === 'rel' && a.items[0]?.k === 'id') inner.add(a.items[0].name);
        return hasFreeGraphVar(n.args[0], inner) || n.args.slice(1).some((a) => (a.k === 'rel' && a.items[1] ? hasFreeGraphVar(a.items[1], bound) : false));
      }
      return (n.base ? hasFreeGraphVar(n.base, bound) : false) || n.args.some((a) => hasFreeGraphVar(a, bound));
    }
  }
}

/**
 * The parts a step reads. A chain of + and −, or of ×, is one step (4ac, b² − 4ac + d) unless a part of it was put in
 * its own parentheses. Calls that bind a variable keep their bound body opaque while still exposing ordinary bounds,
 * conditions, or conversion inputs.
 */
function partsOf(n: Node, isDefined: (name: string) => boolean): Node[] {
  switch (n.k) {
    case 'bin': {
      const f = family(n.op);
      const flat = (c: Node): Node[] => (f && c.k === 'bin' && family(c.op) === f && !inParens(c) ? [...flat(c.a), ...flat(c.b)] : [c]);
      return [...flat(n.a), ...flat(n.b)];
    }
    case 'un': case 'post': case 'abs': return [n.a];
    case 'rel': return n.items;
    case 'piece': return n.branches.flatMap((b) => [b.cond, b.val].filter((x): x is Node => !!x));
    case 'call': {
      if (n.name.startsWith('_')) return OPEN_INTERNAL.has(n.name) ? n.args : [];
      if (BUILTINS[n.name]?.lazy && !isDefined(n.name)) {
        if (n.name === 'convert') return n.args.slice(0, 1);
        if (n.name === 'if') return n.args;
        if (n.name === 'sum' || n.name === 'prod') {
          return n.args.length === 4 && n.args[1]?.k === 'id' ? n.args.slice(2) : n.args;
        }
        if (n.name === 'integral' || n.name === 'riemann') return n.args.length >= 4 ? n.args.slice(2, 4) : [];
        if (n.name === 'deriv' || n.name === 'deriv2' || n.name === 'tangent') return n.args.length >= 3 ? n.args.slice(2) : [];
        return [];
      }
      return n.args;
    }
    case 'list': case 'point': case 'vec': case 'bracket': return n.items;
    default: return [];
  }
}

/** Whether a line has steps to show: a value or truth line (or one that fails) with more than one operation. */
export function canUnfold(text: string, result?: RowResult, defined?: ReadonlySet<string>): boolean {
  // A slider, a table, and a line with neither a value, truth nor an error (a curve, a function) have no working to show.
  if (result && (result.slider || result.table || (result.value === undefined && result.truth === undefined && !result.error))) return false;
  const shape = lineShape(text);
  if (!shape || isLeaf(shape.root, shape.read)) return false;
  if (result?.value === undefined && result?.truth === undefined && (result?.graph.length || hasFreeGraphVar(shape.root))) return false;
  const isDef = defined ? (name: string) => defined.has(name) : () => false;
  return partsOf(shape.root, isDef).some((p) => !isLeaf(p, shape.read));
}

const failed = (r: PartResult): r is { error: string } => 'error' in r;

/**
 * A line's steps, worked out where it sits on the sheet (`text` in place of its row's text, so a line being typed can
 * show its steps), or null when it has none (see canUnfold). The line's own top operation isn't a step: its value is
 * the line's, so a quotient has no ÷ step under it.
 */
export function unfoldSteps(text: string, scope: UnfoldScope): Unfolded | null {
  const index = scope.rows.findIndex((r) => r.id === scope.id);
  const shape = index < 0 ? null : lineShape(text);
  if (!shape || isLeaf(shape.root, shape.read)) return null;
  const { root, read } = shape;
  const rows: RowInput[] = scope.rows.map((r) => (r.id === scope.id && r.kind === 'expr' && r.text !== text ? { ...r, text } : r));
  const results = scope.results && scope.rows[index]?.kind === 'expr' && (scope.rows[index] as { text: string }).text === text ? scope.results : undefined;
  const definers = sheetDefiners(rows, results ?? [], { lineNames: scope.settings.lineNames });
  const isDefined = (name: string) => definers.has(name);
  const sameText = read.text === text;

  const steps: (UnfoldStep & { node: Node })[] = [];
  const outline: string[] = [];
  const evalCond = (cond: Node): PartResult => evaluateParts(rows, scope.settings, index, [cond])[0];
  /**
   * The children of `n` that actually execute: for piecewise and lazy `if`, evaluate conditions lazily so untaken
   * branches (like `1/0` in `{1 > 0: 2+3, 1/0}`) are never evaluated or reported as failures.
   */
  const activeParts = (n: Node): Node[] => {
    if (n.k === 'piece') {
      const out: Node[] = [];
      for (const b of n.branches) {
        if (!b.cond) { if (b.val) out.push(b.val); break; }
        out.push(b.cond);
        const r = evalCond(b.cond);
        if (failed(r)) break;
        if (typeof r.value === 'number' && r.value !== 0) { if (b.val) out.push(b.val); break; }
      }
      return out;
    }
    if (n.k === 'call' && n.name === 'if' && !isDefined('if') && n.args.length >= 2) {
      const [cond, yes, no] = n.args;
      const r = evalCond(cond);
      if (failed(r)) return [cond];
      return typeof r.value === 'number' && r.value !== 0 ? [cond, yes] : no ? [cond, no] : [cond];
    }
    return partsOf(n, isDefined);
  };
  /** The names a part reads itself: its leaves', or all of an opaque call's. */
  const inputsOf = (n: Node, parts: readonly Node[]): string[] => {
    if (!parts.length) return namesRead(n, isDefined);
    return [...new Set(parts.filter((p) => isLeaf(p, read)).flatMap((p) => namesRead(p, isDefined)))];
  };
  const walk = (n: Node, id: string, depth: number, parent: string | null): string[] => {
    if (isLeaf(n, read)) return [];
    const span = read.spanOf(n)!;
    const parts = activeParts(n);
    const step = { id, node: n, text: read.text.slice(span[0], span[1]).trim(), span: sameText ? span : null, depth, height: 0, parent, reads: [] as string[], names: namesRead(n, isDefined), inputs: inputsOf(n, parts), status: 'ok' as StepStatus };
    outline.push(id);
    parts.forEach((c, k) => step.reads.push(...walk(c, `${id}.${k}`, depth + 1, id)));
    steps.push(step);
    return [id];
  };
  const rootParts = activeParts(root);
  const reads = rootParts.flatMap((c, k) => walk(c, String(k), 1, null));
  if (!steps.length) return null;

  const worked = evaluateParts(rows, scope.settings, index, [...steps.map((s) => s.node), root]);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const bad = (ids: string[]) => ids.some((id) => byId.get(id)!.status !== 'ok');
  const isTruthNode = (n: Node) => n.k === 'rel' || (n.k === 'call' && (n.name === '_and' || n.name === '_or' || n.name === '_xor'));
  steps.forEach((s, k) => {
    const r = worked[k];
    s.height = s.reads.length ? 1 + Math.max(...s.reads.map((id) => byId.get(id)!.height)) : 0;
    if (failed(r)) {
      s.error = { text: r.error, form: readError(r.error) };
      s.status = bad(s.reads) ? 'after' : 'fails';
    } else {
      s.value = r.value;
      if (r.precise) s.precise = r.precise;
      if (isTruthNode(s.node) && typeof r.value === 'number') s.truth = true;
    }
  });
  const own = worked[steps.length];
  const line: Unfolded['line'] = failed(own)
    ? { reads, inputs: inputsOf(root, rootParts), error: { text: own.error, form: readError(own.error) }, status: bad(reads) ? 'after' : 'fails' }
    : { reads, inputs: inputsOf(root, rootParts), value: own.value, ...(own.precise ? { precise: own.precise } : {}), status: 'ok' };
  const byName = new Map<string, string[]>();
  for (const s of steps) for (const name of s.names) byName.set(name, [...(byName.get(name) ?? []), s.id]);
  return {
    steps: steps.map(({ node: _, ...s }) => s),
    outline,
    line,
    byName,
    failure: steps.find((s) => s.status === 'fails')?.id ?? null,
  };
}

/** The steps a change to any of `names` reaches (a drag's names): the ones to light; the rest stay as they were. */
export function stepsReached(u: Unfolded, names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const name of names) for (const id of u.byName.get(name) ?? []) out.add(id);
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The steps whose value or error differs from before, so a pulse lights only those. Every step, when there's no before. */
export function changedSteps(before: Unfolded | null, after: Unfolded): Set<string> {
  const old = new Map((before?.steps ?? []).map((s) => [s.id, s]));
  const out = new Set<string>();
  for (const s of after.steps) {
    const o = old.get(s.id);
    if (!o || o.text !== s.text || o.error?.text !== s.error?.text || !sameValue(o.value, s.value)) out.add(s.id);
  }
  return out;
}

/**
 * What a step shows for its answer: exact/formatted form when Exact mode, fixed places, full digits, or an overflowed
 * BigInt exact value applies; otherwise a number at STEP_SIG significant figures; another value as the line would show
 * it; the error's short form where the line goes wrong; and NO_VALUE after.
 */
export function stepAnswer(s: UnfoldStep, display: DisplayOpts): string {
  if (s.status === 'after') return NO_VALUE;
  if (s.error) return shortError(s.error.form, s.error.text);
  if (s.truth && typeof s.value === 'number') return s.value ? 'true' : 'false';
  if (typeof s.value === 'number') {
    if ((display.exact && s.precise) || (!Number.isFinite(s.value) && s.precise) || display.places !== null || display.fullDigits) {
      return formatValue(s.value, display, false, s.precise);
    }
    return tagNumber(s.value, STEP_SIG);
  }
  return s.value === undefined ? '' : formatValue(s.value, display, false, s.precise);
}

/** Plain clipboard text for an ok step, shared by web and native front ends; null for failing or empty steps. */
export function stepCopyText(s: UnfoldStep, display: DisplayOpts): string | null {
  if (s.status !== 'ok' || s.value === undefined) return null;
  if (s.truth && typeof s.value === 'number') return s.value ? 'true' : 'false';
  return plainValue(s.value, display, false, s.precise);
}

/**
 * Each step's change since a drag began (`start` is the line's steps then), as itself (+2, −0.7321), with the line's
 * own under the key "line". Steps that didn't change, or aren't numbers, are left out.
 */
export function stepDeltas(start: Unfolded, now: Unfolded): Map<string, string> {
  const out = new Map<string, string>();
  const was = new Map(start.steps.map((s) => [s.id, s.value]));
  const put = (id: string, a: unknown, b: unknown) => {
    const d = typeof a === 'number' && typeof b === 'number' ? formatChange(a, b) : null;
    if (d) out.set(id, d);
  };
  for (const s of now.steps) put(s.id, s.value, was.get(s.id));
  put('line', now.line.value, start.line.value);
  return out;
}

/** A wide sheet's tray of steps: where each step sits in it, the wires between them, and its size. */
export interface TrayLayout {
  size: Size;
  /** Each step's box, in the tray's own coordinates. */
  rects: Map<string, Rect>;
  /** A wire from each step to the step that reads it, as square points (draw with roundedPath). */
  links: { from: string; to: string; points: Point[] }[];
}
export const TRAY = { pad: 22, colGap: 44, rowGap: 14 } as const;

/**
 * Lays a line's steps out in its tray, a sideways tree: a column per height (steps that read no steps on the left,
 * each step right of what it reads), each step level with the middle of what it reads, the line's shortest parts on
 * top. `sizes` is each step's box as drawn.
 */
export function trayLayout(u: Unfolded, sizes: ReadonlyMap<string, Size>, o: { pad: number; colGap: number; rowGap: number } = TRAY): TrayLayout {
  const byId = new Map(u.steps.map((s) => [s.id, s]));
  const size = (id: string): Size => sizes.get(id) ?? { w: 80, h: 40 };
  const tallest = Math.max(0, ...u.steps.map((s) => s.height));
  const colW = Array.from({ length: tallest + 1 }, (_, h) => Math.max(0, ...u.steps.filter((s) => s.height === h).map((s) => size(s.id).w)));
  const colX = colW.map((_, h) => o.pad + colW.slice(0, h).reduce((a, w) => a + w + o.colGap, 0));
  const rowH = Math.max(0, ...u.steps.map((s) => size(s.id).h));
  const slot = rowH + o.rowGap;
  const centre = new Map<string, number>();
  let next = 0;
  const place = (id: string): number => {
    const s = byId.get(id)!;
    const y = s.reads.length ? (() => { const ys = s.reads.map(place); return (ys[0] + ys[ys.length - 1]) / 2; })() : o.pad + next++ * slot + rowH / 2;
    centre.set(id, y);
    return y;
  };
  const top = [...u.line.reads].sort((a, b) => byId.get(a)!.height - byId.get(b)!.height);
  top.forEach(place);
  const rects = new Map<string, Rect>();
  for (const s of u.steps) {
    const sz = size(s.id);
    rects.set(s.id, { x: colX[s.height], y: Math.round(centre.get(s.id)! - sz.h / 2), ...sz });
  }
  const links: TrayLayout['links'] = [];
  for (const s of u.steps) {
    const p = rects.get(s.id)!;
    s.reads.forEach((id, k) => {
      const c = rects.get(id)!;
      const out = { x: c.x + c.w, y: c.y + c.h / 2 }, py = Math.round(p.y + (p.h * (k + 1)) / (s.reads.length + 1)), lx = p.x - o.colGap / 2;
      links.push({ from: id, to: s.id, points: out.y === py ? [out, { x: p.x, y: py }] : [out, { x: lx, y: out.y }, { x: lx, y: py }, { x: p.x, y: py }] });
    });
  }
  const right = Math.max(...[...rects.values()].map((r) => r.x + r.w));
  return { size: { w: right + o.pad, h: o.pad * 2 + next * slot - o.rowGap }, rects, links };
}
