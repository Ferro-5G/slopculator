import { describe, expect, it } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { cleanSettings } from '../src/engine/document';
import {
  columnOrder, composerIntent, composerPlaceholder, updatePreviewRows, composerShowsSlider, EXAMPLE_GRAPH, EXAMPLE_LINES, exampleFrameRect, fitAll, GRAPH_BLOCK,
  gutterLanes, placeBlock, pulseOrder, settleBlocks, SETTLE_GAP, sheetWires, wireKey, zoomAbout, type CanvasRow, type Rect,
  flowLayout, FLOW, fitsAsIs, routeWire, roundedPath, type FlowBlock, type Point, belowKey, BELOW_GAP,
} from '../src/ui/canvas';
import { cleanBody, cleanSheetView, type DocRow } from '../src/ui/document';

const lines = (...texts: string[]): RowInput[] => texts.map((text, k) => ({ id: `r${k + 1}`, kind: 'expr', text }));
const wiresOf = (rows: CanvasRow[], lineNames = false) => sheetWires(rows, evaluateDocument(rows, cleanSettings({ deg: true, lineNames })), { lineNames });
const pairs = (rows: CanvasRow[], lineNames = false) => wiresOf(rows, lineNames).map((w) => `${w.from}>${w.to}${w.name ? `:${w.name}` : ''}`).sort();

describe('sheetWires', () => {
  it('wires a definition to each line that reads it, and drawn lines to the graph', () => {
    expect(pairs(lines('a = 1', 'y = a(x - 1)^2 - 3', 'y = 2sin(45x)', 'normalcdf(-1, 1)'))).toEqual(['r1>r2:a', 'r2>#graph', 'r3>#graph']);
  });
  it('reads a word as its letters when each is defined, as the engine does', () => {
    expect(pairs(lines('k = 45', 'y = 2sin(kx)'))).toEqual(['r1>r2:k', 'r2>#graph']);
  });
  it('wires functions, ans, and chains (a function of x draws too)', () => {
    expect(pairs(lines('f(x) = x^2', 'f(3)', 'ans + 1', 'r = 4', 'A = πr^2'))).toEqual(['r1>#graph', 'r1>r2:f', 'r2>r3:ans', 'r4>r5:r']);
  });
  it("doesn't wire a function's own inputs, a line to itself, constants or unknown names", () => {
    expect(pairs(lines('x0 = 2', 'g(t) = t + 1', 'e^2 + π', 'tax + 1'))).toEqual([]);
  });
  it('wires table columns, and line letters when they are on', () => {
    const rows: RowInput[] = [{ id: 't', kind: 'table', columns: [{ header: 'x1', cells: ['1', '2'] }, { header: 'y1', cells: ['3', '5'] }] }, ...lines('mean(y1)', '2 + 3', 'B * 2')];
    expect(pairs(rows)).toEqual(['t>#graph', 't>r1:y1']);
    expect(pairs(rows, true)).toContain('r1>r3:B');
  });
  it('leaves hidden lines off the graph', () => {
    const rows = lines('y = x');
    (rows[0] as { hidden?: boolean }).hidden = true;
    expect(pairs(rows)).toEqual([]);
  });
});

describe('pulseOrder', () => {
  it('reaches each line once, nearest first', () => {
    const w = wiresOf(lines('a = 1', 'b = a + 1', 'c = a + b', 'y = cx'));
    expect(pulseOrder(w, 'r1')).toEqual([{ id: 'r2', hop: 1 }, { id: 'r3', hop: 1 }, { id: 'r4', hop: 2 }, { id: GRAPH_BLOCK, hop: 3 }]);
  });
});

