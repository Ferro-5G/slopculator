import { describe, expect, it } from 'vitest';
import { LINK_LINE_LENGTH_MAX, LINK_LINES_MAX, linkLines, linkLinesLabel, sheetNames } from '../src/ui/links';
import type { RowInput } from '../src/engine/document';

describe('lines a link adds', () => {
  it('keeps every short line in order and skips blank ones', () => {
    expect(linkLines(['normalcdf(-inf,-2.5)', ' ', 'zscore(180,280,40)'])).toEqual({ lines: ['normalcdf(-inf,-2.5)', 'zscore(180,280,40)'], dropped: 0, clashes: [] });
  });

  it('leaves out lines past the count and length limits, and says how many', () => {
    // A link with a thousand lines froze the tab for 17 s; one 50,000-character line, for 8 s on every load.
    const many = Array.from({ length: LINK_LINES_MAX + 5 }, (_, k) => String(k));
    expect(linkLines(many)).toEqual({ lines: many.slice(0, LINK_LINES_MAX), dropped: 5, clashes: [] });
    const long = '1'.repeat(LINK_LINE_LENGTH_MAX + 1);
    expect(linkLines(['1+1', long])).toEqual({ lines: ['1+1'], dropped: 1, clashes: [] });
    expect(linkLinesLabel(1, 1)).toBe('Added 1 line from the link and left out 1');
    expect(linkLinesLabel(0, 2)).toBe('Left out 2 lines from the link');
    expect(linkLinesLabel(3, 0)).toBe('Added 3 lines from the link');
  });

  it('leaves out lines that would redefine a built-in or a name the sheet defines, and names them', () => {
    // sqrt(t) = t*100 from a link changed every sqrt already on the sheet, and a second rate = … broke both lines.
    const rows: RowInput[] = [
      { id: 'a', kind: 'expr', text: 'rate = 0.05' },
      { id: 'b', kind: 'expr', text: 'g(t) = t + 1' },
      { id: 'c', kind: 'expr', text: 'y = 2x' },
      { id: 'd', kind: 'table', columns: [{ header: 'n', cells: ['1'] }] },
    ];
    const taken = sheetNames(rows);
    expect([...taken].sort()).toEqual(['g', 'n', 'rate']);
    const got = linkLines(['sqrt(t) = t*100', 'rate = 0.07', 'g(x) = 0', 'n = 3', 'y = x + 1', 'k = 2', 'k + rate'], taken);
    expect(got).toEqual({ lines: ['y = x + 1', 'k = 2', 'k + rate'], dropped: 0, clashes: ['sqrt', 'rate', 'g', 'n'] });
    expect(linkLinesLabel(3, 0, got.clashes)).toBe("Added 3 lines from the link and left out 4. A link can't redefine sqrt, rate, g or n");
    expect(linkLinesLabel(0, 1, ['sqrt'])).toBe("Left out 2 lines from the link. A link can't redefine sqrt");
  });

  it('counts the letters of the sheet\'s lines as taken when line letters are on', () => {
    // With rows 5 and A + 1, a link's A = 100 took line 1's letter and turned the answer 6 into 101.
    const rows: RowInput[] = [{ id: 'a', kind: 'expr', text: '5' }, { id: 'b', kind: 'expr', text: 'A + 1' }];
    expect(linkLines(['A = 100', 'k = 3'], sheetNames(rows, true)).clashes).toEqual(['A']);
    expect(linkLines(['A = 100'], sheetNames(rows, false)).clashes).toEqual([]);
  });
});
