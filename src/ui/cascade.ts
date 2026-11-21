// Cascade, the column layout every front end shares on a narrow screen: a block is a pill only as wide as its line,
// a block that reads another steps right by how deep it sits, and wires drop straight down through the open canvas
// beside the stepped blocks, each in a lane of its own, taking the left margin only when no open lane exists. Pure
// data in and out; the platforms measure the blocks, then draw what this decides. No DOM here.
import { boundsOf, gutterLanes, stepDepths, wireKey, type Point, type Rect, type Wire } from './canvas';

/** The one corner radius blocks, the graph and the composer share. */
export const CASCADE_RADIUS = 22;

export interface CascadeOptions {
  /** Room left of the column for wires in the margin; the column's blocks start here. */
  margin: number;
  /** The column's width, from the margin to its right edge. */
  width: number;
  /** How far one step of depth moves a block right. Kept modest, so a line's text is never squeezed. */
  step: number;
  /** The deepest a block steps: deeper ones line up with it. */
  maxDepth: number;
  /** The narrowest a pill gets. */
  minW: number;
  /**
   * The widest a slider gets, as a share of the column: its track gives way, never its label, so every slider leaves
   * open canvas on its right for wires to fall through.
   */
  sliderMax?: number;
  /** Between two blocks. */
  gap: number;
  /** Above a block a tagged wire feeds, so the tag rides on that wire in open canvas while a slider is held. */
  tagGap: number;
  /** Between two wires side by side. */
  laneGap: number;
  /** How far a wire's end keeps in from a block's sides (its rounded ends). */
  inset: number;
  /** How far a wire passing a block keeps from it. */
  clear: number;
  /** How far apart the margin's lanes are, lane 0 nearest the blocks. */
  marginStep: number;
}

/** A phone's column. `width` is the platform's: its column, less the margin and the room on the right. */
export const CASCADE_PHONE: Omit<CascadeOptions, 'width'> = {
  margin: 34, step: 40, maxDepth: 3, minW: 132, sliderMax: 0.7, gap: 12, tagGap: 34, laneGap: 12, inset: 24, clear: 10, marginStep: 7,
};

/** A block in the column, in the column's order. `w`: as wide as its line would be with room to spare. */
export interface CascadeBlock {
  id: string;
  w: number;
  /** A graph, figure, chart, table or open line's steps: it spans the column and never steps. */
  span?: boolean;
  /** A slider: no wider than `sliderMax` of the column, unless its label needs more (`least`). */
  slider?: boolean;
  /** The narrowest it can be without squeezing its label: a slider's line with the least track. */
  least?: number;
}

/** How deep each block sits in the column (stepDepths): what it reads above it, plus one. */
export const cascadeDepths = stepDepths;

/**
 * Each block's place across the column: its width (its line's, between `minW` and the column's width; a spanning
 * block takes the whole width) and its left edge, `step` right for each level of depth up to `maxDepth`. A block too
 * wide for its step steps less, so the text keeps its room. `keep`: while a slider is held, the left edges blocks had
 * when it was pressed, so an answer changing width never moves a block sideways under the finger (a block runs no
 * further right than the column's edge).
 */
export function cascadeColumn(blocks: readonly CascadeBlock[], wires: readonly Wire[], opts: CascadeOptions, keep?: ReadonlyMap<string, number> | null): Map<string, { x: number; w: number; depth: number }> {
  const depths = cascadeDepths(blocks.filter((b) => !b.span).map((b) => b.id), wires);
  const out = new Map<string, { x: number; w: number; depth: number }>();
  for (const b of blocks) {
    if (b.span) { out.set(b.id, { x: opts.margin, w: opts.width, depth: 0 }); continue; }
    const cap = b.slider && opts.sliderMax ? Math.max(opts.sliderMax * opts.width, b.least ?? 0) : opts.width;
    const w = Math.round(Math.min(opts.width, cap, Math.max(opts.minW, b.w)));
    const depth = Math.min(depths.get(b.id) ?? 0, opts.maxDepth);
    const kept = keep?.get(b.id);
    if (kept !== undefined) out.set(b.id, { x: kept, w: Math.min(w, opts.margin + opts.width - kept), depth });
    else out.set(b.id, { x: opts.margin + Math.min(depth * opts.step, opts.width - w), w, depth });
  }
  return out;
}