describe('placeBlock', () => {
  const view: Rect = { x: 0, y: 0, w: 1200, h: 800 };
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  it('goes right of what it uses', () => {
    const uses = { x: 40, y: 40, w: 300, h: 50 };
    expect(placeBlock([uses], { w: 300, h: 50 }, [uses], view)).toEqual({ x: 392, y: 40 });
  });
  it('never overlaps, even when the spots beside are taken', () => {
    const blocks: Rect[] = [{ x: 40, y: 40, w: 300, h: 50 }, { x: 392, y: 40, w: 300, h: 50 }, { x: 40, y: 112, w: 300, h: 50 }];
    const p = placeBlock(blocks, { w: 300, h: 50 }, [blocks[0]], view);
    for (const b of blocks) expect(overlap({ ...p, w: 300, h: 50 }, b)).toBe(false);
  });
  it('takes the first free spot in view, down the first column, on the grid, when it uses nothing', () => {
    const p = placeBlock([{ x: 24, y: 24, w: 400, h: 200 }], { w: 200, h: 80 }, [], view);
    expect(p.x % 8).toBe(0);
    expect(p.y % 8).toBe(0);
    expect(overlap({ ...p, w: 200, h: 80 }, { x: 24, y: 24, w: 400, h: 200 })).toBe(false);
    expect(p.x).toBe(24);
    expect(p.y).toBeLessThan(300);
  });
  it('goes under everything when the view is full', () => {
    const p = placeBlock([{ x: 0, y: 0, w: 1200, h: 800 }], { w: 200, h: 80 }, [], view);
    expect(p.y).toBeGreaterThanOrEqual(800);
  });
});

describe('settleBlocks', () => {
  const overlap = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
  const settled = (units: { id: string; rect: Rect }[]) => {
    const at = settleBlocks(units);
    return units.map((u) => ({ ...u.rect, ...at.get(u.id)! }));
  };
  const noneOverlap = (rs: Rect[]) => {
    for (let i = 0; i < rs.length; i++) for (let j = 0; j < i; j++) expect(overlap(rs[i], rs[j], SETTLE_GAP - 1), `${JSON.stringify(rs[i])} on ${JSON.stringify(rs[j])}`).toBe(false);
  };
  it('leaves blocks that are clear of each other where they are', () => {
    const units = [{ id: 'a', rect: { x: 0, y: 0, w: 200, h: 50 } }, { id: 'b', rect: { x: 0, y: 80, w: 200, h: 50 } }];
    expect(settled(units)).toEqual(units.map((u) => u.rect));
  });
  it('moves a later block the shortest way off an earlier one, on the grid', () => {
    const [a, b] = settled([{ id: 'a', rect: { x: 0, y: 0, w: 200, h: 100 } }, { id: 'b', rect: { x: 40, y: 80, w: 200, h: 50 } }]);
    expect(a).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(b).toEqual({ x: 40, y: 120, w: 200, h: 50 });
    expect(b.x % 8 + b.y % 8).toBe(0);
  });
  it('moves the graph off the example frame as one rect (the old sheet in fin-pulse.png)', () => {
    // The example's slider and curve, framed, with the sheet's graph stored where the example's graph used to be.
    const frame = exampleFrameRect([{ x: 392, y: 112, w: 392, h: 56 }, { x: 392, y: 184, w: 330, h: 56 }], 16, 44)!;
    const graph = { x: 392, y: 256, w: 330, h: 196 };
    const blocks = [{ x: 24, y: 88, w: 210, h: 88 }, { x: 24, y: 200, w: 164, h: 56 }, { x: 24, y: 304, w: 286, h: 88 }, { x: 464, y: 488, w: 196, h: 60 }];
    const out = settled([{ id: 'ex', rect: frame }, ...blocks.map((rect, k) => ({ id: `b${k}`, rect })), { id: GRAPH_BLOCK, rect: graph }]);
    expect(out[0]).toEqual(frame);
    noneOverlap(out);
  });
  it('settles a crowd so nothing overlaps, whatever the order', () => {
    const rects: Rect[] = Array.from({ length: 12 }, (_, k) => ({ x: (k * 37) % 120, y: (k * 53) % 90, w: 180 + (k % 3) * 40, h: 48 + (k % 4) * 30 }));
    noneOverlap(settled(rects.map((rect, k) => ({ id: `r${k}`, rect }))));
    noneOverlap(settled(rects.map((rect, k) => ({ id: `r${k}`, rect })).reverse()));
  });
  it('puts the example back clear of what was placed while it was gone (Clear example, then Undo)', () => {
    const frame = exampleFrameRect([{ x: 392, y: 112, w: 392, h: 56 }, { x: 392, y: 184, w: 330, h: 56 }, { x: 392, y: 264, w: 330, h: 196 }], 16, 44)!;
    const placed = { x: 400, y: 120, w: 240, h: 60 };
    const [p, f] = settled([{ id: 'r1', rect: placed }, { id: 'ex', rect: frame }]);
    expect(p).toEqual(placed);
    expect(overlap(p, f)).toBe(false);
  });
});

