// The grey argument hints and the caret's steps through a call's inputs and a matrix's cells.
import { describe, it, expect } from 'vitest';
import { enterStep } from '../src/ui/lineedit';
import { backspaceEdit, matrixAddRow, matrixCell, matrixNextEmpty, matrixPrevCell, matrixRowStep, slotForEnd, slots, slotStep, stripSignature, unfilled, wantsMatrix } from '../src/ui/slots';
import { USAGE } from '../src/ui/complete';
import { BUILTINS } from '../src/engine/builtins';

describe('grey slots', () => {
  const info = (n: string) => ({ usage: USAGE.get(n), min: BUILTINS[n]?.min });
  const at = (text: string, caret = text.indexOf('|')) => slots(text.replace('|', ''), caret, info);
  const shown = (text: string) => at(text).hints.map((h) => h.text).join(' / ');
  it('names the inputs a call still needs at the caret', () => {
    expect(shown('binompdf(|)')).toBe('n, p, k');
    expect(shown('binompdf(10|)')).toBe(', p, k');
    expect(shown('binompdf(10,|)')).toBe('p, k');
    expect(shown('binompdf(10,0.3,|)')).toBe('k');
    expect(shown('binompdf(10,0.3,4|)')).toBe('');
  });
  it('calls the calculus variable x in the slots, as the tiles and keys fill it in', () => {
    expect(shown('integral(|)')).toBe('expression, x, a, b');
    expect(shown('deriv(|)')).toBe('expression, x, [a]');
    expect(shown('deriv2(|)')).toBe('expression, x, [a]');
  });
  it('reads every form of a usage line: log(2, offers x, and normalcdf(0, still offers its optional inputs', () => {
    expect(shown('log(|)')).toBe('x');
    expect(shown('log(2,|)')).toBe('x');
    expect(at('log(2,|)').pending).toBe(1);
    expect(unfilled('log(2,)', info)).toBe(1);
    expect(shown('normalcdf(|)')).toBe('z');
    expect(shown('normalcdf(0,|)')).toBe('b, [μ], [σ]');
  });
  it('keeps a short form when the longer ones add required inputs or more than one choice', () => {
    expect(shown('round(|)')).toBe('x');
    expect(shown('solve(x^2=2,|)')).toBe('x');
    expect(shown('vec(1,|)')).toBe('y');
    expect(shown('moe(|)')).toBe('n');
  });
  it('counts what the answer still needs: binompdf\'s k holds it, μ and σ and an altitude don\'t', () => {
    expect(at('binompdf(10|)').pending).toBe(2);
    expect(at('binompdf(10,0.3|)').pending).toBe(1);
    expect(at('binompdf(10,0.3,4|)').pending).toBe(0);
    expect(at('normleft(1.2|)').pending).toBe(0);
    expect(at('normalcdf(-1|)').pending).toBe(0);
    expect(at('normalcdf(-1,|)').pending).toBe(1);
    expect(at('superheat("R134a", 30, 40|)').pending).toBe(0);
    expect(shown('superheat("R134a", 30, 40|)')).toBe(', [alt]');
    expect(at('poissoncdf(2|)').pending).toBeGreaterThan(0);
  });
  it('counts what\'s unfilled anywhere in the line, the caret inside the call or past it', () => {
    expect(unfilled('binompdf(10,0.3,)', info)).toBe(1);
    expect(unfilled('binompdf(10,0.3,4)', info)).toBe(0);
    expect(unfilled('binompdf(10)', info)).toBe(2);
    expect(unfilled('normleft(1.2)', info)).toBe(0);
    expect(unfilled('det([[1, ], [3, 4]])', info)).toBe(1);
    expect(unfilled('det([[1, 2], [3, 4]])', info)).toBe(0);
    expect(unfilled('2+3', info)).toBe(0);
  });
  it('names empty slots after the caret, never before it', () => {
    expect(shown('deriv(|, x, )')).toBe('expression / a');
    expect(at('deriv(|, x, )').pending).toBe(2);
    expect(shown('deriv(x^2, x, |)')).toBe('a');
    expect(at('deriv(x^2, x, 3|)').pending).toBe(0);
  });
  it('names a matrix\'s empty cells a, b, c, d across its rows', () => {
    expect(shown('det([[|, ], [, ]])')).toBe('a / b / c / d');
    expect(shown('det([[1, |], [, ]])')).toBe('b / c / d');
    expect(at('det([[1, 2], [3, |]])').pending).toBe(1);
    expect(at('det([[1, 2], [3, 4|]])').pending).toBe(0);
  });
});

