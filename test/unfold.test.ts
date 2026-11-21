import { describe, expect, it } from 'vitest';
import { cleanSettings, evaluateDocument, type RowInput } from '../src/engine/document';
import { formatValue } from '../src/engine/format';
import { cleanBody, type DocRow } from '../src/ui/document';
import { canUnfold, changedSteps, NO_VALUE, shortError, stepAnswer, stepDeltas, stepsReached, TRAY, trayLayout, unfoldSteps, type Unfolded } from '../src/ui/unfold';
import { readError } from '../src/engine/errors';
import { formatChange } from '../src/ui/wiretags';

const settings = cleanSettings({ deg: true });
const lines = (...texts: string[]): RowInput[] => texts.map((text, k) => ({ id: `r${k + 1}`, kind: 'expr', text }));
const show = (v: unknown) => (v === undefined ? undefined : formatValue(v as never, { places: null, exact: false, percent: false }));
/** The last line's steps, on a sheet of these lines. */
function unfold(...texts: string[]): Unfolded {
  const rows = lines(...texts);
  const u = unfoldSteps(texts[texts.length - 1], { rows, settings, id: `r${texts.length}`, results: evaluateDocument(rows, settings) });
  if (!u) throw new Error('no steps');
  return u;
}
const brief = (u: Unfolded) => u.steps.map((s) => [s.id, s.text, s.error ? s.status : show(s.value)]);

const QUAD = 'r = (−b + √(b² − 4ac)) / (2a)';

