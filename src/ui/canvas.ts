// The canvas sheet, shared by every front end: which lines feed which (wires), the order a slider's pulse reaches them,
// where a new block goes on a wide canvas, the lanes wires take down a phone's gutter, what the composer's enter does,
// and the first run's example and hints. No DOM here; the platforms draw what these decide.
import { lettersOf, isGraphVar, namesIn } from '../engine/ast';
import { CONSTANTS } from '../engine/builtins';
import { lineDefines, type RowInput, type RowResult } from '../engine/document';
import { canonicalName } from '../engine/lexer';
import { isHeading, parse, type Node } from '../engine/parser';
import { fitParams, portReads, rowPorts } from './ports';

/** The id the graph block goes by in wires, pulses and the phone's column. A row id never takes this form. */
export const GRAPH_BLOCK = '#graph';
/**
 * The example's own small graph, inside its frame. The example's curves draw there and never on the sheet's graph, so
 * the person's graph only ever holds their own lines.
 */
export const EXAMPLE_GRAPH = '#example-graph';

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export interface Rect extends Point, Size {}

/**
 * A line feeding another: `from` defines `name` and `to` uses it. A line that draws feeds the graph block, with no name.
 * `fromPort`: the wire reads one of `from`'s results (src/ui/ports.ts), as A.h reads a state's enthalpy, and leaves
 * from that result's port.
 */
export interface Wire { from: string; to: string; name: string; fromPort?: string }
export const wireKey = (w: Pick<Wire, 'from' | 'to'> & { fromPort?: string }): string => `${w.from}${w.fromPort ? `.${w.fromPort}` : ''}>${w.to}`;

type Expr = Extract<RowInput, { kind: 'expr' }>;
/** A sheet's row as the canvas sees it: the engine's input, and whether it belongs to the first run's example. */
export type CanvasRow = RowInput & { example?: boolean };
const isExpr = (r: RowInput): r is Expr => r.kind === 'expr';
/** Blank lines and headings never take part: there's nothing to wire. */
const isBlank = (r: RowInput): boolean => r.kind === 'expr' && (!r.text.trim() || isHeading(r.text));

function tree(text: string): Node | null {
  try {
    return parse(text);
  } catch {
    return null;
  }
}

/** A function definition's inputs are its own: f(x) = x² doesn't use another line's x. */
function localNames(n: Node): Set<string> {
  if (n.k === 'rel' && n.ops?.[0] === '=' && n.items[0]?.k === 'call') return new Set(n.items[0].args.flatMap((a) => (a.k === 'id' ? [a.name] : [])));
  return new Set();
}

/**
 * Which row defines each name on a sheet: variables, functions, sliders, table columns, and line letters when line
 * letters are on. A name defined twice belongs to its first line.
 */
export function sheetDefiners(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], opts: { lineNames?: boolean } = {}): Map<string, string> {
  const definer = new Map<string, string>();
  rows.forEach((row, k) => {
    if (row.kind === 'table') {
      for (const c of row.columns) if (c.header.trim()) definer.set(canonicalName(c.header.trim()), row.id);
      return;
    }
    const r = results[k];
    const name = r?.defines ?? r?.slider?.name ?? lineDefines(row.text);
    if (name && !definer.has(name)) definer.set(name, row.id);
    // A fit defines its unknowns: y1 ~ m x1 + b defines m and b.
    if (rowPorts(row, r)?.kind === 'fit' && r?.value && typeof r.value === 'object' && r.value.t === 'record') for (const p of fitParams(r.value)) if (!definer.has(p)) definer.set(p, row.id);
    if (opts.lineNames && r?.lineName && !definer.has(r.lineName)) definer.set(r.lineName, row.id);
  });
  return definer;
}

/**
 * The sheet's names a tree reads, the way the engine resolves them: a word that isn't a name reads as its letters when
 * each one is defined (kx is k·x). `ans` is kept as itself; x, y, constants and `locals` (a function's own inputs)
 * aren't sheet names.
 */
export function namesRead(n: Node, isDefined: (name: string) => boolean, locals: ReadonlySet<string> = new Set()): string[] {
  const out = new Set<string>();
  for (const name of namesIn(n)) {
    if (locals.has(name) || isGraphVar(name)) continue;
    if (name === 'ans' || isDefined(name)) { out.add(name); continue; }
    if (name in CONSTANTS) continue;
    for (const ch of lettersOf(name, (c) => isGraphVar(c) || isDefined(c) || c in CONSTANTS) ?? []) if (isDefined(ch) && !locals.has(ch)) out.add(ch);
  }
  return [...out];
}

/**
 * Every wire on a sheet. A line is wired from each line that defines a name it reads (see sheetDefiners and
 * namesRead). `ans` is wired from the line above it. A line with something drawn, and not hidden, is wired to the
 * graph it draws on: the example's own graph for the example's lines, the sheet's graph block for every other line.
 */
