import { describe, expect, it } from 'vitest';
import { cleanSettings, evaluateDocument } from '../src/engine/document';
import { formatValue, recordCell, type DisplayOpts } from '../src/engine/format';
import type { Settings } from '../src/engine/evaluator';
import type { RecordV } from '../src/engine/values';
import { BUILTINS } from '../src/engine/builtins';
import { signatureForArg } from '../src/ui/complete';

const DEG: Settings = { deg: true, complex: false, sample: false };
const RAD: Settings = { ...DEG, deg: false };
const OFF: Settings = { ...DEG, working: false };
const O: DisplayOpts = { places: null, exact: false, percent: false };

const last = (text: string, s: Settings = DEG) => evaluateDocument([{ id: 'a', kind: 'expr', text }], s)[0];
const shown = (text: string, s: Settings = DEG) => {
  const r = last(text, s);
  if (r.error) throw new Error(r.error);
  return formatValue(r.value!, O);
};

describe('solve over a range', () => {
  it('lists every solution, which the plain search misses in degrees', () => {
    expect(shown('solve(sin(x) = 0.5, x)')).toBe('30');
    expect(shown('solve(sin(x) = 0.5, x, 0, 360)')).toBe('{30, 150}');
  });
  it('finds roots the curve only touches', () => {
    expect(shown('solve(sin(x) = 1, x, 0, 360)')).toBe('90');
    expect(shown('solve(cos(x) = 1, x, 0, 720)')).toBe('{0, 360, 720}');
    expect(last('solve(sin(x) = 1, x, 0, 2π)', RAD).value as number).toBeCloseTo(Math.PI / 2, 8);
    expect(shown('solve((x - 1.25)^2 = 0, x, 0, 3)')).toBe('1.25');
  });
  it('does not report a pole as a root', () => {
    expect(shown('solve(tan(x) = 0, x, 0, 360)')).toBe('{0, 180, 360}');
    expect(last('solve(1/x = 0, x, -1, 1)').error).toMatch(/No solution/);
  });
  it('turns away a backwards range and a curve that never reaches the value', () => {
    expect(last('solve(x = 1, x, 5, 0)').error).toMatch(/low end comes first/);
    expect(last('solve(sin(x) = 2, x, 0, 360)').error).toMatch(/No solution found for x from 0° to 360°/);
  });
  it('says what it searched, Working on or off', () => {
    for (const s of [DEG, OFF]) {
      expect(last('solve(sin(x) = 0.5, x, 0, 360)', s).notes).toContain('Scanned x from 0° to 360°, ends included: 2 solutions');
      expect(last('solve(sin(x) = 0.5, x)', s).notes.join()).toMatch(/Searched x from −100 to 100\. Trig repeats/);
    }
    expect(last('solve(x^2 = 9, x)').notes).toContain('Searched x from −100 to 100');
    expect(last('solve(x^2 = 4, x, 1)').notes).toContain('Started from x = 1, so this is one solution near it');
  });
  it('hints each argument of the range form as it is typed', () => {
    expect(signatureForArg(BUILTINS.solve.usage!, 3)?.current).toBe('high');
  });
  it('keeps the one- and three-argument forms', () => {
    expect(shown('solve(x^2 = 9, x)')).toBe('{−3, 3}');
    expect(last('solve(x^2 = 4, x, 1)').value as number).toBeCloseTo(2, 12);
  });
});

describe('Working', () => {
  const lines = ['sin(30)', 'cos(π/3)', 'tan(45)', 'atan2(1, 1)', 'arclen(10, 90)', 'sector(10, 90)', 'torad(180)', 'todeg(π)', 'trigform(2, 3, 1, 0)', 'period(3)'];
  it('never changes an answer', () => {
    for (const text of lines) for (const deg of [true, false]) {
      expect(last(text, { ...DEG, deg }).value).toEqual(last(text, { ...DEG, deg, working: false }).value);
    }
  });
  it('names the angle unit on trig answers', () => {
    expect(last('sin(30)').notes).toEqual(['Degrees']);
    expect(last('sin(1)', RAD).notes).toEqual(['Radians']);
    expect(last('sin(30)', OFF).notes).toEqual([]);
    expect(last('2 + 2').notes).toEqual([]);
  });
  it('writes out the substitution, and falls back to the plain note', () => {
    expect(last('arclen(10, 90)').notes).toEqual(['θ = 90° = π/2 rad, so s = rθ = 10 × π/2']);
    expect(last('arclen(10, 1.5)', RAD).notes).toEqual(['s = rθ = 10 × 1.5']);
    expect(last('sector(10, 90)').notes).toEqual(['θ = 90° = π/2 rad, so A = ½r²θ = ½ × 10² × π/2']);
    expect(last('arclen(10, 90)', OFF).notes).toEqual(['θ converted from degrees to radians']);
    expect(last('arclen(10, 1.5)', { ...RAD, working: false }).notes).toEqual([]);
  });
  it('shows the conversion both ways, once for a list', () => {
    expect(last('torad(180)').notes).toEqual(['180° = π rad']);
    expect(last('todeg(π)').notes).toEqual(['π rad = 180°']);
    expect(last('torad({90, 180})').notes).toHaveLength(1);
  });
  it('flips its notes with Working, plotted points included', () => {
    expect([DEG, OFF, DEG].map((s) => last('(sin(30), 1)', s).notes.length)).toEqual([1, 0, 1]);
    expect([DEG, OFF, DEG].map((s) => last('sin(30)', s).notes.length)).toEqual([1, 0, 1]);
  });
  it('reads as on for a sheet saved before it existed, and survives a save when set', () => {
    expect(cleanSettings({}).working).toBe(true);
    expect(cleanSettings({ working: false }).working).toBe(false);
    expect(cleanSettings({ working: 'no' }).working).toBe(true);
  });
});

describe('unit circle and tangent', () => {
  it('shows exact beside decimal, with a figure', () => {
    const v = last('unitcircle(60)').value as RecordV;
    expect(v.figure).toMatchObject({ kind: 'unit-circle', cos: 0.5 });
    expect(recordCell(v, v.rows[2].value, O)).toMatch(/^√3\/2 ≈ 0\.866/);
    expect(recordCell(v, v.rows[1].value, O)).toBe('1/2 ≈ 0.5');
    expect(recordCell(v, v.rows[0].value, O)).toBe('(1/2, √3/2)');
  });
  it('is the plain table with Working off', () => {
    const v = last('unitcircle(60)', OFF).value as RecordV;
    expect(v.figure).toBeUndefined();
    expect(recordCell(v, v.rows[1].value, O)).toBe('0.5');
  });
  it('tanform uses the tangent period and its asymptote', () => {
    const rows = (s: Settings) => (last('tanform(1, 2, 0, 0)', s).value as RecordV).rows.map((r) => r.value);
    expect(rows(DEG).slice(0, 2)).toEqual([1, 90]);
    expect(rows(DEG)[4]).toBe(45);
    expect(rows(RAD)[1]).toBeCloseTo(Math.PI / 2, 12);
  });
});
