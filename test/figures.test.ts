import { describe, expect, it } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import type { Settings } from '../src/engine/evaluator';
import {
  argText, dragHandle, figureData, figureKind, figureLabel, figureQuiet, figureScene, figureSize, FIGURE_SIZE, handleAt, HANDLE_HIT, holdFigure, nudgeHandle, riemannRuleText,
  type FigureData, type MatrixData, type NormalData, type RiemannData, type TangentData, type UnitCircleData,
} from '../src/ui/figures';
import { blockControls, figureControls, viewOf } from '../src/ui/blockcontrols';
import { flowLayout, FLOW } from '../src/ui/canvas';
import { viewRects, wideFreeArea, wideHomeView, wideLayout, wideScreen, wideWireRoutes } from '../src/ui/canvaswide';

const DEG: Settings = { deg: true, complex: false, sample: false };
const RAD: Settings = { ...DEG, deg: false };

type Line = string | { text: string; slider?: { min: number; max: number; step: number } };
function sheet(lines: Line[], settings: Settings = RAD) {
  const rows: RowInput[] = lines.map((l, k) => ({ id: `r${k}`, kind: 'expr', text: typeof l === 'string' ? l : l.text, ...(typeof l === 'string' || !l.slider ? {} : { slider: l.slider }) }));
  const results = evaluateDocument(rows, settings);
  return { rows, results, settings };
}
function dataOf<T extends FigureData>(lines: Line[], settings: Settings = RAD): T {
  const s = sheet(lines, settings);
  const d = figureData({ ...s, id: s.rows[s.rows.length - 1].id });
  expect(d).not.toBeNull();
  return d as T;
}

describe('figureKind', () => {
  it('follows from the line', () => {
    expect(figureKind('unit circle(θ)')).toBe('unit-circle');
    expect(figureKind('unitcircle(30)')).toBe('unit-circle');
    expect(figureKind('tangent(f, p)')).toBe('tangent');
    expect(figureKind('riemann(g, 0, 2, n)')).toBe('riemann');
    expect(figureKind('riemann(g, 0, 2, n, "left")')).toBe('riemann');
    expect(figureKind('P = normalcdf(24.97, 25.03, μ, σ)')).toBe('normal');
    expect(figureKind('normalcdf(-1, 1)')).toBe('normal');
    expect(figureKind('M = [[1.5, s], [0.4, 1.2]]')).toBe('matrix');
  });
  it('leaves other lines alone', () => {
    expect(figureKind('normalcdf(1)')).toBeNull();
    expect(figureKind('2 normalcdf(-1, 1)')).toBeNull();
    expect(figureKind('[[1, 2, 3], [4, 5, 6]]')).toBeNull();
    expect(figureKind('12 * 7')).toBeNull();
  });
  it('reads a computed matrix by its value, and draws nothing for a line that fails', () => {
    const s = sheet(['M = [[2, 1], [1, 1]]', 'N = M^-1', 'K = [[1, 2], [2, 4]]^-1']);
    expect(figureKind(s.rows[1].kind === 'expr' ? s.rows[1].text : '', s.results[1])).toBe('matrix');
    expect(figureKind('K = [[1, 2], [2, 4]]^-1', s.results[2])).toBeNull();
  });
});

