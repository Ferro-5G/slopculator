import { describe, expect, it } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { routeWire, sheetWires, wireKey } from '../src/ui/canvas';
import { hostedWires, wideLayout, wideWireRoute } from '../src/ui/canvaswide';
import { portReads, portValue, rowPorts, unusedPorts } from '../src/ui/ports';
import { rowReadouts } from '../src/ui/readouts';
import { wireTag } from '../src/ui/wiretags';
import { parse } from '../src/engine/parser';

const settings = { deg: true, complex: false, sample: false };
type Line = string | { text: string; slider: { min: number; max: number; step: number } };
function sheet(lines: Line[]) {
  const rows: RowInput[] = lines.map((l, k) => ({ id: `r${k}`, kind: 'expr', ...(typeof l === 'string' ? { text: l } : l) }) as RowInput);
  return { rows, results: evaluateDocument(rows, settings), settings };
}
const display = { places: null, exact: false, percent: false };
const STRENGTH = '[31.2, 33.8, 29.6, 32.4, 30.9, 31.7, 34.1, 32.8, 28.9, 33.2, 31.5, 30.4]';

describe('rowPorts', () => {
  it('gives a moist-air state, a list, a fit and linreg their ports, and other lines none', () => {
    const s = sheet(['A = psych(26, 50, "SI")', `d = ${STRENGTH}`, 'x1 = [1, 2, 3, 5]', 'y1 = [1, 2, 3, 4]', 'y1 ~ m x1 + b', 'L = linreg(x1, y1)', 'q = 12', 'v = [1, 2]', 'P = psych(75, 50)']);
    const ports = s.rows.map((r, k) => rowPorts(r, s.results[k]));
    expect(ports[0]).toEqual({ kind: 'air', ports: ['Tdp', 'W', 'h'] });
    expect(ports[1]).toEqual({ kind: 'list', ports: ['n', 'mean', 's', 'median'] });
    expect(ports[4]).toEqual({ kind: 'fit', ports: ['m', 'b', 'R2'] });
    expect(ports[5]).toEqual({ kind: 'linreg', ports: ['a', 'b', 'r2'] });
    expect(ports[6]).toBeNull();
    expect(ports[7]).toBeNull();
    expect(ports[8]?.kind).toBe('air');
  });
});

