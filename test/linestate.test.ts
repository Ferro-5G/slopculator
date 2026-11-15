// The rule for how a line behaves while it's being typed, which the web and the phones share.
import { describe, expect, it } from 'vitest';
import { evaluateDocument, type RowResult } from '../src/engine/document';
import { ENDS_EARLY } from '../src/engine/errors';
import type { DisplayOpts } from '../src/engine/format';
import { isLongAnswer } from '../src/ui/answerlayout';
import { copyableValue, lineLabel, typingState } from '../src/ui/linestate';

const at = (n: number) => ({ start: n, end: n });

describe('typingState', () => {
  it('names the inputs still to come, and counts the line as unfinished', () => {
    const t = 'binompdf(';
    const s = typingState(t, ENDS_EARLY, at(t.length), false);
    expect(s.hints?.[0].text).toBe('n, p, k');
    expect(s.pending).toBe(true);
    expect(s.calm).toBe(true);
    expect(s.unfinished).toBe(true);
  });
  it('treats a line with no caret yet as having one at its end', () => {
    expect(typingState('binompdf(', undefined, undefined, false).hints?.[0].text).toBe('n, p, k');
    expect(typingState('binompdf(', undefined, undefined, false).unfinished).toBe(false);
  });
  it('measures no slots while text is selected, though a blank input still keeps the line calm', () => {
    const s = typingState('binompdf(10, , 3)', undefined, { start: 9, end: 11 }, false);
    expect(s.hints).toBeNull();
    expect(s.unfinished).toBe(false);
    expect(s.pending).toBe(true);
  });
  it('draws no slots on a heading', () => {
    const t = '# binompdf(';
    expect(typingState(t, undefined, at(t.length), true).hints).toBeNull();
    expect(typingState(t, undefined, at(t.length), false).hints).not.toBeNull();
  });
  it('offers to go on from the line above only for a leading operator', () => {
    const lead = evaluateDocument([{ id: '0', kind: 'expr', text: '*100' }], { deg: true, complex: false, sample: false })[0].error;
    expect(typingState('*100', lead, at(4), false)).toMatchObject({ calm: true, lead: true });
    expect(typingState('2+', ENDS_EARLY, at(2), false)).toMatchObject({ calm: true, lead: false });
    expect(typingState('2+2', undefined, at(3), false)).toMatchObject({ calm: false, lead: false, pending: false, hints: null });
  });
});

describe('lineLabel', () => {
  const r = (fields: Partial<RowResult>) => fields as RowResult;
  it('is a line\'s name, else its letter with letters on, else its number', () => {
    expect(lineLabel(r({ lineName: 'tax' }), 0, true)).toEqual({ label: 'tax', unlettered: false });
    expect(lineLabel(r({}), 2, true)).toEqual({ label: 'C', unlettered: true });
    expect(lineLabel(r({}), 2, false)).toEqual({ label: '3', unlettered: false });
  });
  it('gives a heading its number even with letters on', () => {
    expect(lineLabel(r({ heading: 'Notes' }), 2, true)).toEqual({ label: '3', unlettered: false });
  });
});

describe('copyableValue', () => {
  const S = { deg: true, complex: false, sample: false };
  const o: DisplayOpts = { places: null, exact: false, percent: false };
  const row = (text: string, dist?: { cdf: boolean; min: string; max: string }) => evaluateDocument([{ id: '0', kind: 'expr', text, ...(dist ? { dist } : {}) }], S)[0];
  it('takes a shaded curve\'s probability', () => {
    const copy = copyableValue(row('normaldist(0, 1)', { cdf: true, min: '-1', max: '1' }), o);
    expect(Number(copy?.())).toBeCloseTo(0.6827, 3);
  });
  it('has nothing to take from an unshaded curve', () => {
    expect(copyableValue(row('normaldist(0, 1)'), o)).toBeUndefined();
  });
  it('takes any other line\'s value, and nothing from an error or a missing result', () => {
    expect(copyableValue(row('2 + 3'), o)?.()).toBe('5');
    expect(copyableValue(row('2 +'), o)).toBeUndefined();
    expect(copyableValue(undefined, o)).toBeUndefined();
  });
});

describe('isLongAnswer', () => {
  const every: DisplayOpts = { places: null, exact: false, percent: false, fullDigits: true };
  it('is a run of more digits than fit, with Every digit on', () => {
    expect(isLongAnswer('1'.repeat(17), every)).toBe(true);
    expect(isLongAnswer('1'.repeat(16), every)).toBe(false);
    expect(isLongAnswer('1'.repeat(17), { ...every, fullDigits: false })).toBe(false);
  });
  it('is never scientific notation or an answer with no text', () => {
    expect(isLongAnswer('1.51534200448232 × 10³⁰¹', every)).toBe(false);
    expect(isLongAnswer(null, every)).toBe(false);
  });
});
