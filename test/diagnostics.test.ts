import { describe, it, expect } from 'vitest';
import { errorSpan, lineWarnings } from '../src/engine/diagnostics';
import { evaluateDocument, type RowInput } from '../src/engine/document';

const S = { deg: true, complex: false, sample: false };
const run = (text: string, settings = S, before: string[] = []) => {
  const rows = [...before, text].map((t, i): RowInput => ({ id: String(i), kind: 'expr', text: t }));
  return evaluateDocument(rows, settings).at(-1)!;
};
const value = (text: string) => run(text).value;
const first = (text: string, deg = true) => lineWarnings(text, { deg })[0];
const marked = (text: string, s: { start: number; end: number } | null | undefined) => (s ? text.slice(s.start, s.end) : null);

describe('lineWarnings', () => {
  it('flags a negative number raised to a power, and the fix does what it says', () => {
    const w = first('-3^2');
    expect(marked('-3^2', w)).toBe('-3');
    expect(w.fix).toBe('(-3)^2');
    expect(w.message).toContain('−(3^2)');
    expect(value('-3^2')).toBe(-9);
    expect(value(w.fix!)).toBe(9);
    expect(first('5-3^2')).toBeUndefined();
    expect(first('2*-3^2')?.fix).toBe('2*(-3)^2');
    expect(first('(-3)^2')).toBeUndefined();
  });
  it('flags a fraction whose bottom may run on', () => {
    const w = first('1/2(4)');
    expect(w.fix).toBe('1/2*(4)');
    expect(value('1/2(4)')).toBe(0.125);
    expect(value(w.fix!)).toBe(2);
    expect(first('1/2x')?.fix).toBe('1/2*x');
    expect(first('1/2x^2')?.fix).toBe('1/2*x^2');
    expect(first('1/2xy')?.message).toContain('xy is under');
    expect(first('1/2*x')).toBeUndefined();
    expect(first('1/2 + 3')).toBeUndefined();
    expect(first('1/(2x)')).toBeUndefined();
    expect(first('1/sin(30)')).toBeUndefined();
    expect(first('6/2*3')).toBeUndefined();
    expect(first('7 nCr 5')).toBeUndefined();
  });
  it('flags an exponent that may run on, for number bases', () => {
    const w = first('2^3(4)');
    expect(w.fix).toBe('2^(3(4))');
    expect(value('2^3(4)')).toBe(32);
    expect(value(w.fix!)).toBe(4096);
    expect(first('e^2x')?.fix).toBe('e^(2x)');
    expect(first('x^2y')).toBeUndefined();
    expect(first('2^(3x)')).toBeUndefined();
    expect(first('2^3')).toBeUndefined();
    expect(first('2x^2')).toBeUndefined();
  });
  it('flags a function without brackets followed by a sum', () => {
    const w = first('sin 30 + 1');
    expect(marked('sin 30 + 1', w)).toBe('sin 30');
    expect(w.message).toMatch(/sin only covers 30/);
    expect(w.fix).toBeUndefined();
    expect(first('ln 2x - 1')?.message).toMatch(/ln only covers 2x/);
    expect(first('sin(30) + 1')).toBeUndefined();
    expect(first('sin 30')).toBeUndefined();
  });
  it('flags a fraction between a sum on both sides', () => {
    const w = first('1+2/3+4');
    expect(w.fix).toBe('(1+2)/(3+4)');
    expect(value(w.fix!)).toBeCloseTo(3 / 7);
    expect(first('1+2/3')).toBeUndefined();
    expect(first('2/3+4')).toBeUndefined();
    expect(first('(1+2)/(3+4)')).toBeUndefined();
    expect(first('x*1+2/3+4')).toBeUndefined();
  });
  it('flags fractional powers written without brackets around the fraction', () => {
    const w = first('9^1/2');
    expect(w.fix).toBe('9^(1/2)');
    expect(value('9^1/2')).toBe(4.5);
    expect(value(w.fix!)).toBe(3);
    expect(first('8^2/3')?.fix).toBe('8^(2/3)');
    expect(first('x^1/2')?.fix).toBe('x^(1/2)');
    expect(first('16^-1/2')?.fix).toBe('16^(-1/2)');
    expect(first('9^(1/2)')).toBeUndefined();
    expect(first('x^2/2')).toBeUndefined();
    expect(first('x^3/3')).toBeUndefined();
    expect(first('2^1/3^2')).toBeUndefined();
    expect(first('2^1/3√4')).toBeUndefined();
    expect(first('2^1/3[1,2]')).toBeUndefined();
    expect(first('2^1/3{1,2}')).toBeUndefined();
    expect(first('2^1/3|4|')).toBeUndefined();
    expect(first('|2^1/3|')?.fix).toBe('|2^(1/3)|');
    expect(first('2^1÷3')?.fix).toBe('2^(1÷3)');
    expect(first('2^1∕3')?.fix).toBe('2^(1∕3)');
    expect(first('2^1⁄3')?.fix).toBe('2^(1⁄3)');
    expect(first('2^1/3x')?.fix).toBe('2^1/3*x');
  });
  it('flags stacked exponents that group from the right', () => {
    const w = first('2^3^2');
    expect(w.fix).toBe('(2^3)^2');
    expect(value('2^3^2')).toBe(512);
    expect(value(w.fix!)).toBe(64);
    expect(first('2^3**4')?.fix).toBe('(2^3)**4');
    const call = first('sqrt(4)^2^3');
    expect(call.fix).toBe('(sqrt(4)^2)^3');
    expect(value('sqrt(4)^2^3')).toBe(256);
    expect(value(call.fix!)).toBe(64);
    const rad = first('√(4)^2^3');
    expect(rad.fix).toBe('(√(4)^2)^3');
    expect(value('√(4)^2^3')).toBe(256);
    expect(value(rad.fix!)).toBe(64);
    const trig = first('sin(30)^2^3');
    expect(trig.fix).toBe('(sin(30)^2)^3');
    expect(value(trig.fix!)).toBeCloseTo(0.015625);
    expect(first('M[1][2]^2^3')?.fix).toBe('(M[1][2]^2)^3');
    expect(first('(L)[1]^2^3')?.fix).toBe('((L)[1]^2)^3');
    expect(first('(2)[1]^2^3')?.fix).toBe('(2)([1]^2)^3');
    expect(first('x |2|^2^3')?.fix).toBe('x * (|2|^2)^3');
    const bareSin = first('sin 2^3^4');
    expect(bareSin.fix).toBe('sin ((2^3)^4)');
    expect(value(bareSin.fix!)).toBeCloseTo(Math.sin((4096 * Math.PI) / 180));
    const modCase = first('500 mod (2)^2^3');
    expect(modCase.fix).toBe('500 mod ((2)^2)^3');
    expect(value('500 mod (2)^2^3')).toBe(244);
    expect(value(modCase.fix!)).toBe(52);
    const transCase = first('[[1,2],[3,4]]ᵀ[1][2]^2^3');
    expect(transCase.fix).toBe('([[1,2],[3,4]]ᵀ[1][2]^2)^3');
    expect(value('[[1,2],[3,4]]ᵀ[1][2]^2^3')).toBe(6561);
    expect(value(transCase.fix!)).toBe(729);
    expect(first('(2^3)^2')).toBeUndefined();
    expect(first('2^(3^2)')).toBeUndefined();
  });
  it('flags trig that looks like the wrong angle mode', () => {
    expect(first('sin(30)', false)?.message).toMatch(/Radians are on/);
    expect(first('sin(30)', false)?.switchAngle).toBe('deg');
    expect(first('sin(-30)', false)?.switchAngle).toBe('deg');
    expect(first('sin 45', false)?.message).toMatch(/Radians are on/);
    expect(first('sin 30 + 1', false)?.switchAngle).toBe('deg');
    expect(first('sin 30°', false)).toBeUndefined();
    expect(first('sin(30)', true)).toBeUndefined();
    expect(first('sin(30°)', false)).toBeUndefined();
    expect(first('sin(π°)+sin(90)', true)).toBeUndefined();
    expect(first('sin((π + 1)°)', true)).toBeUndefined();
    expect(first('sin((π / 2)°)', true)).toBeUndefined();
    expect(first('sin(π + 0°)', true)?.switchAngle).toBe('rad');
    expect(first('sin(0° + π)', true)?.switchAngle).toBe('rad');
    expect(first('sin(π / 2°)', true)?.switchAngle).toBe('rad');
    expect(first('sin(2)', false)).toBeUndefined();
    expect(first('sin(π/6)', true)?.message).toMatch(/Degrees are on/);
    expect(first('sin(π/6)', true)?.switchAngle).toBe('rad');
    expect(first('sin(π/6)', false)).toBeUndefined();
  });
  it('never warns on blanks, headings, or text it cannot read', () => {
    expect(lineWarnings('', { deg: true })).toEqual([]);
    expect(lineWarnings('# -3^2', { deg: true })).toEqual([]);
    expect(lineWarnings('1 @ 2', { deg: true })).toEqual([]);
  });
  it('keeps positions and the fix right around outer spaces', () => {
    const w = first('  -3^2 ');
    expect(marked('  -3^2 ', w)).toBe('-3');
    expect(w.fix).toBe('  (-3)^2 ');
  });
  it('comes through evaluateDocument, and not on lines with errors', () => {
    expect(run('-3^2').warnings?.[0].fix).toBe('(-3)^2');
    expect(run('1+1').warnings).toBeUndefined();
    expect(run('-3^2+').warnings).toBeUndefined();
    expect(run('sin(30)', { ...S, deg: false }).warnings?.[0].message).toMatch(/Radians/);
  });
});

