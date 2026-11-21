// Values on wires, shared by every front end: what each wire carries, as its tag shows it, and what a slider drag does
// to the tags (which wires it reaches, how far each value moved since the drag began, and how long that stays).
// Tags show only while a slider is held and for a moment after, and on the one wire pointed at or focused; at rest a
// wire shows no tag. No DOM here; the platforms draw the tags.
import { lineDefines, parseLine, type RowResult } from '../engine/document';
import { formatValue, type DisplayOpts } from '../engine/format';
import { canonicalName, superscript } from '../engine/lexer';
import type { Node } from '../engine/parser';
import type { Value } from '../engine/values';
import { pulseOrder, wireKey, type CanvasRow, type Wire } from './canvas';
import { portTagName, portValue, rowPorts } from './ports';

/** Significant figures a tag shows. A focused tag shows the line's own answer instead. */
export const TAG_SIG = 4;
/** A list's range is shorter still, so the range and its bars fit one tag. */
export const LIST_RANGE_SIG = 3;
/** The most bars a list's sparkline draws; a longer list is averaged into this many. */
export const SPARK_BARS = 24;
/** How long a released slider's changes stay on the tags, in ms, before they go quiet. */
export const DELTA_LINGER_MS = 1400;

const MINUS = '−';

/**
 * A number as a tag shows it: `sig` significant figures, trailing zeros dropped, with × 10ⁿ from a million up and
 * below 0.0001.
 */
export function tagNumber(x: number, sig = TAG_SIG): string {
  if (Number.isNaN(x)) return 'undefined';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : `${MINUS}∞`;
  const r = Number(x.toPrecision(sig));
  if (r === 0) return '0';
  const a = Math.abs(r);
  if (a >= 1e6 || a < 1e-4) {
    const [m, e] = r.toExponential(sig - 1).split('e');
    return `${String(Number(m)).replace('-', MINUS)} × 10${superscript(String(Number(e)))}`;
  }
  return String(r).replace('-', MINUS);
}

/** A list of numbers, summed up for a tag: its range, and each bar's height from 0 (the least) to 1 (the most). */
export interface ListSummary { count: number; min: number; max: number; bars: number[] }