describe('figureData', () => {
  it('unit circle: θ, cos and sin from the engine, and the slider it reads', () => {
    const d = dataOf<UnitCircleData>([{ text: 'θ = 40', slider: { min: 0, max: 360, step: 1 } }, 'unit circle(θ)'], DEG);
    expect(d.theta).toBe(40);
    expect(d.cos).toBeCloseTo(Math.cos((40 * Math.PI) / 180), 12);
    expect(d.sin).toBeCloseTo(Math.sin((40 * Math.PI) / 180), 12);
    expect(d.arg).toEqual({ k: 'slider', id: 'r0', name: 'θ', range: { min: 0, max: 360, step: 1 } });
  });
  it('tangent: f and f′ to sample, the point, the slope and the line', () => {
    const d = dataOf<TangentData>(['f(x) = x^3 - 3x', 'p = 1.3', 'tangent(f, p)']);
    expect(d.slope).toBeCloseTo(2.07, 9);
    expect(d.y).toBeCloseTo(-1.703, 9);
    expect(d.f(2)).toBe(2);
    expect(d.df(1)).toBeCloseTo(0, 6);
    expect(d.equation).toBe('y = 2.07x − 4.394');
    expect(d.arg.k).toBe('slider');
  });
  it('riemann: a rule held by a name draws what the sum used', () => {
    // From review: rule = "left" read through a name drew the midpoint rule while the answer was the left sum.
    const d = dataOf<RiemannData>(['f(x) = x^2', 'rule = "left"', 'riemann(f, 0, 1, 4, rule)']);
    expect(d.rule).toBe('left');
    expect(d.sum).toBeCloseTo(0.21875, 10);
  });

  it('riemann: the sum, the integral it approaches and where its rule goes', () => {
    const d = dataOf<RiemannData>(['g(x) = x^3 - 3x', 'n = 8', 'riemann(g, 0, 2, n)']);
    expect(d.sum).toBeCloseTo(-2.03125, 12);
    expect(d.integral).toBeCloseTo(-2, 9);
    expect(d.rule).toBe('mid');
    expect(riemannRuleText(d, 'left')).toBe('riemann(g, 0, 2, n, "left")');
    const e = dataOf<RiemannData>(['g(x) = x^3 - 3x', 'riemann(g, 0, 2, 8, "right")']);
    expect(e.rule).toBe('right');
    expect(riemannRuleText(e, 'mid')).toBe('riemann(g, 0, 2, 8, "mid")');
  });
  it('normal: bounds, μ and σ, with typed bounds rewritten in place', () => {
    const d = dataOf<NormalData>(['μ = 25', 'σ = 0.02', 'P = normalcdf(24.97, 25.03, μ, σ)']);
    expect([d.lo, d.hi, d.mu, d.sigma]).toEqual([24.97, 25.03, 25, 0.02]);
    expect(d.area).toBeCloseTo(0.8663855975, 9);
    expect(d.args[0]).toEqual({ k: 'text', span: [14, 19] });
    expect(dataOf<NormalData>(['normalcdf(-1, 1)']).mu).toBe(0);
  });
  it('matrix: its entries, its determinant from the engine, and which entries are typed', () => {
    const d = dataOf<MatrixData>(['s = 0.6', 'M = [[1.5, s], [0.4, 1.2]]']);
    expect(d.m).toEqual([1.5, 0.6, 0.4, 1.2]);
    expect(d.det).toBeCloseTo(1.56, 12);
    expect(d.cells.map((c) => c.k)).toEqual(['text', 'slider', 'text', 'text']);
    expect(dataOf<MatrixData>(['M = [[2, 1], [1, 1]]', 'N = M^-1']).cells.every((c) => c.k === 'fixed')).toBe(true);
  });
});

