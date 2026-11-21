import { describe, expect, it } from 'vitest';
import {
  CASCADE_PHONE, CASCADE_RADIUS, cascadeColumn, heldLit, heldTraces, cascadeDepths, cascadeGaps, cascadeLayout, cascadeStack, cascadeTagSpots, cascadeWires,
  routesCross, type CascadeOptions,
} from '../src/ui/cascade';
import { FLOW, flowLayout, GRAPH_BLOCK, routeWire, wireKey, type Rect, type Wire } from '../src/ui/canvas';

const opts: CascadeOptions = { ...CASCADE_PHONE, width: 344 };
const wire = (from: string, to: string, name = 'v'): Wire => ({ from, to, name });

// The Cascade sheet: p = 1.3 (a slider), f(x) = x³ − 3x, y = 2 sin(90x) + p, the graph, d = 3p² − 3.
const sheetWires: Wire[] = [wire('p', 'y', 'p'), wire('p', 'd', 'p'), wire('f', GRAPH_BLOCK, ''), wire('y', GRAPH_BLOCK, '')];
const sheet = [
  { id: 'p', w: 300, h: 46, slider: true, least: 200 },
  { id: 'f', w: 170, h: 46 },
  { id: 'y', w: 210, h: 46 },
  { id: GRAPH_BLOCK, w: 344, h: 220, span: true },
  { id: 'd', w: 200, h: 46 },
];