describe('unfoldSteps', () => {
  it("builds the line's tree from the engine's parse, each step with its own value, the line's ÷ folded in", () => {
    const u = unfold('a = 1', 'b = -3', 'c = 2', QUAD);
    expect(brief(u)).toEqual([
      ['0.1.0.0', 'b²', '9'],
      ['0.1.0.1', '4ac', '8'],
      ['0.1.0', 'b² − 4ac', '1'],
      ['0.1', '√(b² − 4ac)', '1'],
      ['0', '−b + √(b² − 4ac)', '4'],
      ['1', '2a', '2'],
    ]);
    expect(show(u.line.value)).toBe('2');
    expect(u.line).toMatchObject({ reads: ['0', '1'], status: 'ok' });
    expect(u.outline).toEqual(['0', '0.1', '0.1.0', '0.1.0.0', '0.1.0.1', '1']);
    const at = (id: string) => u.steps.find((s) => s.id === id)!;
    expect([at('0').depth, at('0.1.0.1').depth, at('1').depth]).toEqual([1, 4, 1]);
    expect(u.steps.map((s) => s.height)).toEqual([0, 0, 1, 2, 3, 0]);
    expect(at('0.1.0')).toMatchObject({ parent: '0.1', reads: ['0.1.0.0', '0.1.0.1'] });
    expect(u.failure).toBeNull();
  });
  it('reads the mockup\'s own spelling, / 2a, as a division by 2a', () => {
    const u = unfold('a = 1', 'b = -3', 'c = 2', 'r = (−b + √(b² − 4ac)) / 2a');
    expect(brief(u).at(-1)).toEqual(['1', '2a', '2']);
    expect(show(u.line.value)).toBe('2');
  });
  it('marks where each step sits in the line', () => {
    const u = unfold('a = 1', 'b = -3', 'c = 2', QUAD);
    for (const s of u.steps) expect(QUAD.slice(s.span![0], s.span![1]).trim()).toBe(s.text);
  });
  it('says which steps read each name, through the steps they read', () => {
    const u = unfold('a = 1', 'b = -3', 'c = 2', QUAD);
    expect(u.steps.find((s) => s.id === '0.1.0.1')!.names.sort()).toEqual(['a', 'c']);
    expect(u.byName.get('c')).toEqual(['0.1.0.1', '0.1.0', '0.1', '0']);
    expect([...stepsReached(u, ['c'])].sort()).toEqual(['0', '0.1', '0.1.0', '0.1.0.1']);
    expect(stepsReached(u, ['zz']).size).toBe(0);
  });
  it('lights only the steps whose value changed', () => {
    const before = unfold('a = 1', 'b = -3', 'c = 2', QUAD);
    const after = unfold('a = 1', 'b = -3', 'c = 1.5', QUAD);
    expect([...changedSteps(before, after)].sort()).toEqual(['0', '0.1', '0.1.0', '0.1.0.1']);
    expect(changedSteps(null, after).size).toBe(6);
    expect(changedSteps(after, after).size).toBe(0);
  });
  it("shows each step's answer, and its change since a drag began, as the mockup does", () => {
    const before = unfold('a = 1', 'b = -3', 'c = 2', QUAD);
    const after = unfold('a = 1', 'b = -3', 'c = 1.5', QUAD);
    const display = { places: null, exact: false, percent: false };
    expect(after.steps.map((s) => stepAnswer(s, display))).toEqual(['9', '6', '3', '1.73205', '4.73205', '2']);
    expect(Object.fromEntries(stepDeltas(before, after))).toEqual({ '0.1.0.1': '−2', '0.1.0': '+2', '0.1': '+0.7321', '0': '+0.7321', line: '+0.366' });
    const bad = unfold('a = 1', 'b = -3', 'c = 3', QUAD);
    expect(stepAnswer(bad.steps.find((s) => s.status === 'fails')!, display)).toBe('Not real');
    expect(stepAnswer(bad.steps.find((s) => s.status === 'after')!, display)).toBe(NO_VALUE);
    expect(formatChange(2, 2)).toBeNull();
    expect(formatChange(1, 1 + 1e-12)).toBe('−1 × 10⁻¹²');
  });
  it('marks the first failing step and the steps after it, with errors read through readError', () => {
    const u = unfold('a = 1', 'b = -3', 'c = 3', QUAD);
    const status = Object.fromEntries(u.steps.map((s) => [s.text, s.status]));
    expect(status).toEqual({ 'b²': 'ok', '4ac': 'ok', 'b² − 4ac': 'ok', '√(b² − 4ac)': 'fails', '−b + √(b² − 4ac)': 'after', '2a': 'ok' });
    expect(u.failure).toBe('0.1');
    expect(u.line.status).toBe('after');
    expect(u.line.error?.text).toBe(u.steps.find((s) => s.id === '0.1')!.error!.text);
    expect(u.steps.find((s) => s.id === '0.1')!.error!.form).toEqual({ k: 'notReal' });
  });
  it('blames the line itself when only its own operation fails', () => {
    const u = unfold('a = 1', 'b = 2', 'r = a / (b - 2)');
    expect(brief(u)).toEqual([['1', 'b - 2', '0']]);
    expect(u.line.status).toBe('fails');
    expect(u.failure).toBeNull();
  });
  it('carries an error from the line a name comes from', () => {
    const u = unfold('a = 1/0', 'r = 2a + 1');
    expect(u.steps[0]).toMatchObject({ text: '2a', status: 'fails' });
    expect(u.steps[0].error!.form.k).toBe('inVar');
  });
  it('keeps a chain of + and − or of × as one step, unless part of it is in parentheses', () => {
    expect(brief(unfold('a = 2', 'b = 3', 'r = a·b·4 + a - 1'))).toEqual([['0', 'a·b·4', '24']]);
    expect(brief(unfold('a = 2', 'b = 3', 'r = 2(a + b) - 1'))).toEqual([['0.1', 'a + b', '5'], ['0', '2(a + b)', '10']]);
    expect(brief(unfold('a = 2', 'b = 3', 'r = 2 · (a · b)'))).toEqual([['1', 'a · b', '6']]);
  });
  it("leaves a binder's inputs alone: they mean nothing outside it", () => {
    expect(brief(unfold('a = 3', 's = sum(n^2, n, 1, a) + 1'))).toEqual([['0', 'sum(n^2, n, 1, a)', '14']]);
  });
  it('works out ans and exact values as the line would', () => {
    expect(brief(unfold('2 + 3', 'ans·2 + 1'))).toEqual([['0', 'ans·2', '10']]);
    const u = unfold('r = (0.1 + 0.2)·3 + 1');
    expect(u.steps[0]).toMatchObject({ text: '0.1 + 0.2', value: 0.3 });
    expect(u.steps[0].precise).toBeDefined();
  });
  it('shows a line being typed in place of its row', () => {
    const rows = lines('a = 2', 'r = a + 1');
    const u = unfoldSteps('r = 3a + 1', { rows, settings, id: 'r2' })!;
    expect(brief(u)).toEqual([['0', '3a', '6']]);
  });
  it('reads LaTeX and unit phrases, with no place in the line to mark', () => {
    const u = unfold('a = 2', 'r = \\frac{a+1}{2}');
    expect(brief(u)).toEqual([['0', 'a+1', '3']]);
    expect(u.steps[0].span).toBeNull();
  });
  it('has nothing for a line with one operation, only leaves, or no single value', () => {
    const none = (...texts: string[]) => {
      const rows = lines(...texts);
      return unfoldSteps(texts[texts.length - 1], { rows, settings, id: `r${texts.length}` });
    };
    expect(none('a = 2', 'r = a + 1')).toBeNull();
    expect(none('r = -3 + 5% + 30°')).toBeNull();
    expect(none('a = 2', 'y = a x^2 + 1')).toBeNull();
    expect(none('f(t) = 2t + 1')).toBeNull();
    expect(none('k = 4')).toBeNull();
  });
});