/** A list of real numbers summed up, or null for anything else (an empty list, points, nested lists). */
export function summarizeList(v: Value): ListSummary | null {
  if (typeof v !== 'object' || v.t !== 'list' || !v.items.length || !v.items.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const xs = v.items as number[];
  const min = Math.min(...xs), max = Math.max(...xs), span = max - min;
  // More items than bars: each bar is the mean of its share of the list, in order.
  const n = Math.min(xs.length, SPARK_BARS);
  const means = Array.from({ length: n }, (_, b) => {
    const lo = Math.floor((b * xs.length) / n), hi = Math.floor(((b + 1) * xs.length) / n);
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += xs[i];
    return sum / (hi - lo);
  });
  return { count: xs.length, min, max, bars: means.map((m) => (span > 0 ? (m - min) / span : 1)) };
}

/** What a wire's tag shows. */
export type WireTag = {
  key: string;
  /** The name the wire carries: k, ans, a line letter. */
  name: string;
  /** The engine's unit for the value, when the line gives one (a convert line's "to" unit). */
  unit: string | null;
  /** The answer as the line's own block shows it, for a focused tag. */
  full: string;
} & (
  /** A number: its 4 significant figures, and the number, for a drag's change. */
  | { kind: 'number'; text: string; value: number }
  /** A list of numbers: its range ("9.6–10.4") and bars for a sparkline. */
  | { kind: 'list'; text: string; list: ListSummary }
  /** A complex number, point or vector at 4 significant figures, or a matrix's size. */
  | { kind: 'other'; text: string }
  /** The line the wire comes from has an error, so it carries nothing. */
  | { kind: 'error'; text: string }
);

/** The unit a line's value is in, when the engine gives it one: convert(5, "mi", "km") and 5 mi to km are in km. */
export function lineUnit(text: string): string | null {
  let n: Node;
  try {
    n = parseLine(text);
  } catch {
    return null;
  }
  if (n.k === 'rel' && n.ops.length === 1 && n.ops[0] === '=' && lineDefines(text)) n = n.items[1];
  return n.k === 'call' && n.name === 'convert' && n.args[2]?.k === 'str' ? n.args[2].s : null;
}

/** The value a wire carries: the line it comes from's value (a table's column, for a wire from a table). */
export function carriedValue(w: Wire, rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[]): { value?: Value; error?: string; prob: boolean } {
  const k = rows.findIndex((r) => r.id === w.from);
  const row = rows[k], r = results[k];
  if (!row || !r) return { prob: false };
  if (row.kind === 'table') {
    const c = row.columns.findIndex((col) => canonicalName(col.header.trim()) === w.name);
    const col = r.table?.columns[c];
    if (!col) return { prob: false };
    if (col.error) return { error: col.error, prob: false };
    return { value: { t: 'list', items: col.values.filter((x): x is number => x !== null) }, prob: false };
  }
  if (r.error) return { error: r.error, prob: false };
  // A wire from a port carries that one result.
  if (w.fromPort) {
    const v = portValue(row, r, w.fromPort);
    return v === undefined ? { prob: false } : { value: v, prob: false };
  }
  return { value: r.value ?? r.slider?.value, prob: r.prob };
}

/**
 * The tag for one wire, or null when it carries nothing a tag can show: a wire into a graph, a function, a
 * distribution, a table of results or text. `display` is the sheet's display settings, so a probability reads as a
 * percent when answers do.
 */
export function wireTag(w: Wire, rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], display: DisplayOpts): WireTag | null {
  if (!w.name) return null;
  const c = carriedValue(w, rows, results);
  const row = rows.find((r) => r.id === w.from);
  const unit = row?.kind === 'expr' && !w.fromPort ? lineUnit(row.text) : null;
  const k = rows.findIndex((r) => r.id === w.from);
  const name = w.fromPort ? portTagName(w.name, (row && rowPorts(row, results[k])?.kind) ?? null, w.fromPort) : w.name;
  const base = { key: wireKey(w), name, unit };
  if (c.error !== undefined) return { ...base, full: '', kind: 'error', text: '—' };
  const v = c.value;
  if (v === undefined) return null;
  const full = formatValue(v, display, c.prob);
  if (typeof v === 'number') {
    const pct = c.prob && display.percent;
    return { ...base, full, kind: 'number', value: v, text: pct ? `${tagNumber(v * 100)}%` : tagNumber(v) };
  }
  switch (v.t) {
    case 'list': {
      const list = summarizeList(v);
      if (!list) return { ...base, full, kind: 'other', text: `{${v.items.length ? '…' : ''}}` };
      const text = list.min === list.max ? tagNumber(list.min, LIST_RANGE_SIG) : `${tagNumber(list.min, LIST_RANGE_SIG)}–${tagNumber(list.max, LIST_RANGE_SIG)}`;
      return { ...base, full, kind: 'list', text, list };
    }
    case 'complex': {
      const im = Math.abs(v.im) === 1 ? 'i' : `${tagNumber(Math.abs(v.im))}i`;
      return { ...base, full, kind: 'other', text: v.re === 0 ? `${v.im < 0 ? MINUS : ''}${im}` : `${tagNumber(v.re)} ${v.im < 0 ? MINUS : '+'} ${im}` };
    }
    case 'point': return { ...base, full, kind: 'other', text: `(${v.c.map((x) => tagNumber(x)).join(', ')})` };
    case 'vector': return { ...base, full, kind: 'other', text: `⟨${v.c.map((x) => tagNumber(x)).join(', ')}⟩` };
    case 'matrix': return { ...base, full, kind: 'other', text: `${v.m.length}×${v.m[0]?.length ?? 0}` };
    default: return null;
  }
}

/** Every wire's tag, by wire key; wires with nothing to show are left out. */
export function wireTags(wires: readonly Wire[], rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], display: DisplayOpts): Map<string, WireTag> {
  const out = new Map<string, WireTag>();
  for (const w of wires) {
    const t = wireTag(w, rows, results, display);
    if (t) out.set(t.key, t);
  }
  return out;
}

/**
 * A slider drag, from press to a moment after release. The values every wire carried when it began are held for the
 * whole drag, so each tag can show how far its value has moved.
 */
export interface DragSession {
  /** The slider's row. */
  source: string;
  /** The wires its change runs down: out of the slider, and out of every line it reaches. */
  reach: ReadonlySet<string>;
  /** The lines (and graphs) it reaches, by id, with how many wires away each is. */
  hops: ReadonlyMap<string, number>;
  /** The names whose values it changes: the slider's own and every reached line's (for a line's steps). */
  names: ReadonlySet<string>;
  /** Each wire's number when the drag began, by wire key; only wires that carried a number. */
  start: ReadonlyMap<string, number>;
  /** When the slider was let go (the caller's clock, in ms), or null while it's held. */
  releasedAt: number | null;
}

