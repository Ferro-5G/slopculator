import { describe, it, expect } from 'vitest';
import { ansFix, calmWhileTyping, errorFixes, friendlyError, inQuotes, isUnfinished, lineErrorText, percentileFix, unitFix } from '../src/ui/errortext';
import { isUnit, otherUnit } from '../src/engine/units';
import { evaluateDocument } from '../src/engine/document';

const errorOf = (text: string) => evaluateDocument([{ id: 'a', kind: 'expr', text }], { deg: false, sample: false, lineNames: false } as never)[0].error ?? '';
const fixes = (text: string) => errorFixes(text, errorOf(text), isUnit);

describe('a line that starts with × ÷ or ^ offers ans', () => {
  it('keeps the error and offers "Use ans × 100"', () => {
    expect(errorOf('*100')).toMatch(/^Unexpected/);
    const f = ansFix('*100', errorOf('*100'))!;
    expect(f.label).toBe('Use ans × 100');
    expect(f.text).toBe('ans*100');
    expect(ansFix('/4', errorOf('/4'))!.label).toBe('Use ans ÷ 4');
    expect(ansFix('^2', errorOf('^2'))!.text).toBe('ans^2');
  });
  it('leaves + and − alone, since they are signs', () => {
    expect(errorOf('-5')).toBe('');
    expect(ansFix('-5', 'Unexpected "-"')).toBeNull();
    expect(ansFix('+5', 'Unexpected "+"')).toBeNull();
  });
});

describe('unit-looking input gets a convert fix', () => {
  it('turns "5 mi to km" and "5 mi in km" into convert()', () => {
    expect(unitFix('5 mi to km', isUnit)!.text).toBe('convert(5, "mi", "km")');
    expect(unitFix('5 mi in km', isUnit)!.text).toBe('convert(5, "mi", "km")');
    expect(unitFix('1,500 ft to m', isUnit)!.text).toBe('convert(1500, "ft", "m")');
    expect(fixes('5 mi to km')[0].text).toBe('convert(5, "mi", "km")');
    expect(unitFix('5 apples to km', isUnit)).toBeNull();
  });
  it('says plainly that length and time can\'t be added, with no conversion that leaves the seconds', () => {
    expect(lineErrorText('3 m + 2 s', errorOf('3 m + 2 s'), isUnit, otherUnit)).toBe("Length and time can't be added");
    expect(lineErrorText('3 m - 2 kg', errorOf('3 m - 2 kg'), isUnit, otherUnit)).toBe("Length and mass can't be subtracted");
    expect(fixes('3 m + 2 s')).toEqual([]);
    // One kind, or a multiplication, still explains convert().
    expect(lineErrorText('2 m + 3', errorOf('2 m + 3'), isUnit, otherUnit)).toBe('m looks like a unit. Units go in convert(), like convert(2, "m", "ft")');
  });
});

describe('name fixes never swap in an unrelated name', () => {
  it('does not turn mi into min or binomial into binomvar', () => {
    expect(fixes('5 mi').some((f) => f.text.includes('min'))).toBe(false);
    expect(fixes('binomial(10, 0.5, 3)').some((f) => f.text.includes('binomvar'))).toBe(false);
  });
  it('still fixes a real typo', () => {
    expect(fixes('integrl(x^2, x, 0, 1)')[0].text).toBe('integral(x^2, x, 0, 1)');
  });
  it('suggests nothing inside quotes', () => {
    expect(inQuotes('convert(5, "mile', 15)).toBe(true);
    expect(inQuotes('convert(5, "mi", "km")', 21)).toBe(false);
  });
});

import { completions } from '../src/ui/complete';
describe('typing inside quotes', () => {
  it('offers no completions for a unit being typed', () => {
    expect(completions('convert(5, "mi', 14, [{ name: 'min', call: true }, { name: 'mean', call: true }])).toBeNull();
    expect(completions('mi', 2, [{ name: 'min', call: true }])).not.toBeNull();
  });
});

