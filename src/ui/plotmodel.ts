import type { GraphItem, RowResult } from '../engine/document';
import { children, isGraphVar, lettersOf } from '../engine/ast';
import { BUILTINS, CONSTANTS } from '../engine/builtins';
import { canonicalName } from '../engine/lexer';
import { binomPdf, normBetween, normPdf } from '../engine/numeric';
import { parse, type Node } from '../engine/parser';
import type { DocRow } from './document';
import { wholeAwareRange } from './slider';

export type Distribution = Extract<GraphItem, { type: 'normal' | 'binom' }>;

export const isDistribution = (it: GraphItem): it is Distribution => it.type === 'normal' || it.type === 'binom';

/** One closure per item, so a renderer can cache what it sampled by function. */
const pdfs = new WeakMap<object, (x: number) => number>();
export function normalPdf(it: Extract<GraphItem, { type: 'normal' }>): (x: number) => number {
  let pdf = pdfs.get(it);
  if (!pdf) {
    pdf = (x: number) => normPdf((x - it.mu) / it.sigma) / it.sigma;
    pdfs.set(it, pdf);
  }
  return pdf;
}

/** How a binomial's peak is found still differs by renderer. */
function distCorners(it: Distribution, binomPeak: (it: Extract<GraphItem, { type: 'binom' }>, mean: number) => number): [number, number][] {
  if (it.type === 'normal') return [[it.mu - 4 * it.sigma, 0], [it.mu + 4 * it.sigma, normPdf(0) / it.sigma]];
  const mean = it.n * it.p, sd = Math.sqrt(it.n * it.p * (1 - it.p)) || 1;
  return [[Math.max(-0.5, mean - 4.5 * sd), 0], [Math.min(it.n + 0.5, mean + 4.5 * sd), binomPeak(it, mean)]];
}

/** Where f changes sign between a and b by blowing up, or null for a plain jump like floor(x). */
function poleBetween(f: (x: number) => number, a: number, b: number): number | null {
  let lo = a, hi = b, flo = f(lo);
  for (let k = 0; k < 50; k++) {
    const m = (lo + hi) / 2;
    if (m === lo || m === hi) break;
    const fm = f(m);
    if (!Number.isFinite(fm)) { lo = hi = m; break; }
    if (fm * flo > 0) { lo = m; flo = fm; } else hi = m;
  }
  const m = (lo + hi) / 2, step = (b - a) * 1e-6;
  // The smaller neighbour: a sample that lands almost on the pole is already huge, and must not hide it.
  return Math.min(Math.abs(f(m - step)), Math.abs(f(m + step))) >= 100 * Math.min(Math.abs(f(a)), Math.abs(f(b))) ? m : null;
}

/** How big a jump between samples, as a share of the plot's height, is worth testing for a pole. */
export const POLE_JUMP = 0.25;

export function asymptoteAcross(f: (x: number) => number, a: number, ya: number, b: number, yb: number): number | null {
  return ya * yb < 0 ? poleBetween(f, a, b) : null;
}

/** The asymptotes to draw: past 40 the view is zoomed so far out that they'd be a solid block. */
export const asymptotesToDraw = (xs: readonly number[]): readonly number[] => (xs.length > 40 ? [] : xs);

/** Null when it's too short to have a direction, a zero vector among them. */
export function vectorArrow(x0: number, y0: number, x1: number, y1: number): { base: [number, number]; left: [number, number]; right: [number, number] } | null {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2) return null;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  const head = Math.min(13, len * 0.5), wing = head * 0.45;
  const bx = x1 - ux * head, by = y1 - uy * head;
  return { base: [bx, by], left: [bx - uy * wing, by + ux * wing], right: [bx + uy * wing, by - ux * wing] };
}

/** On and off lengths of the dashes along a strict inequality's boundary, in pixels. */
export const BOUNDARY_DASH = [7, 5];

export function isDashed(it: GraphItem): boolean {
  return (it.type === 'fx' || it.type === 'fy' || it.type === 'implicit') && (it.ineq === '<' || it.ineq === '>');
}