export function sheetWires(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], opts: { lineNames?: boolean } = {}): Wire[] {
  const definer = sheetDefiners(rows, results, opts);
  const out: Wire[] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string, name: string, fromPort?: string) => {
    if (from === to) return;
    const key = wireKey({ from, to, fromPort });
    if (seen.has(key)) return;
    seen.add(key);
    out.push(fromPort ? { from, to, name, fromPort } : { from, to, name });
  };
  const index = new Map(rows.map((r, k) => [r.id, k]));
  const definerOf = (name: string) => {
    const id = definer.get(name), k = id === undefined ? undefined : index.get(id);
    return k === undefined ? null : { row: rows[k], result: results[k] };
  };
  const isFunction = (name: string) => {
    const d = definerOf(name);
    if (!d || d.row.kind !== 'expr') return false;
    const t = tree(d.row.text);
    return !!t && t.k === 'rel' && t.items[0]?.k === 'call';
  };
  rows.forEach((row, k) => {
    if (!isExpr(row) || isBlank(row)) return;
    const n = tree(row.text);
    if (n) {
      const own = results[k]?.defines ?? lineDefines(row.text);
      // Reads of one result (A.h, mean(data), a fit's m) wire from that result's port.
      const pr = portReads(n, definerOf, isFunction);
      for (const r of pr.reads) if (r.name !== own) add(definer.get(r.name)!, row.id, r.name, r.port);
      for (const name of namesRead(n, (m) => definer.has(m), localNames(n))) {
        if (name === own) continue;
        // Every mention goes through a port, or it's only a field after a dot: no wire from the block as a whole.
        if ((pr.consumed.get(name) ?? 0) > 0 && pr.consumed.get(name) === pr.mentions.get(name)) continue;
        if (pr.fields.has(name) && !pr.mentions.has(name)) continue;
        if (name === 'ans') {
          const above = rows.slice(0, k).reverse().find((r) => !isBlank(r));
          if (above) add(above.id, row.id, 'ans');
          continue;
        }
        add(definer.get(name)!, row.id, name);
      }
    }
    if ((results[k]?.graph.length ?? 0) > 0 && !row.hidden) add(row.id, graphOf(row), '');
  });
  for (const [k, row] of rows.entries()) if (row.kind === 'table' && (results[k]?.graph.length ?? 0) > 0 && !row.hidden) add(row.id, graphOf(row), '');
  return out;
}

/** Which graph a row draws on. */
export const graphOf = (row: { example?: boolean }): string => (isExampleRow(row) ? EXAMPLE_GRAPH : GRAPH_BLOCK);
/** Whether a row's curves belong on the sheet's graph (every front end's main graph), rather than the example's. */
export const onSheetGraph = (row: { example?: boolean }): boolean => !isExampleRow(row);

/** The lines a change to `from` reaches, nearest first: hop 1 reads it directly, hop 2 reads one of those, and so on. */
export function pulseOrder(wires: readonly Wire[], from: string): { id: string; hop: number }[] {
  const out: { id: string; hop: number }[] = [];
  const seen = new Set([from]);
  let frontier = [from];
  for (let hop = 1; frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) for (const w of wires) {
      if (w.from !== id || seen.has(w.to)) continue;
      seen.add(w.to);
      next.push(w.to);
      out.push({ id: w.to, hop });
    }
    frontier = next;
  }
  return out;
}
/** How long a pulse takes to cross one wire, in ms. */
export const PULSE_HOP_MS = 90;

const overlaps = (a: Rect, b: Rect, gap: number): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

/** Room kept between blocks on a wide canvas, and the grid they snap to. */
export const BLOCK_GAP = 24;
export const BLOCK_GRID = 8;

/**
 * Where a new block goes on a wide canvas: to the right of what it uses, else under it, else the first free spot in
 * view (down the first column, then the next), else under everything. It never overlaps a block and sits on the grid.
 */
export function placeBlock(existing: readonly Rect[], size: Size, uses: readonly Rect[], view: Rect, gap = BLOCK_GAP, grid = BLOCK_GRID): Point {
  const free = (p: Point) => !existing.some((b) => overlaps({ ...p, ...size }, b, gap - 1));
  const inView = (p: Point) => p.x >= view.x && p.y >= view.y && p.x + size.w <= view.x + view.w && p.y + size.h <= view.y + view.h;
  const at = (x: number, y: number): Point => ({ x: snap(x, grid), y: snap(y, grid) });
  const near: Point[] = [];
  if (uses.length) {
    const right = uses.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a));
    const low = uses.reduce((a, b) => (b.y + b.h > a.y + a.h ? b : a));
    near.push(at(right.x + right.w + gap * 2, right.y), at(low.x, low.y + low.h + gap));
    // Further down the column under what it uses, before giving up on being near it.
    for (let y = low.y + low.h + gap; y < low.y + low.h + 20 * (size.h + gap); y += grid) near.push(at(low.x, y));
  }
  let outside: Point | undefined;
  if (uses.length) {
    // Beside what it uses and in view first; beside it out of view only when nothing in view is free.
    const spot = near.find((p) => free(p) && inView(p));
    if (spot) return spot;
    outside = near.slice(0, 2).find(free);
  }
  const step = Math.max(grid, Math.round(Math.min(size.w, size.h) / 4 / grid) * grid);
  for (let x = view.x + gap; x + size.w <= view.x + view.w - gap; x += step) {
    for (let y = view.y + gap; y + size.h <= view.y + view.h - gap; y += step) {
      const p = at(x, y);
      if (free(p)) return p;
    }
  }
  if (outside) return outside;
  const bottom = existing.reduce((m, b) => Math.max(m, b.y + b.h), view.y);
  return at(view.x + gap, bottom + gap);
}

