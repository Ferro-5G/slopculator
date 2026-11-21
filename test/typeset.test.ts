import { describe, it, expect } from 'vitest';
import { assignsLiteral, namesKey, prettyText, sheetNames, typeset, type MathBox } from '../src/ui/typeset';
import { cleanSettings, evaluateDocument, type RowInput } from '../src/engine/document';

describe('prettyText', () => {
  it.each([
    ['y = x^2/4 - 3', 'y = x²/4 − 3'],
    ['tax = price * 0.0825', 'tax = price × 0.0825'],
    ['f(x) = 2x+1', 'f(x) = 2x + 1'],
    ['2*x', '2x'],
    ['-2x', '−2x'],
    ['2xy', '2xy'],
    ['x^2 y', 'x²y'],
    ['2*pi*r', '2πr'],
    ['3(x+1)', '3(x + 1)'],
    ['(x+1)(x-1)', '(x + 1)(x − 1)'],
    ['price*(1+tax)', 'price × (1 + tax)'],
    ['(x+1)*2', '(x + 1) × 2'],
    ['2*3', '2 × 3'],
    ['-x^2', '−x²'],
    ['(-2)^2', '(−2)²'],
    ['a-(b+c)', 'a − (b + c)'],
    ['a/(b*c)', 'a/(bc)'],
    ['a/(price*c)', 'a/(price × c)'],
    ['(2^3)^2', '(2³)²'],
    ['x <= 3', 'x ≤ 3'],
    ['sqrt(2)', '√2'],
    ['sqrt(x+1)', '√(x + 1)'],
    ['cbrt(8)', '∛8'],
    ['|x - 1|', '|x − 1|'],
    ['abs(x)', '|x|'],
    ['sin^2(x)', 'sin²(x)'],
    ['5!', '5!'],
    ['20%', '20%'],
    ['1.5e3', '1.5 × 10³'],
    ['2e-4', '2 × 10⁻⁴'],
    ['x_1 + x_2', 'x₁ + x₂'],
    ['monthly_payment * 12', 'monthly_payment × 12'],
    ['normalcdf(-1, 1, 0, 1)', 'normalcdf(−1, 1, 0, 1)'],
    ['log_2(8)', 'log₂(8)'],
    ['5 nCr 2', '5 nCr 2'],
    ['convert(5, "mi", "km")', 'convert(5, "mi", "km")'],
    ['{1, 2, 3}', '{1, 2, 3}'],
    ['x^(1/2)', 'x^(1/2)'],
  ])('%s → %s', (src, out) => {
    expect(prettyText(src)).toBe(out);
  });

  it('leaves a line that does not parse as typed', () => {
    expect(prettyText('normcdf(1')).toBe('normcdf(1');
    expect(prettyText('x = ^')).toBe('x = ^');
  });
});

describe('typeset', () => {
  const kinds = (boxes: MathBox[] | null) => boxes?.map((b) => (b.t === 'run' ? b.s : b.t));

  it('has no form for empty lines, headings and errors', () => {
    expect(typeset('')).toBeNull();
    expect(typeset('# Problem 3')).toBeNull();
    expect(typeset('2 +')).toBeNull();
  });

  it('leaves a line too deeply nested to lay out as plain text, but not a long flat one', () => {
    const nested = (n: number) => `${'sqrt('.repeat(n)}2${')'.repeat(n)}`;
    expect(typeset(nested(300))).toBeNull();
    expect(typeset(nested(20))).not.toBeNull();
    expect(typeset(Array.from({ length: 500 }, (_, k) => k).join('+'))).not.toBeNull();
  });

  it('draws a name like constructor as the name, not as Object.prototype\'s', () => {
    const text = (boxes: MathBox[] | null) => JSON.stringify(boxes);
    expect(text(typeset('constructor = 5'))).not.toMatch(/native code/);
    expect(text(typeset('constructor = 5'))).toMatch(/"constructor"/);
    expect(typeset('toString + 1')).not.toBeNull();
  });

  it('stacks short fractions, and not when asked not to', () => {
    expect(kinds(typeset('x^2/4'))).toEqual(['frac']);
    expect(kinds(typeset('x^2/4', { stack: false }))).toEqual(['sup', '/', '4']);
  });

  it('keeps long fractions on one line, and never stacks inside a fraction or an exponent', () => {
    expect(kinds(typeset('(price + tax + shipping)/4'))).toEqual(['fence', '/', '4']);
    const f = typeset('(1/2)/3')![0];
    expect(f.t).toBe('frac');
    if (f.t === 'frac') expect(kinds(f.num)).toEqual(['1', '/', '2']);
    const s = typeset('e^(1/2)')![0];
    if (s.t === 'sup') expect(kinds(s.exp)).toEqual(['1', '/', '2']);
  });

  it('shows what the line means: 1/2x is over 2x, as in Desmos', () => {
    expect(kinds(typeset('1/2x'))).toEqual(['frac']);
    expect(kinds(typeset('1/2*x'))).toEqual(['frac', 'x']);
  });

  it('draws a matrix of equal rows as a matrix, and anything else as a list', () => {
    const m = typeset('[[1,2],[3,4]] * 2')!;
    expect(m[0].t).toBe('matrix');
    if (m[0].t === 'matrix') expect(m[0].rows.length).toBe(2);
    expect(typeset('[[1,2],[3]]')![0].t).toBe('fence');
  });

  it('gives one-letter names the italic role and longer names the upright one', () => {
    const roles = typeset('x + price')!.filter((b) => b.t === 'run').map((b) => b.t === 'run' && b.role);
    expect(roles).toEqual(['var', 'op', 'name']);
  });

  it('marks brackets tall around a fraction', () => {
    const f = typeset('2(x/3 + 1)')!;
    const fence = f.find((b) => b.t === 'fence');
    expect(fence && fence.t === 'fence' && fence.tall).toBe(true);
  });

  it('draws a piecewise function as cases', () => {
    const c = typeset('{x < 0: -x, x}')![0];
    expect(c.t).toBe('cases');
    if (c.t === 'cases') expect(c.rows.length).toBe(2);
  });
});