describe('cascade', () => {
  it('shares one radius', () => {
    expect(CASCADE_RADIUS).toBe(22);
  });

  it('measures depth by the deepest block above that it reads', () => {
    const d = cascadeDepths(['a', 'b', 'c', 'd'], [wire('a', 'b'), wire('b', 'c'), wire('a', 'c'), wire('x', 'd')]);
    expect([...d]).toEqual([['a', 0], ['b', 1], ['c', 2], ['d', 0]]);
    const loop = cascadeDepths(['a', 'b'], [wire('a', 'b'), wire('b', 'a')]);
    expect([...loop.values()]).toEqual([0, 1]);
  });

  it('makes a block only as wide as its line, between the least and the column', () => {
    const c = cascadeColumn([{ id: 'a', w: 40 }, { id: 'b', w: 200 }, { id: 'c', w: 900 }, { id: 'g', w: 10, span: true }], [], opts);
    expect(c.get('a')!.w).toBe(opts.minW);
    expect(c.get('b')!.w).toBe(200);
    expect(c.get('c')!.w).toBe(opts.width);
    expect(c.get('g')).toEqual({ x: opts.margin, w: opts.width, depth: 0 });
    expect([...c.values()].every((b) => b.x === opts.margin)).toBe(true);
  });

  it('steps a dependent right by its depth, capped, and never squeezes its text', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const chain = ids.slice(1).map((id, k) => wire(ids[k], id));
    const c = cascadeColumn(ids.map((id) => ({ id, w: 150 })), chain, opts);
    expect(ids.map((id) => c.get(id)!.x - opts.margin)).toEqual([0, 40, 80, 120, 120, 120, 120]);
    // A wide line steps only as far as its width allows.
    const wide = cascadeColumn([{ id: 'a', w: 150 }, { id: 'b', w: 330 }], [wire('a', 'b')], opts).get('b')!;
    expect(wide.w).toBe(330);
    expect(wide.x + wide.w).toBeLessThanOrEqual(opts.margin + opts.width);
  });

  it('keeps each left edge while a slider is held, whatever its answer does to its width', () => {
    const blocks = [{ id: 'a', w: 150 }, { id: 'b', w: 200 }, { id: 'c', w: 270 }];
    const ws = [wire('a', 'b'), wire('b', 'c')];
    const before = cascadeColumn(blocks, ws, opts);
    const keep = new Map([...before].map(([id, c]) => [id, c.x]));
    const after = cascadeColumn([blocks[0], blocks[1], { id: 'c', w: 263 }], ws, opts, keep);
    expect(after.get('c')!.x).toBe(before.get('c')!.x);
    expect(cascadeColumn([blocks[0], blocks[1], { id: 'c', w: 263 }], ws, opts).get('c')!.x).not.toBe(before.get('c')!.x);
    const grown = cascadeColumn([blocks[0], blocks[1], { id: 'c', w: 340 }], ws, opts, keep).get('c')!;
    expect(grown.x + grown.w).toBeLessThanOrEqual(opts.margin + opts.width);
  });

  it('keeps room above a block a tagged wire feeds', () => {
    const g = cascadeGaps(sheet.map((b) => b.id), sheetWires, opts);
    expect([...g.values()]).toEqual([0, opts.gap, opts.tagGap, opts.gap, opts.tagGap]);
    // A wire with no tag (a function's) needs none.
    expect(cascadeGaps(['p', 'y'], [wire('p', 'y')], opts, () => false).get('y')).toBe(opts.gap);
    expect([...cascadeStack([{ id: 'a', h: 40 }, { id: 'b', h: 40 }], new Map([['a', 0], ['b', 10]]), 5).values()]).toEqual([5, 55]);
  });

  it("lays out the Cascade sheet as the mockup does: one wire takes the margin, the rest drop straight", () => {
    const l = cascadeLayout(sheet, sheetWires, opts);
    const r = (k: string) => l.routes.get(k)!;
    // p → y drops straight past f, on its right; f drops straight into the graph past y, on its left, and y into the
    // graph; p → d goes round it.
    const py = r(wireKey(sheetWires[0]));
    expect(py.kind).toBe('open');
    expect(py.points[0].x).toBe(py.points[1].x);
    expect(py.points[0].x).toBeGreaterThanOrEqual(l.rects.get('f')!.x + l.rects.get('f')!.w + opts.clear);
    expect(py.points[0].y).toBe(l.rects.get('p')!.y + 46);
    expect(py.points[1].y).toBe(l.rects.get('y')!.y);
    const fg = r(wireKey(sheetWires[2]));
    expect(fg.kind).toBe('open');
    expect(fg.points[0].x).toBeLessThanOrEqual(l.rects.get('y')!.x - opts.clear);
    expect(r(wireKey(sheetWires[3])).kind).toBe('open');
    const pd = r(wireKey(sheetWires[1]));
    expect(pd.kind).toBe('margin');
    expect(pd.points[1].x).toBeLessThan(opts.margin);
    // y and d read p: they step right; the graph spans.
    expect(l.depth.get('y')).toBe(1);
    expect(l.rects.get('y')!.x).toBe(opts.margin + opts.step);
    expect(l.rects.get(GRAPH_BLOCK)!.w).toBe(opts.width);
    // One wire in the margin at most, and nothing crosses.
    expect([...l.routes.values()].filter((x) => x.kind === 'margin').length).toBeLessThanOrEqual(1);
    const routes = [...l.routes.values()];
    for (const a of routes) for (const b of routes) if (a !== b) expect(routesCross(a.points, b.points)).toBe(false);
  });

  it('keeps a slider to sliderMax of the column, unless its label needs more, leaving open canvas on its right', () => {
    const c = cascadeColumn([{ id: 's', w: 330, slider: true, least: 180 }, { id: 'l', w: 330, slider: true, least: 300 }], [], opts);
    expect(c.get('s')!.w).toBe(Math.round(opts.sliderMax! * opts.width));
    expect(c.get('l')!.w).toBe(300);
  });

  it('tries the other open way before the margin when its own lane is taken', () => {
    // From review: b→d takes the only right lane, so a→d has to come down left of the stepped blocks, not the margin.
    const ws = [wire('a', 'b'), wire('b', 'c'), wire('b', 'd'), wire('a', 'd')];
    const l = cascadeLayout([{ id: 'a', w: 210, h: 46 }, { id: 'b', w: 290, h: 46 }, { id: 'c', w: 241, h: 46 }, { id: 'd', w: 290, h: 46 }], ws, opts);
    const kinds = ws.map((w) => l.routes.get(wireKey(w))?.kind);
    expect(kinds.filter((k) => k === 'margin').length).toBe(0);
  });

  it("lets every wire try its own way before another's fallback takes its lane", () => {
    // From review: a right-to-inner fallback must not take the inner lane a→d was given.
    const ws = [wire('a', 'b'), wire('b', 'c'), wire('a', 'd'), wire('a', 'e'), wire('b', 'e')];
    const l = cascadeLayout([{ id: 'a', w: 146, h: 46 }, { id: 'b', w: 197, h: 46 }, { id: 'c', w: 249, h: 46 }, { id: 'd', w: 132, h: 46 }, { id: 'e', w: 301, h: 46 }], ws, opts);
    expect(l.routes.get(wireKey(ws[2]))!.kind).not.toBe('margin');
    const pts = [...l.routes.values()].map((r) => r.points);
    expect(pts.some((p, i) => pts.some((q, j) => j > i && routesCross(p, q)))).toBe(false);
  });

  it('takes the open canvas on the right before the margin, into its target from above', () => {
    // Two sliders stacked: a's wire can't drop straight past b, so it runs down the right and in from above.
    const ws = [wire('a', 'c'), wire('b', 'c')];
    const l = cascadeLayout([{ id: 'a', w: 330, h: 56, slider: true, least: 200 }, { id: 'b', w: 330, h: 56, slider: true, least: 200 }, { id: 'c', w: 210, h: 88 }], ws, opts);
    const ac = l.routes.get(wireKey(ws[0]))!, c = l.rects.get('c')!, a = l.rects.get('a')!, b = l.rects.get('b')!;
    expect(ac.kind).toBe('right');
    expect(ac.points[0].x).toBe(a.x + a.w);
    const lane = ac.points[1].x;
    expect(lane).toBeGreaterThanOrEqual(Math.max(a.x + a.w, b.x + b.w) + opts.clear);
    const end = ac.points[ac.points.length - 1];
    expect(end.y).toBe(c.y);
    expect(end.x).toBeGreaterThanOrEqual(c.x + opts.inset);
    expect(end.x).toBeLessThanOrEqual(c.x + c.w - opts.inset);
    expect(l.routes.get(wireKey(ws[1]))!.kind).toBe('open');
    expect([...l.routes.values()].some((r) => r.kind === 'margin')).toBe(false);
  });

  it('runs a wire down left of the stepped blocks it passes when the right is taken', () => {
    // s feeds d past two stepped blocks that reach the column's right edge: no lane on the right, so it passes them on
    // their left, nearest them, and comes into d from above.
    const rects = new Map<string, Rect>([
      ['s', { x: 34, y: 0, w: 241, h: 56 }],
      ['m', { x: 74, y: 80, w: 304, h: 46 }],
      ['n', { x: 114, y: 150, w: 264, h: 46 }],
      ['d', { x: 114, y: 230, w: 200, h: 46 }],
    ]);
    const r = cascadeWires(rects, [wire('s', 'd')], { ...opts }).get('s>d')!;
    expect(r.kind).toBe('open');
    expect(r.points[0]).toEqual({ x: 74 - opts.clear, y: 56 });
    expect(r.points[1].x).toBe(74 - opts.clear);
    expect(r.points[r.points.length - 1].y).toBe(230);
    expect(r.points[r.points.length - 1].x).toBeGreaterThanOrEqual(114 + opts.inset);
  });

  it('keeps the busier sheet to the crossing its spans force, and the margin to two wires', () => {
    // a = 2, b = 3 (sliders), c = a + b, y = a sin x + b, q = c², g = q + a, h = g/b, y = cx/4, the graph. a → g, b → h,
    // c → y₂ and y → graph interleave pairwise: four wires no three ways round can keep apart, so one crossing at least.
    const blocks = [
      { id: 'a', w: 320, h: 56, slider: true, least: 200 }, { id: 'b', w: 320, h: 56, slider: true, least: 200 }, { id: 'c', w: 210, h: 88 },
      { id: 'y', w: 205, h: 58 }, { id: 'q', w: 210, h: 88 }, { id: 'g', w: 210, h: 88 }, { id: 'h', w: 210, h: 88 }, { id: 'y2', w: 150, h: 70 },
      { id: GRAPH_BLOCK, w: 344, h: 220, span: true },
    ];
    const ws = [wire('a', 'c'), wire('b', 'c'), wire('a', 'y'), wire('b', 'y'), wire('c', 'q'), wire('q', 'g'), wire('a', 'g'), wire('g', 'h'), wire('b', 'h'), wire('c', 'y2'), wire('y', GRAPH_BLOCK, ''), wire('y2', GRAPH_BLOCK, '')];
    const l = cascadeLayout(blocks, ws, opts);
    const routes = [...l.routes.values()];
    expect(routes.filter((r) => r.kind === 'margin').length).toBeLessThanOrEqual(2);
    let pairs = 0;
    for (let i = 0; i < routes.length; i++) for (let j = 0; j < i; j++) if (routesCross(routes[i].points, routes[j].points) || routesCross(routes[j].points, routes[i].points)) pairs++;
    expect(pairs).toBeLessThanOrEqual(3);
  });

  it('keeps lanes side by side apart, and gives a readout port and a side block the margin', () => {
    const rects = new Map<string, Rect>([
      ['a', { x: 34, y: 0, w: 300, h: 40 }],
      ['b', { x: 74, y: 60, w: 200, h: 40 }],
      ['c', { x: 74, y: 120, w: 250, h: 40 }],
    ]);
    const ws = [wire('a', 'b'), wire('a', 'c'), { ...wire('b', 'c'), fromPort: 'h' }];
    const routes = cascadeWires(rects, ws, { ...opts, outY: (w) => (w.fromPort ? 80 : undefined) });
    const ab = routes.get(wireKey(ws[0]))!, ac = routes.get(wireKey(ws[1]))!;
    expect(ab.kind).toBe('open');
    expect(ac.kind).toBe('open');
    expect(Math.abs(ab.points[0].x - ac.points[0].x)).toBeGreaterThanOrEqual(opts.laneGap);
    // a → c passes b on its right.
    expect(ac.points[0].x).toBeGreaterThanOrEqual(74 + 200 + opts.clear);
    const port = routes.get(wireKey(ws[2]))!;
    expect(port.kind).toBe('margin');
    expect(port.points[0]).toEqual({ x: 74, y: 80 });
    const side = cascadeWires(rects, [wire('a', 'b')], { ...opts, side: new Set(['b']) });
    expect([...side.values()][0].kind).toBe('margin');
  });

  it('nests margin wires so they never cross', () => {
    // A span blocks every open lane: both wires go round it.
    const rects = new Map<string, Rect>([
      ['a', { x: 34, y: 0, w: 200, h: 40 }],
      ['g', { x: 34, y: 60, w: 344, h: 200 }],
      ['b', { x: 62, y: 280, w: 200, h: 40 }],
      ['c', { x: 62, y: 340, w: 200, h: 40 }],
    ]);
    const ws = [wire('a', 'c'), wire('a', 'b')];
    const routes = cascadeWires(rects, ws, opts);
    const ac = routes.get(wireKey(ws[0]))!, ab = routes.get(wireKey(ws[1]))!;
    expect(ab.kind).toBe('margin');
    expect(ac.lane).toBeGreaterThan(ab.lane!);
    expect(routesCross(ab.points, ac.points)).toBe(false);
  });

  it('runs a wire up when it feeds a block above it', () => {
    const rects = new Map<string, Rect>([['a', { x: 34, y: 0, w: 200, h: 40 }], ['b', { x: 34, y: 60, w: 200, h: 40 }]]);
    const r = cascadeWires(rects, [wire('b', 'a')], opts).get('b>a')!;
    expect(r.points).toEqual([{ x: 58, y: 60 }, { x: 58, y: 40 }]);
  });

  it('puts a tag on its wire in open canvas, clear of blocks, ports and other tags', () => {
    const l = cascadeLayout(sheet, sheetWires, opts);
    const blocks = [...l.rects.values()];
    const bounds = { x: 0, y: 0, w: opts.margin + opts.width + 12, h: 900 };
    const tags = [wireKey(sheetWires[0]), wireKey(sheetWires[1])].map((key) => ({ key, points: l.routes.get(key)!.points, w: 80, h: 22 }));
    const spots = cascadeTagSpots(tags, blocks, bounds);
    const boxes = tags.map((t) => ({ x: spots.get(t.key)!.x - 40, y: spots.get(t.key)!.y - 11, w: 80, h: 22 }));
    const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const b of boxes) {
      expect(blocks.some((r) => hit(b, r))).toBe(false);
      expect(b.x).toBeGreaterThanOrEqual(0);
    }
    expect(hit(boxes[0], boxes[1])).toBe(false);
    // The open wire's tag is on it: centred on its lane.
    expect(spots.get(tags[0].key)!.x).toBe(tags[0].points[0].x);
  });

  it('finds crossings', () => {
    expect(routesCross([{ x: 0, y: 0 }, { x: 0, y: 10 }], [{ x: -5, y: 5 }, { x: 5, y: 5 }])).toBe(true);
    expect(routesCross([{ x: 0, y: 0 }, { x: 0, y: 10 }], [{ x: 1, y: 0 }, { x: 1, y: 10 }])).toBe(false);
  });
});