describe('figureScene', () => {
  it('puts the unit circle and its waves side by side, the point on the circle at θ', () => {
    const d = dataOf<UnitCircleData>(['unit circle(90)'], DEG);
    const s = figureScene(d, FIGURE_SIZE['unit-circle']);
    expect(s.panes).toHaveLength(2);
    expect(s.panes[1].x).toBeGreaterThan(s.panes[0].x + s.panes[0].w);
    const [h] = s.handles;
    const c = s.panes[0];
    expect(h.x).toBeCloseTo(c.x + c.w / 2, 6);
    expect(h.y).toBeLessThan(c.h / 2);
    expect(h.draggable).toBe(true);
    // The sin guide runs straight across to the wave's dot.
    const guide = s.marks.find((m) => m.t === 'line' && m.pane === -1 && m.tone === 'coral');
    expect(guide?.t).toBe('line');
    if (guide?.t === 'line') expect(guide.y1).toBeCloseTo(guide.y2, 9);
    expect(s.marks.some((m) => m.t === 'text' && m.s === '90°')).toBe(true);
  });
  it('shows the cos guide only while a drag holds the point', () => {
    const d = dataOf<UnitCircleData>(['unit circle(128)'], DEG);
    const teal = (a: string | null) => figureScene(d, FIGURE_SIZE['unit-circle'], { active: a }).marks.filter((m) => m.pane === -1 && m.t === 'line' && m.tone === 'teal').length;
    expect(teal(null)).toBe(0);
    expect(teal('point')).toBe(1);
  });
  it('labels the normal curve in σ, with a handle on each bound', () => {
    const d = dataOf<NormalData>(['P = normalcdf(24.97, 25.03, 25, 0.02)']);
    const s = figureScene(d, FIGURE_SIZE.normal);
    expect(s.handles.map((h) => h.id)).toEqual(['lo', 'hi']);
    const texts = s.marks.flatMap((m) => (m.t === 'text' ? [m.s] : []));
    expect(texts).toEqual(expect.arrayContaining(['μ', '+σ', '−3σ', '25', '24.97', 'z −1.50', 'z 1.50']));
  });
  it('leaves an open bound without a handle', () => {
    const d = dataOf<NormalData>(['normalcdf(-inf, 1)']);
    expect(figureScene(d, FIGURE_SIZE.normal).handles.map((h) => h.id)).toEqual(['hi']);
  });
  it('draws the tangent with f′ under it and its equation', () => {
    const d = dataOf<TangentData>(['f(x) = x^3 - 3x', 'tangent(f, 1.3)']);
    const s = figureScene(d, FIGURE_SIZE.tangent);
    expect(s.panes).toHaveLength(2);
    expect(s.marks.some((m) => m.t === 'text' && m.s === 'y = 2.07x − 4.394')).toBe(true);
    expect(s.marks.some((m) => m.t === 'text' && m.s === 'y = f′(x)')).toBe(true);
    expect(s.handles[0].axis).toBe('x');
  });
  it('gives Riemann its strips and its readouts', () => {
    const d = dataOf<RiemannData>(['g(x) = x^3 - 3x', 'riemann(g, 0, 2, 8)']);
    const s = figureScene(d, FIGURE_SIZE.riemann);
    expect(s.readouts).toEqual([{ id: 'sum', label: 'S₈', value: '−2.03125' }, { id: 'integral', label: '∫₀² g(x) dx', value: '−2' }]);
    expect(s.marks.filter((m) => m.t === 'dot')).toHaveLength(8);
  });
  it('decides a label’s side from a measured width when the platform gives one', () => {
    const d = dataOf<MatrixData>(['M = [[1.5, 0.6], [0.4, 1.2]]']);
    const label = (s: ReturnType<typeof figureScene>) => s.marks.find((m) => m.t === 'text' && m.s === '(0.6, 1.2)');
    const size = { w: 280, h: 280 };
    expect(label(figureScene(d, size))).toMatchObject({ anchor: 'start' });
    // A face twice as wide no longer fits right of the tip, so the label turns to end at the edge.
    expect(label(figureScene(d, size, { measure: (s, px) => s.length * px * 1.4 }))).toMatchObject({ anchor: 'end', x: 276 });
  });
  it('lets the answer give way where the figure says the same, and names what it shows', () => {
    expect(figureQuiet(dataOf<UnitCircleData>(['unit circle(30)'], DEG))).toBe(true);
    expect(figureQuiet(dataOf<TangentData>(['f(x) = x^2', 'tangent(f, 1)']))).toBe(true);
    expect(figureQuiet(dataOf<MatrixData>(['M = [[2, 1], [1, 1]]']))).toBe(true);
    expect(figureQuiet(dataOf<MatrixData>(['M = [[2, 1], [1, 1]]', 'N = M^-1']))).toBe(false);
    expect(figureQuiet(dataOf<NormalData>(['normalcdf(-1, 1)']))).toBe(false);
    expect(figureLabel(dataOf<RiemannData>(['g(x) = x^2', 'riemann(g, 0, 2, 8)']))).toBe('8 strips under g from 0 to 2');
  });
  it('labels a matrix figure with its determinant and its basis vectors', () => {
    const d = dataOf<MatrixData>(['M = [[1.5, 0.6], [0.4, 1.2]]']);
    const s = figureScene(d, FIGURE_SIZE.matrix);
    const texts = s.marks.flatMap((m) => (m.t === 'text' ? [m.s] : []));
    expect(texts).toEqual(expect.arrayContaining(['1.56', '(1.5, 0.4)', '(0.6, 1.2)']));
    expect(s.handles.map((h) => h.id)).toEqual(['i', 'j']);
  });
});