/**
 * The room above each block in the column's order: `tagGap` above a block a tagged wire from anywhere feeds, so the
 * wire's last run is long enough to carry its tag, else `gap`; none above the first. `tagged` says which wires carry
 * a tag (by default every wire with a name).
 */
export function cascadeGaps(ids: readonly string[], wires: readonly Wire[], opts: Pick<CascadeOptions, 'gap' | 'tagGap'>, tagged: (w: Wire) => boolean = (w) => !!w.name): Map<string, number> {
  const inCol = new Set(ids);
  const fed = new Set(wires.filter((w) => w.from !== w.to && inCol.has(w.from) && inCol.has(w.to) && tagged(w)).map((w) => w.to));
  return new Map(ids.map((id, k) => [id, k === 0 ? 0 : fed.has(id) ? opts.tagGap : opts.gap]));
}

/** Stacks the column from `top`: each block's top edge, with its gap above it (cascadeGaps). */
export function cascadeStack(blocks: readonly { id: string; h: number }[], gaps: ReadonlyMap<string, number>, top = 0): Map<string, number> {
  const out = new Map<string, number>();
  let y = top;
  for (const b of blocks) {
    y += gaps.get(b.id) ?? 0;
    out.set(b.id, y);
    y += b.h;
  }
  return out;
}

/** A wire's way down the column: square points from its source to the block it feeds. */
export interface CascadeRoute {
  points: Point[];
  /**
   * `open`: down through open canvas from the source's foot, beside the blocks it passes, straight into the target's
   * top or across the gap above it first. `right`: out of the source's right end, down the open canvas on the right and
   * into the target from above. `margin`: by the left margin, the last resort, in lane `lane` (0 nearest the blocks).
   */
  kind: 'open' | 'right' | 'margin';
  lane?: number;
}

export interface CascadeWireOptions extends Pick<CascadeOptions, 'margin' | 'laneGap' | 'inset' | 'clear' | 'marginStep'> {
  /** The column's width: routes on the right stay inside it. */
  width?: number;
  /** Blocks whose wires leave and enter at their left edge (a state drawn inside the chart's block). */
  side?: ReadonlySet<string>;
  /** Where a wire leaves its block's left edge, when not halfway down its first line (a readout's port). */
  outY?: (w: Wire) => number | undefined;
  /** More that wires go round: an open line's steps. */
  obstacles?: readonly Rect[];
}

/** Where a wire meets a block's left edge: halfway down its first line. */
const sideY = (r: Rect): number => r.y + Math.min(r.h / 2, 24);

/**
 * Every wire's route down the column, from where the blocks are (`rects`, in the column's coordinates), shortest
 * first. A wire drops straight down from the upper block's foot to the lower one's top through a lane open between
 * them, keeping `clear` from every block it passes: on their right, or on the left of a stepped block no margin wire
 * meets. Else it goes by the open canvas on the right: out of the source's right end, down a lane just right of the
 * widest block it passes, into the target from above inside its span. Lanes keep `laneGap` apart wherever they run
 * side by side, shorter spans nearest the blocks, and no route crosses one placed before it. Only a wire with neither,
 * from a readout's port, or to or from a `side` block goes by the left margin, in a lane of its own there
 * (gutterLanes): nested spans take outer lanes, so margin wires don't cross either.
 */
