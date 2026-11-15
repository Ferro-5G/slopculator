// State the engine keeps while it evaluates a sheet (signatures, cached variables, notes, budgets)
// must never change an answer. Each case is from an audit of those states.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluateDocument, type RowInput, type GraphItem } from '../src/engine/document';
import type { Settings } from '../src/engine/evaluator';

const DEG: Settings = { deg: true, complex: false, sample: false };
const rows = (lines: string[]): RowInput[] => lines.map((text, i) => ({ id: String(i), kind: 'expr', text }));
const run = (lines: string[], s: Settings = DEG) => evaluateDocument(rows(lines), s);
const fOf = (g: GraphItem) => (g as { f: (x: number) => number }).f;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mutually recursive functions', () => {
  it('rebuild every graph in the cycle when one body changes', () => {
    const g = 'g(x) = {x < 1: 5, f(x-1)*2}';
    const first = run(['f(x) = {x < 1: 0, g(x-1)+1}', g, 'y = g(x)']);
    const second = run(['f(x) = {x < 1: 1, g(x-1)+1}', g, 'y = g(x)']);
    // g(1) = 2·f(0): 0 before, 2 after.
    expect(fOf(first[1].graph[0])(1)).toBe(0);
    expect(fOf(second[1].graph[0])(1)).toBe(2);
    expect(fOf(second[2].graph[0])(1)).toBe(2);
    expect(fOf(second[1].graph[0])).not.toBe(fOf(first[1].graph[0]));
    expect(fOf(second[2].graph[0])).not.toBe(fOf(first[2].graph[0]));
  });

  it('still reuse graphs when nothing in the cycle changed', () => {
    const sheet = ['f(x) = {x < 1: 0, g(x-1)+1}', 'g(x) = {x < 1: 5, f(x-1)*2}', 'y = g(x)', '1'];
    const first = run(sheet);
    const second = run([...sheet.slice(0, -1), '2']);
    for (const k of [0, 1, 2]) expect(fOf(second[k].graph[0])).toBe(fOf(first[k].graph[0]));
  });
});

describe('ans in a definition', () => {
  it('means the line above the definition, even when an earlier line asks for it first', () => {
    for (const exact of [true, false]) {
      // A decimal literal keeps the exact path on rationals; 10.5 also checks the float path alone.
      const ten = exact ? '10' : '10.5';
      const r = run(['5', 'b*2', ten, 'b = ans + 1']);
      const b = exact ? 11 : 11.5;
      expect(r[3].value).toBe(b);
      expect(r[1].value).toBe(b * 2);
      expect(r[2].value).toBe(Number(ten));
    }
  });

  it('gives exact values from the right row', () => {
    const r = run(['5', 'b*3', '1/3', 'b = ans + 1']);
    expect(r[3].precise).toBeDefined();
    expect(r[3].value).toBe(4 / 3);
    expect(r[1].value).toBe(4);
  });

  it('is an error when it reaches the line that asked for it', () => {
    const r = run(['5', 'b*2', '', 'b = ans + 1']);
    expect(r[1].error).toMatch(/ans/);
    expect(r[3].value).toBe(6);
  });
});

describe('line letters and built-in functions', () => {
  const L: Settings = { ...DEG, lineNames: true };

  it('read a letter followed by ( as the built-in', () => {
    const r = run(['1', '2', '3', 'C(5, 2)', 'C(5)'], L);
    expect(r[3].value).toBe(10);
    expect(r[4].error).toMatch(/takes 2 inputs/);
  });

  it('keep letters usable as values', () => {
    const r = run(['1', '2', '3', 'C + 1', '2C', 'A(B + 1)'], L);
    expect(r[3].value).toBe(4);
    expect(r[4].value).toBe(6);
    expect(r[5].value).toBe(3);
  });
});

describe('notes on definitions', () => {
  it('show on the definition, and not on lines that only use it', () => {
    const r = run(['L = {1, 2, 3}', 's = sd(L)', 't = asin(0.5)', 's + t']);
    expect(r[1].notes).toContain('Population SD (÷ n)');
    expect(r[2].notes.some((n) => /asin gives angles/.test(n))).toBe(true);
    expect(r[3].notes).toEqual([]);
  });

  it('show on the definition when an earlier line computed it first', () => {
    const r = run(['s + 1', 's = sd({1, 2, 3})']);
    expect(r[0].notes).toEqual([]);
    expect(r[1].notes).toContain('Population SD (÷ n)');
  });
});

describe('budgets', () => {
  const slow = 'f(n) = {n < 1: 1, f(n-1) + f(n-1)}';

  it('report a definition that runs out of time as a timeout, not a missing solution', () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 50));
    const r = run([slow, 'k = f(40)', 'solve(x + k = 0, x)']);
    expect(r[2].error).toMatch(/more than 2 seconds/);
    expect(r[1].error).toMatch(/more than 2 seconds/);
  });

  it('work out line letters and table columns before anything is drawn', () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 50));
    const table: RowInput = { id: 't', kind: 'table', columns: [{ header: 'n', cells: ['f(40)'] }] };
    const r = evaluateDocument([...rows([slow, 'f(40)', 'y = B x + sum(n) x']), table], { ...DEG, lineNames: true });
    expect(r[1].error).toMatch(/more than 2 seconds/);
    // Drawing finds nothing left to compute, so a sample returns at once instead of running f(40) unbounded.
    const before = now;
    expect(fOf(r[2].graph[0])(1)).toBeNaN();
    expect(now - before).toBeLessThan(1000);
  });

  it('give a graph a budget while it is drawn', () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 50));
    const r = run([slow, 'y = f(x)']);
    const f = fOf(r[1].graph[0]);
    expect(f(3)).toBe(8);
    // f(60) would never finish; it runs out of time and leaves a gap.
    expect(f(60)).toBeNaN();
  });
});

