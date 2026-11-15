import { describe, it, expect } from 'vitest';
import { findInsert, functionCatalog, searchFunctions, searchScore, SYNONYMS } from '../src/ui/search';
import { BUILTINS } from '../src/engine/builtins';

const top = (q: string, n = 3) => searchFunctions(q).slice(0, n).map((e) => e.name);

describe('what Find inserts', () => {
  const entry = (name: string) => functionCatalog().find((e) => e.name === name)!;
  it('is the tile\'s fuller form where the tile has one', () => {
    expect(findInsert(entry('deriv'), '"R410A"')).toBe('deriv(¦, x, )');
    expect(findInsert(entry('integral'), '"R410A"')).toBe('integral(¦, x, , )');
  });
  it('takes the chosen refrigerant for a fluid tile', () => {
    expect(findInsert(entry('superheat'), '"R454B"')).toBe('superheat("R454B", ¦)');
  });
  it('is the catalog\'s own form otherwise', () => {
    expect(findInsert(entry('sqrt'), '"R410A"')).toBe(entry('sqrt').ins);
  });
});

describe('search finds functions by what they do', () => {
  it('finds a function by its name first', () => {
    expect(top('invNorm', 1)).toEqual(['invNorm']);
    expect(top('normalc', 1)).toEqual(['normalcdf']);
  });

  it('finds functions by the words people use for them', () => {
    expect(top('percentile')).toContain('invNorm');
    expect(top('percentile')).toContain('zcrit');
    expect(top('quantile', 2)).toContain('invNorm');
    expect(top('95th', 2)).toContain('invNorm');
    expect(top('area between', 1)).toEqual(['normalcdf']);
    expect(top('normal probability', 1)).toEqual(['normalcdf']);
    expect(top('binomial probability', 2)).toContain('binompdf');
    expect(top('miles to km', 1)).toEqual(['convert']);
    expect(top('kilometers', 1)).toEqual(['convert']);
    expect(top('convert units', 1)).toEqual(['convert']);
  });

  it('finds a function by the words on its key', () => {
    expect(top('inverse normal', 1)).toEqual(['invNorm']);
    expect(top('z crit', 1)).toEqual(['zcrit']);
  });

  it('shows nothing for a miss, never the popular functions', () => {
    expect(searchFunctions('qqqzzz')).toEqual([]);
    expect(searchFunctions('xylophone')).toEqual([]);
    for (const e of functionCatalog().filter((f) => ['sin', 'cos', 'tan'].includes(f.name))) expect(searchScore('qqqzzz', e)).toBe(-1);
  });

  it('names only real functions in the synonym table', () => {
    for (const name of Object.keys(SYNONYMS)) expect(BUILTINS[name], name).toBeTruthy();
  });

  it('ranks the normal percentile above the list one for what people mean', () => {
    for (const q of ['percentile', 'quantile', 'z for 95%', 'z score for', 'cutoff for', '95%', '90th']) {
      const names = top(q, 3);
      expect(names.slice(0, 2), q).toEqual(['invNorm', 'zcrit']);
    }
    expect(top('percentile', 4)).toContain('percentile');
  });

  it('keeps stems out of long descriptions, and hides weak matches', () => {
    const names = searchFunctions('percentile').map((e) => e.name);
    expect(names.filter((n) => !['invNorm', 'zcrit', 'percentile', 'pctchange', 'percentrank'].includes(n))).toEqual([]);
  });

  it('tells the look-alikes apart', () => {
    const d = Object.fromEntries(functionCatalog().map((e) => [e.name, e.detail]));
    expect(d.percentile).toMatch(/^Data percentile \(list\)/);
    expect(d.invNorm).toMatch(/^Normal percentile \(z\)/);
  });
});

describe('search with nothing typed (UX round 3)', () => {
  it('shows recent functions, then the keypad functions in bank order, and never an action', async () => {
    const { findDefaults, pushRecent } = await import('../src/ui/search');
    const all = functionCatalog();
    const recent = pushRecent(pushRecent([], 'sqrt'), 'mean');
    const d = findDefaults(all, recent);
    expect(d.slice(0, 2).map((e) => e.name)).toEqual(['mean', 'sqrt']);
    const keys = all.filter((e) => e.bank && !recent.includes(e.name)).map((e) => e.name);
    expect(d.slice(2).map((e) => e.name)).toEqual(keys.slice(0, d.length - 2));
    expect(new Set(d.map((e) => e.name)).size).toBe(d.length);
    expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a']);
  });
});

describe('stems only at the start of a word (UX round 3)', () => {
  it('keeps short and partial queries tight', () => {
    expect(searchFunctions('per').length).toBeLessThan(10);
    expect(searchFunctions('percent').map((e) => e.name)).not.toContain('oapercent');
    expect(searchFunctions('tip')).toEqual([]);
    expect(top('z for', 5)).toEqual(['invNorm', 'zcrit']);
  });
});

describe('purpose words find what the Thumb Index offers', () => {
  const first = (q: string) => searchFunctions(q)[0]?.name;
  it('finds the loan payment by what it\'s for', () => {
    expect(first('loan')).toBe('pmt');
    expect(first('monthly payment')).toBe('pmt');
    expect(first('monthly loan payment')).toBe('pmt');
    expect(first('mortgage')).toBe('pmt');
  });
  it('finds dew point, combinations and duct size the same way', () => {
    expect(first('dew')).toBe('dewpoint');
    expect(first('choose')).toBe('nCr');
    expect(first('combinations')).toBe('nCr');
    expect(first('duct size')).toBe('ductsize');
  });
});

describe('whole phrases find functions by their content words', () => {
  it('finds the normal between-two-values probability', () => {
    expect(top('probability between two values', 1)).toEqual(['normbetween']);
    expect(top('between two values', 1)).toEqual(['normbetween']);
  });
  it('treats bare numbers as filler', () => {
    expect(top('chance of exactly 4', 1)).toEqual(['binompdf']);
    expect(top('chance of exactly 10', 1)).toEqual(['binompdf']);
  });
  it('drops the filler around the point, and stems lightly', () => {
    expect(top('find where it crosses zero')).toEqual(expect.arrayContaining(['solve', 'roots']));
    expect(top('where does it cross zero')).toEqual(expect.arrayContaining(['solve', 'roots']));
    expect(top('what is the average of these numbers', 1)).toEqual(['mean']);
  });
  it('ranks by how many content words a function holds when no phrase matches whole', () => {
    expect(top('probability of exactly 3 heads', 1)).toEqual(['binompdf']);
  });
  it('still finds a function by its name first, and a miss is still a miss', () => {
    expect(top('sin', 1)).toEqual(['sin']);
    expect(top('ductsize', 1)).toEqual(['ductsize']);
    expect(top('invnorm', 1)).toEqual(['invNorm']);
    expect(top('the sin', 1)).toEqual(['sin']);
    expect(top('find x', 1)).toEqual(['solve']);
    expect(searchFunctions('find where it qqqzzz')).toEqual([]);
  });
});
