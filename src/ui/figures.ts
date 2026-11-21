// Figure blocks, shared by every front end: a line that is unit circle(θ), tangent(f, p), riemann(f, a, b, n),
// normalcdf(a, b, μ, σ) or a 2×2 matrix draws its own picture in its block. This decides which lines do (figureKind),
// reads their math from the engine where the line sits (figureData), describes each picture as marks a platform draws
// as they are (figureScene: panes, grid, axes, ticks, curves, fills, guides, labels and handles, in draw order), and
// turns a handle's drag or a key press into the line or slider it rewrites (dragHandle, nudgeHandle). No DOM here; the
// platforms draw the marks.
import { evaluateFigureParts, lineDefines, parseLineSpanned, type RowInput, type RowResult } from '../engine/document';
import type { Settings } from '../engine/evaluator';
import { normPdf } from '../engine/numeric';
import type { Node, Spanned } from '../engine/parser';
import type { Value } from '../engine/values';
import { listSummary, riemannRule, type ListSummary, type RiemannRule } from '../engine/builtins';
import { namesIn } from '../engine/ast';
import { superscript } from '../engine/lexer';
import type { CanvasRow, Point, Rect, Size } from './canvas';
import { CURVES } from './document';
import { wholeAwareRange, type SliderRange } from './slider';
import { niceStep, tickValues } from './ticks';
import { tagNumber } from './wiretags';
import { fitParams, isFitLine, listNumbers, R2_PORT, STATS_MIN } from './ports';

export type { RiemannRule };
export type FigureKind = 'unit-circle' | 'tangent' | 'riemann' | 'normal' | 'matrix' | 'stats' | 'pairs';

/**
 * How a handle's drag writes back to a value the figure reads: a number typed in the line (rewritten in place), a
 * slider the line reads by name (moved), or anything else (the handle shows but doesn't drag).
 */
export type ArgRef =
  | { k: 'text'; span: readonly [number, number] }
  | { k: 'slider'; id: string; name: string; range: SliderRange }
  | { k: 'fixed' };

export interface UnitCircleData { kind: 'unit-circle'; text: string; deg: boolean; theta: number; cos: number; sin: number; arg: ArgRef }
export interface TangentData {
  kind: 'tangent'; text: string; name: string; f: (x: number) => number; df: (x: number) => number;
  /** f's curve color on the sheet (its line's stripe, the main graph), or null for a built-in like sin. */
  curve: number | null;
  p: number; y: number; slope: number; intercept: number; equation: string; arg: ArgRef;
}
export interface RiemannData {
  kind: 'riemann'; text: string; name: string; f: (x: number) => number; a: number; b: number; n: number; rule: RiemannRule;
  /** f's curve color on the sheet, or null for a built-in. */
  curve: number | null;
  sum: number; integral: number | null;
  /** Where the rule is typed (its fifth input), or where one goes: right after the fourth input. */
  ruleSpan: readonly [number, number] | null; ruleAt: number | null;
}
export interface NormalData { kind: 'normal'; text: string; lo: number; hi: number; mu: number; sigma: number; area: number; args: [ArgRef, ArgRef] }
export interface MatrixData { kind: 'matrix'; text: string; m: [number, number, number, number]; det: number; cells: ArgRef[] }
/** A list of numbers: its histogram and box plot, from the engine's summary of it (mean, s, median, quartiles). */
export interface StatsData { kind: 'stats'; text: string; xs: number[]; sum: ListSummary }
/** A fit's parameter, as its readout shows it: slope and intercept for a line, else the unknown's own name. */
export interface FitParam { port: string; label: string; value: number }
/**
 * Paired data: a regression line (y1 ~ m x1 + b), linreg(xs, ys), or a list of points. Its points, the fitted curve,
 * and a straight fit's slope and intercept, from the engine.
 */
export interface PairsData {
  kind: 'pairs'; text: string; source: 'fit' | 'linreg' | 'points';
  pts: [number, number][]; curve: ((x: number) => number) | null;
  /** A straight fit's slope and intercept, or null for a curve. */
  line: { slope: number; intercept: number } | null;
  params: FitParam[]; r2: number | null;
}
export type FigureData = UnitCircleData | TangentData | RiemannData | NormalData | MatrixData | StatsData | PairsData;

/** What a figure is drawn on: the sheet, its results and settings, and the line's row. */
export interface FigureScope {
  rows: readonly CanvasRow[];
  results: readonly (RowResult | undefined)[];
  settings: Settings;
  id: string;
}

// ---------- which lines draw ----------

interface Shape { read: Spanned; root: Node; same: boolean }
function shapeOf(text: string): Shape | null {
  try {
    const read = parseLineSpanned(text);
    const n = read.tree;
    let root: Node | null = null;
    if (n.k !== 'rel') root = n;
    else if (n.ops.length === 1 && n.ops[0] === '=' && n.items[0].k === 'id' && lineDefines(text) === n.items[0].name) root = n.items[1];
    return root && { read, root, same: read.text === text };
  } catch {
    return null;
  }
}

const isMatrix2 = (v: Value | undefined): v is { t: 'matrix'; m: number[][] } =>
  typeof v === 'object' && v.t === 'matrix' && v.m.length === 2 && v.m.every((r) => r.length === 2 && r.every(Number.isFinite));

const CALLS: Record<string, { kind: FigureKind; args: number[] }> = {
  unitcircle: { kind: 'unit-circle', args: [1] },
  tangent: { kind: 'tangent', args: [2] },
  riemann: { kind: 'riemann', args: [4, 5] },
  normalcdf: { kind: 'normal', args: [2, 4] },
};

/**
 * The figure a line draws, from the line itself: its value is one of the figure calls (unit circle(θ), tangent(f, p),
 * riemann(f, a, b, n), normalcdf(a, b) or normalcdf(a, b, μ, σ)), maybe named (P = normalcdf(…)), or a 2×2 matrix.
 * A line that fails, a slider and a table draw none.
 */
export function figureKind(text: string, result?: RowResult, paired = false): FigureKind | null {
  if (result && (result.error || result.slider || result.table || result.value === undefined)) return null;
  // A regression, and a list of numbers or of points, are known by their value.
  if (result && isFitLine(text)) return typeof result.value === 'object' && result.value.t === 'record' ? 'pairs' : null;
  const shape = shapeOf(text);
  if (!shape) return null;
  const { root } = shape;
  if (root.k === 'call' && !root.base && root.name === 'linreg' && root.args.length === 2) return 'pairs';
  if (result) {
    const xs = listNumbers(result.value);
    if (xs && xs.length >= STATS_MIN && !paired) return 'stats';
    if (pointPairs(result.value).length >= 3) return 'pairs';
  }
  if (root.k === 'call' && !root.base) {
    const c = CALLS[root.name];
    if (c && c.args.includes(root.args.length)) return c.kind;
  }
  if (result ? isMatrix2(result.value) : root.k === 'bracket' && root.items.length === 2 && root.items.every((r) => r.k === 'bracket' && r.items.length === 2)) return 'matrix';
  return null;
}

/**
 * The rows whose lists a fit or linreg on the sheet reads as its data: they show as plain values, since the fit's
 * scatter shows them (a histogram of each would only repeat it). Pass `figureKind` a row's membership as `paired`.
 */
export function pairedRows(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[]): Set<string> {
  const definer = new Map<string, string>();
  rows.forEach((r, k) => { const name = results[k]?.defines ?? (r.kind === 'expr' ? lineDefines(r.text) : null); if (name && !definer.has(name)) definer.set(name, r.id); });
  const out = new Set<string>();
  rows.forEach((r, k) => {
    if (r.kind !== 'expr' || results[k]?.error) return;
    let n: Node;
    try { n = parseLineSpanned(r.text).tree; } catch { return; }
    const fit = n.k === 'rel' && n.ops.includes('~');
    const root = n.k === 'rel' && n.ops.length === 1 && n.ops[0] === '=' && lineDefines(r.text) ? n.items[1] : n;
    const reg = root.k === 'call' && root.name === 'linreg' && root.args.length === 2;
    if (!fit && !reg) return;
    for (const name of namesIn(reg ? root : n)) { const id = definer.get(name); if (id && id !== r.id) out.add(id); }
  });
  return out;
}

/** A list of 2D points as pairs, or none. */
function pointPairs(v: Value | undefined): [number, number][] {
  if (typeof v !== 'object' || v.t !== 'list' || !v.items.length) return [];
  const out: [number, number][] = [];
  for (const p of v.items) {
    if (typeof p !== 'object' || p.t !== 'point' || p.c.length !== 2 || !p.c.every(Number.isFinite)) return [];
    out.push([p.c[0], p.c[1]]);
  }
  return out;
}

// ---------- the math, from the engine ----------

const id = (name: string): Node => ({ k: 'id', name, pos: 0 });
const call = (name: string, ...args: Node[]): Node => ({ k: 'call', name, args, pos: 0 });
const numOf = (r: { value?: Value } | { error: string } | undefined): number | null => (r && 'value' in r && typeof r.value === 'number' ? r.value : null);

/** A typed number (2, −2.5) as itself. */
const isLiteral = (n: Node): boolean => n.k === 'num' || (n.k === 'un' && n.a.k === 'num');

function argRef(n: Node | undefined, shape: Shape, scope: FigureScope): ArgRef {
  if (!n) return { k: 'fixed' };
  if (isLiteral(n)) {
    const span = shape.same ? shape.read.spanOf(n) : undefined;
    if (!span) return { k: 'fixed' };
    // A span runs to the next token, so it can end in spaces; the number is what's before them.
    const typed = shape.read.text.slice(span[0], span[1]);
    return { k: 'text', span: [span[0], span[0] + typed.trimEnd().length] };
  }
  if (n.k === 'id') {
    const k = scope.rows.findIndex((r, i) => scope.results[i]?.slider?.name === n.name && r.kind === 'expr');
    const r = scope.results[k], row = scope.rows[k];
    if (r?.slider && row?.kind === 'expr') return { k: 'slider', id: row.id, name: n.name, range: wholeAwareRange(r.slider.value, row.slider) };
  }
  return { k: 'fixed' };
}