describe('flowLayout: the mockup\'s columns', () => {
  const sizeOf = (text: string) => ({ w: text.startsWith('a =') ? 320 : 40 + text.length * 9, h: text.includes('(') && !text.startsWith('y') ? 88 : 52 });
  const flow = (texts: string[], extra: Partial<Parameters<typeof flowLayout>[2]> = {}, pins: Record<string, Point> = {}) => {
    const rows = lines(...texts);
    const results = evaluateDocument(rows, cleanSettings({ deg: true }));
    const wires = sheetWires(rows, results);
    const blocks: FlowBlock[] = rows.map((r, k) => ({
      id: r.id, size: sizeOf(texts[k]), pinned: pins[r.id],
      kind: results[k].slider ? 'slider' : wires.some((w) => w.from === r.id && w.to === GRAPH_BLOCK) ? 'line' : 'value',
    }));
    const draws = wires.some((w) => w.to === GRAPH_BLOCK);
    return flowLayout(blocks, wires, { ...FLOW, graph: draws ? { id: GRAPH_BLOCK, size: { w: 560, h: 440 } } : null, ...extra });
  };
  it('lays the mockup sheet out as the mockup does: sliders and curves left, the graph in the middle, values right', () => {
    const at = flow(['a = 1', 'y = a(x - 1)^2 - 3', 'y = 2sin(45x)', 'normalcdf(-1, 1)', 'sqrt(2)/2 + 1/3', '10% * 250', 'det([[2,1],[5,3]])']);
    const [a, par, sin, cdf, root, pct, det, g] = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', GRAPH_BLOCK].map((id) => at.get(id)!);
    expect(a).toMatchObject(FLOW.origin);
    // The curve that reads a steps right under it; the one that reads nothing keeps the column's edge.
    expect([par.x, sin.x]).toEqual([56 + FLOW.step!, 56]);
    // a feeds the curve under it, so the wire between them has room for its tag.
    expect(par.y).toBe(a.y + a.h + FLOW.rowGap + FLOW.wireGap!);
    expect(sin.y).toBe(par.y + par.h + FLOW.rowGap);
    expect(g.x).toBe(Math.max(par.x + par.w, sin.x + sin.w, a.x + a.w) + FLOW.colGap);
    for (const v of [cdf, root, pct, det]) expect(v.x).toBe(g.x + g.w + FLOW.colGap);
    expect(cdf.y < root.y && root.y < pct.y && pct.y < det.y).toBe(true);
    const all = [...at.values()];
    for (let i = 0; i < all.length; i++) for (let j = 0; j < i; j++) expect(all[i].x < all[j].x + all[j].w && all[j].x < all[i].x + all[i].w && all[i].y < all[j].y + all[j].h && all[j].y < all[i].y + all[i].h).toBe(false);
  });
  it('puts a slider just above the first line it feeds, wherever it was sent, and one feeding only values over them', () => {
    const at = flow(['y = x', 'y = ax^2', 'r = 2', 'A = πr^2', 'a = 3']);
    expect(at.get('r5')!.y).toBeLessThan(at.get('r2')!.y);
    expect(at.get('r5')!.y).toBeGreaterThan(at.get('r1')!.y);
    expect(at.get('r4')!.x).toBe(at.get('r3')!.x + FLOW.step!);
    expect(at.get('r3')!.y).toBeLessThan(at.get('r4')!.y);
  });
  it('keeps a slider feeding both a value and a curve in the left column so wires flow left to right', () => {
    const at = flow(['r = 4', 'A = πr^2', 'y = r * sin(x)']);
    const r = at.get('r1')!, area = at.get('r2')!, curve = at.get('r3')!, g = at.get(GRAPH_BLOCK)!;
    expect(r.x).toBe(FLOW.origin.x);
    expect(r.y).toBeLessThan(curve.y);
    expect(g.x).toBeGreaterThan(r.x + r.w);
    expect(area.x).toBeGreaterThan(g.x + g.w);
  });
  it('keeps a dragged block where it is, and flows the rest around it', () => {
    const at = flow(['y = x', 'y = 2x', 'y = 3x'], {}, { r2: { x: 600, y: 600 }, r1: { x: 56, y: 170 } });
    expect(at.get('r1')).toMatchObject({ x: 56, y: 170 });
    expect(at.get('r2')).toMatchObject({ x: 600, y: 600 });
    const r3 = at.get('r3')!;
    expect(r3.x === 56 && (r3.y + r3.h + FLOW.rowGap <= 170 || r3.y >= 170 + 52 + FLOW.rowGap)).toBe(true);
  });
  it('continues a column beside itself when it would run under the composer', () => {
    const at = flow(['1', '2', '3', '4', '5'], { bottom: () => 104 + 3 * 52 + 2 * 18 });
    expect(at.get('r4')!.x).toBeGreaterThan(at.get('r1')!.x);
    expect(at.get('r4')!.y).toBe(104);
  });
  it('keeps room under an open line for its steps without moving the line', () => {
    const blocks = (below?: { w: number; h: number }): FlowBlock[] => [
      { id: 'a', kind: 'value', size: { w: 200, h: 80 } },
      { id: 'b', kind: 'value', size: { w: 200, h: 80 }, below },
      { id: 'c', kind: 'value', size: { w: 200, h: 80 } },
    ];
    const shut = flowLayout(blocks(), [], { ...FLOW });
    const open = flowLayout(blocks({ w: 500, h: 160 }), [], { ...FLOW });
    expect(open.get('b')).toEqual(shut.get('b'));
    expect(open.get(belowKey('b'))).toEqual({ x: 56, y: open.get('b')!.y + 80 + BELOW_GAP, w: 500, h: 160 });
    expect(open.get('c')!.y).toBe(open.get(belowKey('b'))!.y + 160 + FLOW.rowGap);
    expect(shut.has(belowKey('b'))).toBe(false);
  });
  it('puts the example at the top of the lines column, the person\'s lines under it and values beside', () => {
    const blocks: FlowBlock[] = [{ id: 'ex', kind: 'example', size: { w: 362, h: 412 } }, { id: 'v', kind: 'value', size: { w: 200, h: 88 } }, { id: 'l', kind: 'line', size: { w: 300, h: 52 } }];
    const at = flowLayout(blocks, [], { ...FLOW });
    expect(at.get('ex')).toMatchObject(FLOW.origin);
    expect(at.get('l')).toMatchObject({ x: 56, y: 104 + 412 + FLOW.rowGap });
    expect(at.get('v')!.x).toBe(56 + 362 + FLOW.colGap);
  });
});