describe('the comma and Next in a skeleton', () => {
  const step = (text: string, next = false) => {
    const c = text.indexOf('|'), t = text.replace('|', '');
    const to = slotStep(t, c, next);
    return to === null ? null : t.slice(0, to) + '|' + t.slice(to);
  };
  it('walks a matrix cell by cell, row by row, then out past its brackets', () => {
    expect(step('det([[1|, ], [, ]])')).toBe('det([[1, |], [, ]])');
    expect(step('det([[1, 2|], [, ]])')).toBe('det([[1, 2], [|, ]])');
    expect(step('det([[1, 2], [3|, ]])')).toBe('det([[1, 2], [3, |]])');
    expect(step('det([[1, 2], [3, 4|]])')).toBe('det([[1, 2], [3, 4]]|)');
  });
  it('steps to a call\'s next empty slot, past ones already filled', () => {
    expect(step('deriv(x^2|, x, )')).toBe('deriv(x^2, x, |)');
    expect(step('binompdf(10|')).toBeNull();
    expect(step('binompdf(10|, 0.3, 4)')).toBeNull();
    expect(step('2|+3')).toBeNull();
  });
  it('types a 2×2 determinant with the comma: 1, 2, 3, 4', () => {
    let t = 'det([[, ], [, ]])', c = 6;
    for (const d of ['1', '2', '3', '4']) {
      t = t.slice(0, c) + d + t.slice(c); c += 1;
      const to = slotStep(t, c);
      if (to !== null) c = to;
    }
    expect(t).toBe('det([[1, 2], [3, 4]])');
  });
});

describe('the strip\'s signature', () => {
  it('names the fluid the line has, brackets optional inputs, and drops the description', () => {
    const parts = { before: 'superheat("R410A", ', current: 'p', after: ', t, alt): suction line temperature above the dew point' };
    const text = 'superheat("R134a", )';
    expect(stripSignature(parts, text, 19)).toEqual({ before: 'superheat("R134a", ', current: 'p', after: ', t, [alt])' });
    expect(stripSignature({ before: 'normleft(x, ', current: 'μ', after: ', σ) = P(X < x)' }, 'normleft(1, ', 12)).toEqual({ before: 'normleft(x, ', current: '[μ]', after: ', [σ])' });
    expect(stripSignature({ before: 'deriv(', current: 'expression', after: ', x, a) at x = a' }, 'deriv(, x, )', 6)).toEqual({ before: 'deriv(', current: 'expression', after: ', x, a)' });
    expect(stripSignature({ before: 'binompdf(n, p, ', current: 'k', after: ')' }, 'binompdf(10,0.3,', 16)).toEqual({ before: 'binompdf(n, p, ', current: 'k', after: ')' });
  });
});

describe('fix round 2 helpers', () => {
  const info = (n: string) => ({ usage: USAGE.get(n), min: BUILTINS[n]?.min });
  it('offers a matrix in a matrix function\'s empty input, and says which cell the caret is in', () => {
    expect(wantsMatrix('det()', 4)).toBe(true);
    expect(wantsMatrix('det([[1]])', 5)).toBe(false);
    expect(wantsMatrix('sin()', 4)).toBe(false);
    expect(matrixCell('det([[1, ], [, ]])', 9)).toEqual({ row: 1, col: 2, rows: 2, cols: 2 });
    expect(matrixCell('det([[1, 2], [3, ]])', 17)).toEqual({ row: 2, col: 2, rows: 2, cols: 2 });
    expect(matrixCell('2+3', 1)).toBeNull();
  });
  it('puts a caret placed at the end into a call still missing an input', () => {
    expect(slotForEnd('poissoncdf(2)', info)).toBe(12);
    expect(slotForEnd('poissoncdf(2, 3)', info)).toBeNull();
    expect(slotForEnd('normleft(1.2)', info)).toBeNull();
    expect(slotForEnd('2+3', info)).toBeNull();
  });
});

