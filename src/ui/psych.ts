// The psychrometric chart, shared by every front end. A sheet's named moist-air states (A = psych(Tdb, RH)) share one
// chart, the way curves share one graph: this finds them (psychStates), decides the chart's units and range (the
// states' own: °C with g/kg, or °F with grains, never mixed), describes the chart as marks a platform draws as they
// are (psychScene: the saturation curve, RH curves, enthalpy lines, axes, the process line joining the states in sheet
// order, and a point per state), and turns a point's drag or a key into the line or sliders it rewrites (dragPsych,
// nudgePsych). Every number comes from the engine's moist-air equations (moistAir in src/engine/hvac.ts). No DOM here.
import { moistAir } from '../engine/hvac';
import { lineDefines, type RowResult } from '../engine/document';
import type { Settings } from '../engine/evaluator';
import type { RecordV } from '../engine/values';
import type { CanvasRow, Point, Rect, Size } from './canvas';
import { callRefs, figureEdits, quantize, type ArgRef, type FigHandle, type FigMark, type FigTone, type FigureEdit, type MeasureText, type NudgeKey } from './figures';
import type { SliderRange } from './slider';
import { tickValues } from './ticks';

/** The chart's id in wires, pulses, the layout and the phone's column. A row id never takes this form. */
export const PSYCH_BLOCK = '#psych';

/** The calls a drag can rewrite, and the property each takes after the dry bulb. */
export type PsychFn = 'psych' | 'psychwb' | 'psychdp' | 'psychw' | 'psychh';
const FNS: readonly PsychFn[] = ['psych', 'psychwb', 'psychdp', 'psychw', 'psychh'];
/** Each state's color, in sheet order. */
export const STATE_TONES: readonly FigTone[] = ['coral', 'teal', 'amber', 'violet'];

export interface PsychState {
  id: string;
  name: string;
  text: string;
  /** °C, kJ/kg and kPa, else °F, Btu/lb and psia: the line's own units (its last input "SI"). */
  si: boolean;
  /** Dry bulb, humidity ratio (kg/kg or lb/lb), dew point, RH (%), enthalpy and air pressure, from the engine. */
  T: number; W: number; Tdp: number; RH: number; h: number; p: number;
  tone: FigTone;
  /** The call that makes it, when a drag can rewrite it, and how its dry bulb and second input write back. */
  fn: PsychFn | null;
  refs: [ArgRef, ArgRef];
  /** RH typed as a fraction (0.5) rather than a percent (50). */
  fraction: boolean;
}

export interface PsychScope { rows: readonly CanvasRow[]; results: readonly (RowResult | undefined)[]; settings: Settings }

const airOf = (r: RowResult | undefined): RecordV | null => {
  const v = r && !r.error ? r.value : undefined;
  return typeof v === 'object' && v.t === 'record' && v.kind === 'air' ? v : null;
};
const field = (v: RecordV, key: string): number => {
  const x = v.rows.find((r) => r.key === key)?.value;
  return typeof x === 'number' ? x : NaN;
};

/** Whether a row is a named moist-air state: such rows sit in the sheet's psychrometric chart. */
export function isPsychState(row: CanvasRow, result: RowResult | undefined): boolean {
  return row.kind === 'expr' && !row.example && !!airOf(result) && !!(result?.defines ?? lineDefines(row.text));
}

/** A typed number or a slider's value, for the input a ref writes. */
function refValue(ref: ArgRef, text: string, scope: PsychScope): number {
  if (ref.k === 'text') return Number(text.slice(ref.span[0], ref.span[1]));
  if (ref.k === 'slider') {
    const k = scope.rows.findIndex((r) => r.id === ref.id);
    return scope.results[k]?.slider?.value ?? NaN;
  }
  return NaN;
}