/**
 * A line that is one call, maybe named (A = psych(Tdb, 50)): the call's name, its inputs, and how a drag writes each
 * back (a number typed in the line, or a slider it reads). Null for any other line.
 */
export function callRefs(text: string, scope: FigureScope): { name: string; args: Node[]; refs: ArgRef[] } | null {
  const shape = shapeOf(text);
  if (!shape || shape.root.k !== 'call' || shape.root.base) return null;
  return { name: shape.root.name, args: shape.root.args, refs: shape.root.args.map((a) => argRef(a, shape, scope)) };
}

/** How many curve colors a sheet cycles through: a row's color is its curve color modulo this. */
export const CURVE_COLORS = CURVES;

/**
 * The curve color of the line that defines function `name` (f for f(x) = …), as the sheet draws it everywhere else:
 * its stripe and its curve on the main graph. Null for a function no line defines (a built-in like sin).
 */
export function curveOf(scope: Pick<FigureScope, 'rows' | 'results'>, name: string): number | null {
  const k = scope.results.findIndex((r) => r?.defines === name);
  const row = scope.rows[k] as (CanvasRow & { color?: number }) | undefined;
  if (k < 0 || !row) return null;
  return (Number.isInteger(row.color) ? row.color! : k) % CURVE_COLORS;
}

/**
 * A line's figure, worked out by the engine where the line sits on the sheet: every value it draws (θ with cos θ and
 * sin θ, f and f′ to sample, the strips' sum and the integral, the bounds, μ and σ, the matrix and its determinant)
 * and how each handle writes back (ArgRef). Null when the line draws none (figureKind) or its parts fail.
 */
export function figureData(scope: FigureScope): FigureData | null {
  const index = scope.rows.findIndex((r) => r.id === scope.id);
  const row = scope.rows[index], result = scope.results[index];
  if (!row || row.kind !== 'expr') return null;
  const text = row.text;
  const kind = figureKind(text, result);
  const shape = kind && shapeOf(text);
  if (kind === 'pairs' && result) return pairsData(text, shape || null, result, scope, index);
  if (!kind || !shape || !result) return null;
  const rows = scope.rows as RowInput[];
  const { root } = shape;
  const args = root.k === 'call' ? root.args : [];
  const ref = (n: Node | undefined) => argRef(n, shape, scope);
  switch (kind) {
    case 'unit-circle': {
      const { parts } = evaluateFigureParts(rows, scope.settings, index, [args[0], call('cos', args[0]), call('sin', args[0])], []);
      const [theta, cos, sin] = parts.map(numOf);
      if (theta === null || cos === null || sin === null) return null;
      return { kind, text, deg: !!scope.settings.deg, theta, cos, sin, arg: ref(args[0]) };
    }
    case 'tangent': {
      const v = result.value;
      if (args[0].k !== 'id' || typeof v !== 'object' || v.t !== 'record' || v.rows.length < 3) return null;
      const name = args[0].name;
      const { fns } = evaluateFigureParts(rows, scope.settings, index, [], [{ name }, { name, slope: true }]);
      const [slope, pt, intercept] = v.rows.map((r) => r.value);
      if (!fns[0] || !fns[1] || typeof slope !== 'number' || typeof intercept !== 'number' || typeof pt !== 'object' || pt.t !== 'point') return null;
      return { kind, text, name, f: fns[0], df: fns[1], curve: curveOf(scope, name), p: pt.c[0], y: pt.c[1], slope, intercept, equation: v.title, arg: ref(args[1]) };
    }
    case 'riemann': {
      if (args[0].k !== 'id' || typeof result.value !== 'number') return null;
      const name = args[0].name;
      // The rule is worked out like the other inputs, so a name or expression holding "left" draws what the sum used.
      const { parts, fns } = evaluateFigureParts(rows, scope.settings, index, [args[1], args[2], args[3], call('integral', call(name, id('x')), id('x'), args[1], args[2]), ...(args[4] ? [args[4]] : [])], [{ name }]);
      const [a, b, n, integral] = parts.slice(0, 4).map(numOf);
      if (a === null || b === null || n === null || !fns[0]) return null;
      const how = parts[4] && 'value' in parts[4] ? parts[4].value : null;
      const rule = how && typeof how === 'object' && how.t === 'text' ? riemannRule(how.s) ?? 'mid' : 'mid';
      const span4 = shape.same ? shape.read.spanOf(args[4] ?? args[3]) : undefined;
      const typed = span4 ? shape.read.text.slice(span4[0], span4[1]).trimEnd() : '';
      return {
        kind, text, name, f: fns[0], curve: curveOf(scope, name), a, b, n, rule, sum: result.value, integral,
        ruleSpan: args[4] && span4 ? [span4[0], span4[0] + typed.length] : null,
        ruleAt: !args[4] && span4 ? span4[0] + typed.length : null,
      };
    }
    case 'normal': {
      if (typeof result.value !== 'number') return null;
      const { parts } = evaluateFigureParts(rows, scope.settings, index, args, []);
      const [lo, hi, mu = 0, sigma = 1] = parts.map(numOf);
      if (lo === null || hi === null || mu === null || sigma === null || !(sigma > 0)) return null;
      return { kind, text, lo, hi, mu, sigma, area: result.value, args: [ref(args[0]), ref(args[1])] };
    }
    case 'stats': {
      const xs = listNumbers(result.value);
      return xs ? { kind, text, xs, sum: listSummary(xs) } : null;
    }
    case 'pairs': return null;
    case 'matrix': {
      if (!isMatrix2(result.value)) return null;
      const [[a, b], [c, d]] = result.value.m;
      const { parts } = evaluateFigureParts(rows, scope.settings, index, [call('det', root)], []);
      const det = numOf(parts[0]) ?? a * d - b * c;
      const literal = root.k === 'bracket' && root.items.length === 2 && root.items.every((r) => r.k === 'bracket' && r.items.length === 2);
      const cells = literal ? root.items.flatMap((r) => (r as { items: Node[] }).items).map(ref) : [0, 1, 2, 3].map((): ArgRef => ({ k: 'fixed' }));
      return { kind, text, m: [a, b, c, d], det, cells };
    }
  }
}

const num = (v: number): Node => (v < 0 ? { k: 'un', op: '-', a: { k: 'num', v: -v } } as Node : { k: 'num', v });
const bracketOf = (xs: readonly number[]): Node => ({ k: 'bracket', items: xs.map(num) } as Node);

/** A straight fit's slope and intercept, when its curve is a line over the data (else null). */
function lineOf(f: (x: number) => number, xs: readonly number[]): { slope: number; intercept: number } | null {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (!(hi > lo)) return null;
  const a = f(lo), b = f(hi), m = f((lo + hi) / 2);
  if (![a, b, m].every(Number.isFinite)) return null;
  const slope = (b - a) / (hi - lo);
  if (Math.abs(m - (a + b) / 2) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) return null;
  return { slope, intercept: a - slope * lo };
}

/** Paired data's points and fit, from the engine where the line sits. */
function pairsData(text: string, shape: Shape | null, result: RowResult, scope: FigureScope, index: number): PairsData | null {
  const rows = scope.rows as RowInput[];
  const v = result.value;
  const lists = (parts: { value?: Value }[]) => parts.map((p) => listNumbers('value' in p ? p.value : undefined));
  const rec = typeof v === 'object' && v.t === 'record' ? v : null;
  const r2Of = () => { const x = rec?.rows.find((r) => r.key === R2_PORT || r.key === 'r2')?.value; return typeof x === 'number' ? x : null; };
  if (rec && isFitLine(text)) {
    let tree: Node;
    try { tree = parseLineSpanned(text).tree; } catch { return null; }
    if (tree.k !== 'rel' || tree.items.length !== 2) return null;
    const params = fitParams(rec);
    const cands = namesIn(tree.items[1]).filter((n) => !params.includes(n));
    const { parts } = evaluateFigureParts(rows, scope.settings, index, [tree.items[0], ...cands.map(id)], []);
    const [ys, ...rest] = lists(parts as { value?: Value }[]);
    const xs = rest.find((l) => l && ys && l.length === ys.length);
    if (!ys || !xs) return null;
    const fx = result.graph.find((g) => g.type === 'fx');
    const curve = fx && fx.type === 'fx' ? fx.f : null;
    const line = curve ? lineOf(curve, xs) : null;
    const value = (p: string) => { const x = rec.rows.find((r) => r.label === p)?.value; return typeof x === 'number' ? x : NaN; };
    // A line's two unknowns read as its slope and intercept, whichever names they go by.
    let fp: FitParam[] = params.map((p) => ({ port: p, label: p, value: value(p) }));
    if (line && params.length === 2) {
      const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      const sp = params.find((p) => near(value(p), line.slope)), ip = params.find((p) => p !== sp && near(value(p), line.intercept));
      if (sp && ip) fp = [{ port: sp, label: 'slope', value: value(sp) }, { port: ip, label: 'intercept', value: value(ip) }];
    }
    return { kind: 'pairs', text, source: 'fit', pts: xs.map((x, k) => [x, ys[k]]), curve, line, params: fp, r2: r2Of() };
  }
  if (rec && shape?.root.k === 'call' && shape.root.name === 'linreg') {
    const { parts } = evaluateFigureParts(rows, scope.settings, index, shape.root.args, []);
    const [xs, ys] = lists(parts as { value?: Value }[]);
    if (!xs || !ys || xs.length !== ys.length) return null;
    const a = rec.rows.find((r) => r.label === 'a')?.value, b = rec.rows.find((r) => r.label === 'b')?.value;
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return {
      kind: 'pairs', text, source: 'linreg', pts: xs.map((x, k) => [x, ys[k]]), curve: (x) => a * x + b, line: { slope: a, intercept: b },
      params: [{ port: 'a', label: 'slope', value: a }, { port: 'b', label: 'intercept', value: b }], r2: r2Of(),
    };
  }
  const pts = pointPairs(v);
  if (pts.length < 3) return null;
  // A list of points: its least-squares line, as linreg works it out.
  const { parts } = evaluateFigureParts(rows, scope.settings, index, [call('linreg', bracketOf(pts.map((p) => p[0])), bracketOf(pts.map((p) => p[1])))], []);
  const fit = 'value' in parts[0] ? parts[0].value : undefined;
  const row = (l: string) => { const x = typeof fit === 'object' && fit.t === 'record' ? fit.rows.find((r) => r.label === l)?.value : undefined; return typeof x === 'number' ? x : null; };
  const a = row('a'), b = row('b'), r2 = row('r²');
  const line = a !== null && b !== null ? { slope: a, intercept: b } : null;
  return {
    kind: 'pairs', text, source: 'points', pts, curve: line ? (x) => line.slope * x + line.intercept : null, line,
    params: line ? [{ port: '', label: 'slope', value: line.slope }, { port: '', label: 'intercept', value: line.intercept }] : [], r2,
  };
}

