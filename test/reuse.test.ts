// Reuse that must never go stale: curves while their line means the same thing (above all when it reaches ans),
// and the ASCII fast paths agreeing with the general code. Written for #10; test/caches.test.ts covers #12's side.
import { describe, it, expect } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { tokenize } from '../src/engine/lexer';
import { tidy } from '../src/engine/values';

const DEG = { deg: true, complex: false, sample: false };
const RAD = { ...DEG, deg: false };
const rows = (lines: string[]): RowInput[] => lines.map((text, i) => ({ id: `r${i}`, kind: 'expr', text }));
const curve = (lines: string[], i: number, s = DEG) => evaluateDocument(rows(lines), s)[i].graph[0] as { f: (...a: number[]) => number };

describe('curves are reused only while their line means the same thing', () => {
  it('keeps the same curve when another line is edited', () => {
    const a = curve(['a = 2', 'y = a x^2', 'x^2 + y^2 = 25', '1 + 1'], 2);
    const b = curve(['a = 2', 'y = a x^2', 'x^2 + y^2 = 25', '1 + 2'], 2);
    expect(b).toBe(a);
  });

  it('makes a new curve when a variable it uses changes', () => {
    const a = curve(['a = 2', 'y = a x^2'], 1);
    const b = curve(['a = 3', 'y = a x^2'], 1);
    expect(b).not.toBe(a);
    expect(a.f(2)).toBe(8);
    expect(b.f(2)).toBe(12);
  });

  it('follows variables and functions all the way down', () => {
    const lines = (k: string) => ['k = ' + k, 'g(t) = k t', 'h(t) = g(t) + 1', 'y = h(x)'];
    expect(curve(lines('2'), 3).f(5)).toBe(11);
    expect(curve(lines('3'), 3).f(5)).toBe(16);
  });

  it('makes a new curve when the angle mode changes', () => {
    expect(curve(['y = sin(x)'], 0, DEG).f(90)).toBe(1);
    expect(curve(['y = sin(x)'], 0, RAD).f(90)).toBeCloseTo(Math.sin(90), 14);
  });

  it('follows ans through a variable defined below the graph', () => {
    // The graph is fingerprinted before line 2 has a value; that early view of ans must not be kept.
    const lines = (v: string) => ['y = a x', v, 'a = ans'];
    const first = evaluateDocument(rows(lines('2')), DEG);
    const second = evaluateDocument(rows(lines('3')), DEG);
    expect((first[0].graph[0] as { f: (x: number) => number }).f(1)).toBe(2);
    expect((second[0].graph[0] as { f: (x: number) => number }).f(1)).toBe(3);
    expect(second[2].value).toBe(3);
  });

  it('notices ans even when a function name like tan reaches it by letter splitting', () => {
    // tan could split into t·a·n, which reaches a = ans while ans is still being worked out.
    const lines = (one: string, b: string) => ['y = a x + exp(0.5)', one, 'a = ans + 1', b, 'x^2 + y^2 = a + 3'];
    const f = (one: string, b: string) => (evaluateDocument(rows(lines(one, b)), RAD)[4].graph[0] as { f: (x: number, y: number) => number }).f(0, 0);
    expect(f('tan(1e3)', 'b = 2')).toBeCloseTo(-(Math.tan(1000) + 1) - 3, 9);
    expect(f('b*π', 'b = 2')).toBeCloseTo(-(2 * Math.PI + 1) - 3, 9);
  });

  it('follows ans to the line above', () => {
    expect(curve(['2', 'y = ans x'], 1).f(3)).toBe(6);
    expect(curve(['5', 'y = ans x'], 1).f(3)).toBe(15);
  });
});

describe('parsed lines and warnings are reused by text', () => {
  it('gives the same answer and the same error every time', () => {
    for (let k = 0; k < 3; k++) {
      const [ok, bad] = evaluateDocument(rows(['2 + 3', '(1 + 2']), DEG);
      expect(ok.value).toBe(5);
      expect(bad.error).toMatch(/Expected "\)"/);
    }
  });

  it('keeps warnings per angle mode', () => {
    const deg = evaluateDocument(rows(['sin(pi/6)']), DEG)[0].warnings ?? [];
    const rad = evaluateDocument(rows(['sin(pi/6)']), RAD)[0].warnings ?? [];
    expect(deg.length).toBeGreaterThan(0);
    expect(rad.length).toBe(0);
  });

  it('still reports an error from a variable on every sample of a graph', () => {
    const f = curve(['a = foo', 'y = a x'], 1);
    expect(Number.isNaN(f.f(1))).toBe(true);
    expect(Number.isNaN(f.f(2))).toBe(true);
  });
});

describe('fast paths match the general code', () => {
  it('lexes non-ASCII names, Greek, superscripts, and Unicode spaces as before', () => {
    const t = (s: string) => tokenize(s).map((k) => `${k.type}:${k.value}`).join(' ');
    expect(t('2πr')).toBe('num:2 ident:π ident:r eof:');
    expect(t('x²+μσ')).toBe('ident:x op:^ num:2 op:+ ident:μ ident:σ eof:');
    expect(t('été + 1')).toBe('ident:été op:+ num:1 eof:');
    expect(t('a_1 + Ω_b')).toBe('ident:a_1 op:+ ident:Ω_b eof:');
  });

  it('tidies whole numbers without changing them, and big ones as before', () => {
    expect(tidy(9999999999999)).toBe(9999999999999);
    expect(tidy(-42)).toBe(-42);
    expect(tidy(2 ** 53 + 2)).toBe(9007199254741000);
    expect(tidy(0.1 + 0.2)).toBe(0.3);
  });

  it('divides and raises plain numbers with the same errors as before', () => {
    const errs = evaluateDocument(rows(['1/0', '0^-1', '(-8)^0.5', '(-8)^(1/3)']), DEG);
    expect(errs[0].error).toMatch(/Division by zero/);
    expect(errs[1].error).toMatch(/Division by zero/);
    expect(errs[2].error).toMatch(/not a real number/);
    expect(errs[3].value).toBeCloseTo(-2, 14);
  });
});