export function shadeProb(it: Extract<GraphItem, { type: 'normal' }>, lo: number, hi: number): number {
  return normBetween((lo - it.mu) / it.sigma, (hi - it.mu) / it.sigma);
}

export function shadeLabel(prob: number): string {
  return prob >= 0.0001 ? `${(prob * 100).toFixed(prob >= 0.1 ? 1 : 2)}%` : prob.toExponential(1);
}

/** One press of a zoom key or button, on every platform. */
export const ZOOM_STEP = 1.4;

const HOME_HALF_WIDTH = 10;

/** How much of the plot, in pixels, the bars and controls floating over it hide at the top and bottom. */
export interface PlotCover { top: number; bottom: number }
export const NO_COVER: PlotCover = { top: 0, bottom: 0 };

/** The home view, centered on the part of the plot that isn't covered. */
export function homeView(w: number, h: number, cover: PlotCover = NO_COVER): { xmin: number; xmax: number; ymin: number; ymax: number } {
  const yHalf = w ? (HOME_HALF_WIDTH * h) / w : 7;
  const shift = w && h ? ((cover.bottom - cover.top) / 2) * ((2 * yHalf) / h) : 0;
  return { xmin: -HOME_HALF_WIDTH, xmax: HOME_HALF_WIDTH, ymin: -yHalf - shift, ymax: yHalf - shift };
}

/** The view that shows v's y range in the uncovered part of a plot h pixels tall. */
export function clearOfCover(v: PlotView, h: number, cover: PlotCover): PlotView {
  const clear = h - cover.top - cover.bottom;
  if (clear <= 0 || (!cover.top && !cover.bottom)) return v;
  const u = (v.ymax - v.ymin) / clear;
  return { xmin: v.xmin, xmax: v.xmax, ymin: v.ymin - cover.bottom * u, ymax: v.ymax + cover.top * u };
}

export interface PlotView { xmin: number; xmax: number; ymin: number; ymax: number }

export const goodSpan = (lo: number, hi: number): boolean => lo < hi && Number.isFinite(hi - lo);

const near = (a: number, b: number, span: number) => Math.abs(a - b) <= span * 1e-3;

/** Whether the view is what Home would show, so its button has nothing to do. */
export function isHomeView(v: PlotView, w: number, h: number, cover: PlotCover = NO_COVER): boolean {
  const home = homeView(w, h, cover), xr = home.xmax - home.xmin, yr = home.ymax - home.ymin;
  return near(v.xmin, home.xmin, xr) && near(v.xmax, home.xmax, xr) && near(v.ymin, home.ymin, yr) && near(v.ymax, home.ymax, yr);
}

/** Whether one x unit and one y unit are the same length on screen. */
export function isSquareView(v: PlotView, w: number, h: number): boolean {
  const ux = (v.xmax - v.xmin) / (w || 1), uy = (v.ymax - v.ymin) / (h || 1);
  return Math.abs(ux - uy) <= ux * 1e-3;
}

export const NOTHING_TO_FIT = 'Nothing to fit';

/** How much wider than the narrowest curve's range another curve may run before Fit stops following it. */
const FIT_RATIO = 6;
/** How far past the narrowest curve's range, in those ranges, Fit keeps a wider curve in view. */
const FIT_REACH = 1.5;

/**
 * The curves y = f(x) framed across the x range already in view: y from low to high with each curve's outer 3% dropped,
 * so a pole doesn't flatten everything else. A curve far wider than the narrowest (a parabola beside a sine) is followed
 * only a little past that one's range, or Fit would press the narrow curve into a line. Null when there's too little to
 * frame.
 */
