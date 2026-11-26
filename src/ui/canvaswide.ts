// The wide canvas as a whole, shared by every front end: when a window is wide enough for it, where every block goes
// (the example's frame, the flow by kind, settling, a dropped block), the view that shows the sheet, and each wire's
// route. src/ui/canvas.ts has the parts; this puts them together the one way, so every front end lands blocks in the
// same places. No DOM here.
import {
  BELOW_GAP, belowKey, boundsOf, BLOCK_GRID, EXAMPLE_GRAPH, EXAMPLE_GRAPH_GAP, EXAMPLE_GRAPH_SIZE, exampleFrameRect, fitAll, fitsAsIs, FLOW, flowLayout,
  GRAPH_BLOCK, roundedPath, routeWire, settleBlocks, wireKey, type CanvasView, type FlowBlock, type FlowKind, type Point, type Rect, type Size,
  type Wire,
} from './canvas';

export { isSidewaysPhone, isWideCanvas, NARROW_QUERY, SIDEWAYS_MAX_H, WIDE_MIN_W, WIDE_QUERY } from './breakpoints';

/** The sheet's graph block until the person resizes it, and the least it can be resized to. */
export const GRAPH_SIZE: Size = { w: 560, h: 440 };
export const GRAPH_MIN: Size = { w: 280, h: 200 };
/** The example frame's room round its blocks: at the sides and foot, and above for Clear example. */
export const FRAME_PAD = 16;
export const FRAME_TOP = 44;
/** Between the example's blocks inside its frame, and between a slider and the line it feeds (room for a tag). */
export const EXAMPLE_ROW_GAP = 20;
export const EXAMPLE_WIRE_GAP = 40;
/** The keypad panel, beside which the composer centres: its width with the room round it. */
export const KEYS_ROOM = 400;
/** The keypad panel's own width, its key gap and its inset from the window's corner. */
export const KEYS_W = 376;
export const KEYS_INSET = 22;
/** The composer's widest, and the room kept either side of it. */
export const COMPOSER_MAX_W = 680;
export const COMPOSER_SIDE = 24;
/** The dot grid's pitch at 100%. */
export const DOT_PITCH = 22;
/** A zoom button's step. */
export const ZOOM_STEP = 1.25;
/** How far a press moves before it's a drag (a block) or a pan (the background), in screen px. */
export const DRAG_SLOP = 4;

/** The example's frame as one block in the flow. */
const EXAMPLE_UNIT = '#example-unit';
const GROUP = '#example';

/** A block on the wide canvas, as its front end measured it. */
export interface WideBlock {
  id: string;
  size: Size;
  example?: boolean;
  slider?: boolean;
  /** A figure block (src/ui/figures.ts): it flows with the lines that draw, left of the graph. */
  figure?: boolean;
  /**
   * A block that's there to feed another, as a slider is: it flows just above the first block it feeds. The lists a
   * fit reads as its data (pairedRows in src/ui/figures.ts) go this way, over the fit's scatter.
   */
  feeds?: boolean;
  /** Where the person dragged it. */
  at?: Point;
  /** Room kept under it for its open steps (a line's tray): the line and its tray are one unit. */
  below?: Size;
}

export interface WideInput {
  /**
   * The sheet's blocks in sheet order: blank lines and the line the composer is typing left out, a block being
   * changed in the composer kept (at its last size), so nothing lands on it while it's away.
   */
  blocks: readonly WideBlock[];
  wires: readonly Wire[];
  /** The sheet's graph, when it shows: its size, and where the person put it. */
  graph: { size: Size; pinned?: Point } | null;
  /** Whether the example's own graph shows. */
  exampleGraph: boolean;
  /** The lowest a block may reach in a column spanning x to x + w, in world units at the home view. */
  bottom?: (x: number, w: number) => number;
  editingId?: string | null;
  /** A block just dropped by a drag: it gives way to what it landed on. */
  dropped?: string | null;
  /**
   * While the pointer holds something (a slider, a point on the graph), where each block was laid out last: blocks
   * keep those places, at their new sizes, so nothing moves under the pointer until it's let go.
   */
  keep?: ReadonlyMap<string, Rect> | null;
  /**
   * The screen the home view fits the sheet into (wideHomeView's inputs, in px). Given, a sheet the home view would
   * zoom out for is laid out again with taller columns (as if the view were zoomed out) and the graph at the foot of a
   * column, keeping whichever the home view shows largest.
   */
  screen?: WideScreen | null;
  /**
   * Rows drawn inside another block, by that block's id: a sheet's moist-air states sit in its psychrometric chart
   * (src/ui/psych.ts). They aren't in `blocks`; the block they're in is, and it flows where the first of them would.
   * Each comes back in `rects` with its block's rect, so wires to and from it route as that block.
   */
  hosts?: ReadonlyMap<string, string> | null;
}