/** The sheet's moist-air states, in sheet order, each with its numbers from the engine and its color. */
export function psychStates(scope: PsychScope): PsychState[] {
  const out: PsychState[] = [];
  scope.rows.forEach((row, k) => {
    const r = scope.results[k];
    if (!isPsychState(row, r) || row.kind !== 'expr') return;
    const v = airOf(r)!;
    const si = /°C/.test(v.rows[0]?.label ?? '');
    const call = callRefs(row.text, { rows: scope.rows, results: scope.results, settings: scope.settings, id: row.id });
    const fn = call && (FNS as readonly string[]).includes(call.name) ? call.name as PsychFn : null;
    const refs: [ArgRef, ArgRef] = fn && call ? [call.refs[0] ?? { k: 'fixed' }, call.refs[1] ?? { k: 'fixed' }] : [{ k: 'fixed' }, { k: 'fixed' }];
    out.push({
      id: row.id, name: r?.defines ?? lineDefines(row.text) ?? '', text: row.text, si,
      T: field(v, 'Tdb'), W: field(v, 'W'), Tdp: field(v, 'Tdp'), RH: field(v, 'RH'), h: field(v, 'h'), p: field(v, 'p'),
      tone: STATE_TONES[out.length % STATE_TONES.length], fn, refs,
      fraction: fn === 'psych' && refValue(refs[1], row.text, scope) <= 1,
    });
  });
  return out;
}

/** Each state's row, by the chart it sits in: for the layout's `hosts`. */
export const psychHosts = (states: readonly Pick<PsychState, 'id'>[]): Map<string, string> => new Map(states.map((s) => [s.id, PSYCH_BLOCK]));

/**
 * A phone's column with the chart where its first state would be and every state right after it, in sheet order (the
 * states are drawn inside the chart's block, under the chart).
 */
export function psychColumn(order: readonly string[], stateIds: readonly string[]): string[] {
  if (!stateIds.length) return [...order];
  const set = new Set(stateIds);
  const first = order.findIndex((id) => set.has(id));
  if (first < 0) return [...order];
  const rest = order.filter((id) => !set.has(id));
  const at = order.slice(0, first).filter((id) => !set.has(id)).length;
  return [...rest.slice(0, at), PSYCH_BLOCK, ...stateIds.filter((id) => order.includes(id)), ...rest.slice(at)];
}

// ---------- units ----------

/** A chart's units: the first state's. A state in the other units is drawn converted (°F ↔ °C; W is the same in both). */
export interface PsychUnits { si: boolean; t: string; w: string; h: string; wScale: number }
export const unitsOf = (si: boolean): PsychUnits => (si ? { si, t: '°C', w: 'g/kg', h: 'kJ/kg', wScale: 1000 } : { si, t: '°F', w: 'gr/lb', h: 'Btu/lb', wScale: 7000 });
const toUnits = (t: number, from: boolean, to: boolean) => (from === to ? t : to ? (t - 32) / 1.8 : t * 1.8 + 32);

// ---------- the view ----------

/** What the chart shows: its units, its dry bulb range, its top humidity ratio, and the air pressure it's drawn at. */
export interface PsychView { si: boolean; t0: number; t1: number; w1: number; p: number }

/** The chart's range: a usual one for its units (0 to 40 °C and 30 g/kg, or 30 to 110 °F and 200 grains), grown to hold every state. */
export function psychView(states: readonly PsychState[]): PsychView {
  const si = states[0]?.si ?? true;
  const u = unitsOf(si);
  const p = states.find((s) => s.si === si && Number.isFinite(s.p))?.p ?? moistAir.pressure(0, si);
  const ts = states.flatMap((s) => [toUnits(s.T, s.si, si), toUnits(s.Tdp, s.si, si)]).filter(Number.isFinite);
  const step = si ? 5 : 10;
  const [lo, hi] = moistAir.range(si);
  const t0 = Math.max(lo, Math.min(si ? 0 : 30, ...ts.map((t) => Math.floor((t - step / 2) / step) * step)));
  const t1 = Math.min(hi, Math.max(si ? 40 : 110, ...ts.map((t) => Math.ceil((t + step / 2) / step) * step)));
  const wStep = si ? 5 : 20;
  const ws = states.map((s) => s.W * u.wScale).filter(Number.isFinite);
  const top = Math.max(si ? 30 : 200, ...ws.map((w) => Math.ceil((w * 1.12) / wStep) * wStep));
  return { si, t0, t1, w1: top / u.wScale, p };
}

/** The chart's drawing on a wide canvas; the block round it adds the states' readouts beside it. */
export const PSYCH_SIZE: Size = { w: 470, h: 372 };
/** Room round the plot: the humidity ratio's ticks on the right, the dry bulb's under it. */
export const PSYCH_PAD = { l: 10, r: 50, t: 14, b: 30 } as const;