describe('UX round 2 fixes', () => {
  it('never suggests converting a unit to itself, and explains with the fix it offers', () => {
    expect(lineErrorText('10 ft * 3', errorOf('10 ft * 3'), isUnit, otherUnit)).toBe('ft looks like a unit. Units go in convert(), like convert(10, "ft", "m")');
    // A conversion written out in words is worked out, so there's nothing to explain.
    expect(errorOf('5 mi to km')).toBe('');
  });
  it('offers invNorm for percentile with one input between 0 and 1', () => {
    expect(percentileFix('percentile(0.95)', errorOf('percentile(0.95)'))!.text).toBe('invNorm(0.95)');
    expect(fixes('percentile(0.95)')[0].label).toBe('Use invNorm(0.95)');
    expect(percentileFix('percentile(95)', errorOf('percentile(95)'))).toBeNull();
  });
  it('names an unknown word instead of splitting it into letters', () => {
    const r = evaluateDocument([{ id: 'a', kind: 'expr', text: 'total = 5' }, { id: 'b', kind: 'expr', text: 'due = total * tax' }], { deg: false, sample: false, lineNames: false } as never)[1];
    expect(r.error).toMatch(/Unknown name "tax"/);
    expect(r.error).not.toMatch(/depend on x or y|max/);
    expect(friendlyError(r.error!)).toMatch(/tax isn't defined\. Define it on its own line, like tax = 5/);
    // Letters that are all defined still multiply: 2xy graphs in x and y.
    const xy = evaluateDocument([{ id: 'c', kind: 'expr', text: 'y = 2xa' }, { id: 'd', kind: 'expr', text: 'a = 3' }], { deg: false, sample: false, lineNames: false } as never);
    expect(xy[0].error).toBeUndefined();
  });
});

describe('calm while typing', () => {
  it('knows an unfinished line from a wrong one', () => {
    for (const t of ['normalcdf(1,', 'normalcdf()', '2*', 'sqrt(']) expect(isUnfinished(errorOf(t)), t).toBe(true);
    for (const t of ['2**3', 'foo(2)', '5 mi', '1/0)']) expect(isUnfinished(errorOf(t) || 'none'), t).toBe(false);
  });
  it('is calm after the ) of an empty call, however many inputs the function takes', () => {
    for (const t of ['nCr()', 'mean()', 'sin()', 'sqrt()']) expect(calmWhileTyping(t, errorOf(t), t.length), t).toBe(true);
    const own = evaluateDocument([{ id: 'f', kind: 'expr', text: 'f(x) = x^2' }, { id: 'c', kind: 'expr', text: 'f()' }], { deg: false, sample: false, lineNames: false } as never)[1].error!;
    expect(own).toBe('f takes 1 input, got 0');
    expect(calmWhileTyping('f()', own, 3)).toBe(true);
    expect(calmWhileTyping('sin(1, 2)', errorOf('sin(1, 2)'), 9)).toBe(false);
  });
});

describe('numbers side by side (UX round 4)', () => {
  it('warns that 2 3 multiplies, offering 2 * 3 first and 23 second, and changes no answer', async () => {
    const { lineWarnings } = await import('../src/engine/diagnostics');
    const w = (t: string) => lineWarnings(t, { deg: false })[0];
    // One space before each three-digit group groups digits (see battery.test.ts), so 12 000 needs no warning.
    expect(w('12 000')).toBeUndefined();
    expect(w('12  000')).toMatchObject({ fix: '12000', alt: '12 * 000' });
    expect(w('2 3')).toMatchObject({ fix: '2 * 3', alt: '23' });
    expect(w('normalcdf(-1,.5 2)')?.fix).toBe('normalcdf(-1,.5 * 2)');
    expect(lineWarnings('2(3)', { deg: false })).toEqual([]);
    expect(lineWarnings('2x', { deg: false })).toEqual([]);
  });
});

describe('thousands commas and same-kind units (finishing round)', () => {
  it('reads 1,250 as a number with a comma, never a list', async () => {
    const { thousandsFix } = await import('../src/ui/errortext');
    expect(thousandsFix('1,250', 'Unexpected ","')).toMatchObject({ label: 'Use 1250', text: '1250' });
    expect(thousandsFix('price = 1,250,000', 'Unexpected ","')?.text).toBe('price = 1250000');
    expect(thousandsFix('1,25', 'Unexpected ","')).toBeNull();
    expect(thousandsFix('max(1,250)', 'Unexpected ","')).toBeNull();
    expect(fixes('1,250').map((f) => f.label)).toEqual(['Use 1250']);
    expect(lineErrorText('price = 1,250', errorOf('price = 1,250'), isUnit, otherUnit)).toMatch(/^Commas don't group digits/);
  });
  it('puts 5 ft + 3 in in one unit, keeping both terms', () => {
    expect(fixes('5 ft + 3 in').map((f) => f.text)).toEqual(['5 + convert(3, "in", "ft")']);
    expect(lineErrorText('5 ft + 3 in', errorOf('5 ft + 3 in'), isUnit, otherUnit)).toBe('Put both in one unit: 5 + convert(3, "in", "ft")');
    expect(fixes('5 mi - 3 km').map((f) => f.text)).toEqual(['5 - convert(3, "km", "mi")']);
  });
});