/** The least room settling leaves between two blocks that collided. */
export const SETTLE_GAP = 16;

/**
 * Moves blocks so none overlaps another. Units are taken in order: the first keeps its place, and each later one keeps
 * its place if nothing settled so far is within `gap` of it, else moves the shortest distance (on the grid, with up and
 * left counting extra) to where nothing is. A unit can be one block or a group, such as the example's frame, which moves as one. Returns each unit's
 * new top-left corner.
 */
export function settleBlocks(units: readonly { id: string; rect: Rect }[], gap = SETTLE_GAP, grid = BLOCK_GRID): Map<string, Point> {
  const settled: Rect[] = [];
  const out = new Map<string, Point>();
  const up = (v: number) => Math.ceil(v / grid - 1e-9) * grid;
  const down = (v: number) => Math.floor(v / grid + 1e-9) * grid;
  for (const { id, rect: r } of units) {
    const clear = (dx: number, dy: number) => !settled.some((o) => overlaps({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }, o, gap));
    let best: Point = { x: 0, y: 0 };
    if (!clear(0, 0)) {
      // Every move worth trying lines one edge up with a settled block's edge, a gap away, in x, in y, or both.
      const dxs = new Set([0]), dys = new Set([0]);
      for (const o of settled) {
        dxs.add(up(o.x + o.w + gap - r.x)).add(down(o.x - gap - r.w - r.x));
        dys.add(up(o.y + o.h + gap - r.y)).add(down(o.y - gap - r.h - r.y));
      }
      let d = Infinity;
      for (const dy of dys) for (const dx of dxs) {
        // A move up or left costs more: it can take a block under the top bar or out of view, and down or right keeps
        // the order the sheet reads in.
        const dist = Math.hypot(dx < 0 ? dx * 1.5 : dx, dy < 0 ? dy * 1.5 : dy);
        if (dist < d && clear(dx, dy)) { d = dist; best = { x: dx, y: dy }; }
      }
    }
    const at = { x: r.x + best.x, y: r.y + best.y, w: r.w, h: r.h };
    settled.push(at);
    out.set(id, { x: at.x, y: at.y });
  }
  return out;
}

/** The example's frame round its blocks: `pad` at the sides and foot, `top` above for its Clear example band. */
export function exampleFrameRect(members: readonly Rect[], pad: number, top: number): Rect | null {
  const b = boundsOf(members);
  return b && { x: b.x - pad, y: b.y - top, w: b.w + 2 * pad, h: b.h + top + pad };
}
/** The example's own graph on a wide canvas, and how far under its lowest block it sits. */
export const EXAMPLE_GRAPH_SIZE: Size = { w: 330, h: 196 };
export const EXAMPLE_GRAPH_GAP = 24;

/**
 * What a block is, for the wide canvas's layout: the mockup's columns. Sliders and the lines that draw go down the
 * left with figure blocks (src/ui/figures.ts) among them, each under the slider it reads, as the mockup puts the unit
 * circle; the graph sits in the middle, and values go down the right. The example (a slider, its curve and its own graph, framed) is one unit at the top of the lines column.
 */
export type FlowKind = 'slider' | 'line' | 'value' | 'example' | 'figure';
export interface FlowBlock {
  id: string;
  kind: FlowKind;
  size: Size;
  /** Where the person dragged it: it stays. */
  pinned?: Point;
  /** Room kept under it, left-aligned, BELOW_GAP down: a line's open steps. It never moves the block itself. */
  below?: Size;
}
/** Between a block and the room kept under it. */
export const BELOW_GAP = 26;
/** The key of the room kept under a block, in flowLayout's result. */
export const belowKey = (id: string): string => `${id}#below`;
export interface FlowOptions {
  /** Top-left of the first column. */
  origin: Point;
  /** Between columns, and between blocks in a column. */
  colGap: number;
  rowGap: number;
  /** The sheet's graph, if it shows: its own column between the lines and the values, unless it was dragged. */
  graph?: { id: string; size: Size; pinned?: Point } | null;
  /** The lowest a block may reach in a column spanning x to x + w (the composer and the keys are below it). */
  bottom?: (x: number, w: number) => number;
  /** Extra room above a block that the block over it feeds, so the wire between them is long enough for its tag. */
  wireGap?: number;
  /**
   * The graph may sit at the foot of the last lines column, where there's room for it, instead of a column of its
   * own: a crowded sheet then wraps into the height beside the composer rather than one long row.
   */
  graphUnder?: boolean;
  /** Values start under the graph (or, with no graph, under the last lines column) instead of in a column past it. */
  valuesUnder?: boolean;
  /** The lowest the graph and values may reach, when it differs from the lines' (a crowded sheet on a tall screen). */
  bottomRest?: (x: number, w: number) => number;
  /**
   * How far a block steps right in its column for each level it sits below what it reads there (stepDepths), up to
   * `maxDepth` levels: Cascade's "right means depends on", as the phone's column has it (src/ui/cascade.ts).
   */
  step?: number;
  maxDepth?: number;
}
/** Columns sit a little apart, so a wire's tag usually fits on the run into a block, while a usual sheet still fits a laptop at 100%. */
export const FLOW: Pick<FlowOptions, 'origin' | 'colGap' | 'rowGap' | 'wireGap' | 'step' | 'maxDepth'> = { origin: { x: 56, y: 104 }, colGap: 64, rowGap: 18, wireGap: 40, step: 40, maxDepth: 3 };