/** The chart's drawing: its own size on a wide canvas, the column's `width` on a phone (or a narrow window). */
export function psychSize(width?: number): Size {
  if (width === undefined) return PSYCH_SIZE;
  const w = Math.max(220, Math.round(width));
  return { w, h: Math.round(Math.max(240, Math.min(380, w * 0.8))) };
}

function frame(size: Size, v: PsychView) {
  const plot: Rect = { x: PSYCH_PAD.l, y: PSYCH_PAD.t, w: size.w - PSYCH_PAD.l - PSYCH_PAD.r, h: size.h - PSYCH_PAD.t - PSYCH_PAD.b };
  const X = (t: number) => plot.x + ((t - v.t0) / (v.t1 - v.t0)) * plot.w;
  const Y = (w: number) => plot.y + plot.h - (w / v.w1) * plot.h;
  const iT = (px: number) => v.t0 + ((px - plot.x) / plot.w) * (v.t1 - v.t0);
  const iW = (py: number) => ((plot.y + plot.h - py) / plot.h) * v.w1;
  return { plot, X, Y, iT, iW };
}

/** Humidity ratio at a dry bulb and RH (a fraction), or NaN where the equations don't reach. */
function wAt(t: number, rh: number, v: PsychView): number {
  try {
    return moistAir.humRatio(t, rh, v.p, v.si);
  } catch {
    return NaN;
  }
}
/** The dry bulb on saturation at a humidity ratio (the dew point), by bisection on the engine's saturation curve. */
function tSat(w: number, v: PsychView): number {
  let a = moistAir.range(v.si)[0], b = v.t1 + 60;
  for (let k = 0; k < 60; k++) {
    const m = (a + b) / 2;
    const ws = wAt(m, 1, v);
    if (!(ws < w)) b = m;
    else a = m;
  }
  return (a + b) / 2;
}

/** Enthalpy lines every this much, and labels on every other one. */
const H_STEP = { si: 10, ip: 5 } as const;
const fmt1 = (x: number) => String(Math.round(x * 10) / 10).replace('-', '−');

/** The chart as marks, in draw order. `view` holds it still while a point is held (pass the one the drag began with). */
export interface PsychScene { size: Size; panes: Rect[]; marks: FigMark[]; handles: FigHandle[]; view: PsychView; units: PsychUnits }