export function fitCurves(fs: readonly ((x: number) => number)[], v: PlotView): PlotView | null {
  const ranges = fs.flatMap((f) => {
    const ys: number[] = [];
    for (let i = 0; i <= 160; i++) {
      let y: number;
      try { y = f(v.xmin + ((v.xmax - v.xmin) * i) / 160); } catch { continue; }
      if (Number.isFinite(y)) ys.push(y);
    }
    if (ys.length < 8) return [];
    ys.sort((a, b) => a - b);
    return [{ lo: ys[Math.floor(ys.length * 0.03)], hi: ys[Math.ceil(ys.length * 0.97) - 1] }];
  });
  if (!ranges.length) return null;
  const narrow = ranges.reduce<{ lo: number; hi: number } | null>((best, r) => (r.hi - r.lo > 1e-9 && (!best || r.hi - r.lo < best.hi - best.lo) ? r : best), null);
  const span0 = narrow ? narrow.hi - narrow.lo : 0;
  let lo = Infinity, hi = -Infinity;
  for (const r of ranges) {
    const capLo = narrow ? Math.max(r.lo, narrow.lo - FIT_REACH * span0) : r.lo, capHi = narrow ? Math.min(r.hi, narrow.hi + FIT_REACH * span0) : r.hi;
    // Capped only when some of it stays in frame: a curve wholly above or below still has to show.
    const capped = !!narrow && r.hi - r.lo > FIT_RATIO * span0 && capLo < capHi;
    lo = Math.min(lo, capped ? capLo : r.lo);
    hi = Math.max(hi, capped ? capHi : r.hi);
  }
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const span = hi - lo;
  if (lo > 0 && lo < span * 0.5) lo = 0;
  if (hi < 0 && -hi < span * 0.5) hi = 0;
  const pad = (hi - lo) * 0.12;
  return { xmin: v.xmin, xmax: v.xmax, ymin: lo - pad, ymax: hi + pad };
}

/** The curves a Fit can frame: every plain y = f(x), since an inequality's shading has no top or bottom. */
export const fittableCurves = (items: readonly GraphItem[]): ((x: number) => number)[] => items.flatMap((it) => (it.type === 'fx' && !it.ineq ? [it.f] : []));

export function squareView(v: PlotView, w: number, h: number): PlotView {
  const s = Math.max((v.xmax - v.xmin) / w, (v.ymax - v.ymin) / h), cx = (v.xmin + v.xmax) / 2, cy = (v.ymin + v.ymax) / 2;
  return { xmin: cx - (s * w) / 2, xmax: cx + (s * w) / 2, ymin: cy - (s * h) / 2, ymax: cy + (s * h) / 2 };
}

/**
 * The view that frames the items with a size of their own between the covers, or null when none has one. square says the
 * axes share a scale.
 */
export function fitBounds(items: readonly GraphItem[], w: number, h: number, binomPeak: Parameters<typeof distCorners>[1], cover: PlotCover = NO_COVER): { view: PlotView; square: boolean } | null {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  };
  for (const it of items) {
    if (isDistribution(it)) for (const [x, y] of distCorners(it, binomPeak)) add(x, y);
    else if (it.type === 'points' || it.type === 'polygon') for (const p of it.pts) add(p[0], p[1]);
    else if (it.type === 'vector') { add(0, 0); add(it.to[0], it.to[1]); }
  }
  if (!Number.isFinite(xmin)) return null;
  const dists = items.every(isDistribution);
  const pw = (xmax - xmin || 2) * 0.15, ph = (ymax - ymin || 2) * 0.15;
  const padded = { xmin: xmin - pw, xmax: xmax + pw, ymin: ymin - ph, ymax: ymax + ph };
  // Squared against the uncovered height, so growing the y range out over the covers leaves the scales equal.
  const clear = h - cover.top - cover.bottom;
  const framed = dists ? { xmin, xmax, ymin: -0.12 * ymax, ymax: ymax * 1.18 } : w ? squareView(padded, w, clear > 0 ? clear : h) : padded;
  const view = clearOfCover(framed, h, cover);
  // Points too far apart to subtract (±1e308) give no usable view.
  return goodSpan(view.xmin, view.xmax) && goodSpan(view.ymin, view.ymax) ? { view, square: !dists } : { view: homeView(w, h, cover), square: true };
}

export function distFitKey(items: readonly GraphItem[]): string {
  return items.filter(isDistribution).map((it) => (it.type === 'normal' ? `n${it.mu},${it.sigma}` : `b${it.n},${it.p}`)).join('|');
}

