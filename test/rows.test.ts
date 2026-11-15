import { describe, it, expect } from 'vitest';
import { cleanRow, evaluateDocument } from '../src/engine/document';

describe('rows read back from storage or a file', () => {
  it('keeps a well-formed expression row as it was', () => {
    const row = { id: 'a', kind: 'expr', text: 'a = 2', hidden: true, dist: { cdf: true, min: '-inf', max: '0' }, slider: { min: 0, max: 5, step: 0.5 } };
    expect(cleanRow(row)).toEqual(row);
  });
  it('reads a row with no kind as an expression', () => {
    expect(cleanRow({ id: 'a', text: '1+1' })).toEqual({ id: 'a', kind: 'expr', text: '1+1' });
  });
  it('drops rows with nothing usable', () => {
    for (const bad of [null, 5, 'text', [], {}, { kind: 'expr', text: 5 }, { kind: 'table' }, { kind: 'table', columns: [] }, { kind: 'chart', text: '1' }]) {
      expect(cleanRow(bad)).toBeNull();
    }
  });
  it('drops fields of the wrong type instead of the row', () => {
    expect(cleanRow({ id: 7, kind: 'expr', text: 'x', hidden: 'yes', dist: { cdf: 'no' }, slider: { min: 0, max: 0, step: 0 } })).toEqual({ id: '', kind: 'expr', text: 'x' });
    expect(cleanRow({ id: 'a', text: 'x', slider: { min: 0, max: 1, step: -1 } })).toEqual({ id: 'a', kind: 'expr', text: 'x' });
    expect(cleanRow({ id: 'a', text: 'normaldist(0,1)', dist: { cdf: true, min: 5 } })).toMatchObject({ dist: { cdf: true, min: '-inf', max: '' } });
  });
  it('repairs table columns so the table still evaluates', () => {
    const row = cleanRow({ id: 't', kind: 'table', columns: [{ header: 'x', cells: ['1', 2, null] }, { cells: 'oops' }, 'junk'] });
    expect(row).toEqual({ id: 't', kind: 'table', columns: [{ header: 'x', cells: ['1', '2', ''] }, { header: '', cells: [] }] });
    expect(() => evaluateDocument([row!], { deg: true, complex: false, sample: false })).not.toThrow();
  });
});
