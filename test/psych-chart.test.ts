import { describe, expect, it } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { moistAir } from '../src/engine/hvac';
import { dragPsych, holdPsych, nudgePsych, psychColumn, psychHosts, psychScene, psychSize, psychStates, psychView, PSYCH_BLOCK, PSYCH_SIZE, unitsOf } from '../src/ui/psych';

const settings = { deg: true, complex: false, sample: false };
type Line = string | { text: string; slider: { min: number; max: number; step: number } };
function scope(lines: Line[]) {
  const rows: RowInput[] = lines.map((l, k) => ({ id: `r${k}`, kind: 'expr', ...(typeof l === 'string' ? { text: l } : l) }) as RowInput);
  return { rows, results: evaluateDocument(rows, settings), settings };
}
const COIL_C: Line[] = [{ text: 'Tdb = 26', slider: { min: 15, max: 40, step: 0.5 } }, { text: 'RH = 50', slider: { min: 10, max: 100, step: 1 } }, 'A = psych(Tdb, RH, "SI")', 'B = psych(13, 95, "SI")', 'q = A.h − B.h'];
const COIL_F: Line[] = ['A = psych(80, 50)', 'B = psych(55, 95)', 'q = A.h − B.h'];
const texts = (sc: ReturnType<typeof psychScene>) => sc.marks.flatMap((m) => (m.t === 'text' ? [m.s] : []));

describe('psychStates', () => {
  it('finds the named states in sheet order, with the engine’s numbers, a color each, and what a drag writes', () => {
    const st = psychStates(scope(COIL_C));
    expect(st.map((s) => [s.id, s.name, s.tone, s.si])).toEqual([['r2', 'A', 'coral', true], ['r3', 'B', 'teal', true]]);
    expect(st[0]).toMatchObject({ T: 26, RH: 50, Tdp: 14.78, h: 52.91, fn: 'psych', fraction: false });
    expect(st[0].refs.map((r) => r.k)).toEqual(['slider', 'slider']);
    expect(st[1].refs.map((r) => r.k)).toEqual(['text', 'text']);
    expect(psychHosts(st)).toEqual(new Map([['r2', PSYCH_BLOCK], ['r3', PSYCH_BLOCK]]));
  });
  it('leaves unnamed lines and other records alone', () => {
    expect(psychStates(scope(['psych(26, 50, "SI")', 'C = coil(1000, 80, 50, 55, 95)']))).toEqual([]);
  });
});

describe('the chart’s units follow the lines', () => {
  it('°C with g/kg and kJ/kg', () => {
    const st = psychStates(scope(COIL_C));
    const v = psychView(st);
    expect(v).toMatchObject({ si: true, t0: 0, t1: 40, w1: 0.03 });
    const t = texts(psychScene(st, PSYCH_SIZE));
    expect(t).toContain('40 °C');
    expect(t).toContain('g/kg');
    expect(t).toContain('20 kJ/kg');
    expect(t.some((s) => /°F|gr\/lb|Btu/.test(s))).toBe(false);
  });
  it('°F with grains and Btu/lb, never mixed', () => {
    const st = psychStates(scope(COIL_F));
    expect(psychView(st)).toMatchObject({ si: false, t0: 30, t1: 110 });
    const t = texts(psychScene(st, PSYCH_SIZE));
    expect(t).toContain('110 °F');
    expect(t).toContain('gr/lb');
    expect(t.some((s) => s.endsWith('Btu/lb'))).toBe(true);
    expect(t.some((s) => /°C|g\/kg|kJ/.test(s.replace('gr/lb', '')))).toBe(false);
    expect(unitsOf(false).wScale).toBe(7000);
  });
  it('grows to hold a state outside the usual range', () => {
    const v = psychView(psychStates(scope(['A = psych(46, 60, "SI")'])));
    expect(v.t1).toBeGreaterThanOrEqual(50);
    expect(v.w1 * 1000).toBeGreaterThan(psychStates(scope(['A = psych(46, 60, "SI")']))[0].W * 1000);
  });
});

