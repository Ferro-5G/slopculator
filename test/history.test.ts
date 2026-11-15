import { describe, it, expect } from 'vitest';
import { addEntry, dayLabel, fullAnswer, groupByDay, HISTORY_KEY, historyStore, parseHistory, removeEntry, searchHistory, shouldRecord, type HistoryEntry } from '../src/ui/history';
import { evaluateDocument, type RowInput } from '../src/engine/document';

const entry = (text: string, result = '1', at = 1): HistoryEntry => ({ text, result, at });

describe('shouldRecord', () => {
  it('keeps finished calculations, definitions, and graphs', () => {
    expect(shouldRecord('binomge(7, 0.56, 5)', {})).toBe(true);
    expect(shouldRecord('a = 3', {})).toBe(true);
    expect(shouldRecord('y = x^2', {})).toBe(true);
  });
  it('skips blanks, errors, headings, and bare numbers', () => {
    expect(shouldRecord('  ', {})).toBe(false);
    expect(shouldRecord('1+', { error: 'Unexpected end' })).toBe(false);
    expect(shouldRecord('# Part 2', { heading: 'Part 2' })).toBe(false);
    expect(shouldRecord('42', {})).toBe(false);
    expect(shouldRecord('-3.5', {})).toBe(false);
    expect(shouldRecord('1+1', undefined)).toBe(false);
  });
});

describe('addEntry and removeEntry', () => {
  it('puts the newest first and skips an exact repeat of it', () => {
    const one = addEntry([], entry('1+1', '2', 1));
    const two = addEntry(one, entry('2+2', '4', 2));
    expect(two.map((e) => e.text)).toEqual(['2+2', '1+1']);
    expect(addEntry(two, entry('2+2', '4', 3))).toBe(two);
  });
  it('keeps a repeat with a different answer or that came earlier', () => {
    const list = [entry('a+1', '2', 2), entry('b', '5', 1)];
    expect(addEntry(list, entry('a+1', '3', 3))).toHaveLength(3);
    expect(addEntry(list, entry('b', '5', 3))).toHaveLength(3);
  });
  it('removes only the entry asked for', () => {
    const list = [entry('x', '1', 2), entry('x', '1', 1)];
    expect(removeEntry(list, list[1])).toEqual([list[0]]);
    // Same text and time, told apart by answer and sheet.
    const a = { ...entry('ans+1', '2', 10), sheet: 'A' }, b = { ...entry('ans+1', '3', 10), sheet: 'A' }, c = { ...b, sheet: 'B' };
    expect(removeEntry([a, b, c], b)).toEqual([a, c]);
  });
});

describe('parseHistory', () => {
  it('reads what was stored and treats nothing as empty', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory(JSON.stringify([entry('1+1')]))).toEqual([entry('1+1')]);
  });
  it('reports a partly damaged array so its original text is preserved', () => {
    expect(parseHistory(JSON.stringify([{ nope: 1 }, entry('1+1'), null]))).toBeNull();
  });
  it('rejects invalid timestamps and sheet names before rendering them', () => {
    expect(parseHistory('[{"text":"1+1","result":"2","at":1e309}]')).toBeNull();
    expect(parseHistory(JSON.stringify([{ ...entry('1+1'), at: 1e20 }]))).toBeNull();
    expect(parseHistory(JSON.stringify([{ ...entry('1+1'), sheet: {} }]))).toBeNull();
  });
  it('reports damage instead of pretending the history is empty', () => {
    expect(parseHistory('{broken')).toBeNull();
    expect(parseHistory('{"a":1}')).toBeNull();
  });
});

describe('searchHistory', () => {
  const list = [entry('binomge(7, 0.56, 5)', '0.336'), { ...entry('mean(L)', '12'), sheet: 'Unit 11' }];
  it('matches expressions, answers, and sheet names in any case', () => {
    expect(searchHistory(list, 'BINOM')).toEqual([list[0]]);
    expect(searchHistory(list, '0.336')).toEqual([list[0]]);
    expect(searchHistory(list, 'unit')).toEqual([list[1]]);
  });
  it('needs every word, and an empty search shows everything', () => {
    expect(searchHistory(list, 'mean unit')).toEqual([list[1]]);
    expect(searchHistory(list, 'mean binom')).toEqual([]);
    expect(searchHistory(list, '  ')).toBe(list);
  });
});

describe('dayLabel', () => {
  const now = new Date(2026, 10, 1, 12).getTime();
  it('names recent days', () => {
    expect(dayLabel(new Date(2026, 10, 1, 0, 5).getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 31, 23, 59).getTime(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 20).getTime(), now)).toMatch(/2026/);
  });
});

