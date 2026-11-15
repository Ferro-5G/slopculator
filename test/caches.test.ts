// The caches that keep a keystroke cheap must never change an answer.
import { describe, it, expect } from 'vitest';
import { evaluateDocument, sameGraphItem, type RowInput, type GraphItem } from '../src/engine/document';
import { lineWarnings } from '../src/engine/diagnostics';
import { tidy } from '../src/engine/values';
import { Lru } from '../src/engine/memo';
import type { Settings } from '../src/engine/evaluator';

const DEG: Settings = { deg: true, complex: false, sample: false };
const RAD: Settings = { deg: false, complex: false, sample: false };

const rows = (lines: string[]): RowInput[] => lines.map((text, i) => ({ id: String(i), kind: 'expr', text }));
const fOf = (g: GraphItem) => (g as { f: unknown }).f;

describe('graph functions are reused while nothing they depend on changes', () => {
  const sheet = ['a = 2', 'f(x) = x^2 + a', 'y = a sin(x)', 'x^2 + y^2 = 25', 'y > f(x)', 'f(x) - 1', '3 + 4'];

  it('keeps the same function objects when another line changes', () => {
    const first = evaluateDocument(rows(sheet), DEG);
    const second = evaluateDocument(rows([...sheet.slice(0, -1), '3 + 5']), DEG);
    for (const k of [1, 2, 3, 4, 5]) {
      expect(first[k].graph.length).toBe(1);
      expect(fOf(second[k].graph[0])).toBe(fOf(first[k].graph[0]));
    }
  });

  it('builds new ones when a definition they reach changes', () => {
    const first = evaluateDocument(rows(sheet), DEG);
    const second = evaluateDocument(rows(['a = 3', ...sheet.slice(1)]), DEG);
    for (const k of [1, 2, 4, 5]) expect(fOf(second[k].graph[0])).not.toBe(fOf(first[k].graph[0]));
    // The circle doesn't use a.
    expect(fOf(second[3].graph[0])).toBe(fOf(first[3].graph[0]));
    expect((second[2].graph[0] as { f: (x: number) => number }).f(90)).toBe(3);
  });

  it('builds new ones when the angle mode changes', () => {
    const deg = evaluateDocument(rows(['y = sin(x)']), DEG)[0].graph[0] as { f: (x: number) => number };
    const rad = evaluateDocument(rows(['y = sin(x)']), RAD)[0].graph[0] as { f: (x: number) => number };
    expect(rad.f).not.toBe(deg.f);
    expect(deg.f(90)).toBe(1);
    expect(rad.f(Math.PI / 2)).toBe(1);
  });

  it('follows functions defined later in the sheet and letter splitting', () => {
    const a = evaluateDocument(rows(['y = g(x)', 'g(x) = 2x']), DEG);
    const b = evaluateDocument(rows(['y = g(x)', 'g(x) = 3x']), DEG);
    expect((b[0].graph[0] as { f: (x: number) => number }).f(1)).toBe(3);
    expect(fOf(b[0].graph[0])).not.toBe(fOf(a[0].graph[0]));
    const c = evaluateDocument(rows(['y = kx', 'k = 2']), DEG);
    const d = evaluateDocument(rows(['y = kx', 'k = 5']), DEG);
    expect((d[0].graph[0] as { f: (x: number) => number }).f(1)).toBe(5);
    expect(fOf(d[0].graph[0])).not.toBe(fOf(c[0].graph[0]));
  });

  it('waits for the rows an ans on a later line depends on', () => {
    // Row 0 asks about a before row 1 has run, so a's ans can't be known yet.
    evaluateDocument(rows(['y = a x', '2', 'a = ans']), DEG);
    const r = evaluateDocument(rows(['y = a x', '3', 'a = ans']), DEG);
    expect((r[0].graph[0] as { f: (x: number) => number }).f(1)).toBe(3);
    expect(r[2].value).toBe(3);
  });

  it('compares items by function or by data', () => {
    const f = (x: number) => x;
    expect(sameGraphItem({ type: 'fx', f }, { type: 'fx', f })).toBe(true);
    expect(sameGraphItem({ type: 'fx', f }, { type: 'fx', f, ineq: '<' })).toBe(false);
    expect(sameGraphItem({ type: 'fx', f }, { type: 'fx', f: (x: number) => x })).toBe(false);
    expect(sameGraphItem({ type: 'points', pts: [[1, 2]] }, { type: 'points', pts: [[1, 2]] })).toBe(true);
    expect(sameGraphItem({ type: 'points', pts: [[1, 2]] }, { type: 'points', pts: [[1, 3]] })).toBe(false);
    expect(sameGraphItem({ type: 'normal', mu: 0, sigma: 1, shade: [0, 1] }, { type: 'normal', mu: 0, sigma: 1, shade: [0, 2] })).toBe(false);
  });
});