/** The wires as the flow sees them: a row inside a block as that block, and none between two rows of one block. */
export function hostedWires(wires: readonly Wire[], hosts: ReadonlyMap<string, string> | null | undefined): Wire[] {
  if (!hosts?.size) return [...wires];
  const out: Wire[] = [];
  const seen = new Set<string>();
  for (const w of wires) {
    const from = hosts.get(w.from) ?? w.from, to = hosts.get(w.to) ?? w.to;
    if (from === to) continue;
    const key = `${from}>${to}:${w.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to, name: w.name });
  }
  return out;
}

export interface WideLayout {
  /** Every block's rect, the graphs' included. */
  rects: Map<string, Rect>;
  /** The example's dashed frame, if it shows. */
  frame: Rect | null;
  /** Where the dropped block settled, to be stored as its `at` (or as the graph block's place). */
  dropped: { id: string; rect: Rect } | null;
  /** Each open line's tray, under the line, by the line's id. */
  trays: Map<string, Rect>;
}

/** The ids that belong to the example: its rows and its own graph. */
const exampleIds = (blocks: readonly WideBlock[]) => new Set([EXAMPLE_GRAPH, ...blocks.filter((b) => b.example).map((b) => b.id)]);

/**
 * Where every block goes. The example's blocks stack inside its frame, its own graph under them, and the frame flows
 * as one block; the rest flow by kind (flowLayout). Then nothing may sit on another block or on the example's frame,
 * whatever was dragged where: what came first (in the sheet's order, the frame as one block) stays, and a block just
 * dropped gives way.
 */
/** Where the home view fits a sheet: the canvas under the top bar, the composer and keys over it, its free areas. */
export interface WideScreen { area: Rect; composer: Rect | null; keys: Rect | null; free: readonly Rect[] }

/**
 * The screen the home view fits a sheet into, from where the canvas, the composer and the keys are: the canvas under
 * the top bar (and right of `left`), and both of its free areas (beside the keys, and over both at full width when
 * the keys are a panel in a corner, as on a tall window).
 */
export function wideScreen(size: Size, top: number, composer: Rect | null, keys: Rect | null, left = 0): WideScreen {
  return { area: { x: left, y: top, w: size.w - left, h: size.h - top }, composer, keys, free: wideFreeAreas(size, top, composer, keys, left) };
}

export function wideLayout(raw: WideInput): WideLayout {
  const hosts = raw.hosts;
  const laid = wideLayoutFlat(hosts?.size ? { ...raw, wires: hostedWires(raw.wires, hosts) } : raw);
  if (hosts?.size) for (const [id, host] of hosts) { const r = laid.rects.get(host); if (r) laid.rects.set(id, r); }
  return laid;
}

function wideLayoutFlat(input: WideInput): WideLayout {
  const first = layoutAt(input, 1, false);
  const screen = input.screen;
  if (!screen || input.keep) return first;
  const scale = (l: WideLayout) => wideHomeView(viewRects(l), screen.area, screen.composer, screen.keys, screen.free).scale;
  let best = first, bs = scale(first);
  if (bs >= 0.999) return first;
  // The search runs once per sheet shape: a render that changes nothing that's laid out reuses the layout it chose.
  const key = shapeKey(input);
  if (key === lastSearch.key) return lastSearch.params ? layoutAt(input, ...lastSearch.params) : first;
  let params: LayoutParams | null = null;
  // The graph, unless the person sized it, may also come a little smaller.
  const graphScales = input.graph && !input.graph.pinned ? [1, GRAPH_SHRINK] : [1];
  for (const s of [1, ...WRAP_SCALES]) for (const [under, valuesUnder] of [[false, false], [true, false], [false, true], [true, true]]) for (const gs of graphScales) for (const linesToo of s === 1 ? [true] : [true, false]) {
    if (s === 1 && !under && !valuesUnder && gs === 1) continue;
    const l = layoutAt(input, s, under, valuesUnder, gs, linesToo), sc = scale(l);
    // Only a clear gain is worth a different layout.
    if (sc > bs + 0.02) { best = l; bs = sc; params = [s, under, valuesUnder, gs, linesToo]; }
  }
  lastSearch = { key, params };
  return best;
}
type LayoutParams = [number, boolean, boolean, number, boolean];
let lastSearch: { key: string; params: LayoutParams | null } = { key: '', params: null };
/** Everything the search's choice depends on, as one string. */
function shapeKey(i: WideInput): string {
  const r = (v: Rect | Size | Point | null | undefined) => (v ? Object.values(v).map((n) => Math.round(n as number)).join(',') : '-');
  return JSON.stringify([
    i.blocks.map((b) => [b.id, r(b.size), b.example ? 1 : 0, b.slider ? 1 : 0, b.figure ? 1 : 0, b.feeds ? 1 : 0, r(b.at), r(b.below)]),
    i.wires.map((w) => `${w.from}>${w.to}:${w.name}`), i.graph ? [r(i.graph.size), r(i.graph.pinned)] : null, i.exampleGraph, i.editingId ?? null, i.dropped ?? null,
    i.screen ? [r(i.screen.area), r(i.screen.composer), r(i.screen.keys), i.screen.free.map(r)] : null,
    i.bottom ? [0, 200, 400, 600, 800, 1000, 1200, 1400].map((x) => Math.round(i.bottom!(x, 200))) : null,
  ]);
}
/** The zooms a crowded sheet is laid out for. */
const WRAP_SCALES = [0.9, 0.8, 0.75, 0.7, 0.6, 0.5, 0.4];
const GRAPH_SHRINK = 0.8;

/**
 * One layout, with columns as tall as the screen would be at zoom `s` (all of them, or only the graph's and the
 * values'), the graph maybe at a column's foot and a little smaller, and the values maybe under the graph.
 */
function layoutAt(input: WideInput, s: number, graphUnder: boolean, valuesUnder = false, graphScale = 1, linesToo = true): WideLayout {
  const { blocks, wires, editingId = null, dropped = null } = input;
  const isEx = (id: string) => exampleIds(blocks).has(id);
  const inside = new Map<string, Rect>();
  let y = FRAME_TOP;
  let above: string | null = null;
  for (const b of blocks) {
    if (!b.example || b.at) continue;
    // A slider over the line it feeds leaves its wire room to drop straight down with its tag on it.
    if (above && wires.some((w) => w.from === above && w.to === b.id && w.name)) y += EXAMPLE_WIRE_GAP - EXAMPLE_ROW_GAP;
    inside.set(b.id, { x: FRAME_PAD, y, ...b.size });
    y += b.size.h + EXAMPLE_ROW_GAP;
    above = b.id;
  }
  if (input.exampleGraph && inside.size) inside.set(EXAMPLE_GRAPH, { x: FRAME_PAD, y: y - EXAMPLE_ROW_GAP + EXAMPLE_GRAPH_GAP, ...EXAMPLE_GRAPH_SIZE });
  const inner = boundsOf([...inside.values()]);
  const exSize = inner ? { w: inner.x + inner.w + FRAME_PAD, h: inner.y + inner.h + FRAME_PAD } : null;
  const kindOf = (b: WideBlock): FlowKind => (b.slider || b.feeds ? 'slider' : b.figure ? 'figure' : wires.some((w) => w.from === b.id && w.to === GRAPH_BLOCK) ? 'line' : 'value');
  const flowBlocks: FlowBlock[] = [];
  let exampleAdded = false;
  for (const b of blocks) {
    if (b.example && !b.at) {
      if (!exampleAdded && exSize) flowBlocks.push({ id: EXAMPLE_UNIT, kind: 'example', size: exSize });
      exampleAdded = true;
      continue;
    }
    flowBlocks.push({ id: b.id, kind: kindOf(b), size: b.size, pinned: b.at, below: b.below });
  }
  const flow = flowLayout(flowBlocks, wires, {
    ...FLOW,
    graph: input.graph ? { id: GRAPH_BLOCK, size: graphScale === 1 ? input.graph.size : { w: Math.round(input.graph.size.w * graphScale), h: Math.round(input.graph.size.h * graphScale) }, pinned: input.graph.pinned } : null,
    // Columns as tall as the screen at zoom s: every column, or (`linesToo` false) only the graph's and the values'.
    bottom: input.bottom && (s === 1 || !linesToo ? input.bottom : (x, w) => input.bottom!(x * s, w * s) / s),
    bottomRest: input.bottom && s !== 1 ? (x, w) => input.bottom!(x * s, w * s) / s : undefined,
    graphUnder,
    valuesUnder,
  });
  const next = new Map<string, Rect>();
  const trays = new Map<string, Rect>();
  const unit = flow.get(EXAMPLE_UNIT);
  for (const b of blocks) { const t = flow.get(belowKey(b.id)); if (t) trays.set(b.id, t); }
  for (const [id, r] of flow) if (id !== EXAMPLE_UNIT && !id.endsWith('#below')) next.set(id, r);
  if (unit) for (const [id, r] of inside) next.set(id, { ...r, x: unit.x + r.x, y: unit.y + r.y });
  if (input.keep && !dropped) {
    for (const [id, r] of next) { const was = input.keep.get(id); if (was) next.set(id, id === GRAPH_BLOCK ? { ...was } : { ...r, x: was.x, y: was.y }); }
    for (const [id, t] of trays) { const l = next.get(id)!; trays.set(id, { ...t, x: l.x, y: l.y + l.h + BELOW_GAP }); }
  }

  const frameOf = () => exampleFrameRect([...next].filter(([id]) => isEx(id)).map(([, r]) => r), FRAME_PAD, FRAME_TOP);
  const order: string[] = [];
  const editing = editingId ? blocks.find((b) => b.id === editingId) : undefined;
  if (editing && next.has(editing.id) && !isEx(editing.id)) order.push(editing.id);
  for (const b of blocks) if (next.has(b.id)) { const u = isEx(b.id) ? GROUP : b.id; if (!order.includes(u)) order.push(u); }
  if (next.has(GRAPH_BLOCK)) order.push(GRAPH_BLOCK);
  const late = (u: string) => u === dropped || (u === GROUP && !!dropped && isEx(dropped));
  const groupRect = frameOf();
  // An open line and its tray are one unit.
  const withTray = (id: string) => { const r = next.get(id)!, t = trays.get(id); return t ? boundsOf([r, t])! : r; };
  const units = [...order.filter((u) => !late(u)), ...order.filter(late)]
    .flatMap((id) => (id === GROUP ? (groupRect ? [{ id, rect: groupRect }] : []) : [{ id, rect: withTray(id) }]));
  for (const [u, p] of settleBlocks(units)) {
    const ids = u === GROUP ? [...next.keys()].filter(isEx) : [u];
    const r0 = u === GROUP ? groupRect! : withTray(u);
    const d = { x: p.x - r0.x, y: p.y - r0.y };
    for (const id of ids) {
      const r = next.get(id)!;
      next.set(id, { ...r, x: r.x + d.x, y: r.y + d.y });
      const t = trays.get(id);
      if (t) trays.set(id, { ...t, x: t.x + d.x, y: t.y + d.y });
    }
  }
  const droppedRect = dropped ? next.get(dropped) : undefined;
  return { rects: next, frame: frameOf(), dropped: dropped && droppedRect ? { id: dropped, rect: droppedRect } : null, trays };
}

/** Room kept in view left of the leftmost block, where wires can run round it. */
export const WIRE_MARGIN = 36;
/**
 * Every block (and open tray) with the example's frame in place of its blocks, for fitting the view, and a point
 * WIRE_MARGIN left of them all, since wires can run round the left of the leftmost blocks.
 */
export function viewRects(layout: Pick<WideLayout, 'rects' | 'frame'> & { trays?: ReadonlyMap<string, Rect> }): Rect[] {
  const all = [...layout.rects.values(), ...(layout.trays?.values() ?? []), ...(layout.frame ? [layout.frame] : [])];
  const b = boundsOf(all);
  return b ? [...all, { x: b.x - WIRE_MARGIN, y: b.y, w: 1, h: 1 }] : all;
}

/** The part of the canvas the composer and the keypad leave free, in screen px. */
export function wideFreeArea(size: Size, top: number, keysW: number, composerH: number): Rect {
  const keys = keysW > 0 ? keysW + 40 : 0;
  return { x: 0, y: top, w: Math.max(200, size.w - keys), h: Math.max(160, size.h - top - composerH - 32) };
}

/**
 * The free parts of the canvas a sheet can be fitted into: beside the keys and over the composer, and, when the keys
 * are a panel in the corner rather than a column (a tall window), over both of them at full width.
 */
export function wideFreeAreas(size: Size, top: number, composer: Rect | null, keys: Rect | null, left = 0): Rect[] {
  // As wideFreeArea, without its floor: on a short window the floor would fit the sheet under the composer.
  const keysRoom = keys ? size.w - keys.x + 40 : 0, composerRoom = composer ? size.h - composer.y + 32 : 0;
  const out = [{ x: left, y: top, w: Math.max(40, size.w - left - keysRoom), h: Math.max(40, size.h - top - composerRoom) }];
  const foot = Math.min(composer?.y ?? size.h, keys?.y ?? size.h);
  if (keys) out.push({ x: left, y: top, w: size.w - left, h: Math.max(0, foot - 32 - top) });
  return out;
}

/**
 * The view that shows the whole sheet: as laid out, at 100%, when it fits beside the composer and keys (centred in
 * the room left of the keys if narrower), else zoomed out to fit the free area (the one of `free` that shows it
 * largest).
 * @param area the canvas under the top bar; `composer` and `keys` are where they sit over it, in screen px.
 */
export function wideHomeView(rects: readonly Rect[], area: Rect, composer: Rect | null, keys: Rect | null, free: Rect | readonly Rect[]): CanvasView {
  const b = boundsOf(rects);
  if (!b) return { scale: 1, dx: 0, dy: 0 };
  const covers = [...(composer ? [composer] : []), ...(keys ? [keys] : [])];
  const room = keys ? keys.x - area.x : area.w;
  if (area.x === 0) {
    if (fitsAsIs(rects, area, covers)) {
      const dx = Math.max(0, Math.round((room - b.w) / 2 - b.x));
      const shifted = rects.map((r) => ({ ...r, x: r.x + dx }));
      return { scale: 1, dx: fitsAsIs(shifted, area, covers) ? dx : 0, dy: 0 };
    }
  } else {
    const dx = area.x + Math.max(16, Math.round((room - b.w) / 2)) - b.x;
    const shifted = rects.map((r) => ({ ...r, x: r.x + dx }));
    if (fitsAsIs(shifted, area, covers)) return { scale: 1, dx, dy: 0 };
    const dxMin = area.x + 16 - b.x;
    const shiftedMin = rects.map((r) => ({ ...r, x: r.x + dxMin }));
    if (fitsAsIs(shiftedMin, area, covers)) return { scale: 1, dx: dxMin, dy: 0 };
  }
  // A small free area (a phone on its side) keeps less room round the sheet, so it isn't shrunk to nothing.
  const views = (Array.isArray(free) ? free : [free] as readonly Rect[]).filter((f) => f.w > 0 && f.h > 0).map((f) => fitAll(rects, f, Math.min(48, Math.round(Math.min(f.w, f.h) / 10))));
  return views.reduce((best, v) => (v.scale > best.scale ? v : best), views[0] ?? fitAll(rects, area));
}

/** Where the composer sits: centred in the room the keypad leaves, as wide as it may be. */
export function composerSpan(width: number, keysShown: boolean): { x: number; w: number } {
  const room = width - (keysShown ? KEYS_ROOM : 0);
  const w = Math.max(0, Math.min(COMPOSER_MAX_W, room - 2 * COMPOSER_SIDE));
  return { x: Math.round((room - w) / 2), w };
}

export interface WireRoute { wire: Wire; points: Point[]; d: string; from: Point; to: Point }
/** Between the ends of wires arriving down one block's left edge. */
export const WIRE_IN_STEP = 32;

export interface RouteOptions {
  editingId?: string | null;
  /** How long the run into the block must be for the wire's tag to sit on it (0: no tag). */
  minRun?: number;
  /** More blocks to keep clear of: an open line's steps, the strip between a line and its tray. */
  extra?: readonly Rect[];
  /** A box to end in other than the wire's own block (a step of the line it feeds), and that block stays in the way. */
  to?: Rect;
  /** When several wires enter the same step box, this wire's index and total count so their ports spread apart. */
  inSlot?: { index: number; count: number };
  /** The measured input socket's height on the block's left edge, in world units. */
  inY?: number;
  /** Where a wire from a readout's port leaves its block's right edge (the port's height, in world units). */
  outY?: number;
  /** Rows drawn inside another block (a moist-air state in the psychrometric chart), by the block they're in. */
  hosts?: ReadonlyMap<string, string>;
}

/**
 * One wire's route, round every block (and round the example's frame, unless it belongs to the example). Several
 * wires into one block arrive at their own heights down its left edge, in the order their sources sit; a wire ending
 * in a step comes in at the step's middle (or spread evenly when several enter the same step).
 */
export function wideWireRoute(w: Wire, wires: readonly Wire[], rects: ReadonlyMap<string, Rect>, frame: Rect | null, isExample: (id: string) => boolean, o: RouteOptions = {}): Point[] | null {
  const editingId = o.editingId ?? null;
  const a = rects.get(w.from), b = o.to ?? rects.get(w.to);
  if (!a || !b || w.from === editingId || w.to === editingId) return null;
  // A row inside a block routes as that block, and a wire between two rows of one block isn't drawn.
  const host = (id: string) => o.hosts?.get(id) ?? id;
  if (!o.to && host(w.from) === host(w.to)) return null;
  const obstacles = [...rects].filter(([id]) => host(id) !== host(w.from) && (o.to || host(id) !== host(w.to)) && id !== editingId).map(([, r]) => r);
  obstacles.push(...(o.extra ?? []));
  if (frame && !isExample(w.from) && !isExample(w.to)) obstacles.push(frame);
  // Wires into the block (or any row inside it), each at its own height, in the order their sources sit.
  const into = o.to ? [w] : wires.filter((x) => host(x.to) === host(w.to) && rects.has(x.from) && x.from !== editingId && host(x.from) !== host(x.to)).sort((p, q) => rects.get(p.from)!.y - rects.get(q.from)!.y);
  const count = o.to ? (o.inSlot?.count ?? 1) : into.length;
  const i = o.to ? (o.inSlot?.index ?? 0) : into.findIndex((x) => x === w || wireKey(x) === wireKey(w));
  const many = count > 1;
  return routeWire(a, b, obstacles, {
    inY: o.inY,
    spreadY: many ? (o.to ? Math.round(b.y + (b.h * (i + 1)) / (count + 1)) : Math.min(b.y + b.h - 16, b.y + 26 + i * WIRE_IN_STEP)) : undefined,
    // Into its top too: several wires arrive at their own places along it, so two never draw (or tag) as one.
    inX: many ? Math.min(b.x + b.w - 16, b.x + 28 + i * WIRE_IN_STEP) : undefined,
    lane: many ? Math.round((i - (count - 1) / 2) * 8) : 0,
    minRun: o.minRun,
    // A tag on a run down needs its height and a little room: 24 px and 16.
    minDrop: o.minRun ? 40 : 0,
    outY: o.outY,
  });
}

/** Every wire's route (see wideWireRoute); wires to or from the block being changed in the composer aren't drawn. */
export function wideWireRoutes(wires: readonly Wire[], rects: ReadonlyMap<string, Rect>, frame: Rect | null, isExample: (id: string) => boolean, editingId: string | null = null, minRun: (w: Wire) => number = () => 0, more: { portY?: (w: Wire) => number | undefined; inPortY?: (w: Wire) => number | undefined; hosts?: ReadonlyMap<string, string> } = {}): WireRoute[] {
  const out: WireRoute[] = [];
  for (const w of wires) {
    const points = wideWireRoute(w, wires, rects, frame, isExample, {
      editingId, minRun: minRun(w), inY: more.inPortY?.(w), outY: w.fromPort || w.toPin !== undefined ? more.portY?.(w) : undefined, hosts: more.hosts,
    });
    if (points) out.push({ wire: w, points, d: roundedPath(points), from: points[0], to: points[points.length - 1] });
  }
  return out;
}

const snap = (v: number) => Math.round(v / BLOCK_GRID) * BLOCK_GRID;
/** A block dragged from `at0` by (dx, dy) world units, on the grid. */
export const dragTo = (at0: Point, dx: number, dy: number): Point => ({ x: snap(at0.x + dx), y: snap(at0.y + dy) });
/** The graph block moved by its top strip, or resized by its corner, on the grid and never under GRAPH_MIN. */
export function dragGraph(g0: Rect, dx: number, dy: number, resize: boolean): Rect {
  return resize
    ? { ...g0, w: Math.max(GRAPH_MIN.w, snap(g0.w + dx)), h: Math.max(GRAPH_MIN.h, snap(g0.h + dy)) }
    : { ...g0, x: snap(g0.x + dx), y: snap(g0.y + dy) };
}

/**
 * Sheets from builds that stored every block's place are laid out afresh: only a place the person dragged a block to
 * is kept, which `flow: 2` marks. True when a sheet's stored places should be dropped (and `flow` set to 2).
 */
export const needsFreshFlow = (ui: { flow?: number }): boolean => ui.flow !== 2;
