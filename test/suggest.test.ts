import { describe, it, expect } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';

const S = { deg: true, complex: false, sample: false };
const err = (lines: string[]) =>
  evaluateDocument(lines.map((text, i): RowInput => ({ id: String(i), kind: 'expr', text })), S).at(-1)!.error ?? '';

describe('did-you-mean hints', () => {
  it('suggests the closest function', () => {
    expect(err(['normcdf(1)'])).toMatch(/Did you mean normalcdf\(…\)\?/);
    expect(err(['invnrom(0.9)'])).toMatch(/Did you mean invnorm\(…\)\?|Did you mean invNorm\(…\)\?/);
    expect(err(['binompfd(10, 0.5, 3)'])).toMatch(/Did you mean binompdf\(…\)\?/);
  });
  it('suggests variables for bare names', () => {
    expect(err(['total = 5', 'totl + 1'])).toMatch(/Did you mean total\?/);
  });
  it('stays quiet when nothing is close', () => {
    expect(err(['qqqqqq(1)'])).toBe('Unknown function "qqqqqq"');
  });
});
