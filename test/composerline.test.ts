import { describe, expect, it } from 'vitest';
import { cleanSettings, evaluateDocument, type RowInput } from '../src/engine/document';
import { caretRaised, composerAnswer, composerError, composerGlows, composerRuns, composerSpark, composerState, sparkPath, splitRuns } from '../src/ui/composerline';
import { sheetNames } from '../src/ui/typeset';

const shown = (text: string, names = undefined as Parameters<typeof composerRuns>[1]) => composerRuns(text, names).map((r) => `${r.raised ? '^' : ''}${r.s}:${r.role}`).join(' ');
const result = (...texts: string[]) => {
  const rows: RowInput[] = texts.map((text, k) => ({ id: `r${k}`, kind: 'expr', text }));
  return evaluateDocument(rows, cleanSettings({ deg: true }));
};
const display = { places: null, exact: false, percent: false };

describe('composerRuns', () => {
  it('sets a line as it is typed: × for *, numbers upright, letters italic', () => {
    expect(shown('12*7')).toBe('12:num ×:op 7:num');
    expect(shown('y = 2x')).toBe('y:var =:op 2:num x:var');
    expect(shown('12*')).toBe('12:num ×:op');
  });
  it('tells a minus sign from a minus, and raises an exponent', () => {
    expect(shown('-b - 3')).toBe('−:sign b:var −:op 3:num');
    expect(shown('x^2 + 1')).toBe('x:var :text ^2:num +:op 1:num');
    expect(shown('e^(-x)')).toBe('e:var :text ^(:text ^−:sign ^x:var ^):text');
  });
  it('reads words the way the engine does', () => {
    const names = sheetNames([{ id: 'a', kind: 'expr', text: 'k = 2' }]);
    expect(shown('kx', names)).toBe('k:var x:var');
    expect(shown('sin(rate)')).toBe('sin:fn (:text rate:name ):text');
    expect(shown('sqrt(4) + pi')).toBe('√:fn (:text 4:num ):text +:op π:name');
  });
  it('keeps every character in one run, so the caret maps anywhere', () => {
    const text = 'normalcdf(-1, 1)*2';
    const runs = composerRuns(text);
    const covered = runs.reduce((n, r) => n + (r.to - r.from), 0);
    expect(covered).toBe(text.replace(/ /g, '').length);
    const { before, after } = splitRuns(composerRuns('123+4'), 2);
    expect(before.map((r) => r.s)).toEqual(['12']);
    expect(after.map((r) => r.s)).toEqual(['3', '+', '4']);
    expect(caretRaised(splitRuns(composerRuns('x^'), 2).before)).toBe(true);
    expect(caretRaised(splitRuns(composerRuns('x+'), 2).before)).toBe(false);
  });
});

describe('the composer state and answer', () => {
  it('lights only once the line works out', () => {
    expect(composerState('', undefined)).toBe('idle');
    expect(composerState('12*7', result('12*7')[0])).toBe('ok');
    expect(composerState('12*', result('12*')[0])).toBe('err');
    expect(composerState('12*', result('12*')[0], { calm: true })).toBe('typing');
    expect(composerState('r = 4', result('r = 4')[0], { update: true })).toBe('ok');
  });
  it('shows a live answer for a value, none for an error or a name set to a number', () => {
    expect(composerAnswer('12*7', result('12*7')[0], display)).toBe('84');
    expect(composerAnswer('12*', result('12*')[0], display)).toBeNull();
    expect(composerAnswer('r = 4', result('r = 4')[0], display)).toBeNull();
    expect(composerAnswer('2 < 3', result('2 < 3')[0], display)).toBe('true');
    expect(composerAnswer('12', result('12')[0], display)).toBeNull();
  });
  it('a figure line shows the number it works out, or nothing where its block draws a table’s worth', () => {
    const last = (lines: string[]) => result(...lines).at(-1);
    expect(composerAnswer('unitcircle(30)', last(['unitcircle(30)']), display)).toBeNull();
    expect(composerAnswer('unit circle(θ)', last(['θ = 30', 'unit circle(θ)']), display)).toBeNull();
    expect(composerAnswer('tangent(f, 1)', last(['f(x) = x^2', 'tangent(f, 1)']), display)).toBeNull();
    expect(composerAnswer('M = [[1, 2], [3, 4]]', last(['M = [[1, 2], [3, 4]]']), display)).toBeNull();
    expect(composerAnswer('riemann(g, 0, 2, 8)', last(['g(x) = x^3 - 3x', 'riemann(g, 0, 2, 8)']), display)).toBe('−2.03125');
    expect(composerAnswer('normalcdf(-1, 1)', last(['normalcdf(-1, 1)']), display)).toMatch(/^0\.682689/);
  });
  it('draws a little curve for a line that draws', () => {
    const spark = composerSpark(result('y = x^2')[0]);
    expect(spark).toHaveLength(24);
    expect(Math.min(...spark!)).toBe(0);
    expect(Math.max(...spark!)).toBe(1);
    expect(composerSpark(result('12*7')[0])).toBeNull();
  });
  it('lights its edge only once the line works out', () => {
    expect(composerGlows('ok')).toBe(true);
    expect(composerGlows('typing')).toBe(false);
    expect(composerGlows('err')).toBe(false);
  });
  it('cuts a curve that runs off at ±10, and draws heights as a path broken where there is no value', () => {
    const tan = composerSpark(result('y = tan(x)')[0]);
    expect(tan && tan.every((y) => Number.isNaN(y) || (y >= 0 && y <= 1))).toBe(true);
    const ln = composerSpark(result('y = ln(x)')[0])!;
    expect(ln.slice(0, 11).every(Number.isNaN)).toBe(true);
    expect(sparkPath([0, 1, NaN, 0.5], 30, 24)).toBe('M0.0,22.0L10.0,2.0M30.0,12.0');
  });
  it('shows no error while typing; after the pause a short whole one, with the full words', () => {
    const r = result('2 + qqq')[0];
    expect(composerError('2 + qqq', r, { typing: true })).toBeNull();
    expect(composerError('2 + qqq', r, { calm: true })).toBeNull();
    expect(composerError('2 + qqq', r)).toEqual({ short: "qqq isn't defined", full: "qqq isn't defined. Define it on its own line, like qqq = 5" });
    expect(composerError('r = sqrt(-3)', result('r = sqrt(-3)')[0])!.short).toBe('Not real');
    expect(composerError('normcdf(1', result('normcdf(1')[0])!.short).toBe('normcdf( is missing a )');
    expect(composerError('12*7', result('12*7')[0])).toBeNull();
  });
});