describe('graph sampling', () => {
  it('turns errors into gaps without losing values computed on the way', () => {
    const [ln] = evaluateDocument(rows(['y = ln(x)']), DEG);
    const f = (ln.graph[0] as { f: (x: number) => number }).f;
    expect(f(-1)).toBeNaN();
    expect(f(Math.E)).toBe(1);
    // A is first computed inside the graph. 200! overflows a double, and exact math still has to rescue it there.
    const r = evaluateDocument(rows(['200!/199!', 'y = A x']), { ...DEG, lineNames: true });
    expect((r[1].graph[0] as { f: (x: number) => number }).f(1)).toBe(200);
  });

  it('still reports full error messages outside graphs', () => {
    expect(evaluateDocument(rows(['ln(-2)']), DEG)[0].error).toBe('ln is only defined for positive numbers, got -2');
    expect(evaluateDocument(rows(['(-8)^0.5']), DEG)[0].error).toBe('-8^0.5 is not a real number');
  });
});

describe('warnings are cached by text', () => {
  it('keeps warnings apart by angle mode', () => {
    expect(lineWarnings('sin(π/2)', DEG)).toHaveLength(1);
    expect(lineWarnings('sin(π/2)', RAD)).toHaveLength(0);
    expect(lineWarnings('sin(π/2)', DEG)).toHaveLength(1);
  });
});

describe('tidy', () => {
  // The original: try 1 to 13 significant digits and take the first within a few ulps.
  function reference(x: number, snap: boolean): number {
    if (!Number.isFinite(x) || x === 0) return x;
    if (snap && Math.abs(x) < 1e-14) return 0;
    const tol = Math.abs(x) * Number.EPSILON * 4;
    for (let p = 1; p <= 13; p++) {
      const r = Number(x.toPrecision(p));
      if (Math.abs(r - x) <= tol) return r;
    }
    return x;
  }

  it('matches the digit-by-digit search', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer);
    const nudge = (x: number, k: number) => {
      f64[0] = x;
      u64[0] = BigInt.asUintN(64, u64[0] + BigInt(k));
      return f64[0];
    };
    const xs = [0.1 + 0.2, 1 / 3, 2 ** 53, 1e13, 1e13 + 1, 123456789012.5, -0.30000000000000004, 1e-14, 5e-15, Infinity, NaN, -0];
    for (let i = 0; i < 1000; i++) {
      const digits = 1 + Math.floor(rnd() * 15);
      const x = Number(`${Math.floor(rnd() * 10 ** digits)}e${Math.floor(rnd() * 40) - 20}`);
      for (let k = -3; k <= 3; k++) xs.push(nudge(x, k), -nudge(x, k));
      xs.push(rnd() * 10 ** (Math.floor(rnd() * 30) - 15), nudge(2 ** (Math.floor(rnd() * 100) - 50), Math.floor(rnd() * 7) - 3));
    }
    expect(xs.filter((x) => !Object.is(tidy(x), reference(x, false)))).toEqual([]);
    // With inputs of size 1 or more, it still snaps exactly what the fixed 1e-14 did.
    expect(xs.filter((x) => !Object.is(tidy(x, 1), reference(x, true)))).toEqual([]);
    expect(xs.filter((x) => !Object.is(tidy(x, 1e6), reference(x, true)))).toEqual([]);
  });
});

describe('Lru', () => {
  it('keeps entries in use and forgets the rest', () => {
    const c = new Lru<number, number>(4);
    c.set(1, 1);
    for (let k = 2; k < 40; k++) {
      c.set(k, k);
      expect(c.get(1)).toBe(1);
    }
    expect(c.get(2)).toBeUndefined();
    expect(c.get(39)).toBe(39);
  });
});