export function psychScene(states: readonly PsychState[], size: Size, opts: { view?: PsychView | null; active?: string | null; measure?: MeasureText } = {}): PsychScene {
  const v = opts.view ?? psychView(states);
  const u = unitsOf(v.si);
  const { plot, X, Y } = frame(size, v);
  const marks: FigMark[] = [], handles: FigHandle[] = [];
  const pane: Rect = { x: 0, y: 0, ...size };
  const widthOf = (s: string, sz: number, guess: number) => (opts.measure ? opts.measure(s, sz, 600, false) : guess);
  const text = (x: number, y: number, s: string, tone: FigTone, o: Partial<Extract<FigMark, { t: 'text' }>> = {}) =>
    marks.push({ t: 'text', pane: 0, x, y, s, tone, size: 10.5, weight: 500, anchor: 'middle', base: 'middle', ...o });
  const bottom = plot.y + plot.h, right = plot.x + plot.w;
  const sat = (t: number) => Math.min(v.w1, wAt(t, 1, v));
  const tTop = tSat(v.w1, v);

  // Grid: dry bulb lines up to saturation, humidity ratio lines from saturation across.
  const tStep = v.si ? 5 : 10;
  for (const t of tickValues(v.t0, v.t1, tStep)) {
    const x = Math.round(X(t)) + 0.5, wTop = sat(t);
    if (Number.isFinite(wTop)) marks.push({ t: 'line', pane: 0, x1: x, y1: bottom, x2: x, y2: Y(wTop), tone: 'grid', w: 1 });
  }
  const wStep = (v.si ? 5 : 20) / u.wScale;
  for (const w of tickValues(wStep, v.w1, wStep)) {
    const y = Math.round(Y(w)) + 0.5, t = Math.max(v.t0, tSat(w, v));
    if (t < v.t1) marks.push({ t: 'line', pane: 0, x1: X(t), y1: y, x2: right, y2: y, tone: 'grid', w: 1 });
  }

  // Enthalpy lines, from saturation down to dry air, dashed; labelled at saturation.
  const hStep = v.si ? H_STEP.si : H_STEP.ip;
  const hLo = Math.ceil(moistAir.enthalpy(v.t0, 0, v.si) / hStep) * hStep, hHi = moistAir.enthalpy(v.t1, sat(v.t1), v.si);
  let labelled = 0;
  for (let hv = hLo; hv <= hHi; hv += hStep) {
    // Where the line meets saturation: the humidity ratio at which the line's dry bulb is that ratio's dew point.
    let a = 0, b = v.w1 * 1.5;
    for (let k = 0; k < 50; k++) {
      const m = (a + b) / 2;
      if (sat(moistAir.dryBulbAt(hv, m, v.si)) > m || !Number.isFinite(sat(moistAir.dryBulbAt(hv, m, v.si)))) a = m;
      else b = m;
    }
    const wTop = Math.min((a + b) / 2, v.w1);
    let d = '';
    for (let k = 0; k <= 8; k++) {
      const w = (wTop * k) / 8, t = moistAir.dryBulbAt(hv, w, v.si);
      if (t < v.t0 || t > v.t1) continue;
      d += `${d ? 'L' : 'M'}${X(t).toFixed(1)},${Y(w).toFixed(1)}`;
    }
    if (d) marks.push({ t: 'path', pane: 0, d, stroke: 'grid2', w: 1, dash: [2, 4] });
    const tl = moistAir.dryBulbAt(hv, wTop, v.si);
    const step2 = hStep * 2;
    // Not near the top edge, where the RH labels sit.
    if (Math.round(hv / step2) * step2 === hv && Y(wTop) > plot.y + 30 && tl > v.t0 && X(tl) - 34 > plot.x) {
      text(X(tl) - 5, Y(wTop) - 3, labelled++ ? String(hv) : `${hv} ${u.h}`, 'tick', { anchor: 'end', base: 'bottom' });
    }
  }

  // RH curves, every 10%; 20, 40, 60 and 80% labelled where each leaves the chart.
  for (let rh = 10; rh <= 90; rh += 10) {
    let d = '', last: Point | null = null, out = false, prev = v.t0;
    for (let t = v.t0; t <= v.t1 + 1e-9; t += (v.t1 - v.t0) / 120) {
      const w = wAt(t, rh / 100, v);
      if (!Number.isFinite(w)) continue;
      if (w > v.w1) {
        // Up to the top edge, and no further.
        let a = prev, b = t;
        for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (wAt(m, rh / 100, v) > v.w1) b = m; else a = m; }
        last = { x: X(a), y: Y(v.w1) };
        d += `${d ? 'L' : 'M'}${last.x.toFixed(1)},${last.y.toFixed(1)}`;
        out = true;
        break;
      }
      d += `${d ? 'L' : 'M'}${X(t).toFixed(1)},${Y(w).toFixed(1)}`;
      last = { x: X(t), y: Y(w) };
      prev = t;
    }
    if (d) marks.push({ t: 'path', pane: 0, d, stroke: rh % 20 ? 'grid' : 'grid2', w: 1 });
    if (rh % 20 === 0 && last) {
      if (!out) text(right - 4, last.y - 3, `${rh}%`, 'tick', { anchor: 'end', base: 'bottom', plate: true });
      // At the top edge, left of where the curve leaves, unless the label would sit on the saturation curve.
      else if (last.x - X(tTop) > 34) text(last.x - 3, plot.y + 10, `${rh}%`, 'tick', { anchor: 'end', base: 'middle', plate: true });
    }
  }

  // Saturation, the 100% curve, up to the top edge.
  let sd = '';
  for (let t = v.t0; t <= Math.min(v.t1, tTop) + 1e-9; t += (Math.min(v.t1, tTop) - v.t0) / 120) {
    const w = wAt(t, 1, v);
    if (Number.isFinite(w)) sd += `${sd ? 'L' : 'M'}${X(t).toFixed(1)},${Y(Math.min(w, v.w1)).toFixed(1)}`;
  }
  marks.push({ t: 'path', pane: 0, d: sd, stroke: 'ink2', w: 1.8 });

  // Axes: dry bulb along the foot, humidity ratio up the right.
  marks.push({ t: 'path', pane: 0, d: `M${plot.x},${bottom + 0.5}H${right + 0.5}V${plot.y}`, stroke: 'axis', w: 1.2 });
  const tLab = plot.w < 360 ? tStep * 2 : tStep;
  const ts = tickValues(v.t0, v.t1, tLab);
  for (const t of ts) {
    const last = t === ts[ts.length - 1];
    text(Math.min(X(t), last ? right - 12 : right), bottom + 7, last ? `${t} ${u.t}`.replace('-', '−') : String(t).replace('-', '−'), 'tick', { size: 11, base: 'top' });
  }
  const wLab = plot.h < 260 ? wStep * 2 : wStep;
  for (const w of tickValues(0, v.w1, wLab)) {
    const y = Y(w);
    if (y < plot.y + 22) continue;
    text(right + 7, y, String(Math.round(w * u.wScale)), 'tick', { size: 11, anchor: 'start' });
  }
  text(right + 7, plot.y + 4, u.w, 'tick', { size: 11, anchor: 'start', base: 'middle' });

  // The process line, joining the states in sheet order with an arrow along each leg.
  const pts = states.map((s) => ({ s, x: X(toUnits(s.T, s.si, v.si)), y: Y(s.W), xd: X(toUnits(s.Tdp, s.si, v.si)) }));
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1], q = pts[k], L = Math.hypot(q.x - p.x, q.y - p.y);
    if (!(L > 20)) continue;
    const ux = (q.x - p.x) / L, uy = (q.y - p.y) / L;
    marks.push({ t: 'line', pane: 0, x1: p.x + ux * 9, y1: p.y + uy * 9, x2: q.x - ux * 9, y2: q.y - uy * 9, tone: 'ink2', w: 1.8 });
    const mx = p.x + ux * L * 0.55, my = p.y + uy * L * 0.55, hd = 8;
    const ang = Math.atan2(uy, ux);
    marks.push({ t: 'path', pane: 0, d: `M${(mx + ux * hd / 2).toFixed(1)},${(my + uy * hd / 2).toFixed(1)}L${(mx - Math.cos(ang - 0.45) * hd).toFixed(1)},${(my - Math.sin(ang - 0.45) * hd).toFixed(1)}L${(mx - Math.cos(ang + 0.45) * hd).toFixed(1)},${(my - Math.sin(ang + 0.45) * hd).toFixed(1)}Z`, fill: 'ink2' });
  }

  // Each state: across to its dew point on saturation, its point, and its name.
  for (const { s, x, y, xd } of pts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x - xd > 14) {
      marks.push({ t: 'line', pane: 0, x1: x - 8, y1: y, x2: xd + 4, y2: y, tone: s.tone, w: 1.2, dash: [3, 3], op: 0.65 });
      marks.push({ t: 'path', pane: 0, d: `M${(xd + 3.2).toFixed(1)},${y.toFixed(1)}A3.2,3.2 0 1 0 ${(xd - 3.2).toFixed(1)},${y.toFixed(1)}A3.2,3.2 0 1 0 ${(xd + 3.2).toFixed(1)},${y.toFixed(1)}`, stroke: s.tone, w: 1.4 });
    }
    const below = s.RH > 75 || y < plot.y + 26;
    const nw = widthOf(s.name, 13, s.name.length * 8);
    const left = x + 10 + nw > right - 2;
    text(left ? x - 10 : x + 9, below ? y + 7 : y - 7, s.name, s.tone, { size: 13, weight: 700, anchor: left ? 'end' : 'start', base: below ? 'top' : 'bottom', plate: true });
    const same = s.si === v.si;
    handles.push({
      id: s.id, x, y, tone: s.tone, axis: 'xy',
      draggable: same && !!s.fn && (s.refs[0].k !== 'fixed' || s.refs[1].k !== 'fixed'),
      label: `State ${s.name}`,
      value: `${fmt1(s.T)} ${unitsOf(s.si).t}, ${fmt1(s.RH)}% RH`,
    });
  }
  return { size, panes: [pane], marks, handles, view: v, units: u };
}

