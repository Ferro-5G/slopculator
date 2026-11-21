import { describe, expect, it } from 'vitest';
import { cleanSettings, evaluateDocument, type RowInput } from '../src/engine/document';
import { sheetWires, wireKey, type CanvasRow } from '../src/ui/canvas';
import {
  DELTA_LINGER_MS, dragOver, endDrag, formatDelta, lineUnit, shownTags, startDrag, summarizeList, tagNumber, wireDelta, wireState,
  wireTag, wireTags,
} from '../src/ui/wiretags';

const display = { places: null, exact: false, percent: true };
const lines = (...texts: string[]): RowInput[] => texts.map((text, k) => ({ id: `r${k + 1}`, kind: 'expr', text }));
function sheet(rows: CanvasRow[], complex = false) {
  const results = evaluateDocument(rows, cleanSettings({ deg: true, complex }));
  return { rows, results, wires: sheetWires(rows, results) };
}
const set = (rows: RowInput[], id: string, text: string) => rows.map((r) => (r.id === id ? { ...r, text } : r)) as RowInput[];

describe('tagNumber', () => {
  it('shows 4 significant figures, dropping trailing zeros', () => {
    expect(tagNumber(0.0706858)).toBe('0.07069');
    expect(tagNumber(2)).toBe('2');
    expect(tagNumber(0.3)).toBe('0.3');
    expect(tagNumber(-12.3456)).toBe('−12.35');
    expect(tagNumber(295.9)).toBe('295.9');
    expect(tagNumber(123456)).toBe('123500');
  });
  it('switches to × 10ⁿ from a million up and below 0.0001, rounding first', () => {
    expect(tagNumber(1234567)).toBe('1.235 × 10⁶');
    expect(tagNumber(999999.7)).toBe('1 × 10⁶');
    expect(tagNumber(0.0000123)).toBe('1.23 × 10⁻⁵');
    expect(tagNumber(0)).toBe('0');
    expect(tagNumber(Infinity)).toBe('∞');
    expect(tagNumber(NaN)).toBe('undefined');
  });
});

describe('summarizeList', () => {
  it('gives a range and bars from 0 to 1', () => {
    expect(summarizeList({ t: 'list', items: [9.6, 10.4, 10.1, 9.9] })).toEqual({ count: 4, min: 9.6, max: 10.4, bars: [0, 1, expect.closeTo(0.625), expect.closeTo(0.375)] });
    expect(summarizeList({ t: 'list', items: [3, 3] })?.bars).toEqual([1, 1]);
  });
  it('averages a long list into at most 24 bars, in order', () => {
    const s = summarizeList({ t: 'list', items: Array.from({ length: 240 }, (_, k) => k) })!;
    expect(s.bars).toHaveLength(24);
    expect(s.bars[0]).toBeLessThan(s.bars[23]);
  });
  it('leaves lists of anything but real numbers alone', () => {
    expect(summarizeList({ t: 'list', items: [] })).toBeNull();
    expect(summarizeList({ t: 'list', items: [{ t: 'point', c: [1, 2] }] })).toBeNull();
    expect(summarizeList(4)).toBeNull();
  });
});