describe('assignsLiteral', () => {
  it.each([
    ['price = 24.99', true],
    ['n = 5', true],
    ['t = -3', true],
    ['tax = price * 0.0825', false],
    ['y = x^2', false],
    ['f(x) = 2', false],
    ['x = 2 + 3', false],
    ['5 = 5', false],
    ['24.99', false],
    ['x < 5', false],
    ['price = ', false],
  ])('%s → %s', (src, out) => {
    expect(assignsLiteral(src)).toBe(out);
  });
});

describe('words the engine reads as letters', () => {
  const sheet = (...texts: string[]) => {
    const rows: RowInput[] = texts.map((text, k) => ({ id: `r${k}`, kind: 'expr', text }));
    return sheetNames(rows, evaluateDocument(rows, cleanSettings({ deg: true })));
  };
  /** Each run of a typeset line with its role, flattened: "k:var x:var". */
  const runs = (src: string, names = sheet()): string => {
    const out: string[] = [];
    const walk = (bs: MathBox[]) => bs.forEach((b) => {
      if (b.t === 'run') out.push(`${b.s}:${b.role}`);
      else if (b.t === 'sup') { walk(b.base); walk(b.exp); }
      else if (b.t === 'sub') { walk(b.base); walk(b.sub); }
      else if (b.t === 'frac') { walk(b.num); walk(b.den); }
      else if (b.t === 'sqrt') walk(b.body);
      else if (b.t === 'fence') walk(b.body);
    });
    walk(typeset(src, { names })!);
    return out.filter((r) => !/^[()=,]:/.test(r) && !r.startsWith('= ')).join(' ');
  };
  it('sets kx as italic k times x when k is defined, as the engine splits it', () => {
    expect(runs('y = 2sin(kx)', sheet('k = 45'))).toBe('y:var 2:num sin:fn k:var x:var');
  });
  it('leaves kx one upright name when k is not defined, since the engine reads no letters there', () => {
    expect(runs('y = 2sin(kx)')).toBe('y:var 2:num sin:fn kx:name');
  });
  it('keeps defined names, functions, constants and unknown words whole', () => {
    const names = sheet('rate = 0.05', 'r = 2', 'a = 1', 't = 3', 'e2 = 1', 'area(s) = s^2');
    expect(runs('rate * 12', names)).toBe('rate:name ×:op 12:num');
    expect(runs('area(3) + sin(t)', names)).toBe('area:fn 3:num +:op sin:fn t:var');
    expect(runs('tag + 1', names)).toBe('tag:name +:op 1:num');
    expect(runs('tax', names)).toBe('t:var a:var x:var');
  });
  it('splits a word made of x, y and constants with no sheet at all (xy, ex)', () => {
    expect(runs('2xy')).toBe('2:num x:var y:var');
    expect(prettyText('2xy')).toBe('2xy');
  });
  it("counts a function's own inputs: f(t) = kt is k times t", () => {
    expect(runs('f(t) = kt', sheet('k = 2'))).toBe('f:var t:var k:var t:var');
    expect(runs('g(s) = kt', sheet('k = 2'))).toBe('g:var s:var kt:name');
  });
  it('splits a word before a bracket into letters times the bracket when it names no function', () => {
    expect(runs('ab(1 + x)', sheet('a = 1', 'b = 2'))).toBe('a:var b:var 1:num +:op x:var');
    expect(runs('ab(1 + x)', sheet('a = 1', 'b = 2', 'ab(s) = s'))).toBe('ab:fn 1:num +:op x:var');
  });
  it('reads sliders and table columns as defined, and keys change with them', () => {
    const rows: RowInput[] = [{ id: 't', kind: 'table', columns: [{ header: 'n', cells: ['1'] }] }, { id: 'a', kind: 'expr', text: 'm = 3' }];
    const names = sheetNames(rows, evaluateDocument(rows, cleanSettings({})));
    expect(runs('mn', names)).toBe('m:var n:var');
    expect(namesKey(names)).not.toBe(namesKey(sheet('m = 3')));
  });
});