/**
 * Whether a figure says what its line's answer would (the unit circle, the tangent, a typed matrix), so the answer
 * gives way to it. A number answer (an area, a sum) stays over its figure.
 */
export function figureQuiet(data: FigureData): boolean {
  return data.kind === 'unit-circle' || data.kind === 'tangent' || data.kind === 'stats' || data.kind === 'pairs' || (data.kind === 'matrix' && data.cells.some((c) => c.k !== 'fixed'));
}

/** What a screen reader hears for a figure: what it shows, in a few words. */
export function figureLabel(d: FigureData): string {
  switch (d.kind) {
    case 'unit-circle': return `Unit circle at ${d.theta}${d.deg ? '°' : ''}: cos ${d.cos.toPrecision(3)}, sin ${d.sin.toPrecision(3)}`;
    case 'tangent': return `${d.name} with its tangent at x = ${d.p}: ${d.equation}`;
    case 'riemann': return `${d.n} strips under ${d.name} from ${d.a} to ${d.b}`;
    case 'normal': return `Normal curve, μ ${d.mu}, σ ${d.sigma}, shaded from ${d.lo} to ${d.hi}`;
    case 'matrix': return `The plane carried through the matrix, determinant ${d.det.toPrecision(4)}`;
    case 'stats': return `Histogram and box plot of ${d.sum.n} values, mean ${tagNumber(d.sum.mean)}${d.sum.s === null ? '' : `, s ${tagNumber(d.sum.s)}`}`;
    case 'pairs': return `${d.pts.length} points${d.line ? ` with the line y = ${tagNumber(d.line.slope)}x + ${tagNumber(d.line.intercept)}` : d.curve ? ' with the fitted curve' : ''}`;
  }
}

// ---------- sizes ----------

/** A figure's drawing on a wide canvas. The block round it adds its line, its answer and its padding. */
export const FIGURE_SIZE: Record<FigureKind, Size> = {
  'unit-circle': { w: 540, h: 224 },
  tangent: { w: 440, h: 330 },
  riemann: { w: 460, h: 260 },
  normal: { w: 460, h: 214 },
  matrix: { w: 280, h: 280 },
  stats: { w: 296, h: 214 },
  pairs: { w: 272, h: 214 },
};
/** The gap between the unit circle and its waves, in one row at every width. */
export const PANE_GAP = 10;

/**
 * A figure's drawing: on a wide canvas its own size, and in a phone's column (or a narrow window) the column's
 * `width`, with a height that keeps its shape readable. The unit circle keeps its circle and waves side by side.
 */
export function figureSize(kind: FigureKind, width?: number): Size {
  if (width === undefined) return FIGURE_SIZE[kind];
  const w = Math.max(200, Math.round(width));
  const clamp = (h: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, h)));
  switch (kind) {
    case 'unit-circle': return { w, h: clamp((w - PANE_GAP) * 0.48, 140, 248) };
    case 'tangent': return { w, h: clamp(w * 0.86, 260, 380) };
    case 'riemann': return { w, h: clamp(w * 0.6, 190, 290) };
    case 'normal': return { w, h: clamp(w * 0.56, 190, 230) };
    case 'matrix': return { w, h: clamp(w, 220, 320) };
    case 'stats': return { w, h: clamp(w * 0.52, 180, 250) };
    case 'pairs': return { w, h: clamp(w * 0.62, 200, 300) };
  }
}

// ---------- marks ----------

/** The palette a platform maps marks to (dark first): grid lines, axes, ticks, ink, and the figure colors. */
export type FigTone = 'grid' | 'grid2' | 'axis' | 'tick' | 'ink' | 'ink2' | 'muted' | 'accent' | 'coral' | 'teal' | 'amber' | 'violet' | CurveTone;
/**
 * A sheet's curve color by index (c0 is the first, the theme's --curve-1): a function a figure draws wears its own
 * line's color, so the same function never shows in two colors.
 */
export type CurveTone = 'c0' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7';
export const curveTone = (i: number): CurveTone => `c${((i % CURVE_COLORS) + CURVE_COLORS) % CURVE_COLORS}` as CurveTone;
/** The theme's amber and violet are its curves 2 and 3: a mark that isn't f picks the one f isn't. */
const otherThan = (curve: number | null): FigTone => (curve === 2 ? 'violet' : 'amber');

/** Every mark belongs to a pane (clipped to it), or to none (-1). */
export type FigMark =
  | { t: 'line'; pane: number; x1: number; y1: number; x2: number; y2: number; tone: FigTone; w: number; dash?: readonly number[]; op?: number }
  /** An SVG path in the figure's own pixels: a curve, a fill, an arc, an arrowhead. */
  | { t: 'path'; pane: number; d: string; stroke?: FigTone; w?: number; fill?: FigTone; fillOp?: number; dash?: readonly number[]; op?: number }
  /** `plate`: a patch of the pane's color behind it, so it reads over lines. `math`: set in the math face, italic. */
  | { t: 'text'; pane: number; x: number; y: number; s: string; tone: FigTone; size: number; weight: number; anchor: 'start' | 'middle' | 'end'; base: 'top' | 'middle' | 'bottom'; math?: boolean; plate?: boolean }
  | { t: 'dot'; pane: number; x: number; y: number; r: number; tone: FigTone };

/** A point to drag: the circle's point, the tangent point, a bound, a basis vector's tip. */
export interface FigHandle {
  id: string;
  x: number;
  y: number;
  tone: FigTone;
  /** False when what it would move is neither typed in the line nor a slider: it shows, and doesn't drag. */
  draggable: boolean;
  /** How it moves: round the circle, along x, or anywhere. */
  axis: 'angle' | 'x' | 'xy';
  /** For screen readers: what it is, and its value. */
  label: string;
  value: string;
}

/** A readout under a figure: Riemann's sum and the integral it approaches. */
export interface FigReadout { id: string; label: string; value: string }

/** Each figure's view: what its panes show, kept while a handle is held so nothing moves under the pointer. */
export type FigureView =
  | { kind: 'unit-circle' }
  | { kind: 'tangent'; x0: number; x1: number; y0: number; y1: number; d0: number; d1: number }
  | { kind: 'riemann'; x0: number; x1: number; y0: number; y1: number }
  | { kind: 'normal'; x0: number; x1: number; ymax: number }
  | { kind: 'matrix'; r: number }
  | { kind: 'stats'; lo: number; hi: number; width: number }
  | { kind: 'pairs'; x0: number; x1: number; y0: number; y1: number };

export interface FigureScene {
  size: Size;
  /** The plot areas, each drawn as a well with a fine edge. */
  panes: Rect[];
  marks: FigMark[];
  handles: FigHandle[];
  readouts: FigReadout[];
  view: FigureView;
}

/** A handle's dot, and how far from it a press still takes it: a mouse's, and a finger's. */
export const HANDLE_R = 7;
export const HANDLE_HIT = { mouse: 16, touch: 24 } as const;

/**
 * The handle under a press (the nearest within reach), or null. It also runs on a phone's UI thread (a Reanimated
 * worklet), so a press on a handle takes the touch before the canvas or the list can: it reads only its arguments.
 */
export function handleAt(scene: Pick<FigureScene, 'handles'>, p: Point, touch = false): FigHandle | null {
  'worklet';
  const reach = touch ? 24 : 16; // HANDLE_HIT
  let best: FigHandle | null = null, bd: number = reach;
  for (const h of scene.handles) {
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    if (d <= bd) { best = h; bd = d; }
  }
  return best;
}

const fmt = (v: number, sig = 3) => tagNumber(v, sig);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Maps from a view to a pane. */
interface Map2 { X: (x: number) => number; Y: (y: number) => number; ix: (px: number) => number; iy: (py: number) => number }
function map2(pane: Rect, x0: number, x1: number, y0: number, y1: number): Map2 {
  const sx = pane.w / (x1 - x0 || 1), sy = pane.h / (y1 - y0 || 1);
  return { X: (x) => pane.x + (x - x0) * sx, Y: (y) => pane.y + (y1 - y) * sy, ix: (px) => x0 + (px - pane.x) / sx, iy: (py) => y1 - (py - pane.y) / sy };
}