describe('curve colors', () => {
  it('a figure draws a function in its own line’s curve color, and the rest in another', () => {
    const d = dataOf<TangentData>(['f(x) = x^3 - 3x', 'tangent(f, 1.3)']);
    expect(d.curve).toBe(0);
    const strokes = figureScene(d, FIGURE_SIZE.tangent).marks.flatMap((m) => (m.t === 'path' && m.stroke ? [m.stroke] : []));
    expect(strokes).toContain('c0');
    expect(strokes).toContain('amber');
    expect(strokes).not.toContain('violet');
    // f wearing the theme's amber (its curve 2): the tangent takes violet instead.
    const e = dataOf<TangentData>(['a = 1', 'b = 2', 'f(x) = x^2', 'tangent(f, 1)']);
    expect(e.curve).toBe(2);
    const s2 = figureScene(e, FIGURE_SIZE.tangent).marks.flatMap((m) => (m.t === 'path' && m.stroke ? [m.stroke] : []));
    expect(s2).toContain('c2');
    expect(s2).toContain('violet');
    expect(s2).not.toContain('amber');
  });
  it('Riemann’s strips wear g’s color; a built-in keeps the figure’s own', () => {
    const d = dataOf<RiemannData>(['n = 8', 'g(x) = x^3 - 3x', 'riemann(g, 0, 2, n)']);
    expect(d.curve).toBe(1);
    expect(figureScene(d, FIGURE_SIZE.riemann).marks.some((m) => m.t === 'path' && m.fill === 'c1')).toBe(true);
    expect(dataOf<TangentData>(['tangent(sin, 0)']).curve).toBeNull();
  });
});

describe('far-reaching values', () => {
  it('a matrix that reaches far still has a handful of ticks', () => {
    const d = dataOf<MatrixData>(['[[2^70, 1], [1, 1]]']);
    const s = figureScene(d, FIGURE_SIZE.matrix);
    expect(s.marks.length).toBeLessThan(200);
  });
  it('a sum of a million strips draws at most a few hundred', () => {
    const d = dataOf<RiemannData>(['g(x) = x', 'riemann(g, 0, 1, 1000000)']);
    expect(figureScene(d, FIGURE_SIZE.riemann).marks.length).toBeLessThan(200);
  });
});