describe('port wires', () => {
  it('a line reading one result wires from that result’s port', () => {
    const s = sheet(['A = psych(26, 50, "SI")', 'B = psych(13, 95, "SI")', 'q = A.h − B.h', 'r = A.tdp + A.g']);
    const w = sheetWires(s.rows, s.results);
    expect(w).toContainEqual({ from: 'r0', to: 'r2', name: 'A', fromPort: 'h' });
    expect(w).toContainEqual({ from: 'r1', to: 'r2', name: 'B', fromPort: 'h' });
    // Any case, and W in g/kg through the W port.
    expect(w).toContainEqual({ from: 'r0', to: 'r3', name: 'A', fromPort: 'Tdp' });
    expect(w).toContainEqual({ from: 'r0', to: 'r3', name: 'A', fromPort: 'W' });
    // No wire from A as a whole, since every mention goes through a port.
    expect(w.some((x) => x.from === 'r0' && x.to === 'r2' && !x.fromPort)).toBe(false);
  });
  it('two results of one block are two wires, and a mention of the block itself is a third', () => {
    const s = sheet([`d = ${STRENGTH}`, 'fk = mean(d) − 1.645 stdev(d)', 'z = d.median + len(d)', 'w = d + mean(d)']);
    const w = sheetWires(s.rows, s.results);
    const into = (to: string) => w.filter((x) => x.to === to).map((x) => x.fromPort ?? '');
    expect(into('r1')).toEqual(['mean', 's']);
    expect(into('r2').sort()).toEqual(['median', 'n']);
    expect(into('r3').sort()).toEqual(['', 'mean']);
    expect(new Set(w.map(wireKey)).size).toBe(w.length);
  });
  it('a fit defines its unknowns, and a line reading one wires from its port', () => {
    const s = sheet(['x1 = [1, 2, 3, 5]', 'y1 = [1, 2, 3, 4]', 'y1 ~ m x1 + b', 'k = 1 / m']);
    expect(sheetWires(s.rows, s.results)).toContainEqual({ from: 'r2', to: 'r3', name: 'm', fromPort: 'm' });
  });
  it('a field after a dot is no name read, unless the sheet defines it as a function', () => {
    const s = sheet(['h = 3', 'A = psych(26, 50, "SI")', 'q = A.h']);
    expect(sheetWires(s.rows, s.results).filter((x) => x.to === 'r2')).toEqual([{ from: 'r1', to: 'r2', name: 'A', fromPort: 'h' }]);
    const n = parse('A.h + B.k');
    const reads = portReads(n, () => null);
    expect([...reads.fields].sort()).toEqual(['h', 'k']);
  });
  it('a port carries its one result, on the wire’s tag too', () => {
    const s = sheet(['A = psych(26, 50, "SI")', `d = ${STRENGTH}`, 'q = A.h', 'm2 = mean(d)']);
    expect(portValue(s.rows[0], s.results[0], 'h')).toBe(52.91);
    expect(portValue(s.rows[1], s.results[1], 'mean')).toBeCloseTo(s.results[3].value as number, 12);
    const w = sheetWires(s.rows, s.results);
    const tag = wireTag(w.find((x) => x.to === 'r2')!, s.rows, s.results, display);
    expect(tag).toMatchObject({ kind: 'number', name: 'A.h', text: '52.91' });
    expect(wireTag(w.find((x) => x.to === 'r3')!, s.rows, s.results, display)?.name).toBe('x̄(d)');
  });
  it('lists the ports no wire leaves from, for their hollow dots', () => {
    expect(unusedPorts('r0', ['Tdp', 'W', 'h'], [{ from: 'r0', fromPort: 'h' }, { from: 'r1', fromPort: 'W' }])).toEqual(['Tdp', 'W']);
  });
});

describe('readouts', () => {
  it('a moist-air state in its own units: °C with g/kg, or °F with grains', () => {
    const s = sheet(['A = psych(26, 50, "SI")', 'B = psych(75, 50)']);
    expect(rowReadouts({ ...s, id: 'r0' })).toEqual([
      { port: 'Tdp', label: 'T', sub: 'dp', math: true, text: '14.8', unit: '°C' },
      { port: 'W', label: 'W', math: true, text: '10.50', unit: 'g/kg' },
      { port: 'h', label: 'h', math: true, text: '52.9', unit: 'kJ/kg' },
    ]);
    expect(rowReadouts({ ...s, id: 'r1' })!.map((r) => r.unit)).toEqual(['°F', 'gr/lb', 'Btu/lb']);
  });
  it('a list: n, x̄, s and median; a fit: n, slope, intercept and R², each on its unknown’s port', () => {
    const s = sheet([`d = ${STRENGTH}`, 'x1 = [2, 4, 6, 8]', 'y1 = [0.41, 0.79, 1.22, 1.6]', 'y1 ~ m x1 + b']);
    expect(rowReadouts({ ...s, id: 'r0' })!.map((r) => [r.label, r.port])).toEqual([['n', 'n'], ['x̄', 'mean'], ['s', 's'], ['median', 'median']]);
    expect(rowReadouts({ ...s, id: 'r3' })!.map((r) => [r.label, r.port])).toEqual([['n', null], ['slope', 'm'], ['intercept', 'b'], ['R', 'R2']]);
  });
});