describe('errorSpan', () => {
  const at = (text: string, before: string[] = [], lineNames = false) => {
    const r = run(text, { ...S, lineNames } as typeof S, before);
    return { error: r.error, part: marked(text, r.errorSpan) };
  };
  it('points at the name that is unknown', () => {
    expect(at('2 + qq + 1').part).toBe('qq');
    expect(at('2*normcdf(1)').part).toBe('normcdf');
  });
  it('points at an empty line reference', () => {
    expect(errorSpan('B + 1', 'Line B is empty')).toEqual({ start: 0, end: 1 });
  });
  it('points at a stray character', () => {
    expect(at('1 , 2').part).toBe(',');
    expect(at('2 * ) 3').part).toBe(')');
  });
  it('points at the bracket that never closes, not the end of the line', () => {
    expect(errorSpan('(1 + (2)', 'Expected ")" to close "(", got end of input', 8)).toEqual({ start: 0, end: 1 });
    expect(at('nCr(7,5)*(0.56').part).toBe('(');
  });
  it('points at the last token when the line stops early', () => {
    expect(at('1 +').part).toBe('+');
    expect(at('nCr(7,5)*0.56^').part).toBe('^');
  });
  it('points at the function a wrong call is about', () => {
    expect(at('2 + nCr(7)').part).toBe('nCr');
  });
  it('keeps the position right around outer spaces', () => {
    expect(errorSpan('  qq', 'Unknown name "qq"')).toEqual({ start: 2, end: 4 });
  });
  it('gives up rather than pointing somewhere wrong', () => {
    expect(errorSpan('', 'Empty expression')).toBeNull();
    expect(errorSpan('1+1', 'Something else entirely')).toBeNull();
  });
});

describe('long expressions in messages', () => {
  it('quotes only the start, so the message fits a phone', () => {
    const [w] = lineWarnings('1/2(1+2+3+4+5+6+7+8+9+10+11+12)', { deg: true });
    expect(w.message).toContain('(1+2+3+4+5+…');
    expect(w.message).not.toContain('11+12');
    expect(w.message.length).toBeLessThan(120);
    expect(w.fix).toBe('1/2*(1+2+3+4+5+6+7+8+9+10+11+12)');
  });
  it('leaves short ones whole', () => {
    expect(lineWarnings('1/2x', { deg: true })[0].message).toContain('x is under the fraction too');
  });
});

