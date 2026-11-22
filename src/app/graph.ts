import { sameGraphItem, type GraphItem } from '../engine/document';
import { normPdf, binomPdf } from '../engine/numeric';
import { probLabelPlacement } from '../ui/problabel';
import { niceStep, tickValues } from '../ui/ticks';
import { nameSpot, piLabel, yTickSpot } from '../ui/graphlabels';
import { downloadBlob, fileDate } from './download';
import { findMarks, markText, type Mark } from '../ui/pois';
import { asymptoteAcross, asymptotesToDraw, BOUNDARY_DASH, POLE_JUMP, clearOfCover, contourCrossings, DEGREE_WAVE, degreeWaves, distNeedsFit, fitBounds, fitCurves, fittableCurves, goodSpan, homeView, isHomeView, isDashed, NO_COVER, normalPdf, type PlotCover, type PiStep, piStep, type PlotView as View, shadeLabel, shadeProb, squareView, tickLabel, vectorArrow } from '../ui/plotmodel';

/** The face of the graph's numbers and labels: a fixed stack on purpose, because canvas text doesn't follow the look. */
const LABEL_FONT = '"Superscripts", "Geist Mono", "IBM Plex Mono", "IBM Plex Sans", ui-monospace, monospace';
/** How near a pointer must come to a draggable point, in CSS pixels, to grab it. */
const GRAB_RADIUS = 12;
/** How near a pointer must come to a mark, in CSS pixels, to read it exactly. */
const MARK_SNAP = 9;

export interface Drawable {
  rowId: string;
  color: string;
  item: GraphItem;
  label?: string;
  text?: string;
}

/** A point the user can drag; onMove gets graph coordinates. */
export interface Draggable {
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  onEnd?: () => void;
}

interface Target {
  x: number;
  y: number;
  color: string;
  kind?: string;
  rowId: string | null;
}

interface Theme {
  bg: string;
  grid: string;
  gridMajor: string;
  axis: string;
  label: string;
  labelBg: string;
  chip: string;
  chipEdge: string;
  flat: boolean;
  weight: number;
  chipRadius: number;
  hatch: boolean;
  glow: boolean;
  nameFace: string;
  nameRadius: number;
  toolCol: number;
}

function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: v('--graph-bg'),
    grid: v('--graph-grid'),
    gridMajor: v('--graph-grid-major'),
    axis: v('--graph-axis'),
    label: v('--ink-2'),
    labelBg: v('--graph-bg'),
    chip: v('--panel') || v('--graph-bg'),
    chipEdge: v('--rule-2') || v('--graph-grid-major'),
    flat: !!document.documentElement.dataset.theme?.startsWith('contrast'),
    hatch: v('--graph-hatch') === '1',
    glow: v('--graph-glow') === '1',
    weight: Number(v('--graph-weight')) || 2,
    chipRadius: Number(v('--graph-chip-radius')) || 3,
    nameFace: v('--graph-name-face') || 'system-ui, sans-serif',
    nameRadius: Number(v('--graph-name-radius')) || 2,
    toolCol: parseFloat(v('--graph-tool-col')) || 0,
  };
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Whether the segment from (x0, y0) to (x1, y1) touches the box l, t, r, b (Liang–Barsky clipping). */
function segHitsBox(x0: number, y0: number, x1: number, y1: number, l: number, t: number, r: number, b: number): boolean {
  if (Math.max(x0, x1) < l || Math.min(x0, x1) > r || Math.max(y0, y1) < t || Math.min(y0, y1) > b) return false;
  const dx = x1 - x0, dy = y1 - y0;
  let u0 = 0, u1 = 1;
  for (const [p, q] of [[-dx, x0 - l], [dx, r - x0], [-dy, y0 - t], [dy, b - y0]]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const u = q / p;
    if (p < 0) {
      if (u > u1) return false;
      u0 = Math.max(u0, u);
    } else {
      if (u < u0) return false;
      u1 = Math.min(u1, u);
    }
  }
  return true;
}

function shortNum(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : 'undefined';
  const a = Math.abs(v);
  let s = a !== 0 && (a >= 1e6 || a < 1e-4) ? v.toExponential(3) : String(Number(v.toPrecision(5)));
  s = s.replace('e+', 'e');
  return s.replace('-', '−');
}

function sameDrawables(a: Drawable[], b: Drawable[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i];
    if (p.rowId !== q.rowId || p.color !== q.color || p.label !== q.label || p.text !== q.text || !sameGraphItem(p.item, q.item)) return false;
  }
  return true;
}

export class Graph {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  view: View = { xmin: -10, xmax: 10, ymin: -7, ymax: 7 };
  private placed = false;
  items: Drawable[] = [];
  private theme!: Theme;
  private hover: { px: number; py: number } | null = null;
  private pending = false;
  squareAxes = true;
  onViewChange?: () => void;
  private hoverRowId: string | null = null;
  private piTicks = false;
  private degreeWaves = false;
  private asymptotes = true;
  onPin?: () => void;
  private activeRowId: string | null = null;
  private pois: Mark[] = [];
  private pins: Target[] = [];
  /** Shift+drag zoom rectangle, in CSS pixels, while it's being drawn. */
  private zoomBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private draggables: Draggable[] = [];
  private poiKey = '';
  private poiItems: Drawable[] | null = null;

  private scene: HTMLCanvasElement;
  private sceneCtx: CanvasRenderingContext2D;
  private sceneKey = '';
  private sceneItems: Drawable[] | null = null;
  /**
   * Sampled curves, contours and fills per function, valid while the view and size stay put. The engine hands back
   * the same function object for a line that didn't change, so typing on one line re-samples only that line's curve,
   * and recolouring or reweighting a curve (hover, selection) re-samples nothing.
   */
  private runCache = new Map<unknown, [number, number][][]>();
  private poleCache = new Map<unknown, number[]>();
  private contourCache = new Map<unknown, Float32Array>();
  private fillCache = new Map<unknown, Float32Array>();
  private cacheView = '';
  /** What this frame plotted, in CSS pixels, so the origin's 0 can keep off it: sampled runs, and contour segments as x0, y0, x1, y1. */
  private plotted: [number, number][][] = [];
  private plottedSegs: Float32Array[] = [];
  private owners: { d: Drawable; p0: number; p1: number; s0: number; s1: number }[] = [];
  /** The curve names the last frame drew, in CSS pixels, for scripts and checks. */
  curveNames: { rowId: string; text: string; box: [number, number, number, number] }[] = [];
  private usedBoxes: [number, number, number, number][] = [];
  private poiTimer = 0;
  private coarse = false;
  private labelChip = 14;
  private viewMovedAt = 0;
  private cover: PlotCover = NO_COVER;
  private refineTimer = 0;

  private _motionOff = false;
  get motionOff(): boolean { return this._motionOff; }
  set motionOff(off: boolean) {
    if (off === this._motionOff) return;
    this._motionOff = off;
    if (!off) return;
    // A policy change takes ownership now, rather than only guarding the next animation's start.
    const target = this.glideTarget;
    this.cancelViewMotion();
    if (target) this.view = target;
    this.redraw();
    this.onViewChange?.();
  }
  /** The shortest gap between draws in ms, from the Graph frame rate setting. */
  frameGap = 0;
  private drawnAt = 0;