describe('drags and keys', () => {
  it('a unit circle drag moves the slider it reads, in the slider’s steps and range', () => {
    const d = dataOf<UnitCircleData>([{ text: 'θ = 40', slider: { min: 0, max: 360, step: 5 } }, 'unit circle(θ)'], DEG);
    const size = FIGURE_SIZE['unit-circle'];
    const s = figureScene(d, size);
    const c = s.panes[0], cx = c.w / 2, cy = c.h / 2;
    // Straight up from the middle is 90°.
    expect(dragHandle(d, size, holdFigure(d, s), 'point', { x: cx, y: cy - 50 })).toEqual([{ kind: 'slider', id: 'r0', text: 'θ = 90' }]);
    // Just below the right is 357°, which a step of 5 takes to 355.
    expect(dragHandle(d, size, holdFigure(d, s), 'point', { x: cx + 80, y: cy + 4 })).toEqual([{ kind: 'slider', id: 'r0', text: 'θ = 355' }]);
  });
  it('a typed angle is rewritten in the line', () => {
    const d = dataOf<UnitCircleData>(['unit circle(40)'], DEG);
    const size = FIGURE_SIZE['unit-circle'];
    const s = figureScene(d, size);
    const c = s.panes[0];
    expect(dragHandle(d, size, holdFigure(d, s), 'point', { x: c.w / 2 - 60, y: c.h / 2 })).toEqual([{ kind: 'line', text: 'unit circle(180)' }]);
  });
  it('a bound keeps its order and its step', () => {
    const d = dataOf<NormalData>(['P = normalcdf(24.97, 25.03, 25, 0.02)']);
    const size = FIGURE_SIZE.normal;
    const s = figureScene(d, size);
    const hold = holdFigure(d, s);
    const hi = s.handles.find((h) => h.id === 'hi')!;
    const [e] = dragHandle(d, size, hold, 'hi', { x: hi.x + 40, y: hi.y });
    expect(e.kind).toBe('line');
    expect(e.kind === 'line' && /^P = normalcdf\(24\.97, 25\.0\d+, 25, 0\.02\)$/.test(e.text)).toBe(true);
    const lo = s.handles.find((h) => h.id === 'lo')!;
    const [f] = dragHandle(d, size, hold, 'lo', { x: lo.x + 400, y: lo.y });
    expect(f).toEqual({ kind: 'line', text: 'P = normalcdf(25.03, 25.03, 25, 0.02)' });
  });
  it('a matrix tip rewrites its typed entries and moves its slider', () => {
    const d = dataOf<MatrixData>(['s = 0.6', 'M = [[1.5, s], [0.4, 1.2]]']);
    const size = FIGURE_SIZE.matrix;
    const s = figureScene(d, size);
    const hold = holdFigure(d, s);
    const v = s.view.kind === 'matrix' ? s.view.r : 0;
    const U = size.w / (2 * v);
    const at = (x: number, y: number) => ({ x: size.w / 2 + x * U, y: size.h / 2 - y * U });
    expect(dragHandle(d, size, hold, 'i', at(2, -1))).toEqual([{ kind: 'line', text: 'M = [[2, s], [-1, 1.2]]' }]);
    const e = dragHandle(d, size, hold, 'j', at(1, 1));
    expect(e[0]).toEqual({ kind: 'line', text: 'M = [[1.5, s], [0.4, 1]]' });
    expect(e[1].kind).toBe('slider');
  });
  it('a tangent point follows x only', () => {
    const d = dataOf<TangentData>(['f(x) = x^2', 'tangent(f, 1)']);
    const size = FIGURE_SIZE.tangent;
    const s = figureScene(d, size);
    const [e] = dragHandle(d, size, holdFigure(d, s), 'point', { x: size.w / 2, y: 3 });
    expect(e).toEqual({ kind: 'line', text: 'tangent(f, 0)' });
  });
  it('arrow keys nudge a step, ten with Shift', () => {
    const d = dataOf<UnitCircleData>(['unit circle(40)'], DEG);
    expect(nudgeHandle(d, null, 'point', 'right')).toEqual([{ kind: 'line', text: 'unit circle(41)' }]);
    expect(nudgeHandle(d, null, 'point', 'down', true)).toEqual([{ kind: 'line', text: 'unit circle(30)' }]);
    const m = dataOf<MatrixData>(['[[1, 0], [0, 1]]']);
    expect(nudgeHandle(m, null, 'j', 'left')).toEqual([{ kind: 'line', text: '[[1, -0.1], [0, 1]]' }]);
  });
  it('finds a handle under a press, with more reach for a finger', () => {
    const d = dataOf<UnitCircleData>(['unit circle(0)'], DEG);
    const s = figureScene(d, FIGURE_SIZE['unit-circle']);
    const h = s.handles[0];
    expect(handleAt(s, { x: h.x + 20, y: h.y })).toBeNull();
    expect(handleAt(s, { x: h.x + 20, y: h.y }, true)?.id).toBe('point');
  });
  it('reaches as far as HANDLE_HIT says, from only the handles', () => {
    const handles = figureScene(dataOf<UnitCircleData>(['unit circle(0)'], DEG), FIGURE_SIZE['unit-circle']).handles;
    const h = handles[0];
    expect(handleAt({ handles }, { x: h.x + HANDLE_HIT.mouse, y: h.y })?.id).toBe('point');
    expect(handleAt({ handles }, { x: h.x + HANDLE_HIT.mouse + 0.5, y: h.y })).toBeNull();
    expect(handleAt({ handles }, { x: h.x, y: h.y + HANDLE_HIT.touch }, true)?.id).toBe('point');
    expect(handleAt({ handles }, { x: h.x, y: h.y + HANDLE_HIT.touch + 0.5 }, true)).toBeNull();
  });
  it('writes numbers the way a line takes them', () => {
    expect(argText(-0.30000000000000004)).toBe('-0.3');
    expect(argText(-0)).toBe('0');
  });
});