describe('wireTag', () => {
  const s = sheet(lines('d = 0.3', 'A = πd^2/4', 'T = {9.6, 10.4, 10.1, 9.9}', 'm = total(T)', 'f(t) = 2t', 'f(A)', 'y = A x'));
  const tag = (from: string, to: string) => wireTag(s.wires.find((w) => w.from === from && w.to === to)!, s.rows, s.results, display);
  it('carries the line it comes from, at 4 significant figures, with its full answer for a focused tag', () => {
    expect(tag('r1', 'r2')).toMatchObject({ key: 'r1>r2', name: 'd', kind: 'number', text: '0.3', value: 0.3, unit: null });
    expect(tag('r2', 'r6')).toMatchObject({ name: 'A', kind: 'number', text: '0.07069', full: '0.07068583471' });
  });
  it('sums up a list as its range and bars', () => {
    expect(tag('r3', 'r4')).toMatchObject({ name: 'T', kind: 'list', text: '9.6–10.4', list: { count: 4, min: 9.6, max: 10.4 } });
  });
  it('shows nothing for a function or a wire into the graph', () => {
    expect(tag('r5', 'r6')).toBeNull();
    expect(tag('r7', '#graph')).toBeNull();
    expect([...wireTags(s.wires, s.rows, s.results, display).keys()].sort()).toEqual(['r1>r2', 'r2>r6', 'r2>r7', 'r3>r4']);
  });
  it('shows a dash when the line it comes from has an error', () => {
    const e = sheet(lines('a = 1/0', 'a + 1'));
    expect(wireTag(e.wires[0], e.rows, e.results, display)).toMatchObject({ kind: 'error', text: '—' });
  });
  it('reads a probability as a percent when answers do', () => {
    const p = sheet(lines('p = normalcdf(-1, 1)', 'p + 0'));
    expect(wireTag(p.wires[0], p.rows, p.results, display)).toMatchObject({ kind: 'number', text: '68.27%' });
    expect(wireTag(p.wires[0], p.rows, p.results, { ...display, percent: false })).toMatchObject({ text: '0.6827' });
  });
  it('carries the unit a convert line gives, and a table column as a list', () => {
    const u = sheet(lines('L = convert(5, "mi", "km")', '2L'));
    expect(wireTag(u.wires[0], u.rows, u.results, display)).toMatchObject({ text: '8.047', unit: 'km' });
    expect(lineUnit('5 mi to km')).toBe('km');
    expect(lineUnit('2 + 3')).toBeNull();
    const t = sheet([{ id: 't', kind: 'table', columns: [{ header: 'y1', cells: ['3', '5', ''] }] }, ...lines('mean(y1)')]);
    expect(wireTag(t.wires.find((w) => w.to === 'r1')!, t.rows, t.results, display)).toMatchObject({ name: 'y1', kind: 'list', text: '3–5' });
  });
  it('shows a point, a complex number and a matrix briefly', () => {
    const o = sheet(lines('P = (1.23456, 2)', 'P + (0, 0)', 'M = [[1, 2], [3, 4], [5, 6]]', 'M + 0', 'z = 2 + 3i', 'z + 0'), true);
    const tags = wireTags(o.wires, o.rows, o.results, display);
    expect(tags.get('r1>r2')).toMatchObject({ kind: 'other', text: '(1.235, 2)' });
    expect(tags.get('r3>r4')).toMatchObject({ kind: 'other', text: '3×2' });
    expect(tags.get('r5>r6')).toMatchObject({ kind: 'other', text: '2 + 3i' });
  });
});