describe('routeWire', () => {
  const hits = (pts: Point[], r: Rect) => pts.slice(1).some((q, i) => {
    const p = pts[i];
    return Math.min(p.x, q.x) < r.x + r.w && Math.max(p.x, q.x) > r.x && Math.min(p.y, q.y) < r.y + r.h && Math.max(p.y, q.y) > r.y;
  });
  const square = (pts: Point[]) => pts.slice(1).every((q, i) => q.x === pts[i].x || q.y === pts[i].y);
  it('goes straight across to a block beside it, square, from the right edge to the left', () => {
    const a = { x: 0, y: 0, w: 200, h: 52 }, b = { x: 300, y: 0, w: 400, h: 300 };
    const pts = routeWire(a, b, []);
    expect(pts[0]).toEqual({ x: 200, y: 26 });
    expect(pts.at(-1)).toEqual({ x: 300, y: 26 });
    expect(square(pts)).toBe(true);
  });
  it('steps down from a slider to the line under it', () => {
    const pts = routeWire({ x: 0, y: 0, w: 300, h: 52 }, { x: 0, y: 70, w: 200, h: 52 }, []);
    expect(pts).toEqual([{ x: 28, y: 52 }, { x: 28, y: 70 }]);
  });
  it('goes round a block in the way, never over it', () => {
    const a = { x: 0, y: 200, w: 160, h: 52 }, b = { x: 600, y: 0, w: 400, h: 400 };
    const wall = { x: 250, y: 0, w: 200, h: 600 };
    const pts = routeWire(a, b, [wall]);
    expect(hits(pts, wall)).toBe(false);
    expect(square(pts)).toBe(true);
    expect(roundedPath(pts).startsWith('M160,226')).toBe(true);
  });
  it('prefers a route whose run into the block is long enough for a tag', () => {
    const a = { x: 0, y: 0, w: 200, h: 52 }, b = { x: 300, y: 200, w: 200, h: 80 };
    const t = routeWire(a, b, [], { minRun: 90 });
    const p = t.at(-2)!, q = t.at(-1)!;
    expect(Math.abs(q.x - p.x) + Math.abs(q.y - p.y)).toBeGreaterThanOrEqual(90);
    const blocked = { x: 0, y: 100, w: 200, h: 200 };
    const u = routeWire(blocked, { x: 420, y: 100, w: 200, h: 80 }, [], { minRun: 120 });
    expect(Math.abs(u.at(-1)!.x - u.at(-2)!.x)).toBeGreaterThanOrEqual(120);
  });
  it('drops straight down from a slider into the block under it when the drop holds a tag', () => {
    const a = { x: 56, y: 104, w: 300, h: 50 }, b = { x: 56, y: 194, w: 240, h: 50 };
    const pts = routeWire(a, b, [], { minRun: 90, minDrop: 40 });
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBe(pts[1].x);
  });
  it('never runs further left than just past the leftmost block', () => {
    const a = { x: 56, y: 104, w: 300, h: 50 }, mid = { x: 56, y: 212, w: 312, h: 372 }, b = { x: 56, y: 602, w: 200, h: 50 };
    const pts = routeWire(a, b, [mid], { minRun: 90, minDrop: 40 });
    expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThanOrEqual(56 - 36);
    expect(hits(pts, mid)).toBe(false);
  });
  it('reaches a block to the left without crossing either end', () => {
    const a = { x: 600, y: 300, w: 200, h: 52 }, b = { x: 0, y: 0, w: 400, h: 300 };
    const pts = routeWire(a, b, []);
    const inner = (r: Rect) => ({ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 });
    expect(hits(pts, inner(a)) || hits(pts, inner(b))).toBe(false);
  });
  it('routes a curve below-left of the graph out its right edge into the graph foot instead of detouring behind a slider', () => {
    const slider = { x: 90, y: 380, w: 315, h: 50 };
    const curve = { x: 100, y: 520, w: 170, h: 48 };
    const graph = { x: 420, y: 60, w: 450, h: 340 };
    const pts = routeWire(curve, graph, [slider]);
    expect(hits(pts, slider)).toBe(false);
    expect(pts[0].x).toBe(curve.x + curve.w);
    expect(pts.at(-1)!.y).toBe(graph.y + graph.h);
    expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThanOrEqual(curve.x + curve.w);
  });
});

