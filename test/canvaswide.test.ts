import { describe, expect, it } from 'vitest';
import { EXAMPLE_GRAPH, FLOW, GRAPH_BLOCK, type Rect, type Wire } from '../src/ui/canvas';
import {
  COMPOSER_MAX_W, composerSpan, dragGraph, dragTo, FRAME_PAD, FRAME_TOP, GRAPH_MIN, GRAPH_SIZE, isSidewaysPhone, isWideCanvas, KEYS_ROOM, NARROW_QUERY, needsFreshFlow,
  viewRects, wideFreeArea, wideFreeAreas, wideHomeView, wideLayout, wideWireRoutes, WIRE_IN_STEP, WIRE_MARGIN, type WideBlock,
} from '../src/ui/canvaswide';

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('isWideCanvas', () => {
  it('matches the web: 760 px and under is the column, and so is a phone on its side', () => {
    expect(isWideCanvas(760, 1000, false)).toBe(false);
    expect(isWideCanvas(761, 1000, false)).toBe(true);
    expect(isWideCanvas(744, 1133, true)).toBe(false); // a small tablet, upright
    expect(isWideCanvas(834, 1194, true)).toBe(true); // a tablet, upright
    expect(isWideCanvas(874, 402, true)).toBe(false); // a phone on its side
    expect(isSidewaysPhone(402, true)).toBe(true);
    expect(isWideCanvas(1200, 440, false)).toBe(true); // a short desktop window keeps the canvas
    expect(NARROW_QUERY).toBe('(max-width: 760px), (max-height: 460px) and (pointer: coarse)');
  });
});

describe('wideLayout', () => {
  // The mockup's sheet: a slider feeding a curve, a second curve, and a value.
  const blocks: WideBlock[] = [
    { id: 'a', size: { w: 330, h: 54 }, slider: true },
    { id: 'c1', size: { w: 200, h: 50 } },
    { id: 'c2', size: { w: 180, h: 50 } },
    { id: 'v', size: { w: 260, h: 80 } },
  ];
  const wires: Wire[] = [{ from: 'a', to: 'c1', name: 'a' }, { from: 'c1', to: GRAPH_BLOCK, name: '' }, { from: 'c2', to: GRAPH_BLOCK, name: '' }];

  it('lays a sheet out by kind: lines, then the graph, then values', () => {
    const { rects, frame, dropped } = wideLayout({ blocks, wires, graph: { size: GRAPH_SIZE }, exampleGraph: false });
    expect(frame).toBeNull();
    expect(dropped).toBeNull();
    const a = rects.get('a')!, c1 = rects.get('c1')!, g = rects.get(GRAPH_BLOCK)!, v = rects.get('v')!;
    expect(a).toMatchObject({ x: FLOW.origin.x, y: FLOW.origin.y });
    expect(c1.y).toBeGreaterThan(a.y);
    expect(g.x).toBeGreaterThan(a.x + a.w);
    expect(v.x).toBeGreaterThan(g.x + g.w);
    const all = [...rects.values()];
    for (const p of all) for (const q of all) if (p !== q) expect(overlap(p, q)).toBe(false);
  });

  it('frames the example with its own graph, and keeps a dragged block where it was put', () => {
    const ex: WideBlock[] = [
      { id: 'k', size: { w: 330, h: 54 }, example: true, slider: true },
      { id: 'y', size: { w: 330, h: 50 }, example: true },
      { id: 'v', size: { w: 210, h: 80 }, at: { x: 800, y: 400 } },
    ];
    const exWires: Wire[] = [{ from: 'k', to: 'y', name: 'k' }, { from: 'y', to: EXAMPLE_GRAPH, name: '' }];
    const { rects, frame } = wideLayout({ blocks: ex, wires: exWires, graph: null, exampleGraph: true });
    expect(rects.get('v')).toMatchObject({ x: 800, y: 400 });
    expect(frame).toMatchObject({ x: FLOW.origin.x, y: FLOW.origin.y });
    const k = rects.get('k')!;
    expect(k).toMatchObject({ x: FLOW.origin.x + FRAME_PAD, y: FLOW.origin.y + FRAME_TOP });
    expect(rects.get(EXAMPLE_GRAPH)!.y).toBeGreaterThan(rects.get('y')!.y);
  });

  it('a dropped block stays where it was put, the rest flow round it, and it says where it settled', () => {
    const laid = wideLayout({ blocks, wires, graph: { size: GRAPH_SIZE }, exampleGraph: false });
    const a = laid.rects.get('a')!;
    const onA = blocks.map((b) => (b.id === 'v' ? { ...b, at: { x: a.x, y: a.y } } : b));
    const { rects, dropped } = wideLayout({ blocks: onA, wires, graph: { size: GRAPH_SIZE }, exampleGraph: false, dropped: 'v' });
    expect(rects.get('v')).toMatchObject({ x: a.x, y: a.y });
    expect(dropped).toEqual({ id: 'v', rect: rects.get('v') });
    expect(overlap(dropped!.rect, rects.get('a')!)).toBe(false);
  });
});

