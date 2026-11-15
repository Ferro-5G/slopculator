import { describe, it, expect } from 'vitest';
import { evaluateDocument, lineName, type RowInput } from '../src/engine/document';
import type { Settings } from '../src/engine/evaluator';

const S: Settings = { deg: true, complex: false, sample: false, lineNames: true };
const run = (lines: string[], s: Settings = S) =>
  evaluateDocument(lines.map((text, i): RowInput => ({ id: String(i), kind: 'expr', text })), s);

describe('line letters', () => {
  it('names lines A, B, … Z, AA', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(lineName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
  it('each line answers to its letter', () => {
    const r = run(['328 - 400', '406 - 400', 'A/50', 'B/50', 'normalcdf(C, D)']);
    expect(r[2].value).toBe(-1.44);
    expect(r[3].value).toBe(0.12);
    expect(r[4].value as number).toBeCloseTo(0.4728247264, 9);
    expect(r.map((x) => x.lineName)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('names you write win over letters', () => {
    const r = run(['B = 10', '5', 'B + 1']);
    expect(r[2].value).toBe(11); // B is the user's B, not line 2
    expect(r[1].lineName).toBeUndefined();
    expect(r[0].lineName).toBe('A');
    expect(run(['B = 10', 'A * 2'])[1].value).toBe(20); // line A is "B = 10"
  });
  it('off by default, and graphs and functions get no letter', () => {
    expect(run(['5', 'A + 1'], { ...S, lineNames: false })[1].error).toMatch(/Unknown name "A"/);
    const r = run(['y = x^2', 'f(x) = 2x', '3']);
    expect(r[0].lineName).toBeUndefined();
    expect(r[1].lineName).toBeUndefined();
    expect(r[2].lineName).toBe('C');
  });
  it('self reference is an error, not a hang', () => {
    expect(run(['A + 1'])[0].error).toMatch(/itself/);
  });
});