describe('routing from a port', () => {
  it('leaves from the port on the block’s right edge', () => {
    const a = { x: 0, y: 0, w: 200, h: 200 }, b = { x: 400, y: 300, w: 160, h: 60 };
    const pts = routeWire(a, b, [], { outY: 150 });
    expect(pts[0]).toEqual({ x: 200, y: 150 });
    // Even when the target is under it, a port wire never leaves from the block's foot.
    const under = routeWire(a, { x: 20, y: 400, w: 160, h: 60 }, [], { outY: 150 });
    expect(under[0]).toEqual({ x: 200, y: 150 });
  });
  it('a row inside a block routes as that block, round nothing of its own', () => {
    const rects = new Map([['#psych', { x: 0, y: 0, w: 700, h: 380 }], ['r2', { x: 0, y: 0, w: 700, h: 380 }], ['r3', { x: 0, y: 0, w: 700, h: 380 }], ['r4', { x: 760, y: 120, w: 200, h: 80 }]]);
    const hosts = new Map([['r2', '#psych'], ['r3', '#psych']]);
    const w = { from: 'r2', to: 'r4', name: 'A', fromPort: 'h' };
    const pts = wideWireRoute(w, [w], rects, null, () => false, { outY: 160, hosts })!;
    expect(pts[0]).toEqual({ x: 700, y: 160 });
    expect(pts.at(-1)!.x).toBe(760);
    expect(wideWireRoute({ from: 'r2', to: 'r3', name: 'A' }, [], rects, null, () => false, { hosts })).toBeNull();
  });
  it('the layout flows the chart where its first state goes, a slider above it, and gives each state its rect', () => {
    const hosts = new Map([['a', '#psych'], ['b', '#psych']]);
    const wires = [{ from: 't', to: 'a', name: 'T' }, { from: 'a', to: 'q', name: 'A', fromPort: 'h' }, { from: 'b', to: 'q', name: 'B', fromPort: 'h' }, { from: 'a', to: 'b', name: 'A' }];
    expect(hostedWires(wires, hosts)).toEqual([{ from: 't', to: '#psych', name: 'T' }, { from: '#psych', to: 'q', name: 'A' }, { from: '#psych', to: 'q', name: 'B' }]);
    const laid = wideLayout({ blocks: [{ id: 't', size: { w: 300, h: 48 }, slider: true }, { id: '#psych', size: { w: 700, h: 400 }, figure: true }, { id: 'q', size: { w: 220, h: 80 } }], wires, graph: null, exampleGraph: false, hosts });
    const t = laid.rects.get('t')!, chart = laid.rects.get('#psych')!;
    expect(t.y + t.h).toBeLessThan(chart.y);
    expect(laid.rects.get('a')).toEqual(chart);
    expect(laid.rects.get('q')!.x).toBeGreaterThan(chart.x + chart.w);
  });
});

describe('block lines and data lists', () => {
  it('a block’s line shows a long list as its first items and an ellipsis, and a dot as typed', async () => {
    const { typeset, prettyText, BLOCK_LIST_MAX } = await import('../src/ui/typeset');
    const flat = (b: ReturnType<typeof typeset>): string => JSON.stringify(b);
    const long = typeset(`d = ${STRENGTH}`, { listMax: BLOCK_LIST_MAX })!;
    expect(flat(long)).toContain('…');
    expect(flat(long)).not.toContain('34.1');
    expect(flat(typeset('d = [1, 2, 3]', { listMax: BLOCK_LIST_MAX }))).not.toContain('…');
    expect(prettyText('q = A.h − B.h')).toBe('q = A.h − B.h');
  });
  it('a list a fit reads flows just above the fit, as a slider does', () => {
    const wires = [{ from: 'x', to: 'f', name: 'x1' }, { from: 'y', to: 'f', name: 'y1' }, { from: 'f', to: 'k', name: 'm', fromPort: 'm' }];
    const laid = wideLayout({ blocks: [{ id: 'x', size: { w: 300, h: 80 }, feeds: true }, { id: 'y', size: { w: 300, h: 80 }, feeds: true }, { id: 'f', size: { w: 470, h: 280 }, figure: true }, { id: 'k', size: { w: 200, h: 80 } }], wires, graph: null, exampleGraph: false });
    const x = laid.rects.get('x')!, y = laid.rects.get('y')!, f = laid.rects.get('f')!;
    expect(x.x).toBe(f.x);
    expect(x.y < y.y && y.y + y.h < f.y).toBe(true);
  });
});