export function cascadeWires(rects: ReadonlyMap<string, Rect>, wires: readonly Wire[], opts: CascadeWireOptions): Map<string, CascadeRoute> {
  // A lane may pass a block on its left only when no margin wire meets that block: the margin's run into it would
  // cross the lane. Which blocks those are depends on the lanes, so route until it settles.
  const shut = new Set<string>(opts.side ?? []);
  for (let round = 0; ; round++) {
    const { routes, ends, passedLeft } = routeOnce(rects, wires, opts, shut);
    const grow = [...ends].filter((id) => !shut.has(id) && passedLeft.has(id));
    if (!grow.length || round >= 6) return routes;
    for (const id of grow) shut.add(id);
  }
}

/** Whether a route runs into one already placed: crosses it, or lies along it (other than sharing a port). */
function conflicts(pts: readonly Point[], placed: Iterable<readonly Point[]>): boolean {
  const flat = (p: readonly Point[]) => p.slice(1).map((q, i) => [p[i], q] as const).filter(([u, v]) => u.y === v.y);
  for (const o of placed) {
    if (routesCross(pts, o) || routesCross(o, pts)) return true;
    // Runs across at one height, overlapping: they would draw as one, unless they leave the same port together.
    for (const [p0, p1] of flat(pts)) for (const [q0, q1] of flat(o)) {
      if (Math.abs(p0.y - q0.y) >= 3) continue;
      const shared = p0.x === q0.x && p0.y === q0.y;
      if (!shared && Math.min(p0.x, p1.x) < Math.max(q0.x, q1.x) - 1 && Math.min(q0.x, q1.x) < Math.max(p0.x, p1.x) - 1) return true;
    }
  }
  return false;
}

type Lanes = { x: number; y0: number; y1: number }[];
type Others = readonly (readonly [string, Rect])[];
/** Where a wire can go when no straight lane is open: the open canvas on the right, left of stepped blocks, or the margin. */
type Page = 'R' | 'M' | 'L';

