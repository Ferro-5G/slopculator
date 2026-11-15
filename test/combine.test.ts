import { describe, it, expect } from 'vitest';
import { combineTarget, planCombine, type CombineLine } from '../src/ui/combine';
import { isBlankSheet } from '../src/ui/document';
import { evaluateDocument, type RowInput } from '../src/engine/document';

const S = { deg: true, complex: false, sample: false };
const line = (index: number, text: string, extra: Partial<CombineLine> = {}): CombineLine => ({ id: String(index), index, kind: 'expr', text, value: 1, ...extra });
const docOf = (lines: string[], lineNames = false) => evaluateDocument(lines.map((text, i): RowInput => ({ id: String(i), kind: 'expr', text })), { ...S, lineNames });

describe('combineTarget', () => {
  const rows = (...texts: string[]) => texts.map((text, i): RowInput => ({ id: String(i), kind: 'expr', text }));
  it('prefers the active line when it is empty', () => {
    expect(combineTarget(rows('1', ' ', '2', ''), '1')?.id).toBe('1');
  });
  it('falls back to an empty last line', () => {
    expect(combineTarget(rows('1', '2', ''), '0')?.id).toBe('2');
    expect(combineTarget(rows('1', ''), null)?.id).toBe('1');
  });
  it('has no target when neither is empty', () => {
    expect(combineTarget(rows('', '1', '2'), '1')).toBeUndefined();
  });
});

describe('isBlankSheet', () => {
  it('is one empty line and nothing else', () => {
    expect(isBlankSheet([{ id: 'a', kind: 'expr', text: '  ' }])).toBe(true);
    expect(isBlankSheet([{ id: 'a', kind: 'expr', text: '1' }])).toBe(false);
    expect(isBlankSheet([{ id: 'a', kind: 'expr', text: '' }, { id: 'b', kind: 'expr', text: '' }])).toBe(false);
  });
});

describe('planCombine', () => {
  it('uses letters and variable names when lines have them', () => {
    const p = planCombine([line(0, '1+1', { lineName: 'A' }), line(1, 'a = 3', { defines: 'a', lineName: 'B' }), line(2, '5*5', { lineName: 'C' })], '+');
    expect(p.text).toBe('A + a + C');
    expect(p.note).toBe('');
  });
  it('wraps unnamed expressions so the operator applies to the whole line', () => {
    expect(planCombine([line(0, '1+1'), line(1, '7')], '*').text).toBe('(1+1) * 7');
  });
  it('leaves out empty lines with a note', () => {
    const p = planCombine([line(0, '2'), line(1, '', { value: undefined }), line(2, '3'), line(3, '  ', { value: undefined })], '+');
    expect(p.text).toBe('2 + 3');
    expect(p.empty).toEqual(['2', '4']);
    expect(p.note).toBe('Left out empty lines 2, 4.');
  });
  it('notes one empty line in the singular', () => {
    expect(planCombine([line(0, '2'), line(1, '', { value: undefined }), line(2, '3')], '+').note).toBe('Left out empty line 2.');
  });
  it('names lines the way the gutter does', () => {
    const p = planCombine([line(0, '2', { lineName: 'A', label: 'A' }), line(1, '', { value: undefined, label: 'B' }), line(2, 'y = x', { value: undefined, label: 'C' }), line(3, '3', { lineName: 'D', label: 'D' })], '+');
    expect(p.note).toBe('Left out empty line B and line C, with no single number.');
  });
  it('does not mention the line that will hold the result', () => {
    const p = planCombine([line(0, '2'), line(1, '3'), line(2, '', { value: undefined })], '+', '2');
    expect(p.note).toBe('');
    expect(p.text).toBe('2 + 3');
  });
  it('leaves out lines with no single number, and says so', () => {
    const p = planCombine([line(0, '2'), line(1, 'y = x', { value: undefined }), line(2, 'oops', { error: 'bad', value: undefined }), line(3, '3')], '+');
    expect(p.text).toBe('2 + 3');
    expect(p.note).toBe('Left out lines 2, 3, with no single number.');
  });
  it('skips headings and tables without a note', () => {
    const p = planCombine([line(0, '2'), line(1, '# Part 2', { heading: 'Part 2', value: undefined }), line(2, '', { kind: 'table', value: undefined }), line(3, '3')], '+');
    expect(p.text).toBe('2 + 3');
    expect(p.note).toBe('');
  });
  it('needs at least two numbers', () => {
    expect(planCombine([line(0, '2'), line(1, '', { value: undefined })], '+').text).toBe('');
  });
  it('produces expressions the engine evaluates correctly, in order', () => {
    for (const [op, expected] of [['+', 15], ['-', 5], ['*', 50], ['/', 2]] as const) {
      const rows = ['10', '5'];
      const results = docOf(rows, true);
      const plan = planCombine(rows.map((text, i) => ({ id: String(i), index: i, kind: 'expr' as const, text, value: results[i].value, lineName: results[i].lineName, defines: results[i].defines })), op);
      expect(docOf([...rows, plan.text], true).at(-1)!.value).toBe(expected);
    }
  });
});

describe('referring to lines', () => {
  it('says a line is empty instead of unknown', () => {
    const r = docOf(['B + 1', ''], true);
    expect(r[0].error).toBe('Line B is empty');
  });
  it('a line never suggests itself', () => {
    const r = docOf(['B + 1', '5'], true);
    expect(r[0].value).toBe(6);
    const self = docOf(['C + 1'], true);
    expect(self[0].error).not.toMatch(/Did you mean A/);
  });
  it('one-letter names get no guess', () => {
    expect(docOf(['2', 'q + 1'], true)[1].error).not.toMatch(/Did you mean/);
  });
});
