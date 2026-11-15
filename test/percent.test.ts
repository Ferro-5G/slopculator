// Adding a percent: a document setting, on by default as the iPhone Calculator works (80 + 15% = 92), off as plain
// ÷ 100 (80 + 15% = 80.15).
import { describe, it, expect } from 'vitest';
import { cleanSettings, evaluateDocument, type RowInput, type RowResult } from '../src/engine/document';
import { plainValue, type DisplayOpts } from '../src/engine/format';
import type { Settings } from '../src/engine/evaluator';

const ON: Settings = { deg: true, complex: false, sample: false };
const OFF: Settings = { ...ON, percentOf: false };
const AUTO: DisplayOpts = { places: null, exact: false, percent: false };
const EXACT: DisplayOpts = { ...AUTO, exact: true };

const rows = (lines: string[]): RowInput[] => lines.map((text, i) => ({ id: String(i), kind: 'expr', text }));
function last(lines: string | string[], s: Settings): RowResult {
  const r = evaluateDocument(rows(Array.isArray(lines) ? lines : [lines]), s).at(-1)!;
  if (r.error) throw new Error(`${lines}: ${r.error}`);
  return r;
}
const shows = (t: string | string[], s: Settings, o: DisplayOpts = AUTO) => { const r = last(t, s); return plainValue(r.value!, o, r.prob, r.precise); };

describe('adding a percent, on (the default)', () => {
  it('takes b% of a, exactly in floats', () => {
    expect(last('80 + 15%', ON).value).toBe(92);
    expect(last('80 - 15%', ON).value).toBe(68);
    expect(last('80 + 15%', { ...ON, percentOf: true }).value).toBe(92);
  });
  it('chains left to right', () => {
    expect(shows('80 + 15% + 10%', ON)).toBe('101.2');
    expect(shows('2*3 + 15%', ON)).toBe('6.9');
    expect(shows('200 - 10% - 10%', ON)).toBe('162');
  });
  // Units live in convert(), which gives a plain number, so a converted length takes its percent like any other.
  it('works through conversions, lists, vectors and variables', () => {
    expect(last('convert(5, "m", "cm") + 10%', ON).value).toBeCloseTo(550, 9);
    expect(shows('[2, 4] + 50%', ON)).toBe('<3, 6>');
    expect(shows('{10, 20} + 50%', ON)).toBe('{15, 30}');
    expect(shows(['p = 15', '80 + p%'], ON)).toBe('92');
  });
  it('leaves ×, ÷, a bare percent, function arguments and non-bare percents alone', () => {
    expect(last('80 * 15%', ON).value).toBe(12);
    expect(last('80 / 20%', ON).value).toBe(400);
    expect(last('15%', ON).value).toBe(0.15);
    expect(last('round(15%, 2)', ON).value).toBe(0.15);
    expect(shows(['f(x) = x', '80 + f(15%)'], ON)).toBe('80.15');
    expect(shows('80 + 2*15%', ON)).toBe('80.3');
  });
  it('gives 92 exactly in exact mode', () => {
    expect(shows('80 + 15%', ON, EXACT)).toBe('92');
    expect(shows('1/3 + 50%', ON, EXACT)).toBe('1/2');
    expect(shows('1/3 + 50%', OFF, EXACT)).toBe('5/6');
  });
  it('says so in the line note', () => {
    expect(last('80 + 15%', ON).notes).toContain('15% of 80 added');
    expect(last('80 - 15%', ON).notes).toContain('15% of 80 taken off');
    expect(last('80 + 15%', OFF).notes).toEqual([]);
    expect(last('80 * 15%', ON).notes).toEqual([]);
  });
  it('plots y = x + 10% as 1.1x', () => {
    const g = last('y = x + 10%', ON).graph[0] as { type: 'fx'; f: (x: number) => number };
    expect(g.f(10)).toBeCloseTo(11, 12);
    const off = last('y = x + 10%', OFF).graph[0] as { type: 'fx'; f: (x: number) => number };
    expect(off.f(10)).toBeCloseTo(10.1, 12);
  });
});

describe('adding a percent, off', () => {
  it('divides by 100 everywhere, as before', () => {
    expect(last('80 + 15%', OFF).value).toBe(80.15);
    expect(last('80 - 15%', OFF).value).toBe(79.85);
    expect(shows('80 + 15% + 10%', OFF)).toBe('80.25');
    expect(shows('{10, 20} + 50%', OFF)).toBe('{10.5, 20.5}');
    expect(last('80 * 15%', OFF).value).toBe(12);
    expect(last('15%', OFF).value).toBe(0.15);
  });
});

describe('flipping it recomputes', () => {
  it('a line and its graph change with the setting, back and forth', () => {
    const lines = ['80 + 15%', 'y = x + 10%'];
    for (const s of [ON, OFF, ON, OFF]) {
      const [a, b] = evaluateDocument(rows(lines), s);
      expect(a.value).toBe(s.percentOf === false ? 80.15 : 92);
      expect((b.graph[0] as { f: (x: number) => number }).f(100)).toBeCloseTo(s.percentOf === false ? 100.1 : 110, 9);
    }
  });
  it('the exact value changes too', () => {
    for (const s of [ON, OFF, ON]) expect(shows('80 + 15%', s, EXACT)).toBe(s.percentOf === false ? '1603/20' : '92');
  });
});

describe('saved documents', () => {
  it('load as on when they never had the setting, and keep it when they did', () => {
    expect(cleanSettings({ deg: false, complex: false, sample: true }).percentOf).toBe(true);
    expect(cleanSettings(undefined).percentOf).toBe(true);
    expect(cleanSettings({ percentOf: 'no' }).percentOf).toBe(true);
    expect(cleanSettings({ percentOf: false })).toEqual({ deg: true, complex: false, sample: false, lineNames: false, percentOf: false, working: true });
    expect(cleanSettings({ deg: false, lineNames: true, percentOf: true })).toEqual({ deg: false, complex: false, sample: false, lineNames: true, percentOf: true, working: true });
  });
});