describe('the wide view', () => {
  it('stays at 100% when the sheet fits, centred left of the keys; else fits it', () => {
    const rects = [{ x: 56, y: 104, w: 300, h: 60 }];
    const area = { x: 0, y: 60, w: 1366, h: 964 };
    const composer = { x: 300, y: 880, w: 680, h: 120 }, keys = { x: 1014, y: 700, w: 330, h: 300 };
    const v = wideHomeView(rects, area, composer, keys, wideFreeArea({ w: 1366, h: 1024 }, 60, 330, 120));
    expect(v.scale).toBe(1);
    expect(v.dx).toBe(Math.round((1014 - 300) / 2 - 56));
    const far = [...rects, { x: 3000, y: 104, w: 300, h: 60 }];
    expect(wideHomeView(far, area, composer, keys, wideFreeArea({ w: 1366, h: 1024 }, 60, 330, 120)).scale).toBeLessThan(1);
    expect(viewRects({ rects: new Map([['a', rects[0]]]), frame: null })).toEqual([...rects, { x: 56 - WIRE_MARGIN, y: 104, w: 1, h: 1 }]);
  });

  it('fits a wide sheet over the keys on a tall window, when that shows it larger', () => {
    const size = { w: 834, h: 1210 };
    const composer = { x: 24, y: 1000, w: 420, h: 120 }, keys = { x: 482, y: 900, w: 330, h: 290 };
    const free = wideFreeAreas(size, 78, composer, keys);
    expect(free).toHaveLength(2);
    const rects = [{ x: 56, y: 104, w: 1300, h: 440 }];
    const v = wideHomeView(rects, { x: 0, y: 78, w: 834, h: 1132 }, composer, keys, free);
    expect(v.scale).toBeCloseTo((834 - 96) / 1300, 5);
  });

  it('centres the composer in the room the keys leave', () => {
    expect(composerSpan(1440, true)).toEqual({ x: Math.round((1440 - KEYS_ROOM - COMPOSER_MAX_W) / 2), w: COMPOSER_MAX_W });
    expect(composerSpan(700, false).w).toBe(700 - 48);
  });
});

describe('wideWireRoutes', () => {
  it('spreads wires into one block down its left edge', () => {
    const rects = new Map<string, Rect>([
      ['c1', { x: 56, y: 104, w: 200, h: 50 }],
      ['c2', { x: 56, y: 180, w: 200, h: 50 }],
      [GRAPH_BLOCK, { x: 400, y: 104, w: 560, h: 440 }],
    ]);
    const routes = wideWireRoutes([{ from: 'c1', to: GRAPH_BLOCK, name: '' }, { from: 'c2', to: GRAPH_BLOCK, name: '' }], rects, null, () => false);
    expect(routes.map((r) => r.to.y)).toEqual([130, 130 + WIRE_IN_STEP]);
    expect(routes.every((r) => r.to.x === 400 && r.d.startsWith('M'))).toBe(true);
    expect(wideWireRoutes([{ from: 'c1', to: GRAPH_BLOCK, name: '' }], rects, null, () => false, 'c1')).toEqual([]);
  });
});

describe('dragging', () => {
  it('snaps to the grid, and never resizes the graph under its least', () => {
    expect(dragTo({ x: 56, y: 104 }, 13, -3)).toEqual({ x: 72, y: 104 });
    expect(dragGraph({ x: 0, y: 0, w: 560, h: 440 }, -1000, -1000, true)).toMatchObject({ w: GRAPH_MIN.w, h: GRAPH_MIN.h });
    expect(dragGraph({ x: 0, y: 0, w: 560, h: 440 }, 20, 0, false)).toMatchObject({ x: 24, w: 560 });
    expect(needsFreshFlow({})).toBe(true);
    expect(needsFreshFlow({ flow: 2 })).toBe(false);
  });
});

describe('wires into one block from above', () => {
  it('arrive at their own places along its top', () => {
    const rects = new Map<string, Rect>([
      ['a', { x: 300, y: 0, w: 200, h: 50 }],
      ['b', { x: 300, y: 70, w: 200, h: 50 }],
      ['r', { x: 0, y: 300, w: 400, h: 100 }],
    ]);
    const wires = [{ from: 'a', to: 'r', name: 'a' }, { from: 'b', to: 'r', name: 'b' }];
    const ends = wideWireRoutes(wires, rects, null, () => false).map((w) => w.to);
    expect(new Set(ends.map((p) => `${p.x},${p.y}`)).size).toBe(2);
  });
});