/**
 * How deep each block sits in a column: 0 for a block that reads no block above it there, else one more than the
 * deepest block above it that it reads. A wire up the column doesn't count, so lines that read each other can't loop.
 */
export function stepDepths(ids: readonly string[], wires: readonly Wire[]): Map<string, number> {
  const at = new Map(ids.map((id, k) => [id, k]));
  const out = new Map<string, number>();
  for (const id of ids) {
    let d = 0;
    for (const w of wires) if (w.to === id && (at.get(w.from) ?? Infinity) < at.get(id)!) d = Math.max(d, (out.get(w.from) ?? 0) + 1);
    out.set(id, d);
  }
  return out;
}

/**
 * Where each block goes on a wide canvas, by kind, as the mockup lays a sheet out: a column of sliders and lines that
 * draw and figure blocks (the example on top, then each slider just above the first line it feeds), the graph, then a
 * column of values in the order sent (a slider that feeds only values goes above the first of them). Blocks the person
 * dragged keep their place and the rest flow around them; a column too tall for the room continues in another
 * beside it. Returns each block's rect, the graph's included (its height can shrink to the room there is).
 */
export function flowLayout(blocks: readonly FlowBlock[], wires: readonly Wire[], opts: FlowOptions): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const pinned: Rect[] = [];
  for (const b of blocks) {
    if (!b.pinned) continue;
    out.set(b.id, { ...b.pinned, ...b.size });
    pinned.push({ ...b.pinned, ...b.size });
    if (b.below) {
      const r = { x: b.pinned.x, y: b.pinned.y + b.size.h + BELOW_GAP, ...b.below };
      out.set(belowKey(b.id), r);
      pinned.push(r);
    }
  }
  const g = opts.graph;
  if (g?.pinned) { out.set(g.id, { ...g.pinned, ...g.size }); pinned.push({ ...g.pinned, ...g.size }); }
  const free = blocks.filter((b) => !b.pinned);
  const byId = new Map(free.map((b) => [b.id, b]));
  const order = new Map(free.map((b, k) => [b.id, k]));
  // Each slider's first consumer among the blocks that flow, in sheet order. A slider that feeds any curve or figure
  // stays in the left column (above its first curve/figure consumer) so data flows left to right instead of wiring
  // backwards across the graph from the values column.
  const firstUse = new Map<string, string>();
  for (const b of free) {
    if (b.kind !== 'slider') continue;
    const uses = wires.filter((w) => w.from === b.id && byId.has(w.to) && byId.get(w.to)!.kind !== 'example' && byId.get(w.to)!.kind !== 'slider').map((w) => w.to);
    const leftUses = uses.filter((id) => {
      const k = byId.get(id)!.kind;
      return k === 'line' || k === 'figure';
    });
    const pick = leftUses.length ? leftUses : uses;
    pick.sort((p, q) => order.get(p)! - order.get(q)!);
    if (pick.length) firstUse.set(b.id, pick[0]);
  }
  const example: FlowBlock[] = [], lines: FlowBlock[] = [], values: FlowBlock[] = [];
  for (const b of free) {
    if (b.kind === 'example') { example.push(b); continue; }
    if (b.kind === 'slider') { if (!firstUse.has(b.id)) lines.push(b); continue; }
    const col = b.kind === 'line' || b.kind === 'figure' ? lines : values;
    for (const sl of free) if (sl.kind === 'slider' && firstUse.get(sl.id) === b.id) col.push(sl);
    col.push(b);
  }
  const { origin, colGap, rowGap } = opts;
  const lowest = opts.bottom ?? (() => Infinity);
  const bottom = opts.bottomRest ?? lowest;
  let x = origin.x;
  /** The last column stacked: where it is, and where the next block in it would go. */
  let last: { x: number; w: number; y: number } | null = null;
  const clear = (r: Rect) => !pinned.some((o) => overlaps(r, o, rowGap - 1));
  /** Stacks a column from the top, past dragged blocks, continuing in a new column when it runs out of room. */
  /** `past`: where a column started under another block continues when it runs out of room (past that block). */
  const stack = (col: FlowBlock[], top = origin.y, past?: number, bottom = lowest) => {
    if (!col.length) return;
    // A block steps right by how deep it sits among the column's blocks.
    const depths = opts.step ? stepDepths(col.map((b) => b.id), wires) : null;
    // Figures and the example are pictures: they keep the column's edge.
    const indent = (b: FlowBlock) => (depths && b.kind !== 'figure' && b.kind !== 'example' ? Math.min(depths.get(b.id) ?? 0, opts.maxDepth ?? 3) * opts.step! : 0);
    const w = Math.max(...col.map((b) => indent(b) + Math.max(b.size.w, b.below?.w ?? 0)));
    let y = top;
    let prev: FlowBlock | null = null;
    /** The widest block in the column so far: a column that runs out of room continues just past it. */
    let colW = 0;
    for (const b of col) {
      // A wire straight down from the block above needs room for its tag.
      if (prev && opts.wireGap && wires.some((wi) => wi.from === prev!.id && wi.to === b.id && wi.name)) y += opts.wireGap;
      const dx = indent(b);
      const tall = (top: number) => (b.below ? { x: x + dx, y: top, w: Math.max(b.size.w, b.below.w), h: b.size.h + BELOW_GAP + b.below.h } : { x: x + dx, y: top, ...b.size });
      for (let tries = 0; tries < 200; tries++) {
        if ((y > top || top > origin.y) && y + b.size.h > bottom(x, w)) { x = past ?? x + (colW || w) + colGap; past = undefined; y = top = origin.y; colW = 0; continue; }
        const hit = pinned.find((o) => overlaps(tall(y), o, rowGap - 1));
        if (!hit) break;
        y = hit.y + hit.h + rowGap;
      }
      out.set(b.id, { x: x + dx, y, ...b.size });
      colW = Math.max(colW, dx + Math.max(b.size.w, b.below?.w ?? 0));
      pinned.push(tall(y));
      if (b.below) out.set(belowKey(b.id), { x: x + dx, y: y + b.size.h + BELOW_GAP, ...b.below });
      y = tall(y).y + tall(y).h + rowGap;
      prev = b;
    }
    last = { x, w: colW, y };
    x += colW + colGap;
  };
  stack([...example, ...lines], origin.y, undefined, lowest);
  const foot = last as { x: number; w: number; y: number } | null;
  if (g && !g.pinned && opts.graphUnder && foot) {
    // At the foot of the last lines column, at its full height or nearly, when nothing is in the way.
    const h = Math.min(g.size.h, bottom(foot.x, Math.max(foot.w, g.size.w)) - foot.y);
    const r = { x: foot.x, y: foot.y, w: g.size.w, h };
    if (h >= Math.min(g.size.h, 320) && clear(r)) {
      out.set(g.id, r);
      pinned.push(r);
      x = Math.max(x, foot.x + g.size.w + colGap);
      if (opts.valuesUnder) { const past = x; x = foot.x; stack(values, r.y + r.h + rowGap, past, bottom); }
      else stack(values, origin.y, undefined, bottom);
      return out;
    }
  }
  if (g && !g.pinned) {
    let y = origin.y;
    const h = Math.max(200, Math.min(g.size.h, bottom(x, g.size.w) - y));
    for (let tries = 0; tries < 200 && !clear({ x, y, w: g.size.w, h }); tries++) {
      const hit = pinned.find((o) => overlaps({ x, y, w: g.size.w, h }, o, rowGap - 1))!;
      if (hit.y + hit.h + rowGap + h <= bottom(x, g.size.w)) y = hit.y + hit.h + rowGap;
      else { x = hit.x + hit.w + colGap; y = origin.y; }
    }
    out.set(g.id, { x, y, w: g.size.w, h });
    pinned.push({ x, y, w: g.size.w, h });
    if (opts.valuesUnder) { stack(values, y + h + rowGap, x + g.size.w + colGap, bottom); return out; }
    x += g.size.w + colGap;
  } else if (opts.valuesUnder && foot && (!g || g.pinned)) {
    // No graph in the flow: the values continue under the last lines column.
    const past = x;
    x = foot.x;
    stack(values, foot.y, past, bottom);
    return out;
  }
  stack(values, origin.y, undefined, bottom);
  return out;
}