describe('a step in a wide tray', () => {
  it('says which names each step reads itself, where their wires come in', () => {
    const u = unfold('a = 1', 'b = -3', 'c = 2', QUAD);
    const inputs = Object.fromEntries(u.steps.map((s) => [s.text, s.inputs.sort()]));
    expect(inputs).toEqual({ 'b²': ['b'], '4ac': ['a', 'c'], 'b² − 4ac': [], '√(b² − 4ac)': [], '−b + √(b² − 4ac)': ['b'], '2a': ['a'] });
    expect(u.line.inputs).toEqual([]);
    expect(unfold('a = 3', 's = sum(n^2, n, 1, a) + a').steps[0].inputs).toEqual(['a']);
  });
  it('shortens an error by its form, never its wording', () => {
    expect(shortError(readError('Division by zero'), 'Division by zero')).toBe('÷ 0');
    expect(shortError({ k: 'notReal' }, 'x')).toBe('Not real');
    expect(shortError({ k: 'inVar', name: 'a', inner: { k: 'divZero' } }, 'x')).toBe('a: ÷ 0');
    expect(shortError({ k: 'other' }, 'Points can have 2 or 3 coordinates')).toBe('Points can have 2 or 3 coordinates');
    expect(shortError({ k: 'unknown', name: 'qqq', hint: null, example: 'qqq = 5' }, 'x')).toBe("qqq isn't defined");
  });
  it('lays the steps out as a sideways tree: columns by height, each step level with what it reads, wires square', () => {
    const u = unfold('a = 1', 'b = -3', 'c = 2', QUAD);
    const sizes = new Map(u.steps.map((s) => [s.id, { w: 100, h: 46 }]));
    const t = trayLayout(u, sizes);
    const r = (id: string) => t.rects.get(id)!;
    const col = (h: number) => TRAY.pad + h * (100 + TRAY.colGap);
    expect([r('1').x, r('0.1.0.0').x, r('0.1.0.1').x, r('0.1.0').x, r('0.1').x, r('0').x]).toEqual([col(0), col(0), col(0), col(1), col(2), col(3)]);
    // 2a reads no steps and is the line's shortest part, so it's on top; the chain sits level with b² and 4ac.
    expect(r('1').y).toBe(TRAY.pad);
    expect(r('0.1.0.0').y).toBeLessThan(r('0.1.0.1').y);
    expect(r('0.1.0').y + 23).toBe((r('0.1.0.0').y + r('0.1.0.1').y) / 2 + 23);
    expect(r('0').y).toBe(r('0.1.0').y);
    // Nothing overlaps, every link is square, and the tray holds every step.
    const all = [...t.rects.values()];
    for (let i = 0; i < all.length; i++) for (let j = 0; j < i; j++) expect(all[i].x < all[j].x + all[j].w && all[j].x < all[i].x + all[i].w && all[i].y < all[j].y + all[j].h && all[j].y < all[i].y + all[i].h).toBe(false);
    for (const l of t.links) expect(l.points.slice(1).every((q, k) => q.x === l.points[k].x || q.y === l.points[k].y)).toBe(true);
    expect(t.links).toHaveLength(4);
    expect(t.size.w).toBe(col(3) + 100 + TRAY.pad);
    expect(t.size.h).toBe(TRAY.pad * 2 + 3 * (46 + TRAY.rowGap) - TRAY.rowGap);
  });
});

describe('canUnfold', () => {
  const can = (...texts: string[]) => {
    const rows = lines(...texts);
    const results = evaluateDocument(rows, settings);
    return canUnfold(texts[texts.length - 1], results[results.length - 1]);
  };
  it('is a value line, or a failing one, with more than one operation', () => {
    expect(can('2·3 + 1')).toBe(true);
    expect(can('a = 1', 'b = -3', 'c = 2', QUAD)).toBe(true);
    expect(can('a = 1', 'b = -3', 'c = 3', QUAD)).toBe(true);
    expect(can('2 + 3')).toBe(false);
    expect(can('a + b + c')).toBe(false);
    expect(can('k = 45')).toBe(false);
    expect(can('k = 2', 'y = 2sin(kx) + 1')).toBe(false);
    expect(can('f(x) = 2x + 1')).toBe(false);
    expect(canUnfold('2·3 + 1')).toBe(true);
    expect(canUnfold('nonsense +')).toBe(false);
  });
  it('agrees with unfoldSteps', () => {
    for (const t of ['2·3 + 1', 'r = 2(a + b) - 1', 'r = a + b', 'sum(n, n, 1, 4) + 1', 'r = 5% + 1']) {
      const rows = lines('a = 1', 'b = 2', t);
      const results = evaluateDocument(rows, settings);
      expect(canUnfold(t, results[2]), t).toBe(unfoldSteps(t, { rows, settings, id: 'r3', results }) !== null);
    }
  });
});

describe('an open line in a saved sheet', () => {
  it('keeps open: true and drops anything else', () => {
    const body = cleanBody<DocRow>({ rows: [{ id: 'a', kind: 'expr', text: '1', open: true }, { id: 'b', kind: 'expr', text: '2', open: 'yes' }] }, () => 'n', () => ({ id: 'z', kind: 'expr', text: '', color: 0 }));
    expect(body.rows[0].open).toBe(true);
    expect(body.rows[1].open).toBeUndefined();
    expect(cleanBody<DocRow>(JSON.parse(JSON.stringify(body)), () => 'n', () => ({ id: 'z', kind: 'expr', text: '', color: 0 })).rows[0].open).toBe(true);
  });
});