describe('fitsAsIs', () => {
  it('fits at 100% only when every block is on screen and clear of the keys', () => {
    const area = { x: 0, y: 60, w: 1440, h: 740 }, keys = { x: 1088, y: 577, w: 330, h: 300 };
    expect(fitsAsIs([{ x: 56, y: 104, w: 300, h: 50 }, { x: 1036, y: 96, w: 270, h: 90 }], area, [keys])).toBe(true);
    expect(fitsAsIs([{ x: 1100, y: 600, w: 200, h: 80 }], area, [keys])).toBe(false);
    expect(fitsAsIs([{ x: 56, y: 104, w: 2000, h: 50 }], area, [keys])).toBe(false);
  });
});

describe('the canvas view', () => {
  it('fits every block, never past 100%', () => {
    const v = fitAll([{ x: 0, y: 0, w: 400, h: 200 }], { x: 0, y: 0, w: 1440, h: 900 });
    expect(v.scale).toBe(1);
    const big = fitAll([{ x: 0, y: 0, w: 4000, h: 1000 }], { x: 0, y: 0, w: 1440, h: 900 });
    expect(big.scale).toBeCloseTo((1440 - 96) / 4000);
    expect(big.dx).toBeCloseTo(48);
  });
  it('zooms about the pointer, which stays put', () => {
    const v = zoomAbout({ scale: 1, dx: 0, dy: 0 }, 2, { x: 100, y: 50 });
    expect(v).toEqual({ scale: 2, dx: -100, dy: -50 });
    expect(zoomAbout(v, 100, { x: 0, y: 0 }).scale).toBe(2);
  });
});