/** A curve sampled at every other pixel across a pane, lifting the pen where it leaves the plot far or isn't defined. */
function curvePath(f: (x: number) => number, m: Map2, pane: Rect, step = 1.5): string {
  let d = '', pen = false;
  for (let px = pane.x; px <= pane.x + pane.w + 0.01; px += step) {
    const py = m.Y(f(m.ix(px)));
    if (!Number.isFinite(py) || py < pane.y - pane.h || py > pane.y + 2 * pane.h) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** A tick's text: as many decimals as the step needs, with a real minus. */
export function tickText(v: number, step: number): string {
  if (Math.abs(v) < step / 1e6) return '0';
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const a = Math.abs(v);
  const s = a >= 1e5 || a < 1e-4 ? fmt(v, 2) : String(Number(v.toFixed(Math.min(dec, 6))));
  return s.replace('-', '−');
}

/**
 * Grid, axes and tick labels for a pane: grid lines at `step` (every other one lighter), the axes where 0 is in view,
 * and labels along each axis (or along the pane's foot or left edge when the axis is out of view, or `xFoot`).
 */
function axes(marks: FigMark[], pane: number, r: Rect, m: Map2, v: { x0: number; x1: number; y0: number; y1: number }, o: { gx: number; gy: number; lx?: number; ly?: number; xFoot?: boolean; fx?: (x: number) => string; fy?: (y: number) => string; noY?: boolean }): void {
  const lx = o.lx ?? o.gx, ly = o.ly ?? o.gy;
  for (const x of tickValues(v.x0, v.x1, o.gx)) { const px = Math.round(m.X(x)) + 0.5; marks.push({ t: 'line', pane, x1: px, y1: r.y, x2: px, y2: r.y + r.h, tone: Math.round(x / o.gx) % 2 ? 'grid' : 'grid2', w: 1 }); }
  for (const y of tickValues(v.y0, v.y1, o.gy)) { const py = Math.round(m.Y(y)) + 0.5; marks.push({ t: 'line', pane, x1: r.x, y1: py, x2: r.x + r.w, y2: py, tone: Math.round(y / o.gy) % 2 ? 'grid' : 'grid2', w: 1 }); }
  const xIn = v.x0 <= 0 && v.x1 >= 0, yIn = v.y0 <= 0 && v.y1 >= 0;
  const ax = Math.round(m.X(0)) + 0.5, ay = Math.round(m.Y(0)) + 0.5;
  if (yIn) marks.push({ t: 'line', pane, x1: r.x, y1: ay, x2: r.x + r.w, y2: ay, tone: 'axis', w: 1.2 });
  if (xIn) marks.push({ t: 'line', pane, x1: ax, y1: r.y, x2: ax, y2: r.y + r.h, tone: 'axis', w: 1.2 });
  const foot = o.xFoot || !yIn || ay > r.y + r.h - 18;
  const ty = foot ? r.y + r.h - 5 : ay + 5;
  for (const x of tickValues(v.x0, v.x1, lx)) {
    if (Math.abs(x) < lx / 1e6 && !foot) continue;
    const px = m.X(x);
    if (px < r.x + 12 || px > r.x + r.w - 14) continue;
    marks.push({ t: 'text', pane, x: px, y: ty, s: o.fx ? o.fx(x) : tickText(x, lx), tone: 'tick', size: 11, weight: 500, anchor: 'middle', base: foot ? 'bottom' : 'top' });
  }
  if (o.noY) return;
  const left = !xIn || ax - r.x < 26;
  const tx = left ? (xIn ? ax + 6 : r.x + 5) : ax - 6;
  for (const y of tickValues(v.y0, v.y1, ly)) {
    if (Math.abs(y) < ly / 1e6) continue;
    const py = m.Y(y);
    if (py < r.y + 10 || py > r.y + r.h - (foot ? 24 : 12)) continue;
    marks.push({ t: 'text', pane, x: tx, y: py, s: o.fy ? o.fy(y) : tickText(y, ly), tone: 'tick', size: 11, weight: 500, anchor: left ? 'start' : 'end', base: 'middle' });
  }
}

/** The usual spread of a function's values over a range, robust to its far ends: the middle 80% of samples, padded. */
function spread(fs: readonly ((x: number) => number)[], x0: number, x1: number, also: number[] = []): [number, number] {
  const ys: number[] = [];
  for (const f of fs) for (let k = 0; k <= 120; k++) { const y = f(x0 + ((x1 - x0) * k) / 120); if (Number.isFinite(y)) ys.push(y); }
  ys.sort((a, b) => a - b);
  let lo = ys.length ? ys[Math.floor(ys.length * 0.1)] : -1, hi = ys.length ? ys[Math.ceil(ys.length * 0.9) - 1] : 1;
  for (const v of also) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.18;
  return [lo - pad, hi + pad];
}

/** The angle a unit circle draws, as typed (degrees or radians), into [0, one turn). */
const turnOf = (deg: boolean) => (deg ? 360 : 2 * Math.PI);
const wrap = (a: number, turn: number) => ((a % turn) + turn) % turn;
const toRad = (a: number, deg: boolean) => (deg ? (a * Math.PI) / 180 : a);
const PI_TICKS = ['0', 'π/2', 'π', '3π/2', '2π'];

/** The default view of a figure: what a platform draws when nothing is held. */
export function figureView(data: FigureData): FigureView {
  switch (data.kind) {
    case 'unit-circle': return { kind: 'unit-circle' };
    case 'tangent': {
      const xr = Math.max(2.75, Math.ceil((Math.abs(data.p) + 1) * 2) / 2);
      const [y0, y1] = spread([data.f], -xr, xr, [data.y]);
      const [d0, d1] = spread([data.df], -xr, xr, [data.slope, 0]);
      return { kind: 'tangent', x0: -xr, x1: xr, y0, y1, d0, d1 };
    }
    case 'riemann': {
      const lo = Math.min(data.a, data.b), hi = Math.max(data.a, data.b), span = hi - lo || 1;
      const x0 = lo - span * 0.2, x1 = hi + span * 0.2;
      const [y0, y1] = spread([data.f], x0, x1, [0]);
      return { kind: 'riemann', x0, x1, y0, y1 };
    }
    case 'normal': return { kind: 'normal', x0: data.mu - 4 * data.sigma, x1: data.mu + 4 * data.sigma, ymax: (normPdf(0) / data.sigma) * 1.04 };
    case 'matrix': {
      const [a, b, c, d] = data.m;
      const far = Math.max(1, ...[a, b, c, d, a + b, c + d].map(Math.abs));
      return { kind: 'matrix', r: Math.max(2.5, Math.ceil((far + 0.7) * 2) / 2) };
    }
    case 'stats': { const b = histogramBins(data.xs, data.sum); return { kind: 'stats', lo: b.lo, hi: b.hi, width: b.width }; }
    case 'pairs': {
      const span = (vs: number[]): [number, number] => {
        let lo = Math.min(...vs), hi = Math.max(...vs);
        if (!(hi > lo)) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.08;
        // 0 comes into view when it's near: data from 2 to 20 reads against 0.
        if (lo > 0 && lo < (hi - lo) * 0.4) lo = 0; else lo -= pad;
        if (hi < 0 && -hi < (hi - lo) * 0.4) hi = 0; else hi += pad;
        return [lo, hi];
      };
      const [x0, x1] = span(data.pts.map((p) => p[0])), [y0, y1] = span(data.pts.map((p) => p[1]));
      return { kind: 'pairs', x0, x1, y0, y1 };
    }
  }
}

/** The largest of 1, 2 and 5 times a power of ten that is at most `v`. */
function niceFloor(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}
/** The most bars a histogram draws. */
export const MAX_BINS = 60;

/**
 * A histogram's bins: Freedman–Diaconis width (2·IQR/∛n), but never coarser than Sturges' count (⌈log₂ n⌉ + 1 bins
 * over the range), rounded down to 1, 2 or 5 times a power of ten so the edges land on round numbers; at most
 * MAX_BINS. Each bin holds lo + k·width ≤ x < lo + (k + 1)·width, the last one its top edge too.
 */
export function histogramBins(xs: readonly number[], sum: ListSummary = listSummary(xs)): { lo: number; hi: number; width: number; counts: number[] } {
  const range = sum.max - sum.min;
  let width: number;
  if (!(range > 0)) width = niceFloor(Math.abs(sum.min) * 0.1 || 1);
  else {
    const sturges = range / (Math.ceil(Math.log2(sum.n)) + 1);
    const iqr = sum.q3 - sum.q1;
    const fd = iqr > 0 ? (2 * iqr) / Math.cbrt(sum.n) : Infinity;
    width = niceFloor(Math.min(sturges, fd));
    while (range / width > MAX_BINS) width = niceStep(width * 1.5);
  }
  const lo = Math.floor(sum.min / width + 1e-9) * width;
  const k = Math.max(1, Math.floor((sum.max - lo) / width + 1e-9) + (range > 0 && Math.abs((sum.max - lo) / width - Math.round((sum.max - lo) / width)) < 1e-9 ? 0 : 1));
  const counts = new Array<number>(k).fill(0);
  for (const x of xs) counts[Math.min(k - 1, Math.max(0, Math.floor((x - lo) / width + 1e-9)))]++;
  return { lo, hi: lo + k * width, width, counts };
}

/** Each figure's geometry: its panes and maps, shared by the drawing and the drag so they always agree. */
function unitCircleFrame(size: Size) {
  const side = Math.min(size.h, size.w * 0.45);
  const circle: Rect = { x: 0, y: 0, w: side, h: size.h };
  const wave: Rect = { x: side + PANE_GAP, y: 0, w: Math.max(40, size.w - side - PANE_GAP), h: size.h };
  const R = Math.round(Math.min(side, size.h) * 0.36), cx = side / 2, cy = size.h / 2;
  return { circle, wave, R, cx, cy };
}
function tangentFrame(size: Size, v: Extract<FigureView, { kind: 'tangent' }>) {
  const top = Math.round(size.h * 0.63);
  const a: Rect = { x: 0, y: 0, w: size.w, h: top }, b: Rect = { x: 0, y: top + 6, w: size.w, h: size.h - top - 6 };
  return { a, b, A: map2(a, v.x0, v.x1, v.y0, v.y1), B: map2(b, v.x0, v.x1, v.d0, v.d1) };
}
const NORMAL_PAD = { l: 16, r: 16, t: 46, b: 44 };
function normalFrame(size: Size, v: Extract<FigureView, { kind: 'normal' }>) {
  const pane: Rect = { x: 0, y: 0, ...size };
  const plot: Rect = { x: NORMAL_PAD.l, y: NORMAL_PAD.t, w: size.w - NORMAL_PAD.l - NORMAL_PAD.r, h: size.h - NORMAL_PAD.t - NORMAL_PAD.b };
  return { pane, plot, m: map2(plot, v.x0, v.x1, 0, v.ymax) };
}
function matrixFrame(size: Size, v: Extract<FigureView, { kind: 'matrix' }>) {
  const pane: Rect = { x: 0, y: 0, ...size };
  const U = Math.min(size.w, size.h) / (2 * v.r), cx = size.w / 2, cy = size.h / 2;
  return { pane, U, cx, cy, X: (x: number) => cx + x * U, Y: (y: number) => cy - y * U };
}

/** A text mark's drawn width, measured by the platform in the face it draws (math: the math face, italic). */
export type MeasureText = (s: string, size: number, weight: number, math: boolean) => number;

/**
 * A figure as marks, in draw order, for a drawing `size` (figureSize). `view` holds a held figure still (pass the one
 * a drag began with); `active` is the handle being dragged, which shows the guides a drag reveals. `measure` gives a
 * label's real width where a label decides its side by whether it fits; without it the width is estimated.
 */
export function figureScene(data: FigureData, size: Size, opts: { view?: FigureView | null; active?: string | null; measure?: MeasureText } = {}): FigureScene {
  const view = opts.view && opts.view.kind === data.kind ? opts.view : figureView(data);
  const marks: FigMark[] = [], handles: FigHandle[] = [], readouts: FigReadout[] = [];
  const active = opts.active ?? null;
  const widthOf = (s: string, size: number, guess: number) => (opts.measure ? opts.measure(s, size, 600, false) : guess);
  let panes: Rect[] = [];
  const text = (pane: number, x: number, y: number, s: string, tone: FigTone, o: Partial<Extract<FigMark, { t: 'text' }>> = {}) =>
    marks.push({ t: 'text', pane, x, y, s, tone, size: 12.5, weight: 600, anchor: 'middle', base: 'middle', ...o });
  switch (data.kind) {
    case 'unit-circle': {
      const { circle, wave, R, cx, cy } = unitCircleFrame(size);
      panes = [circle, wave];
      const turn = turnOf(data.deg), a = toRad(wrap(data.theta, turn), data.deg);
      const co = data.cos, si = data.sin, px = cx + R * co, py = cy - R * si;
      marks.push({ t: 'line', pane: 0, x1: circle.x, y1: cy + 0.5, x2: circle.x + circle.w, y2: cy + 0.5, tone: 'grid2', w: 1 });
      marks.push({ t: 'line', pane: 0, x1: cx + 0.5, y1: 0, x2: cx + 0.5, y2: size.h, tone: 'grid2', w: 1 });
      marks.push({ t: 'path', pane: 0, d: `M${cx + R},${cy}A${R},${R} 0 1 0 ${cx - R},${cy}A${R},${R} 0 1 0 ${cx + R},${cy}`, stroke: 'muted', w: 1.4 });
      const ar = Math.max(14, R * 0.22);
      if (a > 1e-6) marks.push({ t: 'path', pane: 0, d: `M${cx + ar},${cy}A${ar},${ar} 0 ${a > Math.PI ? 1 : 0} 0 ${(cx + ar * Math.cos(a)).toFixed(2)},${(cy - ar * Math.sin(a)).toFixed(2)}`, stroke: 'ink2', w: 1.6 });
      const lr = ar + 14;
      text(0, cx + lr * Math.cos(a / 2), cy - lr * Math.sin(a / 2), 'θ', 'ink2', { math: true, size: 16, weight: 500 });
      if (active) {
        // The cos length turned upright, so it can be read across on the waves.
        const rr = R * Math.abs(co);
        if (rr > 2) marks.push({ t: 'path', pane: 0, d: `M${cx + R * co},${cy}A${rr},${rr} 0 0 ${co >= 0 ? 0 : 1} ${cx},${cy - R * co}`, stroke: 'teal', w: 1.4, dash: [4, 4], op: 0.9 });
      }
      marks.push({ t: 'line', pane: 0, x1: cx, y1: cy, x2: px, y2: py, tone: 'ink2', w: 1.6 });
      marks.push({ t: 'line', pane: 0, x1: cx, y1: cy, x2: px, y2: cy, tone: 'teal', w: 3.2 });
      marks.push({ t: 'line', pane: 0, x1: px, y1: cy, x2: px, y2: py, tone: 'coral', w: 3.2 });
      const side = co >= 0 ? 1 : -1;
      text(0, px + side * 9, (cy + py) / 2, fmt(si), 'coral', { anchor: side > 0 ? 'start' : 'end', plate: true });
      text(0, (cx + px) / 2, cy + (si >= 0 ? 13 : -13), fmt(co), 'teal', { plate: true });
      // The waves share the circle's scale and middle, so the guides run straight across.
      const x0 = data.deg ? -20 : -0.35, x1 = data.deg ? 400 : 7;
      const v = { x0, x1, y0: -(size.h / 2) / R, y1: size.h / 2 / R };
      const m = map2(wave, v.x0, v.x1, v.y0, v.y1);
      const q = turn / 4;
      axes(marks, 1, wave, m, v, { gx: q / 2, gy: 0.5, lx: wave.w < 260 ? q * 2 : q, ly: 1, xFoot: false, fx: (x) => (data.deg ? `${Math.round(x)}°` : PI_TICKS[Math.round(x / q)] ?? '') });
      const w = data.deg ? wrap(data.theta, 360) : wrap(data.theta, 2 * Math.PI);
      marks.push({ t: 'line', pane: 1, x1: Math.round(m.X(w)) + 0.5, y1: 0, x2: Math.round(m.X(w)) + 0.5, y2: size.h, tone: 'accent', w: 1, op: 0.35 });
      const rad = (x: number) => toRad(x, data.deg);
      marks.push({ t: 'path', pane: 1, d: curvePath((x) => Math.cos(rad(x)), m, wave), stroke: 'teal', w: 2.2 });
      marks.push({ t: 'path', pane: 1, d: curvePath((x) => Math.sin(rad(x)), m, wave), stroke: 'coral', w: 2.2 });
      const sx = m.X(w), sy = m.Y(si), cyy = m.Y(co);
      marks.push({ t: 'line', pane: -1, x1: px + 9, y1: py, x2: sx - 6, y2: sy, tone: 'coral', w: 1.2, dash: [4, 4], op: 0.75 });
      if (active) marks.push({ t: 'line', pane: -1, x1: cx, y1: cy - R * co, x2: sx - 6, y2: cyy, tone: 'teal', w: 1.2, dash: [4, 4], op: 0.75 });
      marks.push({ t: 'dot', pane: 1, x: sx, y: cyy, r: 4.2, tone: 'teal' });
      marks.push({ t: 'dot', pane: 1, x: sx, y: sy, r: 4.2, tone: 'coral' });
      handles.push({ id: 'point', x: px, y: py, tone: 'accent', draggable: data.arg.k !== 'fixed', axis: 'angle', label: 'θ', value: `${fmt(data.theta, 6)}${data.deg ? '°' : ''}` });
      break;
    }
    case 'tangent': {
      const v = view as Extract<FigureView, { kind: 'tangent' }>;
      const { a, b, A, B } = tangentFrame(size, v);
      panes = [a, b];
      const gx = niceStep((v.x1 - v.x0) / 10);
      axes(marks, 0, a, A, v, { gx: gx, gy: niceStep((v.y1 - v.y0) / 8), lx: gx * 2, ly: niceStep((v.y1 - v.y0) / 4) });
      axes(marks, 1, b, B, { x0: v.x0, x1: v.x1, y0: v.d0, y1: v.d1 }, { gx: gx, gy: niceStep((v.d1 - v.d0) / 6), lx: gx * 2, ly: niceStep((v.d1 - v.d0) / 3) });
      const { p, y, slope } = data;
      // f in its own curve color; the tangent, its slope and f′ in one other color.
      const fTone: FigTone = data.curve === null ? 'violet' : curveTone(data.curve);
      const lt = data.curve === null ? 'amber' : otherThan(data.curve);
      // The slope carried down from the tangent point to f′(p).
      marks.push({ t: 'line', pane: -1, x1: A.X(p), y1: Math.min(a.y + a.h, Math.max(a.y, A.Y(y))), x2: B.X(p), y2: Math.min(b.y + b.h, Math.max(b.y, B.Y(slope))), tone: lt, w: 1.3, dash: [5, 5], op: active ? 0.95 : 0.6 });
      marks.push({ t: 'line', pane: 1, x1: B.X(Math.max(v.x0, Math.min(v.x1, 0))), y1: B.Y(slope), x2: B.X(p), y2: B.Y(slope), tone: lt, w: 1.2, dash: [3, 4], op: active ? 0.95 : 0.6 });
      marks.push({ t: 'path', pane: 0, d: curvePath(data.f, A, a), stroke: fTone, w: 2.4 });
      marks.push({ t: 'path', pane: 0, d: `M${A.X(v.x0)},${A.Y(y + slope * (v.x0 - p))}L${A.X(v.x1)},${A.Y(y + slope * (v.x1 - p))}`, stroke: lt, w: 2 });
      // Rise over a run of 1, toward the side with room.
      let run = 1;
      if (A.X(p + 1) - A.X(p) < 24) run = niceStep((v.x1 - v.x0) / 5);
      if (p + run > v.x1 - (v.x1 - v.x0) * 0.04) run = -run;
      const x2 = p + run, y2 = y + slope * run;
      marks.push({ t: 'line', pane: 0, x1: A.X(p), y1: A.Y(y), x2: A.X(x2), y2: A.Y(y), tone: 'tick', w: 1.2, dash: [3, 4] });
      marks.push({ t: 'line', pane: 0, x1: A.X(x2), y1: A.Y(y), x2: A.X(x2), y2: A.Y(y2), tone: lt, w: 1.2, dash: [3, 4] });
      text(0, (A.X(p) + A.X(x2)) / 2, A.Y(y) + (slope * run >= 0 ? 11 : -11), fmt(Math.abs(run)), 'tick', { size: 11.5, weight: 500, plate: true });
      const ry = Math.max(a.y + 12, Math.min(a.y + a.h - 12, (A.Y(y) + A.Y(y2)) / 2));
      // Beside the rise, on the outside unless that runs off the pane.
      const rise = fmt(slope * Math.abs(run)), room = widthOf(rise, 12.5, rise.length * 7.5) + 10;
      const out = run > 0 ? A.X(x2) + room <= a.x + a.w : A.X(x2) - room >= a.x;
      const dir = out === run > 0 ? 1 : -1;
      text(0, A.X(x2) + dir * 8, ry, rise, lt, { anchor: dir > 0 ? 'start' : 'end', plate: true });
      marks.push({ t: 'path', pane: 1, d: curvePath(data.df, B, b), stroke: lt, w: 2.2 });
      marks.push({ t: 'dot', pane: 1, x: B.X(p), y: B.Y(slope), r: 4.4, tone: lt });
      text(-1, a.x + a.w - 12, a.y + 15, data.equation, lt, { anchor: 'end', size: 15, weight: 500, math: true, plate: true });
      text(-1, b.x + 10, b.y + 14, `y = ${data.name}′(x)`, lt, { anchor: 'start', size: 14, weight: 500, math: true, plate: true });
      handles.push({ id: 'point', x: A.X(p), y: A.Y(y), tone: 'accent', draggable: data.arg.k !== 'fixed', axis: 'x', label: 'p', value: fmt(p, 6) });
      break;
    }
    case 'riemann': {
      const v = view as Extract<FigureView, { kind: 'riemann' }>;
      const pane: Rect = { x: 0, y: 0, ...size };
      panes = [pane];
      const m = map2(pane, v.x0, v.x1, v.y0, v.y1);
      axes(marks, 0, pane, m, v, { gx: niceStep((v.x1 - v.x0) / 10), gy: niceStep((v.y1 - v.y0) / 8), lx: niceStep((v.x1 - v.x0) / 5), ly: niceStep((v.y1 - v.y0) / 4), xFoot: true });
      const { a, b, n, f } = data;
      // The strips and the curve in g's own curve color.
      const gTone: FigTone = data.curve === null ? 'teal' : curveTone(data.curve);
      const h = (b - a) / n, off = data.rule === 'left' ? 0 : data.rule === 'right' ? 1 : 0.5;
      const shown = Math.min(n, 400);
      let fill = '', edge = '';
      const dots: Point[] = [];
      for (let k = 0; k < shown; k++) {
        const kk = shown === n ? k : Math.floor((k * n) / shown);
        const xl = a + kk * h, xs = xl + off * h, yv = f(xs);
        if (!Number.isFinite(yv)) continue;
        const L = m.X(Math.min(xl, xl + h)), Rr = m.X(Math.max(xl, xl + h)), T = m.Y(Math.max(yv, 0)), Bt = m.Y(Math.min(yv, 0));
        fill += `M${L.toFixed(1)},${T.toFixed(1)}H${Rr.toFixed(1)}V${Bt.toFixed(1)}H${L.toFixed(1)}Z`;
        if (n <= 120) edge += `M${(Math.round(L) + 0.5).toFixed(1)},${(Math.round(Bt) + 0.5).toFixed(1)}V${(Math.round(T) + 0.5).toFixed(1)}H${(Math.round(Rr) + 0.5).toFixed(1)}V${(Math.round(Bt) + 0.5).toFixed(1)}`;
        if (n <= 24) dots.push({ x: m.X(xs), y: m.Y(yv) });
      }
      marks.push({ t: 'path', pane: 0, d: fill, fill: gTone, fillOp: 0.18 });
      if (edge) marks.push({ t: 'path', pane: 0, d: edge, stroke: gTone, w: 1, op: 0.6 });
      marks.push({ t: 'path', pane: 0, d: curvePath(f, m, pane), stroke: gTone, w: 2.4 });
      for (const d of dots) marks.push({ t: 'dot', pane: 0, x: d.x, y: d.y, r: 2.4, tone: 'ink2' });
      readouts.push({ id: 'sum', label: `S${subscriptDigits(String(n))}`, value: tagNumber(data.sum, 8) });
      if (data.integral !== null) readouts.push({ id: 'integral', label: `∫${boundText(a, true)}${boundText(b, false)} ${data.name}(x) dx`, value: tagNumber(data.integral, 8) });
      break;
    }
    case 'normal': {
      const v = view as Extract<FigureView, { kind: 'normal' }>;
      const { pane, plot, m } = normalFrame(size, v);
      panes = [pane];
      const { mu, sigma, lo, hi } = data;
      const pdf = (x: number) => normPdf((x - mu) / sigma) / sigma;
      const base = m.Y(0);
      for (let k = -3; k <= 3; k++) { const x = Math.round(m.X(mu + k * sigma)) + 0.5; marks.push({ t: 'line', pane: 0, x1: x, y1: plot.y - 12, x2: x, y2: base, tone: k ? 'grid' : 'grid2', w: 1 }); }
      const a = Math.max(lo, v.x0), z = Math.min(hi, v.x1);
      if (z > a) {
        let d = `M${m.X(a).toFixed(1)},${base.toFixed(1)}`;
        for (let px = m.X(a); px < m.X(z); px += 1.5) d += `L${px.toFixed(1)},${m.Y(pdf(m.ix(px))).toFixed(1)}`;
        d += `L${m.X(z).toFixed(1)},${m.Y(pdf(z)).toFixed(1)}L${m.X(z).toFixed(1)},${base.toFixed(1)}Z`;
        marks.push({ t: 'path', pane: 0, d, fill: 'teal', fillOp: 0.22 });
      }
      marks.push({ t: 'path', pane: 0, d: curvePath(pdf, m, plot), stroke: 'teal', w: 2.4 });
      marks.push({ t: 'line', pane: 0, x1: plot.x - 6, y1: Math.round(base) + 0.5, x2: plot.x + plot.w + 6, y2: Math.round(base) + 0.5, tone: 'axis', w: 1.2 });
      const dp = Math.max(0, 1 - Math.floor(Math.log10(sigma)));
      for (let k = -3; k <= 3; k++) {
        const x = m.X(mu + k * sigma);
        if (size.w > 380 || k % 2 === 0) text(0, x, base + 7, String(Number((mu + k * sigma).toFixed(dp))).replace('-', '−'), 'tick', { size: 11.5, weight: 500, base: 'top' });
        text(0, x, base + 23, k ? `${k > 0 ? '+' : '−'}${Math.abs(k) === 1 ? '' : Math.abs(k)}σ` : 'μ', 'muted', { size: 12.5, weight: 500, base: 'top', math: true });
      }
      const bounds: [number, 0 | 1][] = ([[lo, 0], [hi, 1]] as [number, 0 | 1][]).filter(([b]) => Number.isFinite(b) && b > v.x0 && b < v.x1);
      const close = bounds.length === 2 && m.X(hi) - m.X(lo) < 90;
      for (const [bv, k] of bounds) {
        const x = m.X(bv), y = m.Y(pdf(bv)), xr = Math.round(x) + 0.5;
        marks.push({ t: 'line', pane: 0, x1: xr, y1: base, x2: xr, y2: y, tone: 'teal', w: 1.6 });
        marks.push({ t: 'line', pane: 0, x1: xr, y1: y - 9, x2: xr, y2: plot.y - 6, tone: 'teal', w: 1, dash: [2, 3], op: 0.55 });
        const anchor = close ? (k ? 'start' : 'end') : x < 50 ? 'start' : x > size.w - 50 ? 'end' : 'middle';
        const tx = close ? x + (k ? -4 : 4) : x;
        text(0, tx, 17, fmt(bv, 6), 'ink', { size: 13, weight: 600, anchor });
        text(0, tx, 32, `z ${((bv - mu) / sigma).toFixed(2).replace('-', '−')}`, 'tick', { size: 11.5, weight: 500, anchor });
        handles.push({ id: k ? 'hi' : 'lo', x, y, tone: 'teal', draggable: data.args[k].k !== 'fixed', axis: 'x', label: k ? 'Upper bound' : 'Lower bound', value: fmt(bv, 6) });
      }
      break;
    }
    case 'matrix': {
      const v = view as Extract<FigureView, { kind: 'matrix' }>;
      const { pane, U, X, Y } = matrixFrame(size, v);
      panes = [pane];
      const [a, b, c, d] = data.m, dt = data.det;
      const gs = Math.max(1, niceStep(v.r / 5)), nx = size.w / U / 2, ny = size.h / U / 2;
      for (const k of tickValues(-nx, nx, gs)) marks.push({ t: 'line', pane: 0, x1: Math.round(X(k)) + 0.5, y1: 0, x2: Math.round(X(k)) + 0.5, y2: size.h, tone: k ? 'grid' : 'axis', w: 1 });
      for (const k of tickValues(-ny, ny, gs)) marks.push({ t: 'line', pane: 0, x1: 0, y1: Math.round(Y(k)) + 0.5, x2: size.w, y2: Math.round(Y(k)) + 0.5, tone: k ? 'grid' : 'axis', w: 1 });
      // The grid carried through the matrix.
      let g = '';
      const N = 14, L = 40;
      for (let k = -N; k <= N; k++) {
        g += `M${X(k * a - L * b).toFixed(1)},${Y(k * c - L * d).toFixed(1)}L${X(k * a + L * b).toFixed(1)},${Y(k * c + L * d).toFixed(1)}`;
        g += `M${X(k * b - L * a).toFixed(1)},${Y(k * d - L * c).toFixed(1)}L${X(k * b + L * a).toFixed(1)},${Y(k * d + L * c).toFixed(1)}`;
      }
      marks.push({ t: 'path', pane: 0, d: g, stroke: 'accent', w: 1, op: 0.26 });
      marks.push({ t: 'path', pane: 0, d: `M${X(0)},${Y(0)}H${X(1)}V${Y(1)}H${X(0)}Z`, stroke: 'muted', w: 1.2, dash: [4, 4] });
      const tone: FigTone = dt < 0 ? 'coral' : 'amber';
      marks.push({ t: 'path', pane: 0, d: `M${X(0)},${Y(0)}L${X(a)},${Y(c)}L${X(a + b)},${Y(c + d)}L${X(b)},${Y(d)}Z`, fill: tone, fillOp: 0.17, stroke: tone, w: 1.2, op: 0.8 });
      // Ticks a whole step apart, wider for a matrix that reaches far ([[2^70, 1], [1, 1]] mustn't tick every unit).
      const ts = Math.max(1, niceStep(v.r / 2.5));
      for (const k of tickValues(-v.r, v.r, ts)) {
        if (!k || Math.abs(k) > v.r - 0.4 * ts) continue;
        const t = tickText(k, ts);
        text(0, X(k), Y(0) + 4, t, 'muted', { size: 10.5, weight: 500, base: 'top' });
        text(0, X(0) - 5, Y(k), t, 'muted', { size: 10.5, weight: 500, anchor: 'end' });
      }
      text(0, X((a + b) / 2), Y((c + d) / 2), fmt(dt, 4), tone, { size: 15, weight: 600, plate: true });
      ([[a, c, 'coral', 0], [b, d, 'teal', 1]] as const).forEach(([vx, vy, col, k]) => {
        const x2 = X(vx), y2 = Y(vy), ang = Math.atan2(y2 - Y(0), x2 - X(0)), head = 9;
        const bx = x2 - Math.cos(ang) * head * 0.8, by = y2 - Math.sin(ang) * head * 0.8;
        marks.push({ t: 'line', pane: 0, x1: X(0), y1: Y(0), x2: bx, y2: by, tone: col, w: 2.4 });
        marks.push({ t: 'path', pane: 0, d: `M${x2.toFixed(1)},${y2.toFixed(1)}L${(x2 - Math.cos(ang - 0.42) * head).toFixed(1)},${(y2 - Math.sin(ang - 0.42) * head).toFixed(1)}L${(x2 - Math.cos(ang + 0.42) * head).toFixed(1)},${(y2 - Math.sin(ang + 0.42) * head).toFixed(1)}Z`, fill: col });
        const len = Math.hypot(vx, vy) || 1, ox = (vx / len) * 16, oy = (vy / len) * 16;
        const label = `(${fmt(vx)}, ${fmt(vy)})`;
        let anchor: 'start' | 'middle' | 'end' = ox > 4 ? 'start' : ox < -4 ? 'end' : 'middle';
        let lx = x2 + ox;
        const tw = widthOf(label, 12, label.length * 6.6);
        if (anchor === 'start' && lx + tw > size.w - 4) { anchor = 'end'; lx = size.w - 4; }
        if (anchor === 'end' && lx - tw < 4) { anchor = 'start'; lx = 4; }
        text(0, lx, Math.max(10, Math.min(size.h - 10, y2 - oy)), label, col, { size: 12, anchor, base: oy > 4 ? 'bottom' : oy < -4 ? 'top' : 'middle', plate: true });
        const refs = k ? [data.cells[1], data.cells[3]] : [data.cells[0], data.cells[2]];
        handles.push({ id: k ? 'j' : 'i', x: x2, y: y2, tone: col, draggable: refs.some((r) => r.k !== 'fixed'), axis: 'xy', label: k ? 'Second column' : 'First column', value: label });
      });
      break;
    }
    case 'stats': {
      const v = view as Extract<FigureView, { kind: 'stats' }>;
      const pane: Rect = { x: 0, y: 0, ...size };
      panes = [pane];
      const { sum } = data;
      const bins = histogramBins(data.xs, sum);
      const pad = { l: 14, r: 14, t: 34, b: 26 };
      const X = (x: number) => pad.l + ((x - v.lo) / (v.hi - v.lo || 1)) * (size.w - pad.l - pad.r);
      const axisY = size.h - pad.b, boxH = 16, boxY = axisY - 10 - boxH, histB = boxY - 10;
      const top = Math.max(1, ...bins.counts);
      const Yh = (n: number) => histB - (n / top) * (histB - pad.t);
      const sd = sum.s;
      // The band one s either side of the mean, under the bars.
      if (sd !== null && sd > 0) {
        const a = X(sum.mean - sd), b = X(sum.mean + sd);
        marks.push({ t: 'path', pane: 0, d: `M${a.toFixed(1)},${pad.t - 14}H${b.toFixed(1)}V${histB}H${a.toFixed(1)}Z`, fill: 'violet', fillOp: 0.08 });
        for (const x of [a, b]) marks.push({ t: 'line', pane: 0, x1: Math.round(x) + 0.5, y1: pad.t - 14, x2: Math.round(x) + 0.5, y2: histB, tone: 'violet', w: 1, dash: [3, 3], op: 0.5 });
      }
      let bars = '', tops = '';
      bins.counts.forEach((n, k) => {
        if (!n) return;
        const x = X(bins.lo + k * bins.width) + 1, w = Math.max(1, X(bins.lo + (k + 1) * bins.width) - X(bins.lo + k * bins.width) - 2), y = Yh(n);
        bars += `M${x.toFixed(1)},${y.toFixed(1)}H${(x + w).toFixed(1)}V${histB}H${x.toFixed(1)}Z`;
        tops += `M${x.toFixed(1)},${(y + 1).toFixed(1)}H${(x + w).toFixed(1)}`;
      });
      marks.push({ t: 'path', pane: 0, d: bars, fill: 'violet', fillOp: 0.42 });
      marks.push({ t: 'path', pane: 0, d: tops, stroke: 'violet', w: 2 });
      marks.push({ t: 'line', pane: 0, x1: pad.l, y1: histB + 0.5, x2: size.w - pad.r, y2: histB + 0.5, tone: 'grid2', w: 1 });
      // The box plot: whiskers to the least and most, the box from Q1 to Q3, the median across it.
      const my = boxY + boxH / 2;
      marks.push({ t: 'path', pane: 0, d: `M${X(sum.min)},${my}H${X(sum.q1)}M${X(sum.q3)},${my}H${X(sum.max)}M${X(sum.min)},${my - 5}V${my + 5}M${X(sum.max)},${my - 5}V${my + 5}`, stroke: 'ink2', w: 1.3 });
      marks.push({ t: 'path', pane: 0, d: `M${Math.round(X(sum.q1)) + 0.5},${boxY + 0.5}H${Math.round(X(sum.q3)) + 0.5}V${boxY + boxH + 0.5}H${Math.round(X(sum.q1)) + 0.5}Z`, fill: 'grid', stroke: 'ink2', w: 1.3 });
      marks.push({ t: 'line', pane: 0, x1: X(sum.median), y1: boxY, x2: X(sum.median), y2: boxY + boxH, tone: 'ink2', w: 2 });
      // The mean, and s drawn as a length from it.
      const mx = Math.round(X(sum.mean)) + 0.5;
      marks.push({ t: 'line', pane: 0, x1: mx, y1: pad.t - 14, x2: mx, y2: boxY + boxH + 4, tone: 'ink', w: 1.5 });
      text(0, mx - 6, pad.t - 21, 'x̄', 'ink', { math: true, size: 16, weight: 500, anchor: 'end' });
      if (sd !== null && sd > 0) {
        const sx = X(sum.mean + sd), sy = pad.t - 23;
        if (sx - mx > 10) {
          marks.push({ t: 'path', pane: 0, d: `M${mx + 3},${sy}H${sx.toFixed(1)}M${sx.toFixed(1)},${sy - 4}V${sy + 4}`, stroke: 'violet', w: 1.2, op: 0.9 });
          text(0, sx + 5, sy, 's', 'violet', { math: true, size: 16, weight: 500, anchor: 'start' });
        }
      }
      marks.push({ t: 'line', pane: 0, x1: pad.l, y1: axisY + 0.5, x2: size.w - pad.r, y2: axisY + 0.5, tone: 'axis', w: 1.2 });
      const st = niceStep((v.hi - v.lo) / Math.max(3, Math.min(6, Math.floor(size.w / 70))));
      for (const t of tickValues(v.lo, v.hi, st)) {
        const x = X(t);
        if (x < pad.l + 8 || x > size.w - pad.r - 8) continue;
        marks.push({ t: 'line', pane: 0, x1: Math.round(x) + 0.5, y1: axisY, x2: Math.round(x) + 0.5, y2: axisY + 4, tone: 'axis', w: 1 });
        text(0, x, axisY + 7, tickText(t, st), 'tick', { size: 11, weight: 500, base: 'top' });
      }
      break;
    }
    case 'pairs': {
      const v = view as Extract<FigureView, { kind: 'pairs' }>;
      const pane: Rect = { x: 0, y: 0, ...size };
      panes = [pane];
      const plot: Rect = { x: 40, y: 12, w: size.w - 54, h: size.h - 40 };
      const m = map2(plot, v.x0, v.x1, v.y0, v.y1);
      const gx = niceStep((v.x1 - v.x0) / 5), gy = niceStep((v.y1 - v.y0) / 5);
      for (const x of tickValues(v.x0, v.x1, gx)) {
        const px = Math.round(m.X(x)) + 0.5;
        marks.push({ t: 'line', pane: 0, x1: px, y1: plot.y, x2: px, y2: plot.y + plot.h, tone: 'grid', w: 1 });
        text(0, px, plot.y + plot.h + 7, tickText(x, gx), 'tick', { size: 11, weight: 500, base: 'top' });
      }
      for (const y of tickValues(v.y0, v.y1, gy)) {
        const py = Math.round(m.Y(y)) + 0.5;
        marks.push({ t: 'line', pane: 0, x1: plot.x, y1: py, x2: plot.x + plot.w, y2: py, tone: 'grid', w: 1 });
        text(0, plot.x - 7, py, tickText(y, gy), 'tick', { size: 11, weight: 500, anchor: 'end' });
      }
      marks.push({ t: 'path', pane: 0, d: `M${plot.x + 0.5},${plot.y}V${plot.y + plot.h + 0.5}H${plot.x + plot.w}`, stroke: 'axis', w: 1.2 });
      const f = data.curve;
      if (f) {
        // Each point's residual, faintly, then the fit.
        let res = '';
        for (const [x, y] of data.pts) { const fy = f(x); if (Number.isFinite(fy)) res += `M${m.X(x).toFixed(1)},${m.Y(y).toFixed(1)}V${m.Y(fy).toFixed(1)}`; }
        if (res) marks.push({ t: 'path', pane: 0, d: res, stroke: 'amber', w: 1, op: 0.35 });
        const d = data.line
          ? `M${plot.x},${m.Y(data.line.intercept + data.line.slope * v.x0).toFixed(1)}L${plot.x + plot.w},${m.Y(data.line.intercept + data.line.slope * v.x1).toFixed(1)}`
          : curvePath(f, m, plot);
        marks.push({ t: 'path', pane: 0, d, stroke: 'amber', w: 2.2 });
      }
      for (const [x, y] of data.pts) marks.push({ t: 'dot', pane: 0, x: m.X(x), y: m.Y(y), r: 3.6, tone: 'ink' });
      if (data.line) {
        const b = data.line.intercept;
        const eq = `ŷ = ${fmt(data.line.slope, 4)}x ${b < 0 ? '−' : '+'} ${fmt(Math.abs(b), 4)}`;
        // Along the foot, on the side the line leaves room.
        const rising = data.line.slope >= 0;
        text(0, rising ? plot.x + plot.w - 8 : plot.x + 10, plot.y + plot.h - 10, eq, 'amber', { math: true, size: 14, weight: 500, anchor: rising ? 'end' : 'start', base: 'bottom', plate: true });
      }
      break;
    }
  }
  return { size, panes, marks, handles, readouts, view };
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
const subscriptDigits = (s: string) => [...s].map((ch) => (ch >= '0' && ch <= '9' ? SUB[Number(ch)] : ch === '-' ? '₋' : ch === '.' ? '.' : ch)).join('');
/** An integral's bound as a sub- or superscript, or nothing when it isn't a short number. */
function boundText(v: number, low: boolean): string {
  const s = String(Number(v.toPrecision(4)));
  if (!/^-?\d+(\.\d+)?$/.test(s) || s.length > 6) return '';
  return low ? subscriptDigits(s) : superscript(s.replace('-', '⁻').replace('.', '·'));
}

// ---------- drags and keys ----------

/** What a drag or a key does: rewrite the figure's own line, or move a slider the line reads. */
export type FigureEdit = { kind: 'line'; text: string } | { kind: 'slider'; id: string; text: string };

/** What a drag holds from its start to its release: the figure's view, and each slider's range, so neither moves. */
export interface FigureHold { view: FigureView; ranges: ReadonlyMap<string, SliderRange> }
export function holdFigure(data: FigureData, scene: Pick<FigureScene, 'view'>): FigureHold {
  const refs: ArgRef[] = data.kind === 'unit-circle' || data.kind === 'tangent' ? [data.arg] : data.kind === 'normal' ? data.args : data.kind === 'matrix' ? data.cells : [];
  const ranges = new Map<string, SliderRange>();
  for (const r of refs) if (r.k === 'slider') ranges.set(r.id, r.range);
  return { view: scene.view, ranges };
}

/** A number as a line or slider takes it: plain digits, no exponent while it can, an ASCII minus. */
export function argText(v: number): string {
  const r = Number(v.toPrecision(10));
  return Object.is(r, -0) ? '0' : String(r);
}
/** A number rounded to a step, without the step's float noise. */
export const quantize = (v: number, step: number): number => Number((Math.round(v / step) * step).toPrecision(12));

/** The edits that set each of `sets` (an ArgRef and its new value) in `text`. Numbers in the line change right to left. */
export function figureEdits(text: string, sets: readonly { ref: ArgRef; v: number }[], hold: Pick<FigureHold, 'ranges'> | null): FigureEdit[] {
  return edits(text, sets, hold);
}
function edits(text: string, sets: readonly { ref: ArgRef; v: number }[], hold: Pick<FigureHold, 'ranges'> | null): FigureEdit[] {
  const out: FigureEdit[] = [];
  const spans: { span: readonly [number, number]; s: string }[] = [];
  for (const { ref, v } of sets) {
    if (!Number.isFinite(v)) continue;
    if (ref.k === 'slider') {
      const range = hold?.ranges.get(ref.id) ?? ref.range;
      const val = Math.max(range.min, Math.min(range.max, quantize(v, range.step)));
      out.push({ kind: 'slider', id: ref.id, text: `${ref.name} = ${argText(val)}` });
    } else if (ref.k === 'text') spans.push({ span: ref.span, s: argText(v) });
  }
  if (spans.length) {
    let t = text;
    for (const { span, s } of [...spans].sort((p, q) => q.span[0] - p.span[0])) t = t.slice(0, span[0]) + s + t.slice(span[1]);
    if (t !== text) out.unshift({ kind: 'line', text: t });
  }
  return out;
}

/** How fine a typed number moves when nothing says otherwise (a slider's own step wins). */
function typedStep(data: FigureData, view: FigureView): number {
  switch (data.kind) {
    case 'unit-circle': return data.deg ? 1 : 0.01;
    case 'tangent': { const v = view as Extract<FigureView, { kind: 'tangent' }>; return niceStep((v.x1 - v.x0) / 200); }
    case 'normal': return Math.pow(10, Math.floor(Math.log10(data.sigma / 5)));
    default: return 0.1;
  }
}

/**
 * A handle dragged to `p` (in the figure's pixels, at the drawing `size`): the edits that put its value there. A typed
 * number rounds to a step that suits the figure; a slider rounds to its own step and stays in its range. Bounds keep
 * their order. `hold` is what the drag began with (holdFigure).
 */
export function dragHandle(data: FigureData, size: Size, hold: FigureHold, handle: string, p: Point): FigureEdit[] {
  const view = hold.view.kind === data.kind ? hold.view : figureView(data);
  const step = typedStep(data, view);
  const q = (ref: ArgRef, v: number) => (ref.k === 'text' ? quantize(v, step) : v);
  switch (data.kind) {
    case 'unit-circle': {
      if (handle !== 'point') return [];
      const { cx, cy } = unitCircleFrame(size);
      const turn = turnOf(data.deg);
      let a = Math.atan2(cy - p.y, p.x - cx);
      if (a < 0) a += 2 * Math.PI;
      let v = data.deg ? (a * 180) / Math.PI : a;
      // Past a full turn when it was typed so: the drag keeps the turns it had.
      v += Math.floor(data.theta / turn) * turn;
      return edits(data.text, [{ ref: data.arg, v: q(data.arg, v) }], hold);
    }
    case 'tangent': {
      if (handle !== 'point') return [];
      const v = view as Extract<FigureView, { kind: 'tangent' }>;
      const { A } = tangentFrame(size, v);
      const x = Math.max(v.x0, Math.min(v.x1, A.ix(p.x)));
      return edits(data.text, [{ ref: data.arg, v: q(data.arg, x) }], hold);
    }
    case 'normal': {
      const v = view as Extract<FigureView, { kind: 'normal' }>;
      const { m } = normalFrame(size, v);
      if (handle !== 'hi' && handle !== 'lo') return [];
      const k = handle === 'hi' ? 1 : 0;
      let x = q(data.args[k], Math.max(v.x0, Math.min(v.x1, m.ix(p.x))));
      x = k ? Math.max(x, data.lo) : Math.min(x, data.hi);
      return edits(data.text, [{ ref: data.args[k], v: x }], hold);
    }
    case 'matrix': {
      const v = view as Extract<FigureView, { kind: 'matrix' }>;
      const { U, cx, cy } = matrixFrame(size, v);
      const x = (p.x - cx) / U, y = (cy - p.y) / U;
      const [rx, ry] = handle === 'j' ? [data.cells[1], data.cells[3]] : handle === 'i' ? [data.cells[0], data.cells[2]] : [];
      if (!rx || !ry) return [];
      return edits(data.text, [{ ref: rx, v: rx.k === 'text' ? r1(x) : x }, { ref: ry, v: ry.k === 'text' ? r1(y) : y }], hold);
    }
    default: return [];
  }
}

export type NudgeKey = 'left' | 'right' | 'up' | 'down';
/**
 * A handle moved by a key: one step (ten with `big`), up and right adding, down and left taking away; a matrix's tip
 * moves in the key's direction. A slider moves by its own step.
 */
export function nudgeHandle(data: FigureData, hold: FigureHold | null, handle: string, key: NudgeKey, big = false): FigureEdit[] {
  const view = hold?.view.kind === data.kind ? hold.view : figureView(data);
  const sign = key === 'right' || key === 'up' ? 1 : -1;
  const by = (ref: ArgRef) => (ref.k === 'slider' ? (hold?.ranges.get(ref.id) ?? ref.range).step : typedStep(data, view)) * (big ? 10 : 1) * sign;
  switch (data.kind) {
    case 'unit-circle': return handle === 'point' ? edits(data.text, [{ ref: data.arg, v: data.theta + by(data.arg) }], hold) : [];
    case 'tangent': return handle === 'point' ? edits(data.text, [{ ref: data.arg, v: data.p + by(data.arg) }], hold) : [];
    case 'normal': {
      if (handle !== 'hi' && handle !== 'lo') return [];
      const k = handle === 'hi' ? 1 : 0;
      let x = (k ? data.hi : data.lo) + by(data.args[k]);
      x = k ? Math.max(x, data.lo) : Math.min(x, data.hi);
      return edits(data.text, [{ ref: data.args[k], v: x }], hold);
    }
    case 'matrix': {
      const [ix, iy] = handle === 'j' ? [1, 3] : handle === 'i' ? [0, 2] : [-1, -1];
      if (ix < 0) return [];
      const horiz = key === 'left' || key === 'right';
      const ref = data.cells[horiz ? ix : iy], at = data.m[horiz ? ix : iy];
      return edits(data.text, [{ ref, v: ref.k === 'text' ? r1(at + by(ref)) : at + by(ref) }], hold);
    }
    default: return [];
  }
}

/** The line with its Riemann rule set: the fifth input rewritten, or added after the fourth. */
export function riemannRuleText(data: RiemannData, rule: RiemannRule): string | null {
  const t = data.text, word = `"${rule}"`;
  if (data.ruleSpan) return t.slice(0, data.ruleSpan[0]) + word + t.slice(data.ruleSpan[1]);
  if (data.ruleAt !== null) return `${t.slice(0, data.ruleAt)}, ${word}${t.slice(data.ruleAt)}`;
  return null;
}
