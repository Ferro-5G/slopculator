// What a screen reader hears for the line in use, on the web and both phones: what the screen shows there.
import { describe, expect, it } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { heldBack, spokenLine, typingState } from '../src/ui/linestate';

const DISPLAY = { places: null, exact: false, percent: false };
const SETTINGS = { deg: false };
const rowsOf = (lines: string[]): RowInput[] => lines.map((text, i) => ({ id: String(i), kind: 'expr', text }));

/** The last line, as the phones and the web call it. `|` is the caret, else it's at the end. */
function say(lines: string[], typing = false, settings: object = SETTINGS): string {
  const at = lines[lines.length - 1].indexOf('|');
  const texts = [...lines.slice(0, -1), lines[lines.length - 1].replace('|', '')];
  const rows = rowsOf(texts);
  const index = rows.length - 1;
  const text = texts[index];
  const r = evaluateDocument(rows, settings as never)[index];
  const start = at < 0 ? text.length : at;
  const caret = { start, end: start };
  const held = heldBack(typingState(text, r.error, caret, r.heading !== undefined));
  return spokenLine({ text, r, index, held, caret, typing, rows, o: DISPLAY as never });
}

describe('spokenLine', () => {
  it('says an answer as "Line n equals"', () => {
    expect(say(['2 + 2'])).toBe('Line 1 equals 4');
    expect(say(['1', '2 + 2'])).toBe('Line 2 equals 4');
  });
  it('says the line\'s letter when it has one, for answers and errors', () => {
    const lettered = { ...SETTINGS, lineNames: true };
    expect(say(['2 + 2'], false, lettered)).toBe('A equals 4');
    expect(say(['1 + q'], false, lettered)).toMatch(/^A: error\. /);
  });
  it('says a real error in the screen\'s plain words', () => {
    expect(say(['1 + q'])).toMatch(/^Line 1: error\. q isn't defined/);
  });
  it.each(['nCr(1, )', 'binompdf(10, , 3)', 'integral(x, , 0, 1)', 'round(1.5, )', '[[1, ],[2,3]]', 'nCr(,2)', 'deriv(x^2, , 2)', '[[,],[,]]', 'solve(x=1, )'])('never calls %s an error while the screen says Unfinished', (line) => {
    expect(say([line])).toBe('Line 1: Unfinished');
  });
  it('says the function\'s usage in an empty slot', () => {
    expect(say(['nCr(1, |)'])).toMatch(/^Line 1: nCr\(n, r\)/);
    expect(say(['integral(x, |, 0, 1)'])).toMatch(/^Line 1: integral\(expression, x, a, b\)/);
  });
  it('says a line\'s warning after its answer, and on its own when there is no answer', () => {
    expect(say(['2 3'])).toMatch(/^Line 1 equals 6\. Check this: 2 3 multiplies/);
    expect(say(['y = 1/2x'])).toMatch(/^Line 1\. Check this: /);
  });
  it('holds a warning back while typing, unless it shows at once', () => {
    expect(say(['2 3'], true)).toMatch(/^Line 1 equals 6\. Check this: /);
    expect(say(['y = 1/2x'], true)).toBe('');
  });
  it('skips values with no single answer', () => {
    expect(say(['normaldist(0, 1)'])).toBe('');
    expect(say(['binomdist(10, 0.5)'])).toBe('');
    expect(say(['polygon((0,0), (1,0), (0,1))'])).toBe('');
    expect(say(['linreg({1,2,3}, {2,4,7})'])).toBe('');
  });
  it('says nothing for a line with no answer, not another line\'s', () => {
    expect(say(['2 + 2', ''])).toBe('');
    expect(say(['2 + 2', 'y = x'])).toBe('');
  });
  it('says nothing about an error or a hint until typing pauses', () => {
    expect(say(['1 + q'], true)).toBe('');
    expect(say(['nCr(1, )'], true)).toBe('');
    expect(say(['2 + 2'], true)).toBe('Line 1 equals 4');
  });
  it('says what the screen shows: true or false, and no answer for a name set to a number', () => {
    expect(say(['1 < 2'])).toBe('Line 1 equals true');
    expect(say(['a = 5'])).toBe('');
  });
});