describe('the phone column', () => {
  it('puts the graph after the last line that draws, and lanes wires without crossing', () => {
    const rows = lines('a = 1', 'y = a(x - 1)^2 - 3', 'y = 2sin(45x)', 'normalcdf(-1, 1)', '');
    const w = wiresOf(rows);
    const order = columnOrder(rows, w);
    expect(order).toEqual(['r1', 'r2', 'r3', GRAPH_BLOCK, 'r4']);
    const lanes = gutterLanes(w, order);
    // a → its curve is the short inner wire; the curves to the graph nest outside it or share.
    expect(lanes.get(wireKey({ from: 'r1', to: 'r2' }))).toBe(0);
    expect(lanes.get(wireKey({ from: 'r3', to: GRAPH_BLOCK }))).toBe(0);
    expect(lanes.get(wireKey({ from: 'r2', to: GRAPH_BLOCK }))).toBe(1);
  });
  it("puts the example's own graph after the example's curve, and the sheet's graph after the person's", () => {
    const rows: CanvasRow[] = [...EXAMPLE_LINES.map((l, k) => ({ id: `e${k}`, kind: 'expr' as const, text: l.text, example: true })), ...lines('y = x', '2 + 2')];
    expect(columnOrder(rows, wiresOf(rows))).toEqual(['e0', 'e1', EXAMPLE_GRAPH, 'r1', GRAPH_BLOCK, 'r2']);
  });
  it('lets wires end to end share a lane, and nests an enclosing wire outside', () => {
    const wires = [{ from: 'a', to: 'b', name: '' }, { from: 'b', to: 'c', name: '' }, { from: 'a', to: 'c', name: '' }];
    const lanes = gutterLanes(wires, ['a', 'b', 'c']);
    expect(lanes.get('a>b')).toBe(0);
    expect(lanes.get('b>c')).toBe(0);
    expect(lanes.get('a>c')).toBe(1);
  });
});

