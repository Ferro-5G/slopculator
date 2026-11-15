// The rules the web and the phones now share, checked once here rather than per platform.
import { describe, expect, it } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { cleanSheetView, nextColor, saveFailureReporter, sheetAsText, withSheetView } from '../src/ui/document';
import { searchInsertLabel } from '../src/ui/lineedit';
import { commitLine, HISTORY_FULL, HISTORY_KEY, historyStore } from '../src/ui/history';

const settings = { deg: true, complex: false, sample: false };
const row = (id: string, text: string): RowInput => ({ id, kind: 'expr', text });

describe('a background save failing', () => {
  it('is reported once per run of failures', () => {
    const said: string[] = [];
    const report = saveFailureReporter((m) => said.push(m));
    report(false);
    report(false);
    expect(said).toHaveLength(1);
    report(true);
    report(false);
    expect(said).toHaveLength(2);
    expect(said[0]).toMatch(/isn't being saved/);
  });
});

describe('commitLine', () => {
  const rows = [row('a', '2+2')];
  it('records a line once, and the same text left again adds nothing', () => {
    const committed = new Map<string, string>();
    const entries: unknown[] = [];
    const record = (e: unknown) => { entries.push(e); return true; };
    commitLine(committed, rows, settings, 'a', null, record);
    commitLine(committed, rows, settings, 'a', null, record);
    expect(entries).toHaveLength(1);
  });
  it('retries the next time a line is left after a write that failed', () => {
    const committed = new Map<string, string>();
    let writes = 0;
    commitLine(committed, rows, settings, 'a', null, () => { writes++; return false; });
    commitLine(committed, rows, settings, 'a', null, () => { writes++; return true; });
    commitLine(committed, rows, settings, 'a', null, () => { writes++; return true; });
    expect(writes).toBe(2);
  });
  it('skips a line that is not worth keeping', () => {
    let writes = 0;
    commitLine(new Map(), [row('a', '5')], settings, 'a', null, () => { writes++; return true; });
    expect(writes).toBe(0);
  });
});

describe('a history write that fails', () => {
  it('says the one toast', () => {
    const data: Record<string, string> = { [HISTORY_KEY]: '[]' };
    const said: string[] = [];
    const store = historyStore({ getItem: (k) => data[k] ?? null, setItem: () => { throw new Error('disk full'); }, removeItem: () => {} }, (m) => said.push(m));
    expect(store.change(() => [{ text: 'x', result: '1', at: 1 }])).toBeNull();
    expect(said).toEqual([HISTORY_FULL]);
  });
});

describe('a sheet copied as text', () => {
  it('keeps the one format: ->, empty lines numbered, a table\'s E(X), and no trailing empty line', () => {
    const rows: RowInput[] = [
      row('a', '2+2'), row('b', ''),
      { id: 't', kind: 'table', columns: [{ header: 'x', cells: ['1', '2'] }, { header: 'P', cells: ['0.5', '0.5'] }] },
      row('c', ''),
    ];
    const text = sheetAsText(rows, evaluateDocument(rows, settings), { places: null, exact: false, percent: false });
    expect(text).toBe('1. 2+2  -> 4\n2. \n3. [table] E(X) = 1.5');
  });
  it('says a line\'s error in the words the line shows, not the parser\'s', () => {
    const rows = [row('a', '3 m + 2 s'), row('b', '12*3')];
    const text = sheetAsText(rows, evaluateDocument(rows, settings), { places: null, exact: false, percent: false });
    expect(text).toMatch(/Length and time can't be added/);
    expect(text).not.toMatch(/Unknown name/);
  });
});

describe('the undo name for a function from search', () => {
  it('is the function, a matrix, or what was put in', () => {
    expect(searchInsertLabel('binompdf(¦)')).toBe('binompdf');
    expect(searchInsertLabel('[[¦, ], [, ]]')).toBe('matrix');
    expect(searchInsertLabel('π')).toBe('π');
    expect(searchInsertLabel('¦')).toBeUndefined();
  });
});

describe('a new line\'s color', () => {
  it('is the first free one, and a filler on an empty sheet gets the first of all', () => {
    expect(nextColor([])).toBe(0);
    expect(nextColor([{ color: 0 }, { color: 2 }])).toBe(1);
  });
  it('cycles by the line count once all seven are taken', () => {
    expect(nextColor([0, 1, 2, 3, 4, 5, 6, 0].map((color) => ({ color })))).toBe(1);
  });
});

describe('what a saved sheet carries', () => {
  it('reads only fields of the right type, and an old sheet has none of the new ones', () => {
    expect(cleanSheetView({ graph: 'no', graphPinned: 'yes', keypad: 1, view: 'graphs' })).toEqual({});
    expect(cleanSheetView({ graph: false, graphPinned: true, keypad: true, view: 'graph' })).toMatchObject({ graph: false, graphPinned: true, keypad: true, view: 'graph' });
  });
  it('a sheet saved with a bank still reads, and the bank is dropped', () => {
    expect(cleanSheetView({ graph: false, panel: 3, bank: 'Calc' })).toEqual({ graph: false });
  });
  it('brings the sheet\'s view and leaves the device\'s settings', () => {
    const device = { view: 'calc' as const, keypad: true, sound: true };
    expect(withSheetView(device, { view: 'graph', keypad: false })).toEqual({ view: 'graph', keypad: false, sound: true });
  });
  it('a field the sheet never stored clears, unless the caller asks to keep what\'s showing', () => {
    const device = { view: 'graph' as const, keypad: false };
    const old = { graph: true };
    expect(withSheetView(device, old)).toEqual({ graph: true });
    expect(withSheetView(device, old, true)).toEqual({ graph: true, view: 'graph', keypad: false });
  });
});