describe('moving through a matrix', () => {
  it('adds a row inside a matrix, as many cells as its first, and leaves the row tile alone elsewhere', () => {
    expect(matrixAddRow('det([[1, 2]])', 8)).toEqual({ text: 'det([[1, 2], [, ]])', caret: 14 });
    expect(matrixAddRow('2+3', 1)).toBeNull();
  });

  it('marks the empty cell the caret is in, and only that one', () => {
    const r = slots('[[1, ], [, ]]', 5, () => undefined);
    expect(r.hints.map((h) => [h.text, !!h.current])).toEqual([['b', true], ['c', false], ['d', false]]);
    expect(slots('[[1, ], [, ]]', 3, () => undefined).hints.some((h) => h.current)).toBe(false);
  });
  const at = (s: string) => ({ c: s.indexOf('|'), t: s.replace('|', '') });
  const mark = (t: string, c: number | null) => (c === null ? null : t.slice(0, c) + '|' + t.slice(c));
  const up = (s: string) => { const { t, c } = at(s); return mark(t, matrixRowStep(t, c, -1)); };
  const down = (s: string) => { const { t, c } = at(s); return mark(t, matrixRowStep(t, c, 1)); };
  const prev = (s: string) => { const { t, c } = at(s); return mark(t, matrixPrevCell(t, c)); };
  const empty = (s: string) => { const { t, c } = at(s); return mark(t, matrixNextEmpty(t, c)); };

  it('steps by row in the same column, and hands off at the edges', () => {
    expect(down('A = [[1|, 2], [3, 4]]')).toBe('A = [[1, 2], [3|, 4]]');
    expect(up('[[1, 2], [3, 4|]]')).toBe('[[1, 2|], [3, 4]]');
    expect(down('[[1, |], [, ]]')).toBe('[[1, ], [, |]]');
    expect(up('[[1|, 2], [3, 4]]')).toBeNull();
    expect(down('[[1, 2], [3|, 4]]')).toBeNull();
    expect(down('2+|3')).toBeNull();
  });
  it('steps back a cell, across rows, and stops at the first', () => {
    expect(prev('[[1, 2|], [3, 4]]')).toBe('[[1|, 2], [3, 4]]');
    expect(prev('[[1, 2], [|3, 4]]')).toBe('[[1, 2|], [3, 4]]');
    expect(prev('[[|1, 2], [3, 4]]')).toBeNull();
  });
  it('finds the next empty cell for Enter, wrapping to any skipped', () => {
    expect(empty('[[1|, ], [, ]]')).toBe('[[1, |], [, ]]');
    expect(empty('[[, 2], [3, 4|]]')).toBe('[[|, 2], [3, 4]]');
    expect(empty('[[1, 2], [3, |]]')).toBeNull();
    expect(empty('[[1, 2], [3, 4|]]')).toBeNull();
    expect(empty('2+|3')).toBeNull();
  });
  it('gives ⌫ the grid\'s rule in an empty cell and a plain delete everywhere else', () => {
    const edit = (s: string, end?: number) => { const { t, c } = at(s); const r = backspaceEdit(t, c, end ?? c); return [mark(r.text, r.caret), r.matrix]; };
    expect(edit('[[1, 2], [|, 4]]')).toEqual(['[[1, 2|], [, 4]]', true]);
    expect(edit('[[|, ], [, ]]')).toEqual(['|', true]);
    expect(edit('A = [[|, ], [, ]]')).toEqual(['A = |', true]);
    expect(edit('[[1, |]]')).toEqual(['[[1,|]]', false]);
    expect(edit('[[1, |], [3, 4]]')).toEqual(['[[1|, ], [3, 4]]', true]);
    expect(edit('[[12|, ], [, ]]')).toEqual(['[[1|, ], [, ]]', false]);
    expect(edit('2+3|')).toEqual(['2+|', false]);
    expect(edit('|2')).toEqual(['|2', false]);
    expect(edit('a😀|')).toEqual(['a|', false]);
    expect(edit('[[|1, 2], [3, 4]]', 3)).toEqual(['[[|, 2], [3, 4]]', false]);
  });
  it('steps Enter to the next empty cell, unless text is selected', () => {
    const { t, c } = at('[[|, ], [, ]]');
    expect(enterStep(t, c, c, undefined)).toEqual({ cell: 4, fix: null });
    expect(enterStep(t, c, c + 1, undefined)).toEqual({ cell: null, fix: null });
  });
  it('has Enter take a lone leading-operator fix and move on', () => {
    const star = 'Unexpected "*"';
    expect(enterStep('*100', 4, 4, star)).toEqual({ cell: null, fix: 'ans*100' });
    expect(enterStep('2+3', 3, 3, undefined)).toEqual({ cell: null, fix: null });
    expect(enterStep('2+*3', 4, 4, star)).toEqual({ cell: null, fix: null });
  });


});