/** Whether a distribution would be off screen or squashed in this view, so sliding μ inside the view stays steady. */
export function distNeedsFit(items: readonly GraphItem[], v: PlotView): boolean {
  return items.filter(isDistribution).some((it) => {
    const mean = it.type === 'binom' ? it.n * it.p : it.mu;
    const sd = it.type === 'binom' ? Math.sqrt(it.n * it.p * (1 - it.p)) || 1 : it.sigma;
    const lo = mean - 3 * sd, hi = mean + 3 * sd;
    const peak = it.type === 'binom' ? binomPeakAtMean(it, mean) : normPdf(0) / it.sigma;
    const overlap = Math.max(0, Math.min(hi, v.xmax) - Math.max(lo, v.xmin)) / (hi - lo);
    return overlap < 0.9 || v.xmax - v.xmin > 12 * (hi - lo) || peak > v.ymax || peak < 0.25 * v.ymax || v.ymin > 0;
  });
}

/** Whether the line reads this name, spelled out or as a letter of a product like nx, read the way the engine reads it. */
function usesVariable(text: string, name: string, known: (n: string) => boolean): boolean {
  const reads = (n: Node): boolean => {
    if (n.k === 'id' || (n.k === 'call' && !n.base)) {
      if (n.name === name) return true;
      if (!known(n.name) && !(n.k === 'call' && n.name in BUILTINS) && lettersOf(n.name, known)?.includes(name)) return true;
    }
    return children(n).some(reads);
  };
  // A definition's left side says what it defines, not what it reads.
  for (const src of [text, text.replace(/^[^=]*=/, '')]) {
    try {
      return reads(parse(src));
    } catch {
      continue;
    }
  }
  return false;
}

export interface GraphSlider { row: ExprLine; name: string; value: number }

/** A slider for each number a drawn line uses, in sheet order, on every platform's Graph tab. */
export function slidersOnGraph(rows: readonly DocRow[], results: readonly (RowResult | undefined)[]): GraphSlider[] {
  const defined = new Set(results.flatMap((r) => (r?.defines ? [r.defines] : [])));
  const known = (n: string) => isGraphVar(n) || defined.has(n) || n in CONSTANTS;
  const drawn = rows.flatMap((row, k) => (row.kind === 'expr' && !row.hidden && results[k]?.id === row.id && !results[k]?.error && results[k]?.graph.length ? [row.text] : []));
  return rows.flatMap((row, k) => {
    const r = results[k];
    return row.kind === 'expr' && r?.slider && !r.error && drawn.some((text) => usesVariable(text, r.slider!.name, known)) ? [{ row, name: r.slider.name, value: r.slider.value }] : [];
  });
}

function pointNames(text: string): [string, string] | null {
  const m = /^\(\s*([^,()\s]+)\s*,\s*([^,()\s]+)\s*\)$/.exec(text.trim());
  return m ? [m[1], m[2]] : null;
}

type ExprLine = Extract<DocRow, { kind: 'expr' }>;

export interface DraggablePoint {
  x: number;
  y: number;
  xLine: ExprLine;
  yLine: ExprLine;
  /** The two names as the point's line spells them, which is what a drag writes. */
  labels: [string, string];
}

export function draggablePoints(rows: readonly DocRow[], results: readonly (RowResult | undefined)[]): DraggablePoint[] {
  const sliders = new Map<string, { line: ExprLine; value: number }>();
  // By the rows, not the results: right after Clear all the results still list the old lines.
  rows.forEach((row, k) => {
    const r = results[k];
    if (r?.slider && !r.error && row.kind === 'expr') sliders.set(r.slider.name, { line: row, value: r.slider.value });
  });
  return rows.flatMap((row, k) => {
    if (row.kind !== 'expr' || row.hidden || results[k]?.error) return [];
    const names = pointNames(row.text);
    const sx = names && sliders.get(canonicalName(names[0])), sy = names && sliders.get(canonicalName(names[1]));
    return names && sx && sy ? [{ x: sx.value, y: sy.value, xLine: sx.line, yLine: sy.line, labels: names }] : [];
  });
}

/** What a drag of the point to (x, y) writes: each value on its own slider's stops. */
export function draggedLines(p: DraggablePoint, x: number, y: number): { line: ExprLine; text: string }[] {
  const on = (v: number, line: ExprLine, value: number) => {
    const step = wholeAwareRange(value, line.slider).step;
    return Number((Math.round(v / step) * step).toPrecision(10));
  };
  return [
    { line: p.xLine, text: `${p.labels[0]} = ${on(x, p.xLine, p.x)}` },
    { line: p.yLine, text: `${p.labels[1]} = ${on(y, p.yLine, p.y)}` },
  ];
}