// ---------- drags and keys ----------

/** What a drag holds from press to release: the chart's view and each slider's range, so neither moves under it. */
export interface PsychHold { view: PsychView; ranges: ReadonlyMap<string, SliderRange> }
export function holdPsych(states: readonly PsychState[], scene: Pick<PsychScene, 'view'>): PsychHold {
  const ranges = new Map<string, SliderRange>();
  for (const s of states) for (const r of s.refs) if (r.k === 'slider') ranges.set(r.id, r.range);
  return { view: scene.view, ranges };
}

/** How fine a typed number moves: half a degree in °C, a degree in °F; 1% RH (0.01 as a fraction); W and h finely. */
function steps(s: PsychState): [number, number] {
  const t = s.si ? 0.5 : 1;
  switch (s.fn) {
    case 'psych': return [t, s.fraction ? 0.01 : 1];
    case 'psychwb': case 'psychdp': return [t, t];
    case 'psychw': return [t, 0.0001];
    case 'psychh': return [t, 0.5];
    default: return [t, 1];
  }
}

/** The second input's value at a dry bulb and humidity ratio, as the state's call takes it, from the engine. */
function secondAt(s: PsychState, t: number, w: number): number {
  switch (s.fn) {
    case 'psych': { const rh = Math.max(0.01, Math.min(1, moistAir.rh(t, w, s.p, s.si))); return s.fraction ? rh : rh * 100; }
    case 'psychwb': return moistAir.wetBulb(t, w, s.p, s.si);
    case 'psychdp': return moistAir.dewPoint(t, w, s.p, s.si);
    case 'psychw': return w;
    case 'psychh': return moistAir.enthalpy(t, w, s.si);
    default: return NaN;
  }
}
/** The state's current second input, from its numbers. */
function secondOf(s: PsychState): number {
  switch (s.fn) {
    case 'psych': return s.fraction ? s.RH / 100 : s.RH;
    case 'psychwb': return moistAir.wetBulb(s.T, s.W, s.p, s.si);
    case 'psychdp': return s.Tdp;
    case 'psychw': return s.W;
    case 'psychh': return s.h;
    default: return NaN;
  }
}