describe('sizes and layout', () => {
  it('a figure fills a narrow column, the unit circle still beside its waves', () => {
    expect(figureSize('normal', 330)).toEqual({ w: 330, h: 190 });
    const u = figureSize('unit-circle', 330);
    expect(u.w).toBe(330);
    expect(u.h).toBeLessThan(200);
    expect(figureSize('matrix')).toEqual(FIGURE_SIZE.matrix);
  });
  it('figure blocks flow with the lines that draw, left of the graph, each under the slider it reads', () => {
    const out = flowLayout([
      { id: 's', kind: 'slider', size: { w: 300, h: 50 } },
      { id: 'c', kind: 'line', size: { w: 240, h: 50 } },
      { id: 'f', kind: 'figure', size: { w: 560, h: 340 } },
      { id: 'v', kind: 'value', size: { w: 220, h: 80 } },
    ], [{ from: 's', to: 'f', name: 's' }, { from: 'c', to: '#graph', name: '' }], { ...FLOW, graph: { id: '#graph', size: { w: 400, h: 300 } } });
    const g = out.get('#graph')!, f = out.get('f')!, v = out.get('v')!, s = out.get('s')!, c = out.get('c')!;
    expect(f.x).toBe(c.x);
    expect(g.x).toBeGreaterThan(f.x + f.w);
    expect(v.x).toBeGreaterThan(g.x + g.w);
    expect(s.x).toBe(f.x);
    expect(s.y).toBeLessThan(f.y);
    expect(f.y).toBeGreaterThan(c.y);
  });
  // A 1440 × 900 window: the canvas under the top bar, the composer at its foot, the keys in the corner.
  const SCREEN = {
    area: { x: 0, y: 60, w: 1440, h: 840 },
    composer: { x: 203, y: 805, w: 682, h: 74 },
    keys: { x: 1088, y: 612, w: 330, h: 266 },
    free: [wideFreeArea({ w: 1440, h: 900 }, 60, 330, 94)],
  };
  const bottom = (x: number, w: number) => Math.min(880, ...[SCREEN.composer, SCREEN.keys].filter((c) => x < c.x + c.w && c.x < x + w).map((c) => c.y - 20));
  const homeScale = (l: ReturnType<typeof wideLayout>) => wideHomeView(viewRects(l), SCREEN.area, SCREEN.composer, SCREEN.keys, SCREEN.free).scale;
  it('a crowded sheet wraps into the height beside the composer instead of one long row', () => {
    // The mixed sheet: a slider, a matrix figure, a curve, a value, a normal figure, and the graph.
    const input = {
      blocks: [
        { id: 'k', size: { w: 300, h: 50 }, slider: true }, { id: 'M', size: { w: 312, h: 372 }, figure: true },
        { id: 'y', size: { w: 200, h: 50 } }, { id: 'd', size: { w: 200, h: 80 } }, { id: 'P', size: { w: 492, h: 318 }, figure: true },
      ],
      wires: [{ from: 'k', to: 'M', name: 'k' }, { from: 'k', to: 'y', name: 'k' }, { from: 'M', to: 'd', name: 'M' }, { from: 'd', to: 'P', name: 'd' }, { from: 'y', to: '#graph', name: '' }],
      graph: { size: { w: 560, h: 440 } }, exampleGraph: false, bottom,
    };
    const wrapped = wideLayout({ ...input, screen: SCREEN }), row = wideLayout(input);
    expect(homeScale(row)).toBeLessThan(0.7);
    expect(homeScale(wrapped)).toBeGreaterThanOrEqual(0.75);
    const rs = [...wrapped.rects.values()];
    const hit = (a: (typeof rs)[number], c: (typeof rs)[number]) => a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
    expect(rs.some((a, i) => rs.some((c, j) => i < j && hit(a, c)))).toBe(false);
  });
  it('on a tall, narrow screen a crowded sheet stacks taller instead of shrinking to a strip', () => {
    // A portrait tablet's canvas: the composer at the foot on the left, the keys a panel in the corner.
    const composer = { x: 20, y: 960, w: 420, h: 74 }, keys = { x: 480, y: 740, w: 330, h: 266 };
    const screen = wideScreen({ w: 834, h: 1100 }, 60, composer, keys);
    const tallBottom = (x: number, w: number) => Math.min(1080, ...[composer, keys].filter((c) => x < c.x + c.w && c.x < x + w).map((c) => c.y - 20));
    const input = {
      blocks: [
        { id: 'k', size: { w: 300, h: 50 }, slider: true }, { id: 'M', size: { w: 312, h: 372 }, figure: true },
        { id: 'y', size: { w: 200, h: 50 } }, { id: 'd', size: { w: 200, h: 80 } }, { id: 'P', size: { w: 492, h: 318 }, figure: true },
      ],
      wires: [{ from: 'k', to: 'M', name: 'k' }, { from: 'k', to: 'y', name: 'k' }, { from: 'M', to: 'd', name: 'M' }, { from: 'd', to: 'P', name: 'd' }, { from: 'y', to: '#graph', name: '' }],
      graph: { size: { w: 560, h: 440 } }, exampleGraph: false, bottom: tallBottom,
    };
    const scaleOf = (l: ReturnType<typeof wideLayout>) => wideHomeView(viewRects(l), screen.area, screen.composer, screen.keys, screen.free).scale;
    expect(scaleOf(wideLayout(input))).toBeLessThan(0.5);
    const L = wideLayout({ ...input, screen });
    expect(scaleOf(L)).toBeGreaterThanOrEqual(0.7);
  });
  it('a sheet that fits keeps the layout it had', () => {
    const input = { blocks: [{ id: 'a', size: { w: 300, h: 50 }, slider: true }, { id: 'c', size: { w: 240, h: 50 } }, { id: 'v', size: { w: 200, h: 80 } }], wires: [{ from: 'a', to: 'c', name: 'a' }, { from: 'c', to: '#graph', name: '' }], graph: { size: { w: 560, h: 440 } }, exampleGraph: false, bottom };
    const l = wideLayout({ ...input, screen: SCREEN });
    expect(homeScale(l)).toBe(1);
    expect([...l.rects]).toEqual([...wideLayout(input).rects]);
  });
  it('the example’s slider leaves its wire room to drop straight into the curve', () => {
    const l = wideLayout({ blocks: [{ id: 'k', size: { w: 400, h: 56 }, example: true, slider: true }, { id: 'y', size: { w: 330, h: 58 }, example: true }], wires: [{ from: 'k', to: 'y', name: 'k' }, { from: 'y', to: '#example-graph', name: '' }], graph: null, exampleGraph: true });
    const k = l.rects.get('k')!, y = l.rects.get('y')!;
    expect(y.y - (k.y + k.h)).toBe(40);
    const pts = wideWireRoutes([{ from: 'k', to: 'y', name: 'k' }], l.rects, l.frame, () => true, null, () => 90)[0].points;
    expect(pts).toHaveLength(2);
  });
  it('wideLayout reads a block marked as a figure', () => {
    const l = wideLayout({ blocks: [{ id: 'v', size: { w: 200, h: 80 } }, { id: 'f', size: { w: 560, h: 300 }, figure: true }], wires: [], graph: null, exampleGraph: false });
    expect(l.rects.get('v')!.x).toBeGreaterThan(l.rects.get('f')!.x + 560);
  });
});

describe('block controls', () => {
  it('one style for the view switch and Steps, in that order', () => {
    const c = blockControls({ figure: 'normal', view: 'figure', steps: true, stepsOpen: false, failed: false });
    expect(c.map((x) => x.id)).toEqual(['view', 'steps']);
    expect(c[0].kind === 'choice' && c[0].options.map((o) => o.glyph)).toEqual(['△', '=']);
    expect(blockControls({ figure: null, view: 'figure', steps: false, stepsOpen: false, failed: false })).toEqual([]);
  });
  it('a Riemann figure picks its rule over its own corner, only while it shows', () => {
    expect(figureControls('riemann', 'figure', 'mid')[0].value).toBe('mid');
    expect(figureControls('riemann', 'numbers', 'mid')).toEqual([]);
    expect(figureControls('normal', 'figure', 'mid')).toEqual([]);
  });
  it('stores only numbers', () => {
    expect(viewOf({})).toBe('figure');
    expect(viewOf({ view: 'numbers' })).toBe('numbers');
  });
});