/**
 * The drag that begins when a slider is pressed (or a key moves it). A press on the same slider while its last drag's
 * changes still show carries on from that drag, so a run of quick nudges, or arrow keys, adds up against one start.
 */
export function startDrag(sliderId: string, wires: readonly Wire[], rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], prev: DragSession | null = null, now = 0): DragSession {
  if (prev && prev.source === sliderId && !dragOver(prev, now)) return { ...prev, releasedAt: null };
  const order = pulseOrder(wires, sliderId);
  const hops = new Map([[sliderId, 0], ...order.map((o) => [o.id, o.hop] as const)]);
  const reach = new Set<string>(), names = new Set<string>(), start = new Map<string, number>();
  for (const w of wires) {
    if (!hops.has(w.from) || !hops.has(w.to)) continue;
    const key = wireKey(w);
    reach.add(key);
    if (w.name) names.add(w.name);
    const v = carriedValue(w, rows, results).value;
    if (typeof v === 'number') start.set(key, v);
  }
  // The slider's own name, even when nothing reads it yet.
  const k = rows.findIndex((r) => r.id === sliderId);
  const own = results[k]?.slider?.name ?? results[k]?.defines;
  if (own) names.add(own);
  hops.delete(sliderId);
  return { source: sliderId, reach, hops, names, start, releasedAt: null };
}

/** The drag once its slider is let go: its changes stay for DELTA_LINGER_MS. */
export const endDrag = (s: DragSession, now: number): DragSession => (s.releasedAt === null ? { ...s, releasedAt: now } : s);

/** Whether a released drag's changes have had their time: its tags go quiet and the session can be dropped. */
export const dragOver = (s: DragSession, now: number): boolean => s.releasedAt !== null && now - s.releasedAt >= DELTA_LINGER_MS;

/**
 * How far a value moved since the drag began, as a tag shows it: a percent of where it started (+12.4%, −3%), or the
 * change itself when it started at 0 (+0.25). Null when it hasn't moved enough to show (under 0.05%).
 */
export function formatDelta(now: number, start: number): string | null {
  if (!Number.isFinite(now) || !Number.isFinite(start) || now === start) return null;
  const sign = now > start ? '+' : MINUS;
  if (start === 0) return `${sign}${tagNumber(Math.abs(now))}`;
  const p = Math.abs(((now - start) / Math.abs(start)) * 100);
  if (p < 0.05) return null;
  return `${sign}${p < 100 ? p.toFixed(1) : p.toFixed(0)}%`;
}

/** How far a value moved, as itself (+2, −0.7321): a line's steps show their changes this way. Null when it didn't. */
export function formatChange(now: number, start: number): string | null {
  if (!Number.isFinite(now) || !Number.isFinite(start) || now === start) return null;
  const d = tagNumber(Math.abs(now - start));
  return d === '0' ? null : `${now > start ? '+' : MINUS}${d}`;
}

/** A wire's change since the drag began, or null: a wire the drag doesn't reach, or a value that isn't a number. */
export function wireDelta(s: DragSession, tag: WireTag | null | undefined): string | null {
  if (!tag || tag.kind !== 'number' || !s.reach.has(tag.key)) return null;
  const start = s.start.get(tag.key);
  return start === undefined ? null : formatDelta(tag.value, start);
}

/**
 * How a wire draws: lit when a drag runs down it, dim when a drag or a pointed-at wire leaves it out, focus when it's
 * the one pointed at or focused, and plain at rest.
 */
export type WireState = 'plain' | 'lit' | 'dim' | 'focus';

export function wireState(key: string, drag: DragSession | null, focus: string | null): WireState {
  if (focus === key) return 'focus';
  if (drag) return drag.reach.has(key) ? 'lit' : 'dim';
  return focus ? 'dim' : 'plain';
}

/**
 * The wires whose tags show: every wire's while a drag is held or lingers (the ones it reaches lit, the rest dim, by
 * wireState; in a phone's column only the ones it reaches, `reachedOnly`), and the one pointed at or focused. At rest, none. `now` is the caller's clock, the one endDrag was given.
 */
export function shownTags(tags: ReadonlyMap<string, WireTag>, drag: DragSession | null, focus: string | null, now: number, opts: { reachedOnly?: boolean } = {}): Set<string> {
  const out = new Set<string>();
  // A phone's column (Cascade) has room only for the tags of the wires the drag runs down: `reachedOnly`.
  if (drag && !dragOver(drag, now)) for (const key of tags.keys()) if (!opts.reachedOnly || drag.reach.has(key)) out.add(key);
  if (focus && tags.has(focus)) out.add(focus);
  return out;
}
