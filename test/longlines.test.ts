// Hints run on every line when a sheet loads and on the focused line as it changes. Some used regexes that retried at
// every character of a long run, so a file with one 50,000-character line froze the tab for seconds on each load.
import { describe, it, expect } from 'vitest';
import { lineErrorText, errorFixes } from '../src/ui/errortext';
import { completions, sheetCandidates, signatureForArg } from '../src/ui/complete';
import { callNameBefore, usageForms } from '../src/ui/brackets';
import { unfilled } from '../src/ui/slots';
import { slotInfo } from '../src/ui/linestate';
import { isUnit, otherUnit } from '../src/engine/units';

const N = 50_000;
const ms = (f: () => unknown): number => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
// Each of these took 2 to 9 seconds at this length. Linear work takes a few milliseconds; the bound leaves room for a
// slow machine without letting quadratic work through.
const FAST = 500;

describe('hints on very long lines', () => {
  it('explain an error on a line of 50,000 digits quickly', () => {
    const text = `${'1'.repeat(N)} + 5 kg`;
    const error = 'Unknown name "kg". Define it on its own line, like kg = 5';
    expect(ms(() => lineErrorText(text, error, isUnit, otherUnit))).toBeLessThan(FAST);
    expect(ms(() => errorFixes(text, error, isUnit))).toBeLessThan(FAST);
    expect(ms(() => errorFixes(`${'1,'.repeat(N / 2)} + 5 kg`, error, isUnit))).toBeLessThan(FAST);
  });
  it('find names and calls in a line of 50,000 letters quickly', () => {
    const text = `${'a'.repeat(N)}+`;
    expect(ms(() => completions(text, text.length, sheetCandidates([], [])))).toBeLessThan(FAST);
    expect(ms(() => callNameBefore(text, text.length))).toBeLessThan(FAST);
    expect(ms(() => unfilled(text, slotInfo))).toBeLessThan(FAST);
  });
  it('split the usage of a function whose definition has a long run of spaces quickly', () => {
    const usage = `f(x) = 1${' '.repeat(N)}+ x`;
    expect(ms(() => usageForms(usage))).toBeLessThan(FAST);
    expect(ms(() => signatureForArg(usage, 0))).toBeLessThan(FAST);
  });
  it('still read the same names and numbers', () => {
    expect(callNameBefore('2 + log_2(', 9)).toBe('log_2');
    expect(callNameBefore('_1ab(', 4)).toBe('ab');
    expect(unfilled('2 + binompdf(10,0.3,)', slotInfo)).toBe(1);
    expect(lineErrorText('3 + 5km', 'Unknown name "km"', isUnit, () => 'mi')).toMatch(/convert\(5, "km", "mi"\)/);
    expect(lineErrorText('-1,500.5 km', 'Unknown name "km"', isUnit, () => 'mi')).toMatch(/convert\(-1500\.5, "km", "mi"\)/);
    expect(usageForms('log(x), log(b, x), or log_b(x)')).toEqual(['log(x)', 'log(b, x)', 'log_b(x)']);
  });
});
