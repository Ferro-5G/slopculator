import { cleanRow, cleanSettings, type RowInput, type RowResult } from '../engine/document';
import type { Settings } from '../engine/evaluator';
import { plainNumber, plainValue, type DisplayOpts } from '../engine/format';
import { isUnit, otherUnit } from '../engine/units';
import { COLORS, GRAPH_RATE_NAMES, LOOK_NAMES, MODE_NAMES, MOTION_NAMES, THEME_NAMES, type ColorPref, type GraphRatePref, type LookPref, type ModePref, type MotionPref, type ThemeValue } from './appearance';
import { lineErrorText } from './errortext';
import { ROUND_MAX } from './rounding';

/**
 * `at` is where the line's block sits on a wide canvas (src/ui/canvas.ts); narrow layouts ignore it, and a line without
 * one is placed when it's first shown. `example` marks the first run's example lines, which Clear example removes.
 * `open` marks a line whose steps are showing (src/ui/unfold.ts), so it opens that way again.
 */
export type DocRow = RowInput & { color: number; note?: string; at?: { x: number; y: number }; example?: true; open?: true; /** A figure block showing its numbers (figure is the default). */ view?: 'numbers' };

export interface DocBody<R extends DocRow> {
  rows: R[];
  settings: Required<Settings>;
  display: DisplayOpts;
}

export type LookName = LookPref;

export interface AppearancePrefs {
  theme?: ThemeValue;
  /** Appearance as it's now split (src/ui/appearance.ts); `theme` is kept in step for older readers. */
  mode?: ModePref;
  pureBlack?: boolean;
  contrast?: boolean;
  /** Modern when unset. */
  look?: LookName;
  /** Full when unset. */
  motion?: MotionPref;
  /** Highest when unset. */
  graphRate?: GraphRatePref;
  /** The accent and tint over the theme. The theme's own when unset. */
  color?: ColorPref;
  /** Aurora Glow: the light over the canvas, the composer and the keys. */
  glow?: boolean;
  padLeft?: boolean;
}

/**
 * What a saved sheet carries beyond its lines, on every platform: how it was being looked at. Everything else stored
 * beside these fields belongs to the device, and stays with it when a sheet opens.
 */
export interface SheetView {
  graph?: boolean;
  /** The user chose Show graph: it stays up on a sheet with nothing to plot. Unset, the graph comes and goes with what can be plotted. */
  graphPinned?: boolean;
  keypad?: boolean;
  view?: 'calc' | 'graph';
  /** Where the person put the graph block on a wide canvas (dragged or resized), and its size. Unset, the layout places it. */
  graphBlock?: { x: number; y: number; w: number; h: number };
  /**
   * 2 once the wide canvas lays blocks out by kind, where a stored position (a row's `at`, `graphBlock`) is one the
   * person chose by dragging. Unset, positions came from an older build that stored every block's place, and are dropped.
   */
  flow?: 2;
  /** The psychrometric chart showing its states' numbers instead of the chart (the chart is the default). */
  psych?: 'numbers';
  /** Where the person dragged the psychrometric chart on a wide canvas. Unset, the layout places it. */
  psychAt?: { x: number; y: number };
  /** Show the 2D node canvas on a phone or narrow window instead of the stacked column. */
  nodes?: boolean;
}

const SHEET_VIEW_FIELDS: readonly (keyof SheetView)[] = ['graph', 'graphPinned', 'keypad', 'view', 'graphBlock', 'flow', 'psych', 'psychAt', 'nodes'];

export const CURRENT_SHEET_KEY = 'slopculator:current';
export const RECENT_MAX = 6;


