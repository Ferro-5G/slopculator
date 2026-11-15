import { describe, expect, it } from 'vitest';
import { formatValue, plainNumber, plainValue, prettyNumber, type DisplayOpts } from '../src/engine/format';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { fullAnswer } from '../src/ui/history';

describe('automatic number display', () => {
  it('shows every digit of a whole number a double holds exactly', () => {
    expect(plainNumber(2 ** 40, null)).toBe('1099511627776');
    expect(plainNumber(-(2 ** 40), null)).toBe('-1099511627776');
    expect(plainNumber(Number.MAX_SAFE_INTEGER, null)).toBe('9007199254740991');
    expect(plainNumber(1e15, null)).toBe('1000000000000000');
    expect(prettyNumber(-(2 ** 40), null)).toBe('−1099511627776');
  });

  it('keeps 15 correct digits past that when copied, and the screen\'s ten', () => {
    expect(plainNumber(2 ** 60, null)).toBe('1.15292150460685E18');
    expect(plainNumber(2 ** 200, null)).toBe('1.60693804425899E60');
    expect(prettyNumber(2 ** 200, null)).toBe('1.606938044 × 10⁶⁰');
  });

  it('does not round the whole part of a long decimal away', () => {
    expect(plainNumber(1234567890123.5, null)).toBe('1234567890124');
  });

  it('still hides float noise in decimals', () => {
    expect(plainNumber(0.1 + 0.2, null)).toBe('0.3');
    expect(plainNumber(1 / 3, null)).toBe('0.333333333333');
    expect(plainNumber(1e-7, null)).toBe('1E-7');
    expect(plainNumber(-0, null)).toBe('0');
  });
});

describe('screen and clipboard precision', () => {
  const doc = (lines: string[]) => evaluateDocument(lines.map((text, i): RowInput => ({ id: String(i), kind: 'expr', text })), { deg: false, complex: false, sample: false });
  const o: DisplayOpts = { places: null, exact: false, percent: false };

  it('shows ten significant digits and copies twelve', () => {
    const [r] = doc(['normalcdf(-1, 1, 0, 1)']);
    expect(formatValue(r.value!, o, r.prob, r.precise)).toBe('0.6826894921');
    expect(plainValue(r.value!, o, r.prob, r.precise)).toBe('0.682689492137');
    expect(fullAnswer(r)).toBe('0.682689492137');
  });

  it('caps exact values the same way, and keeps a short exact decimal whole', () => {
    const [q, t] = doc(['1/7 + 3/4', '24.99 * 0.0825']);
    expect(formatValue(q.value!, o, q.prob, q.precise)).toBe('0.8928571429');
    expect(plainValue(q.value!, o, q.prob, q.precise)).toBe('0.892857142857');
    expect(formatValue(t.value!, o, t.prob, t.precise)).toBe('2.061675');
  });

  it('never rounds the whole part, and fixed places still win', () => {
    expect(prettyNumber(12345678901.234, null)).toBe('12345678901');
    expect(prettyNumber(Math.PI, 12)).toBe('3.141592653590');
  });
});

describe('huge numbers on screen', () => {
  const doc = (lines: string[]) => evaluateDocument(lines.map((text, i): RowInput => ({ id: String(i), kind: 'expr', text })), { deg: false, complex: false, sample: false });
  const o: DisplayOpts = { places: null, exact: false, percent: false };

  it('keeps 16-digit whole numbers whole', () => {
    expect(prettyNumber(2 ** 52, null)).toBe('4503599627370496');
    const [r] = doc(['2^60']);
    expect(formatValue(r.value!, o, r.prob, r.precise)).toBe('1.152921505 × 10¹⁸');
  });
});

describe('Huge answers: every digit on screen when asked for', () => {
  const doc = (lines: string[]) => evaluateDocument(lines.map((text, i): RowInput => ({ id: String(i), kind: 'expr', text })), { deg: false, complex: false, sample: false });
  const short: DisplayOpts = { places: null, exact: false, percent: false };
  const full: DisplayOpts = { ...short, fullDigits: true };

  it('shows a huge whole number short by default, and every digit with fullDigits', () => {
    const [, r] = doc(['A = 9120', 'A*99^999']);
    expect(formatValue(r.value!, short, r.prob, r.precise)).toBe('3.97698764 × 10¹⁹⁹⁷');
    const all = formatValue(r.value!, full, r.prob, r.precise);
    expect(all).toHaveLength(1998);
    expect(all.startsWith('3976987640254578272892236334884533551547')).toBe(true);
    expect(plainValue(r.value!, short, r.prob, r.precise)).toBe(all);
  });

  it('shows a 17-digit whole number and a long exact decimal in full', () => {
    const [a, b] = doc(['12345678901234567', '10^20 + 0.5']);
    expect(formatValue(a.value!, short, a.prob, a.precise)).toBe('1.23456789 × 10¹⁶');
    expect(formatValue(a.value!, full, a.prob, a.precise)).toBe('12345678901234567');
    expect(formatValue(b.value!, full, b.prob, b.precise)).toBe('100000000000000000000.5');
  });

  it('leaves what has no exact digits alone: a double past 10^15 still shows its proven digits as × 10ⁿ', () => {
    expect(prettyNumber(2 ** 200, null, undefined, true)).toBe('1.60693804425899 × 10⁶⁰');
    expect(prettyNumber(1e300, null, undefined, true)).toBe('1 × 10³⁰⁰');
    const [r] = doc(['1/3']);
    expect(formatValue(r.value!, full, r.prob, r.precise)).toBe('0.3333333333');
  });
});

describe('Every digit, grouped for reading', () => {
  it('groups a whole number in threes from the right, a fraction from the left, with thin spaces', async () => {
    const { groupDigits, DIGIT_GAP } = await import('../src/engine/format');
    const g = (s: string) => groupDigits(s).split(DIGIT_GAP).join(' ');
    expect(g('1152921504606846976')).toBe('1 152 921 504 606 846 976');
    expect(g('−12345678901234567')).toBe('−12 345 678 901 234 567');
    expect(g('12345.6789012')).toBe('12 345.678 901 2');
    expect(groupDigits('1.5 × 10¹⁸')).toBe('1.5 × 10¹⁸');
  });
});