describe('psychScene', () => {
  it('draws saturation, RH curves, enthalpy lines, the process line and a point per state, where the engine puts them', () => {
    const st = psychStates(scope(COIL_C));
    const sc = psychScene(st, PSYCH_SIZE);
    expect(sc.handles.map((h) => [h.id, h.draggable])).toEqual([['r2', true], ['r3', true]]);
    // A's point sits at its dry bulb and humidity ratio on the chart's axes.
    const plotW = PSYCH_SIZE.w - 10 - 50, plotH = PSYCH_SIZE.h - 14 - 30;
    expect(sc.handles[0].x).toBeCloseTo(10 + (26 / 40) * plotW, 6);
    expect(sc.handles[0].y).toBeCloseTo(14 + plotH - (st[0].W / 0.03) * plotH, 6);
    expect(texts(sc)).toEqual(expect.arrayContaining(['20%', '40%', '60%', '80%', 'A', 'B']));
    // The process line from A to B, with its arrow.
    expect(sc.marks.some((m) => m.t === 'line' && m.tone === 'ink2' && m.w === 1.8)).toBe(true);
    // Every mark inside the drawing.
    for (const m of sc.marks) if (m.t === 'line') for (const v of [m.x1, m.x2]) expect(v).toBeGreaterThanOrEqual(-1), expect(v).toBeLessThanOrEqual(PSYCH_SIZE.w + 1);
  });
  it('fits a phone’s column', () => {
    expect(psychSize(358)).toEqual({ w: 358, h: 286 });
    expect(psychSize()).toEqual(PSYCH_SIZE);
  });
});

describe('dragging a state', () => {
  it('moves the sliders it reads, at their steps and inside their ranges', () => {
    const st = psychStates(scope(COIL_C));
    const sc = psychScene(st, PSYCH_SIZE), hold = holdPsych(st, sc);
    const plotW = PSYCH_SIZE.w - 60, plotH = PSYCH_SIZE.h - 44;
    // To 30 °C at 12 g/kg.
    const p = { x: 10 + (30 / 40) * plotW, y: 14 + plotH - (0.012 / 0.03) * plotH };
    const e = dragPsych(st[0], PSYCH_SIZE, hold, p);
    const rh = Math.round(moistAir.rh(30, 0.012, st[0].p, true) * 100);
    expect(e).toEqual([{ kind: 'slider', id: 'r0', text: 'Tdb = 30' }, { kind: 'slider', id: 'r1', text: `RH = ${rh}` }]);
  });
  it('rewrites the numbers typed in the line, and stops at saturation', () => {
    const st = psychStates(scope(COIL_C));
    const sc = psychScene(st, PSYCH_SIZE), hold = holdPsych(st, sc);
    const e = dragPsych(st[1], PSYCH_SIZE, hold, { x: 10 + (20 / 40) * (PSYCH_SIZE.w - 60), y: 20 });
    expect(e).toEqual([{ kind: 'line', text: 'B = psych(20, 100, "SI")' }]);
  });
  it('writes a wet bulb, dew point or enthalpy for the calls that take one', () => {
    const st = psychStates(scope(['A = psychdp(24, 12, "SI")', 'B = psychh(70, 30)']));
    const sc = psychScene([st[0]], PSYCH_SIZE), hold = holdPsych([st[0]], sc);
    // Across at the same humidity ratio: the dew point stays.
    const [e] = dragPsych(st[0], PSYCH_SIZE, hold, { x: 10 + (30 / 40) * (PSYCH_SIZE.w - 60), y: sc.handles[0].y });
    expect(e).toEqual({ kind: 'line', text: 'A = psychdp(30, 12, "SI")' });
    expect(nudgePsych(st[1], null, 'up')).toEqual([{ kind: 'line', text: 'B = psychh(70, 30.5)' }]);
  });
  it('nudges with the keys: across the dry bulb, up and down the humidity', () => {
    const st = psychStates(scope(COIL_C));
    expect(nudgePsych(st[1], null, 'right')).toEqual([{ kind: 'line', text: 'B = psych(13.5, 95, "SI")' }]);
    expect(nudgePsych(st[1], null, 'down', true)).toEqual([{ kind: 'line', text: 'B = psych(13, 85, "SI")' }]);
    expect(nudgePsych(st[0], null, 'up')).toEqual([{ kind: 'slider', id: 'r1', text: 'RH = 51' }]);
  });
});

describe('psychColumn', () => {
  it('puts the chart where its first state goes, with every state after it', () => {
    expect(psychColumn(['t', 'r', 'a', 'q', 'b', 'z'], ['a', 'b'])).toEqual(['t', 'r', PSYCH_BLOCK, 'a', 'b', 'q', 'z']);
    expect(psychColumn(['t', 'q'], [])).toEqual(['t', 'q']);
  });
});