describe('a slider drag', () => {
  // d → A → Q ← v, Q → m → P ← ΔT ← T: the mockup's sheet.
  const rows0 = lines('d = 0.3', 'v = 2', 'A = πd^2/4', 'Q = A v', 'm = 1000Q', 'T = {9.6, 10.4, 10.1, 9.9}', 'dT = mean(T)', 'P = m·4186·dT');
  const s0 = sheet(rows0);
  it('reaches the wires down from the slider, by pulseOrder, and dims the rest', () => {
    const d = startDrag('r1', s0.wires, s0.rows, s0.results);
    expect([...d.reach].sort()).toEqual(['r1>r3', 'r3>r4', 'r4>r5', 'r5>r8']);
    expect(Object.fromEntries(d.hops)).toEqual({ r3: 1, r4: 2, r5: 3, r8: 4 });
    expect([...d.names].sort()).toEqual(['A', 'Q', 'd', 'm']);
    expect(wireState('r1>r3', d, null)).toBe('lit');
    expect(wireState('r2>r4', d, null)).toBe('dim');
    expect(wireState('r2>r4', null, null)).toBe('plain');
    expect(wireState('r2>r4', null, 'r2>r4')).toBe('focus');
    expect(wireState('r1>r3', null, 'r2>r4')).toBe('dim');
  });
  it('shows each reached wire\'s change against the values when the drag began', () => {
    const d = startDrag('r1', s0.wires, s0.rows, s0.results);
    const s1 = sheet(set(rows0, 'r1', 'd = 0.33'));
    const tags = wireTags(s1.wires, s1.rows, s1.results, display);
    expect(wireDelta(d, tags.get('r1>r3'))).toBe('+10.0%');
    expect(wireDelta(d, tags.get('r3>r4'))).toBe('+21.0%');
    expect(wireDelta(d, tags.get('r5>r8'))).toBe('+21.0%');
    // Not reached, or a list: no change to show.
    expect(wireDelta(d, tags.get('r2>r4'))).toBeNull();
    expect(wireDelta(d, tags.get('r6>r7'))).toBeNull();
  });
  it('formats a change as a percent, or as itself from 0', () => {
    expect(formatDelta(1.5, 1)).toBe('+50.0%');
    expect(formatDelta(0.5, 1)).toBe('−50.0%');
    expect(formatDelta(5, 1)).toBe('+400%');
    expect(formatDelta(-1, 2)).toBe('−150%');
    expect(formatDelta(0.25, 0)).toBe('+0.25');
    expect(formatDelta(-3, 0)).toBe('−3');
    expect(formatDelta(1.0001, 1)).toBeNull();
    expect(formatDelta(1, 1)).toBeNull();
  });
  it('shows every tag while held and for a moment after release (lit or dim), plus the wire pointed at', () => {
    const tags = wireTags(s0.wires, s0.rows, s0.results, display);
    expect(shownTags(tags, null, null, 0).size).toBe(0);
    expect([...shownTags(tags, null, 'r2>r4', 0)]).toEqual(['r2>r4']);
    const d = startDrag('r1', s0.wires, s0.rows, s0.results);
    expect([...shownTags(tags, d, null, 0)].sort()).toEqual([...tags.keys()].sort());
    // A phone's column shows only the wires the drag runs down.
    expect([...shownTags(tags, d, null, 0, { reachedOnly: true })].sort()).toEqual([...tags.keys()].filter((k) => d.reach.has(k)).sort());
    expect(shownTags(tags, d, null, 0, { reachedOnly: true }).size).toBeLessThan(tags.size);
    const up = endDrag(d, 1000);
    expect(shownTags(tags, up, null, 1000 + DELTA_LINGER_MS - 1).size).toBe(tags.size);
    expect(dragOver(up, 1000 + DELTA_LINGER_MS)).toBe(true);
    expect(shownTags(tags, up, null, 1000 + DELTA_LINGER_MS).size).toBe(0);
  });
  it('carries on from the same slider\'s drag while its changes still show, and starts afresh after', () => {
    const d = startDrag('r1', s0.wires, s0.rows, s0.results);
    const s1 = sheet(set(rows0, 'r1', 'd = 0.4'));
    const again = startDrag('r1', s1.wires, s1.rows, s1.results, endDrag(d, 100), 600);
    expect(again.start.get('r1>r3')).toBe(0.3);
    expect(again.releasedAt).toBeNull();
    expect(startDrag('r1', s1.wires, s1.rows, s1.results, endDrag(d, 100), 100 + DELTA_LINGER_MS).start.get('r1>r3')).toBe(0.4);
    expect(startDrag('r2', s1.wires, s1.rows, s1.results, endDrag(d, 100), 600).start.get('r2>r4')).toBe(2);
  });
  it('keys each start value by the wire', () => {
    const d = startDrag('r1', s0.wires, s0.rows, s0.results);
    expect(d.start.get(wireKey({ from: 'r3', to: 'r4' }))).toBeCloseTo(Math.PI * 0.09 / 4, 12);
  });
});