/**
 * A wire's path on a wide canvas: square corners (drawn rounded), leaving `a` from its right edge or foot and
 * entering `b` at its left edge or top, around every block in `obstacles`. Tries the shapes a few lanes allow and
 * keeps the shortest that crosses nothing, counting each bend; if every shape crosses something, the one that
 * crosses least. `inY` puts the end on `b`'s left edge at that height (several wires into the graph spread out), `inX`
 * spreads ends along its top the same way, and
 * `lane` nudges the lane a wire takes so wires side by side don't draw as one. `minRun` (across) and `minDrop` (down)
 * prefer routes whose run into `b` is that long, so a tag fits on it.
 */
export function routeWire(a: Rect, b: Rect, obstacles: readonly Rect[], opts: { inY?: number; inX?: number; lane?: number; gap?: number; minRun?: number; minDrop?: number; outY?: number } = {}): Point[] {
  const gap = opts.gap ?? 14, lane = opts.lane ?? 0, minRun = opts.minRun ?? 0, minDrop = opts.minDrop ?? minRun;
  const midY = (r: Rect) => r.y + Math.min(r.h / 2, 26);
  // A wire from a readout's port (outY) leaves from the port, on the block's right edge, and nowhere else.
  const port = opts.outY !== undefined;
  const outR = { x: a.x + a.w, y: opts.outY ?? midY(a) }, outB = { x: a.x + 28, y: a.y + a.h };
  const inL = { x: b.x, y: opts.inY ?? midY(b) }, inT = { x: opts.inX ?? b.x + 28, y: b.y };
  const right = a.x + a.w, left = b.x;
  const ys = new Set<number>([a.y - gap, a.y + a.h + gap, b.y - gap, b.y + b.h + gap]);
  const xs = new Set<number>([right + gap, left - gap, Math.min(a.x, b.x) - gap - 8]);
  // Lanes far enough out for the run into b to carry a tag, unless that's far out past both ends.
  if (minRun && left - minRun - gap >= Math.min(a.x, b.x) - 40) xs.add(left - minRun - gap);
  for (const o of obstacles) { ys.add(o.y - gap).add(o.y + o.h + gap); xs.add(o.x - gap).add(o.x + o.w + gap); }
  const cands: Point[][] = [];
  if (left > right) {
    // Across: out of the right edge, down a lane between them, into the left edge.
    const mids = new Set([Math.round((right + left) / 2) + lane, ...[...xs].filter((x) => x > right && x < left)]);
    for (const lx of mids) cands.push([outR, { x: lx, y: outR.y }, { x: lx, y: inL.y }, inL]);
    if (inT.y > outR.y) cands.push([outR, { x: inT.x, y: outR.y }, inT]);
  }
  if (b.y > a.y + a.h && !port) {
    // Straight down, out of the foot into the top, where the two overlap: a block stepped right under what it reads.
    const sx = Math.max(a.x, b.x) + 28 + lane;
    if (sx <= Math.min(a.x + a.w, b.x + b.w) - 28) cands.push([{ x: sx, y: a.y + a.h }, { x: sx, y: b.y }]);
    // Down: out of the foot, across a lane between them, into the top.
    const mids = new Set([Math.round((a.y + a.h + b.y) / 2) + lane, ...[...ys].filter((y) => y > a.y + a.h && y < b.y)]);
    for (const ly of mids) cands.push([outB, { x: outB.x, y: ly }, { x: inT.x, y: ly }, inT]);
    if (inL.x > outB.x) cands.push([outB, { x: outB.x, y: inL.y }, inL]);
  }
  // Round the outside: out of the right edge, along a lane above or below, down the left of b into its left edge.
  for (const ly of ys) {
    const x1 = right + gap + lane;
    for (const run of new Set([gap, minRun + gap])) {
      const x2 = (left > x1 + run - gap ? left : Math.min(left, a.x)) - run - Math.abs(lane);
      cands.push([outR, { x: x1, y: outR.y }, { x: x1, y: ly }, { x: x2, y: ly }, { x: x2, y: inL.y }, inL]);
    }
  }
  if (!port) for (const lx of xs) if (lx < Math.min(a.x, left)) cands.push([{ x: a.x, y: midY(a) }, { x: lx, y: midY(a) }, { x: lx, y: inL.y }, inL]);
  // Round the right and down into b's top, near its right end (a wire from straight above takes the left end).
  // `inX` spreads wires along the top from its left end; here they spread from its right end the same way.
  const inTR = { x: b.x + b.w - 28 - (opts.inX === undefined ? 0 : opts.inX - (b.x + 28)), y: b.y };
  const outer = new Set([right + gap + lane, Math.max(right, b.x + b.w) + gap + lane, ...[...xs].filter((x) => x > right)]);
  for (const ly of ys) if (ly < b.y && ly > a.y + a.h) for (const x1 of outer) cands.push([outR, { x: x1, y: outR.y }, { x: x1, y: ly }, { x: inTR.x, y: ly }, inTR]);
  const segHits = (p: Point, q: Point, r: Rect, pad: number) => {
    const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
    return x0 < r.x + r.w + pad && x1 > r.x - pad && y0 < r.y + r.h + pad && y1 > r.y - pad;
  };
  // Nothing runs further left than a lane just past the leftmost block: the home view keeps only that much room
  // (WIRE_MARGIN) left of the sheet, and a wire beyond it would leave the screen.
  const floorX = Math.min(a.x, b.x, ...obstacles.map((o) => o.x)) - WIRE_ROOM;
  const score = (pts: Point[]) => {
    let len = 0, hits = pts.some((p) => p.x < floorX) ? 1 : 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
      for (const o of obstacles) if (segHits(pts[i - 1], pts[i], o, 4)) hits++;
      // Never back through its own ends: only the first segment may touch a, and only the last b.
      if (i > 1 && segHits(pts[i - 1], pts[i], a, -1)) hits++;
      if (i < pts.length - 1 && segHits(pts[i - 1], pts[i], b, -1)) hits++;
    }
    // The run into b, after points that don't turn are dropped, is too short for a tag.
    const t = straight(pts), p = t[t.length - 2], q = t[t.length - 1];
    const lastRun = Math.abs(q.x - p.x) + Math.abs(q.y - p.y), need = p.x === q.x ? minDrop : minRun;
    return { hits, short: need && lastRun < need ? 1 : 0, cost: len + 30 * (pts.length - 2) };
  };
  let best = cands[0] ?? [outR, inL], bs = { hits: Infinity, short: 1, cost: Infinity };
  for (const c of cands) {
    const sc = score(c);
    if (sc.hits < bs.hits || (sc.hits === bs.hits && (sc.short < bs.short || (sc.short === bs.short && sc.cost < bs.cost)))) { best = c; bs = sc; }
  }
  return straight(best);
}