export const asObject = (v: unknown) => (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
export const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export const CURVES = 8;
export function nextColor(rows: readonly { color: number }[]): number {
  const used = new Set(rows.map((r) => r.color));
  for (let c = 0; c < CURVES - 1; c++) if (!used.has(c)) return c;
  return rows.length % (CURVES - 1);
}

export function blankBody<R extends DocRow>(row: R): DocBody<R> {
  return { rows: [row], settings: cleanSettings({}), display: { places: null, exact: false, percent: false } };
}

function cleanDisplay(raw: unknown): DisplayOpts {
  const dis = asObject(raw);
  const places = dis.places;
  return {
    places: Number.isInteger(places) && (places as number) >= 0 && (places as number) <= ROUND_MAX ? (places as number) : null,
    exact: bool(dis.exact, false),
    percent: bool(dis.percent, false),
    ...(typeof dis.fullDigits === 'boolean' ? { fullDigits: dis.fullDigits } : {}),
  };
}

export function cleanSheetView(raw: Record<string, unknown>): SheetView {
  return {
    ...(typeof raw.graph === 'boolean' ? { graph: raw.graph } : {}),
    ...(raw.graphPinned === true ? { graphPinned: true } : {}),
    ...(typeof raw.keypad === 'boolean' ? { keypad: raw.keypad } : {}),
    ...(raw.view === 'calc' || raw.view === 'graph' ? { view: raw.view } : {}),
    ...(cleanBlockRect(raw.graphBlock) ? { graphBlock: cleanBlockRect(raw.graphBlock)! } : {}),
    ...(raw.flow === 2 ? { flow: 2 as const } : {}),
    ...(raw.psych === 'numbers' ? { psych: 'numbers' as const } : {}),
    ...(cleanPoint(raw.psychAt) ? { psychAt: cleanPoint(raw.psychAt)! } : {}),
    ...(typeof raw.nodes === 'boolean' ? { nodes: raw.nodes } : {}),
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7;
function cleanPoint(raw: unknown): { x: number; y: number } | null {
  const p = asObject(raw);
  return finite(p.x) && finite(p.y) ? { x: p.x, y: p.y } : null;
}
function cleanBlockRect(raw: unknown): { x: number; y: number; w: number; h: number } | null {
  const p = cleanPoint(raw), r = asObject(raw);
  return p && finite(r.w) && finite(r.h) && r.w >= 80 && r.h >= 60 ? { ...p, w: r.w, h: r.h } : null;
}

/**
 * A device's settings once a sheet opens: the sheet's view over them.
 * @param keepUnset a view field the sheet never stored stays as the device has it, for sheets older than the field.
 */
export function withSheetView<T extends SheetView>(device: T, sheet: SheetView, keepUnset = false): T {
  const out = { ...device } as Record<string, unknown>;
  for (const k of SHEET_VIEW_FIELDS) {
    if (sheet[k] !== undefined) out[k] = sheet[k];
    else if (!keepUnset) delete out[k];
  }
  return out as T;
}

export function cleanAppearance(raw: Record<string, unknown>): AppearancePrefs {
  const oneOf = <T extends string>(v: unknown, names: readonly T[]): T | undefined => (names.includes(v as T) ? (v as T) : undefined);
  const theme = oneOf(raw.theme, THEME_NAMES.map(([t]) => t)), mode = oneOf(raw.mode, MODE_NAMES.map(([m]) => m));
  const look = oneOf(raw.look, LOOK_NAMES.map(([l]) => l)), motion = oneOf(raw.motion, MOTION_NAMES.map(([m]) => m)), graphRate = oneOf(raw.graphRate, GRAPH_RATE_NAMES.map(([r]) => r)), color = oneOf(raw.color, COLORS);
  return {
    ...(theme ? { theme } : {}),
    ...(mode ? { mode } : {}),
    ...(typeof raw.pureBlack === 'boolean' ? { pureBlack: raw.pureBlack } : {}),
    ...(typeof raw.contrast === 'boolean' ? { contrast: raw.contrast } : {}),
    ...(look ? { look } : {}),
    ...(motion ? { motion } : {}),
    ...(graphRate ? { graphRate } : {}),
    ...(color ? { color } : {}),
    ...(typeof raw.glow === 'boolean' ? { glow: raw.glow } : {}),
    ...(typeof raw.padLeft === 'boolean' ? { padLeft: raw.padLeft } : {}),
  };
}

export function cleanBody<R extends DocRow>(raw: Record<string, unknown>, newId: () => string, blankRow: () => R): DocBody<R> {
  const inputs: unknown[] = Array.isArray(raw.rows) ? raw.rows : [];
  const known = new Set(inputs.map((r) => asObject(r).id).filter((id): id is string => typeof id === 'string'));
  const seen = new Set<string>();
  const rows: R[] = [];
  for (const [k, r] of inputs.entries()) {
    const row = cleanRow(r);
    if (!row) continue;
    if (!row.id || seen.has(row.id)) {
      do { row.id = newId(); } while (known.has(row.id));
      known.add(row.id);
    }
    seen.add(row.id);
    const stored = asObject(r);
    const { color, note } = stored;
    const at = cleanPoint(stored.at);
    rows.push({ ...row, color: Number.isInteger(color) && (color as number) >= 0 ? (color as number) : k, ...(typeof note === 'string' ? { note } : {}), ...(at ? { at } : {}), ...(stored.example === true ? { example: true } : {}), ...(stored.open === true ? { open: true } : {}), ...(stored.view === 'numbers' ? { view: 'numbers' } : {}) } as R);
  }
  return { rows: rows.length ? rows : [blankRow()], settings: cleanSettings(raw.settings), display: cleanDisplay(raw.display) };
}

/**
 * Whether parsed JSON holds a sheet: a `rows` list with at least one line the app can read. Older exports carry no
 * `app` field, so the rows are what's checked. Anything else (`{}`, another app's file) would load as a blank sheet.
 */
export function hasSheetRows(parsed: unknown): boolean {
  const rows = (parsed as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) && rows.some((r: unknown) => cleanRow(r) !== null);
}

export function restoreDoc<D>(read: () => string | null, normalize: (raw: unknown) => D, blank: () => D): { doc: D; restored: boolean } {
  try {
    const raw = read();
    if (raw) {
      const parsed = JSON.parse(raw);
      return { doc: normalize(parsed), restored: hasSheetRows(parsed) };
    }
  } catch {
    /* fall through to a blank document */
  }
  return { doc: blank(), restored: false };
}

export function lineCopy(row: Extract<DocRow, { kind: 'expr' }>) {
  return { kind: 'expr' as const, text: row.text, dist: row.dist ? { ...row.dist } : undefined, slider: row.slider ? { ...row.slider } : undefined, note: row.note };
}

export const isEmptyLine = (row: RowInput): boolean => row.kind === 'expr' && !row.text.trim();

export const isBlankSheet = (rows: readonly RowInput[]): boolean => rows.length === 1 && isEmptyLine(rows[0]);

export const sheetLineCount = (rows: readonly RowInput[]): number => rows.filter((r) => r.kind === 'table' || r.text.trim()).length;

export const linesLabel = (n: number): string => `${n} line${n === 1 ? '' : 's'}`;

/** A saved sheet's date: the year only when it isn't this one. */
export function savedOn(at: number): string {
  const d = new Date(at);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function copyName(base: string, names: readonly string[]): string {
  const taken = new Set(names);
  let n = `${base} copy`;
  for (let k = 2; taken.has(n); k++) n = `${base} copy ${k}`;
  return n;
}

export function sheetAsText(rows: readonly RowInput[], results: readonly RowResult[], display: DisplayOpts): string {
  let end = rows.length;
  while (end > 0) {
    if (!isEmptyLine(rows[end - 1])) break;
    end--;
  }
  return rows.slice(0, end).map((row, k) => {
    const r = results[k];
    const name = r?.lineName ?? String(k + 1);
    if (row.kind === 'table') return `${name}. [table]${r?.table?.ev !== undefined ? ` E(X) = ${r.table.ev}` : ''}`;
    const res = !r ? '' : r.error ? `  -> error: ${lineErrorText(row.text, r.error, isUnit, otherUnit)}` : r.distProb !== undefined ? `  -> P = ${plainNumber(r.distProb, display.places)}` : r.value !== undefined ? `  -> ${plainValue(r.value, display, r.prob, r.precise)}` : '';
    return `${name}. ${row.text}${res}`;
  }).join('\n');
}

export const SAVE_DELAY_MS = 250;

export const SAVED_SHEETS_FAILED = "Saved sheets couldn't be updated: this device's storage is full or turned off.";

export function saveFailureReporter(report: (message: string) => void): (ok: boolean) => void {
  let failing = false;
  return (ok) => {
    if (!ok && !failing) report("This sheet isn't being saved: this device's storage is full or turned off.");
    failing = !ok;
  };
}

export interface SavedSheet<D> {
  name: string;
  savedAt: number;
  doc: D;
}

/** Key-value storage. A read or a write that fails throws. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function restoredSheetName(storage: KeyValueStorage, restored: boolean): string | null {
  try {
    if (!restored) {
      storage.removeItem(CURRENT_SHEET_KEY);
      return null;
    }
    return storage.getItem(CURRENT_SHEET_KEY) || null;
  } catch {
    return null;
  }
}

/** The saved sheets on any key-value store. Reading never throws; a write throws when the storage does. */
export function sheetStore<D>(storage: KeyValueStorage, key: string, normalize: (raw: unknown) => D) {
  const stored = (): unknown[] => {
    try {
      const v: unknown = JSON.parse(storage.getItem(key) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const readable = (list: unknown[]): SavedSheet<D>[] => list
    .filter((x): x is SavedSheet<D> => typeof x === 'object' && x !== null && typeof (x as SavedSheet<D>).name === 'string' && (x as SavedSheet<D>).name !== '' && typeof (x as SavedSheet<D>).doc === 'object' && (x as SavedSheet<D>).doc !== null)
    .map((x) => ({ name: x.name, savedAt: Number.isFinite(x.savedAt) ? x.savedAt : 0, doc: normalize(x.doc) }));
  const put = (list: SavedSheet<D>[]) => storage.setItem(key, JSON.stringify(list));
  const load = () => readable(stored());
  return {
    load,
    put,
    write(name: string, doc: D, drop?: string): SavedSheet<D>[] {
      const list = stored().filter((x) => { const n = (x as { name?: unknown } | null)?.name; return n !== name && n !== drop; });
      list.unshift({ name, savedAt: Date.now(), doc: JSON.parse(JSON.stringify(doc)) });
      storage.setItem(key, JSON.stringify(list));
      return readable(list);
    },
    remove(name: string): SavedSheet<D>[] {
      const rest = load().filter((s) => s.name !== name);
      put(rest);
      return rest;
    },
  };
}