function routeOnce(rects: ReadonlyMap<string, Rect>, wires: readonly Wire[], opts: CascadeWireOptions, shut: ReadonlySet<string>): { routes: Map<string, CascadeRoute>; ends: Set<string>; passedLeft: Set<string> } {
  const out = new Map<string, CascadeRoute>();
  const lanes: Lanes = [];
  const ends = new Set<string>(), passedLeft = new Set<string>();
  const all = [...rects.entries()];
  const obstacles = (opts.obstacles ?? []).map((r) => ['', r] as const);
  const right = opts.width === undefined ? Infinity : opts.margin + opts.width;
  const live = wires.filter((w) => w.from !== w.to && rects.has(w.from) && rects.has(w.to));
  const placed = () => [...out.values()].map((r) => r.points);
  const clash = (x: number, y0: number, y1: number) => lanes.some((l) => l.y0 < y1 && y0 < l.y1 && Math.abs(l.x - x) < opts.laneGap);
  // Each block's place down the column, for which wires' spans nest and which interleave.
  const ranked = [...rects.entries()].sort((p, q) => p[1].y - q[1].y || p[1].x - q[1].x).map(([id]) => id);
  const rank = new Map(ranked.map((id, k) => [id, k]));
  const spanOf = (w: Wire) => { const i = rank.get(w.from)!, j = rank.get(w.to)!; return { lo: Math.min(i, j), hi: Math.max(i, j) }; };
  const interleave = (p: { lo: number; hi: number }, q: { lo: number; hi: number }) => (p.lo < q.lo && q.lo < p.hi && p.hi < q.hi) || (q.lo < p.lo && p.lo < q.hi && q.hi < p.hi);
  const gapOf = (w: Wire) => {
    const a = rects.get(w.from)!, b = rects.get(w.to)!;
    return Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  };
  // The shortest drops first: wires between neighbours take the lanes they must have before longer ones pick theirs,
  // and the lanes nearest the blocks.
  const sorted = live.map((w, k) => ({ w, k })).sort((p, q) => gapOf(p.w) - gapOf(q.w) || p.k - q.k).map((e) => e.w);
  const othersOf = (w: Wire): Others => [...all.filter(([id]) => id !== w.from && id !== w.to), ...obstacles];
  /** Wires with no straight lane, and the pages each can take. */
  const rest: { w: Wire; key: string; can: Set<Page> }[] = [];
  /** Straight wires that pass a block, and the page they pass it on. */
  const passers: { span: { lo: number; hi: number }; page: Page }[] = [];

  // 1. Straight down, foot to top, through a lane open between them. It keeps `clear` from every block it passes: on
  // their right, or on the left of a stepped block no margin wire meets.
  for (const w of sorted) {
    const key = wireKey(w);
    const a = rects.get(w.from)!, b = rects.get(w.to)!;
    const down = a.y <= b.y;
    const up = down ? a : b, low = down ? b : a;
    const y0 = up.y + up.h, y1 = low.y;
    const others = othersOf(w);
    if (opts.outY?.(w) !== undefined || w.fromPort || opts.side?.has(w.from) || opts.side?.has(w.to) || y1 <= y0) { rest.push({ w, key, can: new Set(['L']) }); continue; }
    const lo = Math.max(up.x, low.x) + opts.inset;
    const hi = Math.min(up.x + up.w, low.x + low.w) - opts.inset;
    const beside = others.filter(([, r]) => r.y < y1 && r.y + r.h > y0);
    const blocked = beside.map(([id, r]) => ({ x0: id && shut.has(id) ? -Infinity : r.x - opts.clear, x1: r.x + r.w + opts.clear }));
    const ok = (x: number) => x >= lo && x <= hi && !blocked.some((k) => x > k.x0 && x < k.x1) && !clash(x, y0, y1)
      && !conflicts([{ x, y: y0 }, { x, y: y1 }], placed());
    const xs = [lo, ...blocked.map((k) => k.x1), ...lanes.map((l) => l.x + opts.laneGap)].sort((p, q) => p - q);
    const x = xs.find(ok);
    if (x === undefined) {
      const can = new Set<Page>(['L']);
      if (down && rightBase(a, b, others, opts) <= right) can.add('R');
      if (down && innerRange(a, b, others, opts)) can.add('M');
      rest.push({ w, key, can });
      continue;
    }
    const lx = Math.round(x);
    let left = false, onRight = false;
    for (const [id, r] of beside) {
      if (lx < r.x) { left = true; if (id) passedLeft.add(id); } else onRight = true;
    }
    if (left || onRight) passers.push({ span: spanOf(w), page: left ? 'M' : 'R' });
    lanes.push({ x: lx, y0, y1 });
    const top = { x: lx, y: y0 }, foot = { x: lx, y: y1 };
    out.set(key, { kind: 'open', points: down ? [top, foot] : [foot, top] });
  }

  // 2. Each of the rest takes a page. Two wires on one page whose spans interleave cross, and a wire left of the
  // stepped blocks crosses a margin wire into a block it passes; the pages are chosen for the fewest such meetings,
  // then the right before the open canvas on the left, and the margin last (every choice tried when few wires need
  // one, else one at a time).
  const spans = rest.map((r) => spanOf(r.w));
  const ends0 = rest.map((r) => [rank.get(r.w.from)!, rank.get(r.w.to)!]);
  const passes = (span: { lo: number; hi: number }, k: number) => span.lo < k && k < span.hi;
  const PAGE_COST: Record<Page, number> = { R: 0, M: 1, L: 3 };
  const cost = (pick: readonly Page[]) => {
    let c = 0;
    for (let i = 0; i < rest.length; i++) {
      if (!rest[i].can.has(pick[i])) return Infinity;
      c += PAGE_COST[pick[i]];
      for (const p of passers) {
        if (p.page === pick[i] && interleave(spans[i], p.span)) c += 100;
        if (p.page === 'M' && pick[i] === 'L' && ends0[i].some((k) => passes(p.span, k))) c += 100;
      }
      for (let j = 0; j < i; j++) {
        if (pick[i] === pick[j] && interleave(spans[i], spans[j])) c += 100;
        if (pick[i] === 'M' && pick[j] === 'L' && ends0[j].some((k) => passes(spans[i], k))) c += 100;
        if (pick[j] === 'M' && pick[i] === 'L' && ends0[i].some((k) => passes(spans[j], k))) c += 100;
      }
    }
    return c;
  };
  const pages: Page[] = ['R', 'M', 'L'];
  let best: Page[] = rest.map((r) => pages.find((p) => r.can.has(p))!);
  if (rest.length <= 9) {
    let bestCost = cost(best);
    const pick: Page[] = rest.map(() => 'R');
    const walk = (i: number) => {
      if (i === rest.length) { const c = cost(pick); if (c < bestCost) { bestCost = c; best = [...pick]; } return; }
      for (const p of pages) if (rest[i].can.has(p)) { pick[i] = p; walk(i + 1); }
    };
    walk(0);
  } else {
    for (let i = 0; i < rest.length; i++) {
      let pick = best, c = cost(best);
      for (const p of pages) {
        if (!rest[i].can.has(p)) continue;
        const t = [...best]; t[i] = p;
        const tc = cost(t);
        if (tc < c) { c = tc; pick = t; }
      }
      best = pick;
    }
  }
  const page = new Map(rest.map((r, i) => [r.key, best[i]]));

  // 3. The open canvas, shortest first: on the right (nearest the blocks first), then left of the stepped blocks
  // (nearest them first). A wire with no way there clear of the routes before it takes the way that crosses least.
  const margin: { key: string; a: Rect; b: Rect; fy: number; ty: number }[] = [];
  // Every wire gets its assigned way first; only then do the ones left over try the other open way, before the margin.
  const done = new Set<string>();
  const left: typeof rest = [];
  const take = (r: (typeof rest)[number], got: 'R' | 'M'): boolean => {
    const a = rects.get(r.w.from)!, b = rects.get(r.w.to)!, others = othersOf(r.w);
    const route = got === 'R'
      ? rightRoute(a, b, others, opts, right, clash, placed(), true) ?? rightRoute(a, b, others, opts, right, clash, placed(), false)
      : innerRoute(a, b, others, opts, clash, placed(), true) ?? innerRoute(a, b, others, opts, clash, placed(), false);
    if (!route) return false;
    page.set(r.key, got);
    for (const seg of route.lanes) lanes.push(seg);
    if (got === 'M') for (const [id, o] of others) if (id && o.y < b.y && o.y + o.h > a.y + a.h) passedLeft.add(id);
    out.set(r.key, { kind: got === 'R' ? 'right' : 'open', points: route.points });
    done.add(r.key);
    return true;
  };
  for (const which of ['R', 'M'] as const) for (const r of rest) {
    if (page.get(r.key) !== which || done.has(r.key)) continue;
    if (!take(r, which)) left.push(r);
  }
  for (const r of left) {
    const other = page.get(r.key) === 'R' ? 'M' : 'R';
    if (!(r.can.has(other) && take(r, other))) page.set(r.key, 'L');
  }
  // 4. The left margin, the last resort: lanes by the wires' spans down it, as a phone's gutter always took them.
  for (const r of rest) {
    if (page.get(r.key) !== 'L') continue;
    const a = rects.get(r.w.from)!, b = rects.get(r.w.to)!;
    margin.push({ key: r.key, a, b, fy: opts.outY?.(r.w) ?? sideY(a), ty: sideY(b) });
    ends.add(r.w.from).add(r.w.to);
  }
  const order = [...new Set(margin.flatMap((m) => [m.fy, m.ty]))].sort((p, q) => p - q).map(String);
  const laneOf = gutterLanes(margin.map((m) => ({ from: String(m.fy), to: String(m.ty), name: m.key })), order);
  for (const m of margin) {
    const lane = laneOf.get(wireKey({ from: String(m.fy), to: String(m.ty) })) ?? 0;
    const lx = Math.max(2, opts.margin - 10 - lane * opts.marginStep);
    out.set(m.key, { kind: 'margin', lane, points: [{ x: m.a.x, y: m.fy }, { x: lx, y: m.fy }, { x: lx, y: m.ty }, { x: m.b.x, y: m.ty }] });
  }
  return { routes: out, ends, passedLeft };
}