/**
 * A state's point dragged to `p` (in the chart's pixels, at the drawing `size`): the edits that put the state there,
 * its dry bulb and its second input (RH, wet bulb, dew point, W or h, whichever its call takes), each rewritten in the
 * line or moved on the slider it reads. Typed numbers round to a step that suits them; a point can't go past
 * saturation.
 */
export function dragPsych(state: PsychState, size: Size, hold: PsychHold, p: Point): FigureEdit[] {
  const v = hold.view;
  if (!state.fn || state.si !== v.si) return [];
  const { iT, iW } = frame(size, v);
  const [ts, ws] = steps(state);
  let t = Math.max(v.t0, Math.min(v.t1, iT(p.x)));
  if (state.refs[0].k === 'text') t = quantize(t, ts);
  let w = Math.max(1e-6, Math.min(v.w1, iW(p.y)));
  try {
    w = Math.min(w, moistAir.humRatio(t, 1, state.p, state.si));
    let second = secondAt(state, t, w);
    if (state.refs[1].k === 'text') second = quantize(second, ws);
    if (state.fn === 'psych') second = Math.max(state.fraction ? 0.01 : 1, Math.min(state.fraction ? 1 : 100, second));
    if (state.fn === 'psychwb' || state.fn === 'psychdp') second = Math.min(second, t);
    return figureEdits(state.text, [{ ref: state.refs[0], v: t }, { ref: state.refs[1], v: second }], hold);
  } catch {
    return [];
  }
}

/**
 * A state's point moved by a key: left and right change its dry bulb, up and down its second input (more humid is
 * up), by a step (ten with `big`); a slider moves by its own step.
 */
export function nudgePsych(state: PsychState, hold: Pick<PsychHold, 'ranges'> | null, key: NudgeKey, big = false): FigureEdit[] {
  if (!state.fn) return [];
  const [ts, ws] = steps(state);
  const sign = key === 'right' || key === 'up' ? 1 : -1;
  const across = key === 'left' || key === 'right';
  const ref = state.refs[across ? 0 : 1];
  const step = ref.k === 'slider' ? (hold?.ranges.get(ref.id) ?? ref.range).step : across ? ts : ws;
  const at = across ? state.T : secondOf(state);
  let next = at + step * (big ? 10 : 1) * sign;
  if (ref.k === 'text') next = quantize(next, step);
  if (!across && state.fn === 'psych') next = Math.max(state.fraction ? 0.01 : 1, Math.min(state.fraction ? 1 : 100, next));
  return figureEdits(state.text, [{ ref, v: next }], hold);
}

/** What a screen reader hears for the chart. */
export function psychLabel(states: readonly PsychState[]): string {
  return `Psychrometric chart: ${states.map((s) => `${s.name} at ${fmt1(s.T)} ${unitsOf(s.si).t}, ${fmt1(s.RH)}% RH`).join('; ')}`;
}