describe('cascade while a slider is held', () => {
  it('lights the slider and what it reaches, and traces the curves it moves', () => {
    const drag = { source: 'p', hops: new Map([['y', 1], ['d', 1], [GRAPH_BLOCK, 2]]) };
    expect([...heldLit(drag)].sort()).toEqual([GRAPH_BLOCK, 'd', 'p', 'y'].sort());
    expect(heldTraces(drag, sheetWires, GRAPH_BLOCK)).toEqual(['y']);
    expect(heldTraces(null, sheetWires, GRAPH_BLOCK)).toEqual([]);
  });
});

describe('cascade on a wide canvas', () => {
  it('drops a wire straight into a block stepped right under what it reads', () => {
    const a = { x: 56, y: 100, w: 320, h: 50 }, b = { x: 96, y: 208, w: 260, h: 50 };
    const pts = routeWire(a, b, [], { minDrop: 40 });
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBe(pts[1].x);
    expect(pts[0].y).toBe(150);
    expect(pts[1].y).toBe(208);
  });
  it('steps a dependent right in its column, but never a figure', () => {
    const out = flowLayout([
      { id: 's', kind: 'slider', size: { w: 300, h: 50 } },
      { id: 'c', kind: 'line', size: { w: 240, h: 50 } },
      { id: 'f', kind: 'figure', size: { w: 400, h: 300 } },
    ], [wire('s', 'c', 's'), wire('s', 'f', 's')], { ...FLOW, graph: null });
    expect(out.get('c')!.x).toBe(out.get('s')!.x + FLOW.step!);
    expect(out.get('f')!.x).toBe(out.get('s')!.x);
  });
});