/** The nearest a right lane from `a` down to `b` can be: just right of `a` and the widest block it passes. */
function rightBase(a: Rect, b: Rect, others: Others, opts: CascadeWireOptions): number {
  const fy = sideY(a);
  return Math.max(a.x + a.w, ...others.filter(([, r]) => r.y < b.y && r.y + r.h > fy).map(([, r]) => r.x + r.w)) + opts.clear;
}

/** The gap above `b`, where a route crosses over to come in from above: its top. */
function gapTop(a: Rect, b: Rect, others: Others): number {
  return Math.max(a.y + a.h, ...others.map(([, r]) => r.y + r.h).filter((y) => y <= b.y));
}

/** Where a lane out of `a`'s foot can run left of every block it passes on the way to `b`, or null for nowhere. */
function innerRange(a: Rect, b: Rect, others: Others, opts: CascadeWireOptions): { lo: number; hi: number } | null {
  const y0 = a.y + a.h;
  const passing = others.filter(([, r]) => r.y < b.y && r.y + r.h > y0).map(([, r]) => r);
  const lo = a.x + opts.inset;
  const hi = Math.min(a.x + a.w - opts.inset, ...passing.map((r) => r.x - opts.clear));
  return passing.length && hi >= lo ? { lo, hi } : null;
}