/** How far left of the leftmost block a wire may run: inside the room the home view keeps there (WIRE_MARGIN). */
const WIRE_ROOM = 30;

/** An orthogonal path without the points where it doesn't turn. */
function straight(pts: readonly Point[]): Point[] {
  return pts.filter((p, i) => i === 0 || i === pts.length - 1 || !((pts[i - 1].x === p.x && p.x === pts[i + 1].x) || (pts[i - 1].y === p.y && p.y === pts[i + 1].y)));
}

/** An orthogonal path as SVG, its corners rounded. */
export function roundedPath(pts: readonly Point[], radius = 8): string {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const r = Math.min(radius, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const ux = Math.sign(c.x - p.x), uy = Math.sign(c.y - p.y), vx = Math.sign(n.x - c.x), vy = Math.sign(n.y - c.y);
    d += ` L${c.x - ux * r},${c.y - uy * r} Q${c.x},${c.y} ${c.x + vx * r},${c.y + vy * r}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x},${last.y}`;
}

/** Whether every block fits on screen at 100% with no view change: inside `area` and clear of `avoid` (the keys). */
export function fitsAsIs(rects: readonly Rect[], area: Rect, avoid: readonly Rect[] = []): boolean {
  return rects.every((r) => r.x >= area.x && r.y >= area.y && r.x + r.w <= area.x + area.w && r.y + r.h <= area.y + area.h && !avoid.some((o) => overlaps(r, o, 0)));
}

/** How a wide canvas maps onto the screen: screen = world × scale + offset. */
export interface CanvasView { scale: number; dx: number; dy: number }
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The view that shows every block with `pad` around them, never zoomed in past 100%. `area` is the free part of the screen. */
export function fitAll(rects: readonly Rect[], area: Rect, pad = 48): CanvasView {
  const b = boundsOf(rects);
  if (!b) return { scale: 1, dx: area.x + pad, dy: area.y + pad };
  const scale = Math.max(MIN_SCALE, Math.min(1, (area.w - 2 * pad) / Math.max(1, b.w), (area.h - 2 * pad) / Math.max(1, b.h)));
  return { scale, dx: area.x + (area.w - b.w * scale) / 2 - b.x * scale, dy: area.y + (area.h - b.h * scale) / 2 - b.y * scale };
}

/** Zoom by `factor` about a screen point, kept between MIN_SCALE and MAX_SCALE. */
export function zoomAbout(v: CanvasView, factor: number, at: Point): CanvasView {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
  const k = scale / v.scale;
  return { scale, dx: at.x - (at.x - v.dx) * k, dy: at.y - (at.y - v.dy) * k };
}
export const toWorld = (v: CanvasView, p: Point): Point => ({ x: (p.x - v.dx) / v.scale, y: (p.y - v.dy) / v.scale });

/**
 * A phone's column: the sheet's lines in order, with each graph after the last line that draws on it (the example's
 * small graph after the example's curve, the sheet's graph after the person's last curve). Blank lines (the composer's
 * own) and lines being edited in the composer are left to the caller.
 */
export function columnOrder(rows: readonly RowInput[], wires: readonly Wire[]): string[] {
  let ids = rows.filter((r) => !isBlank(r) || isHeading(r.kind === 'expr' ? r.text : '')).map((r) => r.id);
  for (const g of [EXAMPLE_GRAPH, GRAPH_BLOCK]) {
    const drawn = new Set(wires.filter((w) => w.to === g).map((w) => w.from));
    if (!drawn.size) continue;
    let last = -1;
    ids.forEach((id, k) => { if (drawn.has(id)) last = k; });
    ids = [...ids.slice(0, last + 1), g, ...ids.slice(last + 1)];
  }
  return ids;
}

/**
 * The lane each wire takes down a phone's left gutter, lane 0 nearest the blocks. Wires whose spans in the column don't
 * overlap share a lane; nested spans take outer lanes, so wires never cross. Wires to or from a block not in `order`
 * get none.
 */
export function gutterLanes(wires: readonly Wire[], order: readonly string[]): Map<string, number> {
  const pos = new Map(order.map((id, k) => [id, k]));
  const spans = wires.flatMap((w) => {
    const a = pos.get(w.from), b = pos.get(w.to);
    return a === undefined || b === undefined ? [] : [{ key: wireKey(w), lo: Math.min(a, b), hi: Math.max(a, b) }];
  });
  // Shorter spans first: they take the inner lanes, and anything that spans them goes outside.
  spans.sort((p, q) => p.hi - p.lo - (q.hi - q.lo) || p.lo - q.lo);
  const taken: { lo: number; hi: number }[][] = [];
  const out = new Map<string, number>();
  for (const s of spans) {
    // Spans may share a lane end to end (one ends on the block where the next starts), never overlap.
    const clash = (t: { lo: number; hi: number }) => s.lo < t.hi && t.lo < s.hi;
    // A span outside others takes a lane past every lane used inside it, so wires never cross.
    let lane = 0;
    for (const t of spans) if (t !== s && s.lo <= t.lo && t.hi <= s.hi && out.has(t.key)) lane = Math.max(lane, out.get(t.key)! + 1);
    while (taken[lane]?.some(clash)) lane++;
    (taken[lane] ??= []).push(s);
    out.set(s.key, lane);
  }
  return out;
}

/** What the composer's enter does with what's typed. */
export type ComposerIntent =
  | { kind: 'new' }
  | { kind: 'edit'; id: string }
  /** It defines a name another line already defines: offer to change that line instead of defining the name twice. */
  | { kind: 'update'; id: string; name: string };

/**
 * @param draftId the row the composer is typing a new line into, when the sheet keeps it as one of its rows (it's
 * never "another line that defines the name": that's the line itself).
 */
export function composerIntent(text: string, rows: readonly RowInput[], editingId: string | null, draftId: string | null = null): ComposerIntent {
  if (editingId) return { kind: 'edit', id: editingId };
  const name = lineDefines(text);
  if (name) {
    const other = rows.find((r) => r.kind === 'expr' && r.id !== draftId && lineDefines(r.text) === name);
    if (other) return { kind: 'update', id: other.id, name };
  }
  return { kind: 'new' };
}

/**
 * The rows the sheet is worked out from while the composer's draft would update another line: the change in place
 * and the draft left out, so the name isn't defined twice and the lines that read it show the new value as it's typed.
 * Unchanged rows otherwise. Web and phones both evaluate through this.
 */
export function updatePreviewRows<T extends RowInput>(rows: readonly T[], draftId: string | null, editingId: string | null): readonly T[] {
  if (editingId || !draftId) return rows;
  const draft = rows.find((r) => r.id === draftId);
  if (draft?.kind !== 'expr' || !draft.text.trim()) return rows;
  const intent = composerIntent(draft.text, rows, null, draftId);
  if (intent.kind !== 'update') return rows;
  return rows.map((r) => (r.id === intent.id && r.kind === 'expr' ? { ...r, text: draft.text } : r.id === draftId && r.kind === 'expr' ? { ...r, text: '' } : r));
}

/**
 * Whether the composer's line shows its slider. A new line has no block yet, so the composer shows it; a block being
 * changed keeps showing its slider on the canvas, so the composer doesn't show a second. (The web moves the block's own
 * view into the composer, which comes to the same thing: one slider.)
 */
export const composerShowsSlider = (editingBlock: boolean): boolean => !editingBlock;

/** The first run's example: a slider wired to a curve, wired to the graph. Its rows carry `example: true`. */
export const EXAMPLE_LINES: readonly { text: string; slider?: { min: number; max: number; step: number } }[] = [
  { text: 'k = 45', slider: { min: 0, max: 90, step: 1 } },
  { text: 'y = 2sin(kx)' },
];
/** The example frame's name for screen readers; the frame shows no title. */
export const EXAMPLE_TITLE = 'Example';
export const CLEAR_EXAMPLE = 'Clear example';
/** The first run's example, listed first under Examples while it's off the sheet so it can come back. */
export const WELCOME_EXAMPLE = { title: 'Welcome example', subtitle: 'A slider wired to a curve and the graph' } as const;
export const EXAMPLE_CLEARED = 'Example cleared';
export const isExampleRow = (r: { example?: boolean }): boolean => r.example === true;

/** What the composer says before anything is typed on a sheet with no lines of the person's own: the one blank-state cue. */
export const FIRST_PLACEHOLDER = '12 × 7, or r = 4';
export const PLACEHOLDER = 'Type a calculation';

/** The composer's placeholder: the first-run cue until the sheet holds a line of the person's own. */
export function composerPlaceholder(rows: readonly CanvasRow[]): string {
  return rows.some((r) => !isExampleRow(r) && !isBlank(r)) ? PLACEHOLDER : FIRST_PLACEHOLDER;
}

/** The composer's live answer for a line that draws, in place of a number. */
export const GRAPH_PREVIEW_LABEL = 'Draws on the graph';