  constructor(private host: HTMLElement, private isPhone: () => boolean = () => false) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'graph-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.scene = document.createElement('canvas');
    this.sceneCtx = this.scene.getContext('2d')!;
    this.theme = readTheme(host);
    new ResizeObserver(() => this.resize()).observe(host);
    this.bindPointer();
  }

  private viewPlaced(): boolean {
    const v = this.view;
    return this.placed && goodSpan(v.xmin, v.xmax) && goodSpan(v.ymin, v.ymax);
  }

  /** How much the canvas the graph sits on is zoomed, so the plot draws at the pixels it covers on screen. */
  private zoomScale = 1;
  setZoom(scale: number): void {
    if (Math.abs(scale - this.zoomScale) < 0.01) return;
    this.zoomScale = scale;
    this.resize();
  }

  private resize(): void {
    // Layout size, not the on-screen box: the graph block can sit on a zoomed canvas, and the plot works in its own
    // pixels (pointer offsets are in them too).
    const r = { width: this.host.clientWidth, height: this.host.clientHeight };
    if (r.width === 0 || r.height === 0) return;
    const oldW = this.w, oldH = this.h;
    this.w = r.width;
    this.h = r.height;
    this.dpr = (window.devicePixelRatio || 1) * Math.max(0.5, Math.min(2, this.zoomScale));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.scene.width = this.canvas.width;
    this.scene.height = this.canvas.height;
    this.sceneKey = '';
    if (oldW === 0) {
      const v = this.view;
      if (!this.viewPlaced()) this.reset();
      else if (this.squareAxes) this.view = squareView(v, this.w, this.h);
    } else if (this.squareAxes) {
      const sx = (this.view.xmax - this.view.xmin) / oldW;
      const sy = (this.view.ymax - this.view.ymin) / oldH;
      const cx = (this.view.xmin + this.view.xmax) / 2, cy = (this.view.ymin + this.view.ymax) / 2;
      this.view = { xmin: cx - (sx * this.w) / 2, xmax: cx + (sx * this.w) / 2, ymin: cy - (sy * this.h) / 2, ymax: cy + (sy * this.h) / 2 };
    }
    this.redraw();
  }

  refreshTheme(): void {
    // A graph block that isn't on the page (nothing draws yet, or it's hidden) reads the page's colors instead.
    this.theme = readTheme(this.host.isConnected ? this.host : document.body);
    this.sceneKey = '';
    this.redraw();
  }

  pan(fx: number, fy: number): void {
    this.cancelViewMotion();
    const dx = (this.view.xmax - this.view.xmin) * fx, dy = (this.view.ymax - this.view.ymin) * fy;
    this.view = { xmin: this.view.xmin + dx, xmax: this.view.xmax + dx, ymin: this.view.ymin + dy, ymax: this.view.ymax + dy };
    this.redraw();
    this.onViewChange?.();
  }

  reset(animate = false): void {
    this.moveTo(homeView(this.w, this.h, this.cover), true, animate);
  }

  /** How much of the plot the controls floating over it hide. A view still at home stays centered on what's left. */
  setCover(cover: PlotCover): void {
    if (cover.top === this.cover.top && cover.bottom === this.cover.bottom) return;
    const wasHome = this.isHome;
    this.cover = cover;
    if (wasHome && this.w) this.view = homeView(this.w, this.h, cover);
    this.redraw();
    this.onViewChange?.();
  }

  makeSquare(): void {
    if (!this.w) {
      this.squareAxes = true;
      return;
    }
    const { xmin, xmax, ymin, ymax } = this.view;
    const cy = (ymin + ymax) / 2;
    const yr = ((xmax - xmin) * this.h) / this.w;
    this.moveTo({ xmin, xmax, ymin: cy - yr / 2, ymax: cy + yr / 2 }, true, true);
  }

  zoomStep(factor: number): void {
    this.zoom(factor, this.w / 2, this.h / 2, true);
  }

  zoom(factor: number, px = this.w / 2, py = this.h / 2, animate = false): void {
    const base = (animate && this.glideTarget) || this.view;
    const x = base.xmin + (px / this.w) * (base.xmax - base.xmin);
    const y = base.ymax - (py / this.h) * (base.ymax - base.ymin);
    const { xmin, xmax, ymin, ymax } = base;
    const next = { xmin: x - (x - xmin) * factor, xmax: x + (xmax - x) * factor, ymin: y - (y - ymin) * factor, ymax: y + (ymax - y) * factor };
    // Zooming in stops while the span is still well above the spacing of doubles, where the view would collapse to a
    // point that no zoom out can grow back from. Zooming out stops before the span overflows.
    const span = (lo: number, hi: number) => hi - lo;
    const tiny = (lo: number, hi: number) => !(span(lo, hi) > Math.max(1e-12 * Math.max(Math.abs(lo), Math.abs(hi)), 1e-300));
    if (factor < 1 && (tiny(next.xmin, next.xmax) || tiny(next.ymin, next.ymax))) return;
    if (factor > 1 && !(span(next.xmin, next.xmax) < 1e300 && span(next.ymin, next.ymax) < 1e300)) return;
    this.moveTo(next, this.squareAxes, animate);
  }

  private glideFrame = 0;
  private glideTarget: View | null = null;

  private cancelViewMotion(): void {
    cancelAnimationFrame(this.flingFrame);
    cancelAnimationFrame(this.glideFrame);
    this.flingFrame = this.glideFrame = 0;
    this.glideTarget = null;
  }

  private moveTo(v: View, square: boolean, animate: boolean): void {
    this.placed = true;
    // Fit, Home and the keys take over from a touch pan's coast.
    this.cancelViewMotion();
    if (!animate || this.motionOff || !this.w) {
      this.view = v;
      this.squareAxes = square;
      this.redraw();
      this.onViewChange?.();
      return;
    }
    const from = this.view;
    const t0 = performance.now();
    const ms = 260;
    const fcx = (from.xmin + from.xmax) / 2, fcy = (from.ymin + from.ymax) / 2;
    const tcx = (v.xmin + v.xmax) / 2, tcy = (v.ymin + v.ymax) / 2;
    const fw = from.xmax - from.xmin, fh = from.ymax - from.ymin;
    const rw = (v.xmax - v.xmin) / fw, rh = (v.ymax - v.ymin) / fh;
    this.squareAxes = square;
    this.glideTarget = v;
    let shown = from;
    const step = (now: number) => {
      if (this.view !== shown) {
        this.glideTarget = null;
        this.glideFrame = 0;
        return;
      }
      const u = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - u, 3);
      const cx = fcx + (tcx - fcx) * e, cy = fcy + (tcy - fcy) * e;
      const w = fw * Math.pow(rw, e), h = fh * Math.pow(rh, e);
      shown = u >= 1 ? v : { xmin: cx - w / 2, xmax: cx + w / 2, ymin: cy - h / 2, ymax: cy + h / 2 };
      this.view = shown;
      this.redraw();
      this.onViewChange?.();
      if (u < 1) this.glideFrame = requestAnimationFrame(step);
      else { this.glideTarget = null; this.glideFrame = 0; }
    };
    this.glideFrame = requestAnimationFrame(step);
  }

  distributionsNeedFit(): boolean {
    return distNeedsFit(this.items.map((d) => d.item), this.view);
  }

  fit(only?: (d: Drawable) => boolean, animate = false): boolean {
    const items = only ? this.items.filter(only) : this.items;
    const fitted = fitBounds(items.map((d) => d.item), this.w, this.h, (b, m) => Math.max(...[Math.floor(m), Math.ceil(m)].map((k) => binomPdf(b.n, b.p, Math.min(b.n, k)))), this.cover);
    if (!fitted) return false;
    this.moveTo(fitted.view, fitted.square, animate);
    return true;
  }

  private fxValues(f: (x: number) => number, n = 96): number[] {
    const { xmin, xmax } = this.view;
    const ys: number[] = [];
    for (let i = 0; i <= n; i++) {
      let y: number;
      try { y = f(xmin + ((xmax - xmin) * i) / n); } catch { continue; }
      if (Number.isFinite(y)) ys.push(y);
    }
    return ys;
  }

  /**
   * Whether a new curve y = f(x) shows in the view as a curve: at least 15% of it across the x range lands inside the
   * y range. A parabola under a bell curve's 0…0.45 doesn't (8%: it draws as two near-vertical strokes); y = x² − 3
   * in the usual −10…10 window does (a third of it, its whole bowl).
   */
  fnInView(f: (x: number) => number): boolean {
    const ys = this.fxValues(f);
    if (ys.length < 8) return true;
    const { ymin, ymax } = this.view;
    return ys.filter((y) => y >= ymin && y <= ymax).length >= ys.length * 0.15;
  }

  /** Whether a trig curve in degrees is squeezed into less than one wave, so it draws as a line. */
  get needsDegreeWaves(): boolean {
    return this.degreeWaves && this.view.xmax - this.view.xmin < DEGREE_WAVE;
  }

  fitFunctions(fs: readonly ((x: number) => number)[], animate = false): boolean {
    const v = fitCurves(fs, this.degreeWaves ? degreeWaves(this.view) : this.view);
    if (!v) return false;
    this.moveTo(clearOfCover(v, this.h, this.cover), false, animate);
    return true;
  }

  /** Fit's button: what has a size of its own, or else the curves. False when nothing can be framed. */
  fitAll(animate = false): boolean {
    return this.fit(undefined, animate) || this.fitFunctions(fittableCurves(this.items.map((d) => d.item)), animate);
  }

  get isHome(): boolean {
    return !this.w || isHomeView(this.view, this.w, this.h, this.cover);
  }

  toPx(x: number): number {
    return ((x - this.view.xmin) / (this.view.xmax - this.view.xmin)) * this.w;
  }
  toPy(y: number): number {
    return this.h - ((y - this.view.ymin) / (this.view.ymax - this.view.ymin)) * this.h;
  }
  toX(px: number): number {
    return this.view.xmin + (px / this.w) * (this.view.xmax - this.view.xmin);
  }
  toY(py: number): number {
    return this.view.ymin + ((this.h - py) / this.h) * (this.view.ymax - this.view.ymin);
  }

  private born = new Map<string, number>();
  private still = false;

  update(state: { items?: Drawable[]; draggables?: Draggable[]; piTicks?: boolean; degreeWaves?: boolean; asymptotes?: boolean; activeRowId?: string | null; hoverRowId?: string | null }): void {
    if (state.draggables !== undefined) this.draggables = state.draggables;
    if (state.piTicks !== undefined) this.piTicks = state.piTicks;
    if (state.degreeWaves !== undefined) this.degreeWaves = state.degreeWaves;
    if (state.asymptotes !== undefined) this.asymptotes = state.asymptotes;
    if (state.activeRowId !== undefined) this.activeRowId = state.activeRowId;
    if (state.hoverRowId !== undefined) this.hoverRowId = state.hoverRowId;
    if (state.items) this.setItems(state.items);
    this.redraw();
  }

  get hoveredRow(): string | null {
    return this.hoverRowId;
  }

  /** Curves traced faintly, dotted, where they were when a held slider's drag began. */
  private traces: Drawable[] = [];
  setTraces(items: Drawable[]): void {
    if (!items.length && !this.traces.length) return;
    this.traces = items;
    this.sceneKey = '';
    this.redraw();
  }
  private drawTraces(): void {
    const { ctx } = this;
    for (const d of this.traces) {
      const it = d.item;
      if (it.type !== 'fx' && it.type !== 'fy') continue;
      const runs = it.type === 'fx' ? this.sampleFx(it.f) : this.sampleFy(it.f);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.setLineDash([2, 5]);
      for (const run of runs) {
        ctx.beginPath();
        run.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private setItems(items: Drawable[]): void {
    if (sameDrawables(items, this.items)) return;
    const now = performance.now();
    const live = new Set(items.map((d) => d.rowId));
    for (const id of live) if (!this.born.has(id)) this.born.set(id, this.items.length || this.born.size ? now : now - 1e4);
    for (const id of [...this.born.keys()]) if (!live.has(id)) this.born.delete(id);
    this.pins = this.pins.filter((p) => p.rowId === null || live.has(p.rowId));
    this.items = items;
  }

  private progress(rowId: string): number {
    if (this.motionOff || this.still) return 1;
    const t = (performance.now() - (this.born.get(rowId) ?? 0)) / 520;
    if (t >= 1) return 1;
    return 1 - Math.pow(1 - t, 3);
  }

  redraw(): void {
    if (this.pending) return;
    this.pending = true;
    const tick = (now: number) => {
      if (now - this.drawnAt < this.frameGap) {
        requestAnimationFrame(tick);
        return;
      }
      this.pending = false;
      this.drawnAt = now;
      this.draw();
    };
    requestAnimationFrame(tick);
  }

  private bindPointer(): void {
    const c = this.canvas;
    let drag: { px: number; py: number; view: View } | null = null;
    let down: { px: number; py: number } | null = null;
    let moving: Draggable | null = null;
    let owner: number | null = null;
    // Fingers on the graph, for a pinch. Two down: the view scales about where they started and follows them, as on the phones.
    const fingers = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; cx: number; cy: number; view: View } | null = null;
    let lastTap = { t: 0, x: 0, y: 0 };
    // Where a finger's pan has been lately, for the speed it leaves with; a touch pan coasts after the finger lifts.
    let trail: { t: number; x: number; y: number }[] = [];
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.cancelViewMotion();
      trail = [];
      if (e.pointerType === 'touch') {
        fingers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (fingers.size === 2) {
          const [a, b] = [...fingers.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: { ...this.view } };
          owner = null;
          drag = null;
          down = null;
          moving?.onEnd?.();
          moving = null;
          c.classList.remove('dragging', 'moving');
          return;
        }
      }
      if (owner !== null) return;
      owner = e.pointerId;
      down = { px: e.offsetX, py: e.offsetY };
      if (e.shiftKey) {
        this.zoomBox = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY };
        return;
      }
      moving = this.draggables.find((d) => Math.hypot(this.toPx(d.x) - e.offsetX, this.toPy(d.y) - e.offsetY) < GRAB_RADIUS) ?? null;
      if (!moving) drag = { px: e.offsetX, py: e.offsetY, view: { ...this.view } };
      c.classList.add(moving ? 'moving' : 'dragging');
    });
    c.addEventListener('pointerup', (e) => {
      if (e.pointerId !== owner) return;
      const box = this.zoomBox;
      if (box) {
        this.zoomBox = null;
        down = null;
        const w = Math.abs(box.x1 - box.x0), hgt = Math.abs(box.y1 - box.y0);
        if (w > 8 && hgt > 8) {
          const xa = this.toX(Math.min(box.x0, box.x1)), xb = this.toX(Math.max(box.x0, box.x1));
          const ya = this.toY(Math.max(box.y0, box.y1)), yb = this.toY(Math.min(box.y0, box.y1));
          this.moveTo({ xmin: xa, xmax: xb, ymin: ya, ymax: yb }, false, false);
        } else this.redraw();
        return;
      }
      if (!moving && down && Math.hypot(e.offsetX - down.px, e.offsetY - down.py) < 4) {
        const now = performance.now();
        if (e.pointerType === 'touch' && now - lastTap.t < 300 && Math.hypot(e.offsetX - lastTap.x, e.offsetY - lastTap.y) < 24) {
          lastTap = { t: 0, x: 0, y: 0 };
          this.zoom(0.5, e.offsetX, e.offsetY, true);
          this.onViewChange?.();
        } else {
          lastTap = { t: now, x: e.offsetX, y: e.offsetY };
          if (this.togglePin(e.offsetX, e.offsetY)) this.onPin?.();
        }
      }
      down = null;
    });
    c.addEventListener('pointermove', (e) => {
      if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && fingers.size >= 2) {
        const [a, b] = [...fingers.values()];
        const k = pinch.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const sx = pinch.view.xmax - pinch.view.xmin, sy = pinch.view.ymax - pinch.view.ymin;
        const gx = pinch.view.xmin + (pinch.cx / this.w) * sx, gy = pinch.view.ymax - (pinch.cy / this.h) * sy;
        const next = { xmin: gx - (cx / this.w) * sx * k, xmax: gx + (1 - cx / this.w) * sx * k, ymin: gy - (1 - cy / this.h) * sy * k, ymax: gy + (cy / this.h) * sy * k };
        if (goodSpan(next.xmin, next.xmax) && goodSpan(next.ymin, next.ymax) && next.xmax - next.xmin > 1e-9 * Math.max(Math.abs(next.xmin), Math.abs(next.xmax), 1e-300)) {
          this.view = next;
          this.placed = true;
          this.redraw();
          this.onViewChange?.();
        }
        return;
      }
      const mine = e.pointerId === owner;
      if (this.zoomBox && mine) {
        this.zoomBox.x1 = e.offsetX;
        this.zoomBox.y1 = e.offsetY;
        this.redraw();
        return;
      }
      if (moving) {
        if (mine) moving.onMove(this.toX(e.offsetX), this.toY(e.offsetY));
      } else if (!drag) {
        const over = this.draggables.some((d) => Math.hypot(this.toPx(d.x) - e.offsetX, this.toPy(d.y) - e.offsetY) < GRAB_RADIUS);
        c.classList.toggle('grab', over);
      }
      if (drag && mine) {
        trail.push({ t: performance.now(), x: e.offsetX, y: e.offsetY });
        while (trail.length > 2 && trail[trail.length - 1].t - trail[0].t > 100) trail.shift();
        const dx = ((e.offsetX - drag.px) / this.w) * (drag.view.xmax - drag.view.xmin);
        const dy = ((e.offsetY - drag.py) / this.h) * (drag.view.ymax - drag.view.ymin);
        this.view = { xmin: drag.view.xmin - dx, xmax: drag.view.xmax - dx, ymin: drag.view.ymin + dy, ymax: drag.view.ymax + dy };
        this.onViewChange?.();
      }
      this.hover = { px: e.offsetX, py: e.offsetY };
      this.redraw();
    });
    const end = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (pinch) {
        if (fingers.size < 2) pinch = null;
        // The finger that's left carries on as a pan from here.
        const left = fingers.size === 1 ? [...fingers.entries()][0] : null;
        if (left) {
          owner = left[0];
          drag = { px: left[1].x, py: left[1].y, view: { ...this.view } };
        }
        return;
      }
      if (owner !== null && e.pointerId !== owner) return;
      owner = null;
      // Only a finger still moving as it lifts coasts: a drag, a pause and a lift stays where it was put.
      if (drag && e.pointerType === 'touch' && e.type === 'pointerup' && !this.motionOff && trail.length >= 2 && performance.now() - trail[trail.length - 1].t < 50) {
        const a = trail[0], b = trail[trail.length - 1], dt = b.t - a.t;
        if (dt > 0) this.fling((b.x - a.x) / dt, (b.y - a.y) / dt);
      }
      drag = null;
      moving?.onEnd?.();
      moving = null;
      c.classList.remove('dragging', 'moving');
      if (this.zoomBox) {
        this.zoomBox = null;
        this.redraw();
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.redraw();
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(Math.pow(1.0015, e.deltaY), e.offsetX, e.offsetY);
      },
      { passive: false },
    );
  }

  private flingFrame = 0;

  /** A touch pan's coast after the finger lifts, in px per ms, like the phone apps'. */
  private fling(vx: number, vy: number): void {
    const launch = Math.hypot(vx, vy);
    if (launch < 0.4) return;
    // A cap on the launch speed, so one flick can't throw the curves off the screen.
    if (launch > 2.4) {
      vx *= 2.4 / launch;
      vy *= 2.4 / launch;
    }
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      const keep = Math.pow(0.997, dt);
      vx *= keep;
      vy *= keep;
      if (Math.hypot(vx, vy) < 0.02) { this.flingFrame = 0; return; }
      const v = this.view, ux = (v.xmax - v.xmin) / this.w, uy = (v.ymax - v.ymin) / this.h;
      const mx = -vx * dt * ux, my = vy * dt * uy;
      this.view = { xmin: v.xmin + mx, xmax: v.xmax + mx, ymin: v.ymin + my, ymax: v.ymax + my };
      this.redraw();
      this.onViewChange?.();
      this.flingFrame = requestAnimationFrame(step);
    };
    this.flingFrame = requestAnimationFrame(step);
  }

  private drawScene(target: CanvasRenderingContext2D): boolean {
    const main = this.ctx;
    this.ctx = target;
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawGrid();
    let animating = false;
    const clipped = (d: Drawable, draw: () => void) => {
      const k = this.progress(d.rowId);
      if (k >= 1) return draw();
      animating = true;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, this.w * k, this.h);
      ctx.clip();
      draw();
      ctx.restore();
    };
    this.plotted = [];
    this.plottedSegs = [];
    this.owners = [];
    for (const d of this.items) clipped(d, () => this.drawFill(d));
    this.drawTraces();
    for (const d of this.items) {
      const p0 = this.plotted.length, s0 = this.plottedSegs.length;
      clipped(d, () => this.drawStroke(d));
      if (this.progress(d.rowId) >= 1) this.owners.push({ d, p0, p1: this.plotted.length, s0, s1: this.plottedSegs.length });
    }
    this.drawAxisLabels();
    this.drawCurveNames();
    this.ctx = main;
    const live = new Set<unknown>();
    for (const d of [...this.items, ...this.traces]) if ('f' in d.item) live.add(d.item.f); else if (d.item.type === 'region') live.add(d.item.test);
    for (const cache of [this.runCache, this.poleCache, this.contourCache, this.fillCache] as Map<unknown, unknown>[])
      for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
    return animating;
  }

  private viewKey(): string {
    return `${this.view.xmin}|${this.view.xmax}|${this.view.ymin}|${this.view.ymax}|${this.w}|${this.h}`;
  }

  private viewChanged(): boolean {
    const viewKey = this.viewKey();
    if (viewKey === this.cacheView) return false;
    const now = performance.now();
    this.coarse = this.cacheView !== '' && now - this.viewMovedAt < 200;
    this.viewMovedAt = now;
    clearTimeout(this.refineTimer);
    if (this.coarse) {
      this.refineTimer = window.setTimeout(() => {
        this.coarse = false;
        this.contourCache.clear();
        this.fillCache.clear();
        this.sceneKey = '';
        this.redraw();
      }, 150);
    }
    this.cacheView = viewKey;
    this.runCache.clear();
    this.poleCache.clear();
    this.contourCache.clear();
    this.fillCache.clear();
    return true;
  }

  private draw(): void {
    const { ctx } = this;
    if (!this.w) return;
    const moving = this.viewChanged() && this.coarse;
    const sceneKey = `${this.viewKey()}|${this.dpr}|${this.activeRowId}|${this.hoverRowId}|${this.piTicks}|${this.asymptotes}|${this.squareAxes}`;
    if (sceneKey !== this.sceneKey || this.items !== this.sceneItems) {
      const animating = this.drawScene(moving ? ctx : this.sceneCtx);
      this.sceneKey = animating || moving ? '' : sceneKey;
      this.sceneItems = this.items;
      if (animating) this.redraw();
      if (!moving) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.scene, 0, 0);
      }
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.scene, 0, 0);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const key = `${this.activeRowId}|${this.viewKey()}`;
    if (key !== this.poiKey || this.items !== this.poiItems) {
      const sameCurves = this.items === this.poiItems && this.poiKey.startsWith(`${this.activeRowId}|`);
      this.poiKey = key;
      this.poiItems = this.items;
      clearTimeout(this.poiTimer);
      if (sameCurves) {
        this.poiTimer = window.setTimeout(() => {
          this.pois = this.findPOIs();
          this.sceneKey = '';
          this.redraw();
        }, 120);
      } else {
        this.pois = this.findPOIs();
        this.sceneKey = '';
      }
    }
    for (const p of this.pins) this.drawLabel(p, true);
    const fm = this.focusMark;
    if (fm && this.pois.some((q) => q.x === fm.x && q.y === fm.y && q.kind === fm.kind)) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.arc(this.toPx(fm.x), this.toPy(fm.y), 8, 0, Math.PI * 2);
      ctx.strokeStyle = this.theme.axis;
      ctx.lineWidth = 2;
      ctx.stroke();
      this.drawLabel({ x: fm.x, y: fm.y, kind: fm.kind, color: this.theme.axis, rowId: fm.rowId ?? null }, false);
    }
    for (const d of this.draggables) {
      const px = this.toPx(d.x), py = this.toPy(d.y);
      this.ctx.beginPath();
      this.ctx.arc(px, py, 10, 0, Math.PI * 2);
      this.ctx.strokeStyle = this.theme.axis;
      this.ctx.globalAlpha = 0.45;
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    }
    for (const p of this.pois) this.hollowDot(this.toPx(p.x), this.toPy(p.y));
    this.drawTrace();
    if (this.zoomBox) {
      const b = this.zoomBox, ctx = this.ctx;
      const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), hgt = Math.abs(b.y1 - b.y0);
      ctx.fillStyle = this.theme.axis;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(x, y, w, hgt);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.theme.axis;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, w, hgt);
      ctx.setLineDash([]);
    }
  }

  private ticks(): { pi: PiStep | null; sx: number; sy: number } {
    const pi = this.piTicks ? piStep(this.view.xmax - this.view.xmin, this.w) : null;
    const sx = pi ? pi.step : niceStep(((this.view.xmax - this.view.xmin) / this.w) * 110);
    const sy = this.squareAxes && !pi ? sx : niceStep(((this.view.ymax - this.view.ymin) / this.h) * 80);
    return { pi, sx, sy };
  }

  private drawGrid(): void {
    const { ctx, w, h, theme } = this;
    const { pi, sx, sy } = this.ticks();
    const minorX = pi ? sx / 2 : sx / 5, minorY = sy / 5;
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    for (const x of tickValues(this.view.xmin, this.view.xmax, minorX)) {
      const px = Math.round(this.toPx(x)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (const y of tickValues(this.view.ymin, this.view.ymax, minorY)) {
      const py = Math.round(this.toPy(y)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();
    ctx.strokeStyle = theme.gridMajor;
    ctx.beginPath();
    for (const x of tickValues(this.view.xmin, this.view.xmax, sx)) {
      const px = Math.round(this.toPx(x)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (const y of tickValues(this.view.ymin, this.view.ymax, sy)) {
      const py = Math.round(this.toPy(y)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();
    const ax = Math.round(this.toPx(0)) + 0.5;
    const ay = Math.round(this.toPy(0)) + 0.5;
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ax >= 0 && ax <= w) {
      ctx.moveTo(ax, 0);
      ctx.lineTo(ax, h);
    }
    if (ay >= 0 && ay <= h) {
      ctx.moveTo(0, ay);
      ctx.lineTo(w, ay);
    }
    ctx.stroke();
  }

  private drawAxisLabels(): void {
    const { ctx, w, h, theme } = this;
    this.usedBoxes = [];
    const { pi, sx, sy } = this.ticks();
    const ax = Math.round(this.toPx(0)) + 0.5;
    const ay = Math.round(this.toPy(0)) + 0.5;
    const size = this.isPhone() ? 11 : 12.5;
    this.labelChip = Math.round(size * 1.3);
    const chip = this.labelChip;
    ctx.font = `400 ${size}px ${LABEL_FONT}`;
    ctx.fillStyle = theme.label;
    const labelY = Math.min(Math.max(ay + 4, 4), h - this.cover.bottom - chip - 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const x of tickValues(this.view.xmin, this.view.xmax, sx)) {
      if (Math.abs(x) < sx / 1e6) continue;
      const px = this.toPx(x);
      const text = pi ? piLabel(Math.round(x / sx), pi.num, pi.den) : tickLabel(x, sx);
      const half = ctx.measureText(text).width / 2 + 4;
      if (px - half < 2 || px + half > w - 2) continue;
      this.label(text, px, labelY, 'center', 'top');
    }
    const pinLeft = ax < Math.round(48 * size / 11);
    const yView: [number, number, number, number] = [0, this.cover.top, w, h - this.cover.bottom];
    const poiScreen = this.pois.map((p) => [this.toPx(p.x), this.toPy(p.y)] as const);
    const tickCrowded = (box: [number, number, number, number]) => {
      if (this.crowded(box, 6)) return true;
      const [l, t, r, b] = box;
      for (const [px, py] of poiScreen) {
        if (Math.hypot(Math.max(l - px, 0, px - r), Math.max(t - py, 0, py - b)) < 9) return true;
      }
      for (const [l2, t2, r2, b2] of this.usedBoxes) {
        if (l < r2 + 3 && r > l2 - 3 && t < b2 + 3 && b > t2 - 3) return true;
      }
      return false;
    };
    for (const y of tickValues(this.view.ymin, this.view.ymax, sy)) {
      if (Math.abs(y) < sy / 1e6) continue;
      const py = this.toPy(y);
      if (py < chip / 2 + 3 + this.cover.top || py > h - chip / 2 - 3 - this.cover.bottom) continue;
      const text = tickLabel(y, sy);
      const tw = ctx.measureText(text).width + 4;
      const spot = yTickSpot({ ax, py, tw, th: chip, view: yView, pinLeft, isCrowded: tickCrowded });
      this.label(text, spot.x, spot.y, spot.align, spot.base);
    }
    if (ax >= 0 && ax <= w && ay >= 0 && ay <= h) {
      const spots: [number, number, CanvasTextAlign, CanvasTextBaseline][] = [[ax - 5, ay + 4, 'right', 'top'], [ax + 6, ay + 4, 'left', 'top'], [ax - 5, ay - 4, 'right', 'bottom']];
      const spot = spots.find(([x, y, align, base]) => !this.crowded(this.labelBox('0', x, y, align, base), 12));
      if (spot) this.label('0', ...spot);
    }
  }

  private labelBox(text: string, x: number, y: number, align: CanvasTextAlign, base: CanvasTextBaseline): [number, number, number, number] {
    const bw = this.ctx.measureText(text).width + 4;
    const bx = align === 'center' ? x - bw / 2 : align === 'right' ? x - bw + 2 : x - 2;
    const chip = this.labelChip;
    const by = base === 'top' ? y - 1 : base === 'middle' ? y - chip / 2 : y - chip + 1;
    return [bx - 1, by, bx + bw + 1, by + chip];
  }

  private crowded([l, t, r, b]: [number, number, number, number], pad: number): boolean {
    l -= pad;
    t -= pad;
    r += pad;
    b += pad;
    for (const run of this.plotted) {
      if (run.length === 1 && segHitsBox(run[0][0], run[0][1], run[0][0], run[0][1], l, t, r, b)) return true;
      for (let k = 1; k < run.length; k++) if (segHitsBox(run[k - 1][0], run[k - 1][1], run[k][0], run[k][1], l, t, r, b)) return true;
    }
    for (const s of this.plottedSegs)
      for (let k = 0; k < s.length; k += 4) if (segHitsBox(s[k], s[k + 1], s[k + 2], s[k + 3], l, t, r, b)) return true;
    return false;
  }

  private label(text: string, x: number, y: number, align: CanvasTextAlign, base: CanvasTextBaseline): void {
    const { ctx } = this;
    ctx.textAlign = align;
    ctx.textBaseline = base;
    const [l, t, r, b] = this.labelBox(text, x, y, align, base);
    ctx.fillStyle = this.theme.labelBg;
    roundRect(ctx, l, t, r - l, b - t, 2);
    ctx.fill();
    ctx.fillStyle = this.theme.label;
    ctx.fillText(text, x, y);
    this.usedBoxes.push([l, t, r, b]);
  }

  private chip(x: number, y: number, w: number, h: number, edge = this.theme.chipEdge, edgeWidth = 1): void {
    const { ctx, theme } = this;
    ctx.save();
    roundRect(ctx, x, y, w, h, theme.chipRadius);
    ctx.fillStyle = theme.chip;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = edgeWidth;
    ctx.strokeStyle = edge;
    ctx.stroke();
  }

  private sampleFx(f: (x: number) => number): [number, number][][] {
    const cached = this.runCache.get(f);
    if (cached) return cached;
    const runs = this.sampleFxRaw(f);
    this.runCache.set(f, runs);
    return runs;
  }

  private sampleFxRaw(f: (x: number) => number): [number, number][][] {
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    let prev: number | null = null;
    const limit = this.h * 4;
    const poles: number[] = [];
    let lastPx = NaN, lastY = NaN;
    const pole = (px: number, y: number) => {
      const at = asymptoteAcross(f, this.toX(lastPx), lastY, this.toX(px), y);
      if (at !== null) poles.push(at);
      return at !== null;
    };
    this.poleCache.set(f, poles);
    for (let px = -1; px <= this.w + 1; px += 1) {
      const y = f(this.toX(px));
      if (!Number.isFinite(y)) {
        if (run.length) runs.push(run);
        run = [];
        prev = null;
        continue;
      }
      if (prev === null && lastPx === px - 2 && pole(px, y)) {
        runs[runs.length - 1]?.push([lastPx, lastY > 0 ? -limit : limit]);
        run = [[px, y > 0 ? -limit : limit]];
      }
      let py = this.toPy(y);
      const jump = prev !== null && Math.abs(py - prev) > this.h && (py < -limit || py > limit || prev < -limit || prev > limit || Math.sign(py - this.h / 2) !== Math.sign(prev - this.h / 2));
      // The last sample before a pole can be well inside the plot, so each side runs on off the edge.
      if (prev !== null && (jump || Math.abs(py - prev) > POLE_JUMP * this.h) && pole(px, y)) {
        run.push([lastPx, lastY > 0 ? -limit : limit]);
        runs.push(run);
        run = [[px, y > 0 ? -limit : limit]];
      } else if (jump) {
        if (run.length) runs.push(run);
        run = [];
      }
      py = Math.max(-limit, Math.min(limit, py));
      run.push([px, py]);
      prev = py;
      lastPx = px;
      lastY = y;
    }
    if (run.length) runs.push(run);
    return runs;
  }

  private strokePoles(f: unknown, color: string): void {
    const poles = asymptotesToDraw(this.poleCache.get(f) ?? []);
    if (!poles.length) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    for (const x of poles) {
      const px = Math.round(this.toPx(x)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, this.h);
    }
    ctx.stroke();
    ctx.restore();
  }

  private sampleFy(f: (y: number) => number): [number, number][][] {
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    for (let py = -1; py <= this.h + 1; py += 1) {
      const x = f(this.toY(py));
      if (!Number.isFinite(x)) {
        if (run.length) runs.push(run);
        run = [];
        continue;
      }
      run.push([Math.max(-this.w * 4, Math.min(this.w * 4, this.toPx(x))), py]);
    }
    if (run.length) runs.push(run);
    return runs;
  }

  private shadePath(color: string, wash: number): void {
    const { ctx, theme } = this;
    if (!theme.hatch) {
      ctx.globalAlpha = wash;
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fill();
    ctx.clip();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = -this.h; c < this.w; c += 7) {
      ctx.moveTo(c, this.h);
      ctx.lineTo(c + this.h, 0);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawFill(d: Drawable): void {
    const { ctx } = this;
    const it = d.item;
    ctx.fillStyle = d.color;
    if (it.type === 'fx' && it.ineq) {
      const up = it.ineq === '>' || it.ineq === '>=';
      for (const run of this.sampleFx(it.f)) {
        ctx.beginPath();
        const edge = up ? -1 : this.h + 1;
        ctx.moveTo(run[0][0], edge);
        for (const [px, py] of run) ctx.lineTo(px, py);
        ctx.lineTo(run[run.length - 1][0], edge);
        ctx.closePath();
        this.shadePath(d.color, 0.16);
      }
    } else if (it.type === 'fy' && it.ineq) {
      const right = it.ineq === '>' || it.ineq === '>=';
      for (const run of this.sampleFy(it.f)) {
        ctx.beginPath();
        const edge = right ? this.w + 1 : -1;
        ctx.moveTo(edge, run[0][1]);
        for (const [px, py] of run) ctx.lineTo(px, py);
        ctx.lineTo(edge, run[run.length - 1][1]);
        ctx.closePath();
        this.shadePath(d.color, 0.16);
      }
    } else if ((it.type === 'implicit' && it.ineq) || it.type === 'region') {
      const cell = this.coarse ? 6 : 3;
      const test =
        it.type === 'region'
          ? it.test
          : (() => {
              const f = it.f, op = it.ineq!;
              return (x: number, y: number) => {
                const v = f(x, y);
                return op === '<' ? v < 0 : op === '<=' ? v <= 0 : op === '>' ? v > 0 : v >= 0;
              };
            })();
      const fkey = it.type === 'region' ? it.test : it.f;
      let rects = this.fillCache.get(fkey);
      if (!rects) {
        // (x, y, width) per shaded span, one row of cells at a time.
        const out: number[] = [];
        for (let py = 0; py < this.h; py += cell) {
          const y = this.toY(py + cell / 2);
          let start = -1;
          for (let px = 0; px <= this.w; px += cell) {
            const inside = px < this.w && test(this.toX(px + cell / 2), y);
            if (inside && start < 0) start = px;
            if (!inside && start >= 0) {
              out.push(start, py, px - start);
              start = -1;
            }
          }
        }
        rects = Float32Array.from(out);
        this.fillCache.set(fkey, rects);
      }
      ctx.globalAlpha = 0.16;
      for (let k = 0; k < rects.length; k += 3) ctx.fillRect(rects[k], rects[k + 1], rects[k + 2], cell);
      ctx.globalAlpha = 1;
    } else if (it.type === 'normal' && it.shade) {
      const [lo, hi] = it.shade;
      const a = Math.max(lo, this.toX(-1)), b = Math.min(hi, this.toX(this.w + 1));
      if (a < b) {
        const pdf = (x: number) => normPdf((x - it.mu) / it.sigma) / it.sigma;
        ctx.beginPath();
        const y0 = this.toPy(0);
        ctx.moveTo(this.toPx(a), y0);
        const pa = this.toPx(a), pb = this.toPx(b);
        for (let px = pa; px < pb; px += 1) ctx.lineTo(px, this.toPy(pdf(this.toX(px))));
        ctx.lineTo(pb, this.toPy(pdf(b)));
        ctx.lineTo(pb, y0);
        ctx.closePath();
        this.shadePath(d.color, 0.3);
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        if (Number.isFinite(lo) && lo >= this.view.xmin) {
          ctx.moveTo(this.toPx(lo), y0);
          ctx.lineTo(this.toPx(lo), this.toPy(pdf(lo)));
        }
        if (Number.isFinite(hi) && hi <= this.view.xmax) {
          ctx.moveTo(this.toPx(hi), y0);
          ctx.lineTo(this.toPx(hi), this.toPy(pdf(hi)));
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const text = shadeLabel(shadeProb(it, lo, hi));
        const at = probLabelPlacement({ a: Math.max(lo, this.toX(0)), b: Math.min(hi, this.toX(this.w)), mu: it.mu, pdf, X: (x) => this.toPx(x), Y: (y) => this.toPy(y) });
        ctx.font = `700 ${at.big ? 16 : 12}px ${LABEL_FONT}`;
        ctx.textAlign = at.anchor === 'middle' ? 'center' : at.anchor === 'end' ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 6;
        ctx.strokeStyle = this.theme.bg;
        ctx.strokeText(text, at.x, at.y);
        ctx.fillStyle = d.color;
        ctx.fillText(text, at.x, at.y);
      }
    } else if (it.type === 'polygon') {
      ctx.beginPath();
      it.pts.forEach(([x, y], k) => (k ? ctx.lineTo(this.toPx(x), this.toPy(y)) : ctx.moveTo(this.toPx(x), this.toPy(y))));
      ctx.closePath();
      this.shadePath(d.color, 0.16);
    }
  }

  private weight = 2.25;

  private strokeRuns(runs: [number, number][][], color: string, dashed = false): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = this.weight;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dashed) ctx.setLineDash(BOUNDARY_DASH);
    for (const run of runs) {
      ctx.beginPath();
      run.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
      this.plotted.push(run);
    }
    ctx.setLineDash([]);
  }

  private drawStroke(d: Drawable): void {
    const { ctx } = this;
    const selected = d.rowId === this.activeRowId || d.rowId === this.hoverRowId;
    this.weight = this.theme.weight + (selected ? 1 : 0);
    if (this.theme.glow) {
      ctx.save();
      ctx.shadowColor = withAlpha(d.color, selected ? 0.75 : 0.45);
      ctx.shadowBlur = selected ? 12 : 7;
      this.strokeItem(d);
      ctx.restore();
      return;
    }
    this.strokeItem(d);
  }

  private strokeItem(d: Drawable): void {
    const { ctx } = this;
    const it = d.item;
    switch (it.type) {
      case 'fx':
      {
        const runs = this.sampleFx(it.f);
        this.strokeRuns(runs, d.color, isDashed(it));
        if (this.asymptotes && !it.ineq) this.strokePoles(it.f, d.color);
        return;
      }
      case 'fy':
        this.strokeRuns(this.sampleFy(it.f), d.color, isDashed(it));
        return;
      case 'implicit':
        this.contour(it.f, d.color, isDashed(it));
        return;
      case 'normal': {
        const runs = this.sampleFx(normalPdf(it));
        this.strokeRuns(runs, d.color);
        return;
      }
      case 'binom': {
        const lo = Math.max(0, Math.ceil(this.view.xmin)), hi = Math.min(it.n, Math.floor(this.view.xmax));
        if (hi - lo > this.w) return;
        const y0 = this.toPy(0);
        // Counting with i, not k: past 2^53, k++ leaves k unchanged.
        for (let i = 0; i <= hi - lo; i++) {
          const k = lo + i, p = binomPdf(it.n, it.p, k);
          const inShade = it.shade && k >= it.shade[0] && k <= it.shade[1];
          ctx.strokeStyle = d.color;
          ctx.fillStyle = d.color;
          ctx.globalAlpha = it.shade && !inShade ? 0.35 : 1;
          ctx.lineWidth = 2.5;
          const px = this.toPx(k), py = this.toPy(p);
          this.plotted.push([[px, y0], [px, py]]);
          ctx.beginPath();
          ctx.moveTo(px, y0);
          ctx.lineTo(px, py);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        return;
      }
      case 'polygon': {
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        it.pts.forEach(([x, y], k) => (k ? ctx.lineTo(this.toPx(x), this.toPy(y)) : ctx.moveTo(this.toPx(x), this.toPy(y))));
        ctx.closePath();
        ctx.stroke();
        const ring = it.pts.map(([x, y]): [number, number] => [this.toPx(x), this.toPy(y)]);
        if (ring.length) this.plotted.push([...ring, ring[0]]);
        return;
      }
      case 'vector': {
        const x0 = this.toPx(0), y0 = this.toPy(0), x1 = this.toPx(it.to[0]), y1 = this.toPy(it.to[1]);
        const arrow = vectorArrow(x0, y0, x1, y1);
        if (!arrow) {
          this.dot(x1, y1, d.color);
          this.plotted.push([[x1, y1]]);
          return;
        }
        ctx.strokeStyle = d.color;
        ctx.fillStyle = d.color;
        ctx.lineWidth = this.weight;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(...arrow.base);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(...arrow.left);
        ctx.lineTo(...arrow.right);
        ctx.closePath();
        ctx.fill();
        this.plotted.push([[x0, y0], [x1, y1]]);
        return;
      }
      case 'points':
        for (const [x, y] of it.pts) {
          this.dot(this.toPx(x), this.toPy(y), d.color);
          this.plotted.push([[this.toPx(x), this.toPy(y)]]);
        }
        return;
      case 'region':
        return;
    }
  }

  private drawCurveNames(): void {
    const { ctx, w, h, theme } = this;
    this.curveNames = [];
    // Where the plot has no room to name its curves (a phone, or the canvas, whose blocks name them), the names are
    // still worked out, for the page API and the graph's description, but not painted.
    const paint = !this.isPhone();
    const rows = new Map<string, { d: Drawable; p0: number; p1: number; s0: number; s1: number }[]>();
    for (const o of this.owners) if (o.d.label) rows.set(o.d.rowId, [...(rows.get(o.d.rowId) ?? []), o]);
    if (!rows.size) return;
    const SIZE = 13, PX = 6, PY = 3;
    const tagH = SIZE + 2 * PY + 2;
    ctx.font = `600 ${SIZE}px ${theme.nameFace}`;
    const view: [number, number, number, number] = [0, 0, w - theme.toolCol, h];
    if (view[2] <= view[0]) return;
    const segmentsOf = (own: { p0: number; p1: number; s0: number; s1: number }[]) => {
      const sg: number[] = [];
      for (const o of own) {
        for (let i = o.p0; i < o.p1; i++) {
          const run = this.plotted[i];
          if (run.length === 1) sg.push(run[0][0], run[0][1], run[0][0], run[0][1]);
          for (let k = 1; k < run.length; k++) sg.push(run[k - 1][0], run[k - 1][1], run[k][0], run[k][1]);
        }
        for (let i = o.s0; i < o.s1; i++) for (const v of this.plottedSegs[i]) sg.push(v);
      }
      return sg;
    };
    const lines = [...rows.values()].map((own) => ({ d: own[0].d, segs: segmentsOf(own) }));
    const axisX = Math.round(this.toPx(0)) + 0.5, axisY = Math.round(this.toPy(0)) + 0.5;
    for (const [n, line] of lines.entries()) {
      const others = lines.flatMap((o, m) => (m === n ? [] : o.segs));
      const spotFor = (text: string, clear: number, overAxes = false) =>
        nameSpot({ own: line.segs, others, view, tw: ctx.measureText(text).width + 2 * PX, th: tagH, used: this.usedBoxes, axisX, axisY, clear, overAxes });
      const label = line.d.label!;
      const full = line.d.text ? `${label}  ${line.d.text}` : label;
      let text = full;
      let box = spotFor(full, 12) ?? spotFor(full, 3);
      if (!box && full !== label) { text = label; box = spotFor(label, 3); }
      if (!box) { text = label; box = spotFor(label, 0, true); }
      if (!box) continue;
      if (paint) this.nameTag(text, box, line.d.color);
      this.curveNames.push({ rowId: line.d.rowId, text, box });
    }
  }

  private nameTag(text: string, [l, t, r, b]: [number, number, number, number], color: string): void {
    const { ctx, theme } = this;
    ctx.save();
    ctx.globalAlpha = theme.flat ? 1 : 0.85;
    ctx.fillStyle = theme.bg;
    roundRect(ctx, l, t, r - l, b - t, theme.nameRadius);
    ctx.fill();
    ctx.restore();
    if (theme.flat) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      roundRect(ctx, l + 0.5, t + 0.5, r - l - 1, b - t - 1, theme.nameRadius);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, l + 6, (t + b) / 2 + 0.5);
    this.usedBoxes.push([l, t, r, b]);
  }

  private dot(px: number, py: number, color: string, r = 4.5): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(px, py, r + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = this.theme.bg;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  private contour(f: (x: number, y: number) => number, color: string, dashed: boolean): void {
    let segs = this.contourCache.get(f);
    if (!segs) {
      segs = this.contourSegments(f);
      this.contourCache.set(f, segs);
    }
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = this.weight;
    ctx.lineCap = 'round';
    if (dashed) ctx.setLineDash(BOUNDARY_DASH);
    ctx.beginPath();
    for (let k = 0; k < segs.length; k += 4) {
      ctx.moveTo(segs[k], segs[k + 1]);
      ctx.lineTo(segs[k + 2], segs[k + 3]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    this.plottedSegs.push(segs);
  }

  /** Marching squares over 4 px cells: the zero set of f as line segments (x0, y0, x1, y1, …) in CSS pixels. */
  private contourSegments(f: (x: number, y: number) => number): Float32Array {
    const out: number[] = [];
    const cell = this.coarse ? 8 : 4;
    const cols = Math.ceil(this.w / cell) + 1, rows = Math.ceil(this.h / cell) + 1;
    const v = new Float64Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      const y = this.toY(j * cell);
      for (let i = 0; i < cols; i++) v[j * cols + i] = f(this.toX(i * cell), y);
    }
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = v[j * cols + i], b = v[j * cols + i + 1], c = v[(j + 1) * cols + i + 1], d = v[(j + 1) * cols + i];
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) continue;
        const x0 = i * cell, y0 = j * cell;
        const pts = contourCrossings(a, b, c, d).map(([u, q]): [number, number] => [x0 + u * cell, y0 + q * cell]);
        if (pts.length >= 2) {
          // Skip sign flips across poles, where values blow up instead of crossing zero.
          const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
          const mid = f(this.toX(x0 + cell / 2), this.toY(y0 + cell / 2));
          if (Math.abs(mid) > scale) continue;
          out.push(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
          if (pts.length === 4) out.push(pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
        }
      }
    }
    return Float32Array.from(out);
  }

  private hollowDot(px: number, py: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = this.theme.bg;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.theme.axis;
    ctx.stroke();
  }

  private findPOIs(): Mark[] {
    const curves = this.items
      .filter((d) => d.item.type === 'fx' && !(d.item as { ineq?: string }).ineq)
      .map((d) => ({ f: (d.item as { f: (x: number) => number }).f, rowId: d.rowId }));
    if (!curves.length) return [];
    const xs: number[] = [];
    const step = curves.length > 4 ? 3 : 2;
    for (let px = 0; px <= this.w; px += step) xs.push(this.toX(px));
    return findMarks(curves, xs, this.view.ymax - this.view.ymin, true)
      .filter((p) => p.x >= this.view.xmin && p.x <= this.view.xmax && p.y >= this.view.ymin && p.y <= this.view.ymax)
      .slice(0, 200);
  }

  private findTarget(px: number, py: number): Target | null {
    let best: (Target & { dist: number }) | null = null;
    for (const p of this.pois) {
      const dist = Math.hypot(this.toPx(p.x) - px, this.toPy(p.y) - py);
      if (dist <= MARK_SNAP && (!best || dist < best.dist)) best = { x: p.x, y: p.y, color: this.theme.axis, dist, kind: p.kind, rowId: p.rowId ?? this.activeRowId };
    }
    if (best) return best;
    const x = this.toX(px);
    for (const d of this.items) {
      const it = d.item;
      let candidates: [number, number][] = [];
      if (it.type === 'fx') candidates = [[x, it.f(x)]];
      else if (it.type === 'normal') candidates = [[x, normalPdf(it)(x)]];
      else if (it.type === 'fy') {
        const y = this.toY(py);
        candidates = [[it.f(y), y]];
      } else if (it.type === 'points' || it.type === 'polygon') candidates = it.pts.map((p) => [p[0], p[1]]);
      else if (it.type === 'vector') candidates = [[it.to[0], it.to[1]]];
      else if (it.type === 'binom') {
        const k = Math.round(x);
        if (k >= 0 && k <= it.n) candidates = [[k, binomPdf(it.n, it.p, k)]];
      }
      for (const [cx, cy] of candidates) {
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        const dist = Math.hypot(this.toPx(cx) - px, this.toPy(cy) - py);
        if (dist < 14 && (!best || dist < best.dist)) best = { x: cx, y: cy, color: d.color, dist, rowId: d.rowId };
      }
    }
    return best;
  }

  private drawLabel(t: Target, pinned: boolean): void {
    const bx = this.toPx(t.x), by = this.toPy(t.y);
    if (bx < -20 || bx > this.w + 20 || by < -20 || by > this.h + 20) return;
    this.dot(bx, by, t.color, 4);
    const text = t.kind ? markText(t as Mark, shortNum) : `(${shortNum(t.x)}, ${shortNum(t.y)})`;
    const { ctx } = this;
    ctx.font = `${pinned ? 600 : 400} 12px ${LABEL_FONT}`;
    const tw = ctx.measureText(text).width + 12;
    let lx = bx + 10, ly = by - 30;
    if (lx + tw > this.w - 4) lx = bx - 10 - tw;
    if (ly < 4) ly = by + 10;
    this.chip(lx + 0.5, ly + 0.5, tw - 1, 21, pinned ? t.color : this.theme.chipEdge, pinned ? 1.5 : 1);
    ctx.fillStyle = this.theme.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + 6, ly + 11.5);
  }

  private drawTrace(): void {
    if (!this.hover) return;
    const t = this.findTarget(this.hover.px, this.hover.py);
    {
      const { ctx } = this;
      const text = t ? `x = ${shortNum(t.x)}   y = ${shortNum(t.y)}` : `x = ${shortNum(this.toX(this.hover.px))}   y = ${shortNum(this.toY(this.hover.py))}`;
      ctx.font = `11px ${LABEL_FONT}`;
      const tw = ctx.measureText(text).width + 16;
      this.chip(10.5, this.h - 32.5, tw, 22);
      ctx.fillStyle = this.theme.label;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 18, this.h - 21.5);
    }
    if (t && !this.pins.some((p) => Math.abs(this.toPx(p.x) - this.toPx(t.x)) < 2 && Math.abs(this.toPy(p.y) - this.toPy(t.y)) < 2)) this.drawLabel(t, false);
  }

  togglePin(px: number, py: number): boolean {
    const near = this.pins.findIndex((p) => Math.hypot(this.toPx(p.x) - px, this.toPy(p.y) - py) < 10);
    if (near >= 0) {
      this.pins.splice(near, 1);
      this.redraw();
      return true;
    }
    const t = this.findTarget(px, py);
    if (!t) return false;
    this.pins.push(t);
    this.redraw();
    return true;
  }

  /** What the readout says for a pointer at (px, py) in the graph's CSS pixels: a mark, a curve point, or null. */
  readoutAt(px: number, py: number): string | null {
    const t = this.findTarget(px, py);
    if (!t) return null;
    return t.kind ? markText(t as Mark, shortNum) : `(${shortNum(t.x)}, ${shortNum(t.y)})`;
  }

  /** Where a graph point is, in the graph's CSS pixels. */
  pixelOf(x: number, y: number): { px: number; py: number } {
    return { px: this.toPx(x), py: this.toPy(y) };
  }

  private focusMark: Mark | null = null;

  stepMark(dir: 1 | -1): string | null {
    const marks = [...this.pois].sort((a, b) => a.x - b.x || a.y - b.y);
    if (!marks.length) {
      this.focusMark = null;
      return null;
    }
    const f = this.focusMark;
    const at = f ? marks.findIndex((m) => m.x === f.x && m.y === f.y && m.kind === f.kind) : -1;
    const next = at < 0 ? (dir > 0 ? 0 : marks.length - 1) : (at + dir + marks.length) % marks.length;
    this.focusMark = marks[next];
    this.redraw();
    return markText(this.focusMark!, shortNum);
  }

  get markCount(): number {
    return this.pois.length;
  }

  pinFocusedMark(): boolean {
    const f = this.focusMark;
    if (!f) return false;
    if (!this.pins.some((p) => p.x === f.x && p.y === f.y)) this.pins.push({ x: f.x, y: f.y, kind: f.kind, color: this.theme.axis, rowId: f.rowId ?? null });
    this.redraw();
    return true;
  }

  blurMarks(): void {
    if (!this.focusMark) return;
    this.focusMark = null;
    this.redraw();
  }

  clearPins(): void {
    this.pins = [];
    this.redraw();
  }

  /**
   * Runs fn with the finished picture on the canvas: no hover readout, and curves that are still sweeping in drawn
   * whole. A pane that has never been shown has no size, and its canvas is still the browser's blank 300×150, so
   * the picture is drawn at 720×480 for fn and the canvas is emptied again after, leaving the first real size to be
   * treated as the first. toBlob and toDataURL copy the bitmap when called, so fn can hand them straight back.
   */
  private drawn<T>(fn: () => T): T {
    if (!this.host.isConnected) this.theme = readTheme(document.body);
    const hover = this.hover;
    this.hover = null;
    this.still = true;
    const saved = this.w ? null : { view: this.view, w: this.canvas.width, h: this.canvas.height };
    if (saved) {
      this.w = 720;
      this.h = 480;
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = this.scene.width = Math.round(this.w * this.dpr);
      this.canvas.height = this.scene.height = Math.round(this.h * this.dpr);
      const v = this.view;
      const usable = this.viewPlaced();
      this.view = !usable ? homeView(this.w, this.h) : this.squareAxes ? squareView(v, this.w, this.h) : v;
    }
    this.sceneKey = '';
    try {
      this.draw();
      return fn();
    } finally {
      this.hover = hover;
      this.still = false;
      if (saved) {
        this.view = saved.view;
        this.w = this.h = 0;
        this.canvas.width = this.scene.width = saved.w;
        this.canvas.height = this.scene.height = saved.h;
      }
      this.sceneKey = '';
      this.redraw();
    }
  }

  private snapshot(): Promise<Blob | null> {
    return this.drawn(() => new Promise<Blob | null>((res) => this.canvas.toBlob(res)));
  }

  toDataURL(): string {
    return this.drawn(() => this.canvas.toDataURL('image/png'));
  }

  async copyImage(): Promise<boolean> {
    const blob = await this.snapshot();
    if (!blob || typeof ClipboardItem === 'undefined') return false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  }

  exportPNG(): void {
    void this.snapshot().then((blob) => {
      if (!blob) return;
      downloadBlob(blob, `slopculator-graph-${fileDate(true)}.png`);
    });
  }
}