/**
 * Where a contour crosses a marching-squares cell with these corner values (a top left, b top right, c bottom right,
 * d bottom left), in the cell's unit square: two points, or four at a saddle.
 */
export function contourCrossings(a: number, b: number, c: number, d: number): [number, number][] {
  const lerp = (p: number, q: number) => (p === q ? 0.5 : p / (p - q));
  const pts: [number, number][] = [];
  if ((a < 0) !== (b < 0)) pts.push([lerp(a, b), 0]);
  if ((b < 0) !== (c < 0)) pts.push([1, lerp(b, c)]);
  if ((d < 0) !== (c < 0)) pts.push([lerp(d, c), 1]);
  if ((a < 0) !== (d < 0)) pts.push([0, lerp(a, d)]);
  return pts;
}

// Not followed by another letter, except x: sin(x), sin x, sinx and sin2x all call sine, and sinh does not.
const TRIG_CALL = /\b(a?(sin|cos|tan|csc|sec|cot)|arc(sin|cos|tan))(?![a-wyzA-Z])/;
/** Only the periodic ones: asin and acos take −1…1, so a −360…360 window would leave them nothing to draw. */
const WAVE_CALL = /\b(sin|cos|tan|csc|sec|cot)(?![a-wyzA-Z])/;
export const callsWave = (text: string): boolean => WAVE_CALL.test(text);
const draws = (rows: readonly DocRow[], results: readonly (RowResult | undefined)[], call: RegExp) =>
  rows.some((row, k) => row.kind === 'expr' && !row.hidden && !!results[k]?.graph.length && call.test(row.text));

/** Whether the x axis reads in multiples of π: in radians, with a drawn line that calls a trig function. */
export function wantsPiTicks(rows: readonly DocRow[], results: readonly (RowResult | undefined)[], deg: boolean): boolean {
  return !deg && draws(rows, results, TRIG_CALL);
}

/** Whether Fit should frame whole waves: in degrees, where sin(x) across the usual −10…10 is a straight line. */
export function wantsDegreeWaves(rows: readonly DocRow[], results: readonly (RowResult | undefined)[], deg: boolean): boolean {
  return deg && draws(rows, results, WAVE_CALL);
}

/** One wave of sin(x) in degrees. A view narrower than this widens to two waves, −360…360, before Fit frames the curves. */
export const DEGREE_WAVE = 360;
export const degreeWaves = (v: PlotView): PlotView => (v.xmax - v.xmin >= DEGREE_WAVE ? v : { ...v, xmin: -DEGREE_WAVE, xmax: DEGREE_WAVE });

export interface PiStep { step: number; num: number; den: number }

const PI_STEPS: [number, number][] = [[1, 12], [1, 6], [1, 4], [1, 2], [1, 1], [2, 1], [4, 1], [8, 1], [16, 1], [32, 1], [64, 1], [128, 1]];

/** Null past either end of the scale: zoomed in, under two labels would fit; zoomed out, they'd run together. Decimals label those. */
export function piStep(span: number, width: number): PiStep | null {
  if (span < Math.PI / 6) return null;
  for (const [num, den] of PI_STEPS) {
    const step = (Math.PI * num) / den;
    if ((step / span) * width >= 70) return { step, num, den };
  }
  return null;
}

export function tickLabel(v: number, step: number, plusSign = false): string {
  if (Math.abs(v) < step / 1e6) return '0';
  const abs = Math.abs(v);
  let s: string;
  if (abs >= 1e6 || abs < 1e-4) s = plusSign ? v.toExponential(1) : v.toExponential(1).replace('e+', 'e');
  else {
    const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    s = v.toFixed(decimals);
  }
  return s.replace('-', '−');
}


export const binomPeakAtMean = (it: Extract<GraphItem, { type: 'binom' }>, mean: number) => binomPdf(it.n, it.p, Math.round(mean));