/**
 * Into `b` from above: straight down when the lane is over it, else down to the gap above it, across, and in. The
 * points from where the lane starts, or null when every way runs into a lane (or, `strict`, a route) already placed.
 */
function enterFromAbove(start: Point[], lx: number, b: Rect, top: number, opts: CascadeWireOptions,
  clash: (x: number, y0: number, y1: number) => boolean, placed: readonly (readonly Point[])[], strict: boolean): { points: Point[]; lanes: Lanes } | null {
  const y0 = start[start.length - 1].y;
  if (lx >= b.x + opts.inset && lx <= b.x + b.w - opts.inset) {
    if (clash(lx, y0, b.y)) return null;
    const pts = [...start, { x: lx, y: b.y }];
    return !strict || !conflicts(pts, placed) ? { points: pts, lanes: [{ x: lx, y0, y1: b.y }] } : null;
  }
  // Across from the lane's side: the nearest point inside b first.
  const fromLeft = lx < b.x + opts.inset;
  const txs: number[] = [];
  for (let k = 0; k < 6; k++) {
    const tx = fromLeft ? b.x + opts.inset + k * opts.laneGap : b.x + b.w - opts.inset - k * opts.laneGap;
    if (tx >= b.x + opts.inset && tx <= b.x + b.w - opts.inset) txs.push(Math.round(tx));
  }
  for (let jy = Math.round(b.y - Math.min(8, (b.y - top) / 2)); jy > top + 3; jy -= 5) {
    if (clash(lx, y0, jy)) continue;
    for (const tx of txs) {
      if (clash(tx, jy, b.y)) continue;
      const pts = [...start, { x: lx, y: jy }, { x: tx, y: jy }, { x: tx, y: b.y }];
      if (!strict || !conflicts(pts, placed)) return { points: pts, lanes: [{ x: lx, y0, y1: jy }, { x: tx, y0: jy, y1: b.y }] };
    }
  }
  return null;
}

/**
 * A wire's way down the open canvas on the right, from `a` above to `b` below: out of `a`'s right end, down a lane
 * just right of the widest block it passes, inside the column (`right`), and into `b` from above.
 */