describe('updatePreviewRows', () => {
  it('works the sheet out with an update in place and the draft left out, on every front end', () => {
    const rows: RowInput[] = [{ id: 'r1', kind: 'expr', text: 'r = 4' }, { id: 'u', kind: 'expr', text: '2r' }, { id: 'd', kind: 'expr', text: 'r = 6' }];
    const shown = updatePreviewRows(rows, 'd', null);
    expect(shown.map((r) => (r.kind === 'expr' ? r.text : ''))).toEqual(['r = 6', '2r', '']);
    const res = evaluateDocument([...shown], cleanSettings({}));
    expect(res[1]?.value).toBe(12);
    expect(res.some((x) => x?.error)).toBe(false);
    expect(updatePreviewRows(rows, 'd', 'r1')).toBe(rows);
    expect(updatePreviewRows(rows, null, null)).toBe(rows);
  });
});

describe('composerIntent', () => {
  const rows = lines('r = 4', 'A = πr^2', '');
  it('offers to update a line that already defines the name', () => {
    expect(composerIntent('r = 6', rows, null)).toEqual({ kind: 'update', id: 'r1', name: 'r' });
  });
  it('sends a new line otherwise, and edits the line being edited', () => {
    expect(composerIntent('s = 6', rows, null)).toEqual({ kind: 'new' });
    expect(composerIntent('2r', rows, null)).toEqual({ kind: 'new' });
    expect(composerIntent('r = 6', rows, 'r1')).toEqual({ kind: 'edit', id: 'r1' });
  });
  it('shows a slider once: in the composer for a new line, on its block while the block is being changed', () => {
    expect(composerShowsSlider(false)).toBe(true);
    expect(composerShowsSlider(true)).toBe(false);
  });
  it("doesn't count the draft row the line is being typed into", () => {
    const typing = lines('A = 2', 'r = 4');
    expect(composerIntent('r = 4', typing, null, 'r2')).toEqual({ kind: 'new' });
    expect(composerIntent('A = 3', typing, null, 'r2')).toEqual({ kind: 'update', id: 'r1', name: 'A' });
  });
});

describe('the first run', () => {
  const example = EXAMPLE_LINES.map((l, k) => ({ id: `e${k}`, kind: 'expr' as const, text: l.text, example: true as const }));
  it('cues the first line until the sheet holds one of the person\'s own', () => {
    expect(composerPlaceholder([...example, { id: 'd', kind: 'expr', text: '' }])).toBe('12 × 7, or r = 4');
    expect(composerPlaceholder([...example, { id: 'r1', kind: 'expr', text: 'r = 4' }])).toBe('');
  });
  it("wires the example to its own graph, and the person's curves to the sheet's graph, never both", () => {
    const rows: CanvasRow[] = [...example, ...lines('y = 2sin(45x)')];
    expect(pairs(rows)).toEqual(['e0>e1:k', `e1>${EXAMPLE_GRAPH}`, `r1>${GRAPH_BLOCK}`]);
  });
});

describe('canvas fields in a saved sheet', () => {
  it('keeps a block position, the example flag and the graph block, and drops bad ones', () => {
    const body = cleanBody<DocRow>({ rows: [{ id: 'a', kind: 'expr', text: '1', at: { x: 10, y: 20 }, example: true }, { id: 'b', kind: 'expr', text: '2', at: { x: 'no' }, example: 'yes' }] }, () => 'n', () => ({ id: 'z', kind: 'expr', text: '', color: 0 }));
    expect(body.rows[0]).toMatchObject({ at: { x: 10, y: 20 }, example: true });
    expect(body.rows[1].at).toBeUndefined();
    expect(body.rows[1].example).toBeUndefined();
    expect(cleanSheetView({ graphBlock: { x: 1, y: 2, w: 400, h: 300 } })).toEqual({ graphBlock: { x: 1, y: 2, w: 400, h: 300 } });
    expect(cleanSheetView({ graphBlock: { x: 1, y: 2, w: 4, h: 300 } })).toEqual({});
    expect(cleanSheetView({ flow: 2 })).toEqual({ flow: 2 });
    expect(cleanSheetView({ flow: 1 })).toEqual({});
  });
});
