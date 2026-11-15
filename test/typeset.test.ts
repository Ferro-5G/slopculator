import { describe, it, expect } from 'vitest';
import { assignsLiteral, prettyText, typeset, type MathBox } from '../src/ui/typeset';

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

  it('shows what the line means: 1/2x is a half of x', () => {
    expect(kinds(typeset('1/2x'))).toEqual(['frac', 'x']);
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