function rightRoute(a: Rect, b: Rect, others: Others, opts: CascadeWireOptions, right: number,
  clash: (x: number, y0: number, y1: number) => boolean, placed: readonly (readonly Point[])[], strict: boolean): { points: Point[]; lanes: Lanes } | null {
  const fy = Math.round(sideY(a));
  const base = rightBase(a, b, others, opts);
  const top = gapTop(a, b, others);
  const xs = [...new Set([base, ...placed.flatMap((p) => p.map((q) => q.x + opts.laneGap))])].filter((x) => x >= base && x <= right).sort((p, q) => p - q);
  for (const x of xs) {
    const lx = Math.round(x);
    const r = enterFromAbove([{ x: a.x + a.w, y: fy }, { x: lx, y: fy }], lx, b, top, opts, clash, placed, strict);
    if (r) return r;
  }
  return null;
}

/**
 * A wire's way down the open canvas left of the stepped blocks it passes: out of `a`'s foot, down a lane that keeps
 * `clear` of each, nearest them first, and into `b` from above.
 */
function innerRoute(a: Rect, b: Rect, others: Others, opts: CascadeWireOptions,
  clash: (x: number, y0: number, y1: number) => boolean, placed: readonly (readonly Point[])[], strict: boolean): { points: Point[]; lanes: Lanes } | null {
  const range = innerRange(a, b, others, opts);
  if (!range) return null;
  const y0 = a.y + a.h;
  const top = gapTop(a, b, others);
  const xs = [...new Set([range.hi, ...placed.flatMap((p) => p.map((q) => q.x - opts.laneGap))])].filter((x) => x >= range.lo && x <= range.hi).sort((p, q) => q - p);
  for (const x of xs) {
    const lx = Math.round(x);
    const r = enterFromAbove([{ x: lx, y: y0 }], lx, b, top, opts, clash, placed, strict);
    if (r) return r;
  }
  return null;
}

export interface CascadeLayout {
  rects: Map<string, Rect>;
  depth: Map<string, number>;
  gaps: Map<string, number>;
  routes: Map<string, CascadeRoute>;
  /** The column's height, from `top` to the foot of its last block. */
  height: number;
}

/**
 * The whole column at once, for a platform that places blocks itself: widths and steps (cascadeColumn), the gaps and
 * the stack, then the wires. `h` is each block's height at the width cascadeColumn gives it.
 */
export function cascadeLayout(blocks: readonly (CascadeBlock & { h: number })[], wires: readonly Wire[], opts: CascadeOptions, extra: { top?: number; tagged?: (w: Wire) => boolean } & Pick<CascadeWireOptions, 'side' | 'outY' | 'obstacles'> = {}): CascadeLayout {
  const across = cascadeColumn(blocks, wires, opts);
  const gaps = cascadeGaps(blocks.map((b) => b.id), wires, opts, extra.tagged);
  const ys = cascadeStack(blocks, gaps, extra.top ?? 0);
  const rects = new Map(blocks.map((b) => {
    const c = across.get(b.id)!;
    return [b.id, { x: c.x, y: ys.get(b.id)!, w: c.w, h: b.h }] as const;
  }));
  const routes = cascadeWires(rects, wires, { ...opts, side: extra.side, outY: extra.outY, obstacles: extra.obstacles });
  const b = boundsOf([...rects.values()]);
  return { rects, depth: new Map([...across].map(([id, c]) => [id, c.depth])), gaps, routes, height: b ? b.y + b.h - (extra.top ?? 0) : 0 };
}

/** A tag to place on its wire: its size, and its wire's points from source to block. */
export interface CascadeTag { key: string; points: readonly Point[]; w: number; h: number }

const overlapArea = (a: Rect, b: Rect, pad = 0): number => {
  const x = Math.min(a.x + a.w, b.x + b.w) + pad - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.h, b.y + b.h) + pad - Math.max(a.y, b.y);
  return x > 0 && y > 0 ? x * y : 0;
};

/**
 * Where each tag's centre goes while a slider is held: on its own wire, in open canvas, as near the block it feeds as
 * it can be without covering a block, another tag or either end of its wire. Inside `bounds` (the screen's column): a
 * tag on a margin wire too wide for the margin slides right off the wire as little as it must, into the open room the
 * gap above its block keeps (cascadeGaps). Tags are placed in order; a later one keeps clear of the earlier ones.
 */