describe('fullAnswer', () => {
  const answer = (text: string) => {
    const rows: RowInput[] = [{ id: '0', kind: 'expr', text }];
    return fullAnswer(evaluateDocument(rows, { deg: true, complex: false, sample: false })[0]);
  };
  it('ignores the rounding setting, which belongs to the display', () => {
    expect(answer('1/3')).toBe('0.333333333333');
    expect(answer('binomge(7, 0.56, 5)')).toBe('0.33616667607');
  });
  it('is empty for a graph or a missing line', () => {
    expect(answer('y = x')).toBe('');
    expect(fullAnswer(undefined)).toBe('');
  });
});

describe('groupByDay', () => {
  it('groups runs of a day in order', () => {
    const now = new Date(2026, 10, 1, 12).getTime();
    const list = [entry('c', '1', new Date(2026, 10, 1, 9).getTime()), entry('b', '1', new Date(2026, 10, 1, 8).getTime()), entry('a', '1', new Date(2026, 9, 31, 8).getTime())];
    expect(groupByDay(list, now).map((g) => [g.day, g.entries.map((e) => e.text).join('')])).toEqual([['Today', 'cb'], ['Yesterday', 'a']]);
  });
});

describe('historyStore', () => {
  const memory = (start: Record<string, string> = {}) => {
    const data = { ...start };
    return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; } };
  };
  it('starts every write from what is stored now', () => {
    const s = memory();
    const store = historyStore(s, () => {});
    store.change((l) => addEntry(l, entry('a', '1', 1)));
    // Another writer, like a second window.
    s.data[HISTORY_KEY] = JSON.stringify([entry('other', '2', 2)]);
    store.change((l) => addEntry(l, entry('b', '3', 3)));
    expect(JSON.parse(s.data[HISTORY_KEY]).map((e: HistoryEntry) => e.text)).toEqual(['b', 'other']);
  });
  it('never drops entries on a cap', () => {
    const s = memory();
    const store = historyStore(s, () => {});
    const many = Array.from({ length: 20000 }, (_, i) => entry(`x${i}`, '1', i));
    s.data[HISTORY_KEY] = JSON.stringify(many);
    expect(store.change((l) => addEntry(l, entry('new', '1', 1)))).toHaveLength(20001);
  });
  it('sets damaged text aside under its own key', () => {
    const s = memory({ [HISTORY_KEY]: '{broken' });
    const store = historyStore(s, () => {}, () => 77);
    expect(store.change((l) => addEntry(l, entry('a')))).toHaveLength(1);
    expect(s.data[`${HISTORY_KEY}:damaged:77`]).toBe('{broken');
    expect(JSON.parse(s.data[HISTORY_KEY])).toHaveLength(1);
  });
  it('never overwrites a prior backup when the clock has not moved', () => {
    const oldKey = `${HISTORY_KEY}:damaged:77`;
    const s = memory({ [oldKey]: '{older', [HISTORY_KEY]: '{newer' });
    const store = historyStore(s, () => {}, () => 77);
    expect(store.load()).toEqual([]);
    expect(s.data[oldKey]).toBe('{older');
    expect(Object.values(s.data)).toContain('{newer');
  });
  it('writes nothing over damage it could not set aside, and says so', () => {
    const s = memory({ [HISTORY_KEY]: '{broken' });
    const fails: string[] = [];
    const store = historyStore({ ...s, setItem: () => { throw new Error('disk full'); } }, (m) => fails.push(m));
    expect(store.change((l) => addEntry(l, entry('a')))).toBeNull();
    expect(s.data[HISTORY_KEY]).toBe('{broken');
    expect(fails).toHaveLength(1);
  });
  it('tells the user when a write fails', () => {
    const s = memory({ [HISTORY_KEY]: JSON.stringify([entry('keep')]) });
    const fails: string[] = [];
    const store = historyStore({ ...s, setItem: () => { throw new Error('disk full'); } }, (m) => fails.push(m));
    expect(store.change((l) => addEntry(l, entry('a', '1', 2)))).toBeNull();
    expect(fails).toHaveLength(1);
    expect(JSON.parse(s.data[HISTORY_KEY])).toEqual([entry('keep')]);
  });
  it('writes nothing when nothing changed', () => {
    let writes = 0;
    const s = memory();
    const store = historyStore({ ...s, setItem: (k, v) => { writes++; s.setItem(k, v); } }, () => {});
    store.change((l) => addEntry(l, entry('a')));
    store.change((l) => addEntry(l, entry('a', '1', 2)));
    expect(writes).toBe(1);
  });
});