export function cascadeTagSpots(tags: readonly CascadeTag[], blocks: readonly Rect[], bounds: Rect, gap = 4): Map<string, Point> {
  const out = new Map<string, Point>();
  const placed: Rect[] = [];
  for (const t of tags) {
    const pts = t.points;
    if (pts.length < 2) continue;
    const ends = [pts[0], pts[pts.length - 1]];
    let best: { at: Point; score: number } | null = null;
    // Walk back from the block's end, a few px at a time.
    let along = 0;
    for (let i = pts.length - 1; i > 0; i--) {
      const p = pts[i - 1], q = pts[i];
      const len = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      for (let s = 0; s <= len; s += 3) {
        const f = len ? s / len : 0;
        const cx = q.x + (p.x - q.x) * f, cy = q.y + (p.y - q.y) * f;
        const x = Math.min(Math.max(cx, bounds.x + t.w / 2), bounds.x + bounds.w - t.w / 2);
        const y = Math.min(Math.max(cy, bounds.y + t.h / 2), bounds.y + bounds.h - t.h / 2);
        const box = { x: x - t.w / 2, y: y - t.h / 2, w: t.w, h: t.h };
        let cover = 0;
        for (const r of blocks) cover += overlapArea(box, r);
        for (const r of placed) cover += overlapArea(box, r, gap);
        // Neither end of its wire: a tag over a port hides where the wire meets its block.
        for (const e of ends) if (Math.abs(e.x - x) < t.w / 2 + 4 && Math.abs(e.y - y) < t.h / 2 + 4) cover += t.w * 4;
        const score = cover * 100 + Math.hypot(x - cx, y - cy) * 3 + (along + s) * 0.2;
        if (!best || score < best.score) best = { at: { x: Math.round(x), y: Math.round(y) }, score };
      }
      along += len;
    }
    if (!best) continue;
    out.set(t.key, best.at);
    placed.push({ x: best.at.x - t.w / 2, y: best.at.y - t.h / 2, w: t.w, h: t.h });
  }
  return out;
}

/**
 * Whether two routes cross: a run of one passes through a run of the other, other than where they meet at a shared
 * end (two wires out of one port, or into one). For checks: Cascade's wires never cross.
 */
export function routesCross(a: readonly Point[], b: readonly Point[]): boolean {
  const shared = (p: Point) => [b[0], b[b.length - 1]].some((q) => q.x === p.x && q.y === p.y);
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const p0 = a[i - 1], p1 = a[i], q0 = b[j - 1], q1 = b[j];
    const pv = p0.x === p1.x, qv = q0.x === q1.x;
    if (pv === qv) continue;
    const [v0, v1, h0, h1] = pv ? [p0, p1, q0, q1] : [q0, q1, p0, p1];
    const x = v0.x, y = h0.y;
    const inV = y > Math.min(v0.y, v1.y) && y < Math.max(v0.y, v1.y);
    const inH = x > Math.min(h0.x, h1.x) && x < Math.max(h0.x, h1.x);
    if (inV && inH && !shared({ x, y })) return true;
  }
  return false;
}

/** What a held slider lights: itself and every block its change reaches (the graph among them, by GRAPH_BLOCK). */
export function heldLit(drag: { source: string; hops: ReadonlyMap<string, number> } | null): Set<string> {
  return drag ? new Set([drag.source, ...drag.hops.keys()]) : new Set();
}

/**
 * The curves a held slider moves, each traced faintly, dotted, where it was when the drag began: the lines its change
 * reaches (and the slider's own line) that draw on `graph`.
 */
export function heldTraces(drag: { source: string; hops: ReadonlyMap<string, number> } | null, wires: readonly Wire[], graph: string): string[] {
  if (!drag) return [];
  const moved = heldLit(drag);
  return wires.filter((w) => w.to === graph && moved.has(w.from)).map((w) => w.from);
}
