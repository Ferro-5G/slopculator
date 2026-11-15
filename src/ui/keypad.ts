import { leadingCall } from './brackets';

export interface Key {
  label: string;
  /** Text to insert. "¦" marks where the caret lands; default is the end. */
  ins?: string;
  action?: 'left' | 'right' | 'back' | 'enter' | 'clear' | 'clearall' | 'matrix' | 'table';
  title?: string;
  sub?: string;
  /**
   * hero: the keys a bank exists for, listed first and drawn as plain function keys (enter is the one accent key;
   * see drawTone). red: AC, which clears every line, drawn with red text.
   */
  tone?: 'num' | 'op' | 'fn' | 'act' | 'hero' | 'red';
}

export interface Panel {
  name: string;
  /** The bank's keys, column by column: top, bottom, then the next column. Its hero keys are in the first six. */
  keys: Key[];
}

const fn = (name: string, title: string, sub?: string, label = name): Key => ({ label, ins: `${name}(¦)`, title, sub, tone: 'fn' });
const hero = (name: string, title: string, sub?: string): Key => ({ label: name, ins: `${name}(¦)`, title, sub, tone: 'hero' });
const op = (label: string, ins = label, title?: string, sub?: string): Key => ({ label, ins, title, sub, tone: 'op' });
const name = (name: string, title: string, sub?: string): Key => ({ label: name, ins: name, title, sub, tone: 'fn' });
const d = (label: string): Key => ({ label, ins: label, tone: 'num' });
const act = (label: string, action: Key['action'], title: string, sub?: string): Key => ({ label, action, title, sub, tone: 'act' });

/** Legends say × ÷ −; the keys type * / -, which is what the line reads. */
export const PAD: Key[][] = [
  [act('←', 'left', 'Move the caret left. Hold to repeat, or slide to move it along'), act('→', 'right', 'Move the caret right. Hold to repeat, or slide to move it along'), d('7'), d('8'), d('9'), op('×', '*', 'Multiply')],
  [op('xʸ', '^', 'Power'), op('√', '√(¦)', 'Square root'), d('4'), d('5'), d('6'), op('−', '-', 'Subtract')],
  [op('(', '('), op(')', ')'), d('1'), d('2'), d('3'), op('+', '+', 'Add')],
  // , and = type just themselves: the typeset line spaces them, and no space the app put in hides between them and
  // the caret (a tap landed between the comma and an invisible space, and a fix could give a wrong answer).
  [op(',', ',', 'Separates inputs: f(a, b)'), op('=', '=', 'Define a variable, graph a curve or write an equation'), d('0'), d('.'), act('⌫', 'back', 'Backspace. Hold to clear the line; Undo brings it back', 'hold: clear'), { label: 'enter', action: 'enter', title: 'New line (Enter)', tone: 'hero' }],
];

export function padRows(padLeft = false): Key[][] {
  if (!padLeft) return PAD;
  return PAD.map((r, i) => {
    if (i < PAD.length - 1) return [r[5], r[2], r[3], r[4], r[0], r[1]];
    // , = 0 . ⌫ enter → enter ⌫ 0 . = ,
    return [r[5], r[4], r[2], r[3], r[1], r[0]];
  });
}

export const ANS: Key = { label: 'ans', ins: 'ans', title: 'Answer from the line above', tone: 'fn' };
export const AC: Key = { label: 'AC', action: 'clearall', title: 'Clear every line (Ctrl+Alt+Backspace). Ctrl+Z brings them back', tone: 'red' };
export const DIV: Key = op('÷', '/', 'Divide');

export const LONG_LABEL = 7;
/** Every caption's size, in points (dp, px), on every platform and in both looks. One that can't fit is left off. */
export const CAPTION_MIN = 11;
const CAPTION_ROOM = 50;
/** No key label is drawn smaller than this, in points (dp, px). */
export const LABEL_MIN = 12;
export const LABEL_TWO = 13;
export const LABEL_ONE = 15;
export const CLEAR_ARM_MS = 250;
export const CLEAR_MS = 800;
export const CARET_DELAY_MS = 380;
export const CARET_REPEAT_MS = 60;
/** How far a slide on a caret key goes per step, in points (dp, px). */
export const CARET_SCRUB = 12;

export const keyCall = (k: Key): string | null => leadingCall(k.ins ?? '');

export function keyCaption(k: Key): string | undefined {
  if (!k.sub) return undefined;
  if (k.action === 'back') return k.sub;
  if ([...k.label].length >= LONG_LABEL || keyLegend(k.label).length > 1) return undefined;
  return textFits(k.sub, 'mono', CAPTION_MIN, CAPTION_ROOM) ? k.sub : undefined;
}

export const isWordKey = (k: Key): boolean => legendText(k.label) !== k.label || (/^[A-Za-z_][A-Za-z0-9_ +]*$/.test(k.label) && k.label.length > 2);

export function captionRows(padLeft = false): boolean[] {
  return padRows(padLeft).map((row) => row.some((k) => !!keyCaption(k)));
}

export function captionedLabelCentre(height: number, clear = 26): number {
  return Math.min(height * 0.46, height - clear);
}

/** One entry is one line; two are the two lines it goes on when one won't fit, broken between words, never inside one. */
const LEGENDS: Record<string, string[]> = {
  // Algebra: log with its caption, base b, beside log base 10
  log_b: ['log'],
  // Matrix
  transpose: ['Aᵀ'],
  linsolve: ['linear', 'solve'],
  reflectx: ['reflect', 'x-axis'],
  reflecty: ['reflect', 'y-axis'],
  reflectyx: ['reflect', 'y = x'],
  // Trig
  unitcircle: ['unit', 'circle'],
  trigform: ['trig', 'form'],
  tanform: ['tan', 'form'],
  // Calculus, Data, Chance and Inference
  deriv2: ['2nd', 'deriv'],
  quadreg: ['parabola', 'fit'],
  polyval: ['poly', 'value'],
  chi2cdf: ['χ²', 'cdf'],
  geompdf: ['first', 'success'],
  poissonpdf: ['Poisson', 'pdf'],
  poissoncdf: ['Poisson', 'cdf'],
  isprime: ['prime?'],
  invT: ['inverse', 't'],
  // percentile(list, p): a list's value at a share of the way up. "percentile" doesn't fit a 375 pt key at 12 pt.
  percentile: ['data', 'quantile'],
  // Normal
  normaldist: ['normal', 'curve'],
  normalcdf: ['normal', 'cdf'],
  normalpdf: ['normal', 'pdf'],
  zscore: ['z-score'],
  x_from_z: ['x from z'],
  zcrit: ['z crit'],
  // Data and Chance
  fivenum: ['five', 'number'],
  binompdf: ['binomial', 'pdf'],
  binomcdf: ['binomial', 'cdf'],
  binomge: ['binomial', '≥'],
  binomgt: ['binomial', '>'],
  binomlt: ['binomial', '<'],
  binomdist: ['binomial', 'graph'],
  binomstats: ['binomial', 'stats'],
  netgain: ['net', 'gain'],
  // Money
  compound: ['(1+r/n)ⁿᵗ'],
  continuous: ['Peʳᵗ'],
  pctchange: ['percent', 'change'],
  // Air
  wetbulb: ['wet', 'bulb'],
  dewpoint: ['dew', 'point'],
  shratio: ['sensible', 'ratio'],
  psychwb: ['psych', 'from wb'],
  psychdp: ['psych', 'from dp'],
  specvol: ['specific', 'volume'],
  humratio: ['humidity', 'ratio'],
  airflow: ['air', 'flow'],
  temprise: ['temp', 'rise'],
  mixtemp: ['mixed', 'temp'],
  // Refrig: superheat and subcool by name, their SH and SC as the captions
  superheat: ['super', 'heat'],
  subcool: ['sub', 'cool'],
  ptchart: ['P-T', 'chart'],
  refcycle: ['refrig', 'cycle'],
  sattemp: ['sat', 'temp'],
  refprops: ['refrig', 'props'],
  tbubble: ['bubble', 'temp'],
  pbubble: ['bubble', 'pressure'],
  tdew: ['dew', 'temp'],
  pdew: ['dew', 'pressure'],
  psat: ['water', 'pressure'],
  eertocop: ['EER', 'to COP'],
  coptoeer: ['COP', 'to EER'],
  coptokw: ['COP to', 'kW/ton'],
  kwtocop: ['kW/ton', 'to COP'],
  // Flow
  ductvel: ['duct', 'velocity'],
  ductloss: ['duct', 'loss'],
  ductsize: ['duct', 'size'],
  ductdia: ['duct', 'diameter'],
  eqdia: ['equal', 'diameter'],
  rectduct: ['rectangle', 'duct'],
  velpress: ['velocity', 'pressure'],
  fanlaws: ['fan', 'laws'],
  fanpower: ['fan', 'power'],
  achflow: ['ACH', 'flow'],
  ventair: ['vent', 'air'],
  pipevel: ['pipe', 'velocity'],
  pipeloss: ['pipe', 'loss'],
  valvecv: ['valve', 'Cv'],
  gasinput: ['gas', 'input'],
  'V imbal': ['voltage', 'balance'],
};

/**
 * Faces that are one word broken for room on a key (super / heat), the one exception to breaking only between words.
 * Anywhere they're written on one line, a menu row or a search's words, they read as the word.
 */
const ONE_WORD = new Set(['superheat', 'subcool']);

export function keyLegend(label: string): string[] {
  if (LEGENDS[label]) return LEGENDS[label];
  const space = label.indexOf(' ');
  return space > 0 ? [label.slice(0, space), label.slice(space + 1)] : [label];
}

/** invNorm keeps its own name on its face: "percentile" can't fit the
 * narrowest key on one line at 12 px, nor as an 11 px caption, and a face is never broken inside a word. Its title and
 * search say normal percentile. */
export const joinLegend = (lines: readonly string[]): string => lines.join(' ');

export const legendText = (label: string): string => (ONE_WORD.has(label) ? label : joinLegend(keyLegend(label)));

/**
 * Whether `text` fits `width` at `size` without measuring it: mono characters are all 0.6 em; in a sans face narrow
 * ones (i, l, spaces, stops) set about 0.3 em and the rest about 0.55; in a condensed face about 0.28 and 0.5.
 */
export function textFits(text: string, face: 'mono' | 'sans' | 'condensed', size: number, width: number): boolean {
  const narrow = /[ilIj.,:;·' |!]/;
  const em = [...text].reduce((w, c) => w + (face === 'mono' ? 0.6 : narrow.test(c) ? (face === 'sans' ? 0.3 : 0.28) : face === 'sans' ? 0.55 : 0.5), 0);
  return em * size <= width;
}

export function keyLines(label: string, width: number, face: 'mono' | 'sans' = 'mono'): string[] {
  const lines = keyLegend(label);
  return lines.length > 1 && textFits(joinLegend(lines), face, LABEL_TWO, width) ? [joinLegend(lines)] : lines;
}

export function drawTone(k: Key): 'num' | 'fn' | 'op' | 'act' | 'hero' {
  if (k.action === 'enter') return 'hero';
  if (k.tone === 'hero') return 'fn';
  // On the function key's cap: the editing keys' darker cap leaves Retro's red legend under 3:1.
  if (k.tone === 'red') return 'fn';
  return k.tone ?? 'fn';
}

const ARITHMETIC = new Set(['÷', '×', '−', '+']);
export function capTone(k: Key): 'num' | 'fn' | 'op' | 'act' | 'hero' {
  const t = drawTone(k);
  return t === 'op' && !ARITHMETIC.has(k.label) ? 'fn' : t;
}

/** Modern sets a lone operator a size up in the sans face. tone is what the platform draws the key as. The asterisk stays mono: sans faces set it high, like a superscript. */
export const bigOp = (k: Key, tone: Key['tone']): boolean => tone === 'op' && !k.sub && [...k.label].length === 1 && k.label !== '*';

// Each line of a bank below is one column: its top key, then the key under it.
const panel = (name: string, keys: Key[]): Panel => ({ name, keys });

export const PANELS: Panel[] = [
  // The everyday extras, by how often you reach for them between digits.
  panel('Basic', [
    op('x', 'x'), op('y', 'y'),
    op('π', 'π', 'Pi, 3.14159…'), op('e', 'e', "Euler's number, 2.71828…"),
    op('x²', '^2', 'Square'), op('x⁻¹', '^-1', 'Reciprocal'),
    op('%', '%', 'Percent: 50% = 0.5'), op('|x|', '|¦|', 'Absolute value'),
    op('n!', '!', 'Factorial: 5! = 120'),
  ]),
  // Math. Algebra: logs and powers, solving, roots, rounding, whole numbers and complex parts. The trig functions live
  // only on Trig.
  panel('Algebra', [
    hero('ln', 'Natural log, base e', 'base e'), op('eˣ', 'e^', 'e to a power'),
    hero('log', 'log(x) is base 10; log(b, x) is base b', 'base 10'), op('10ˣ', '10^', '10 to a power'),
    hero('solve', 'solve(equation, x) or solve(equation, x, guess)', 'find x'), fn('quad', 'quad(a, b, c): roots of ax² + bx + c', 'ax²+bx+c'),
    op('log_b', 'log_¦()', 'Any base: log_2(8) = 3', 'base b'), op('E', 'E', 'Scientific notation: 1.5E3 = 1500', '×10ⁿ'),
    op('∛', '∛(¦)', 'Cube root'), fn('nthroot', 'nthroot(x, n)', 'nth root', 'ⁿ√'),
    fn('abs', 'Absolute value', '|x|'), fn('round', 'round(x, places)', 'x, places'),
    fn('floor', 'Round down', '↓'), fn('ceil', 'Round up', '↑'),
    fn('mod', 'mod(a, b): remainder', 'remainder'), fn('rem', 'rem(a, b): remainder with the sign of a', 'a mod b'),
    fn('quot', 'quot(a, b): whole-number quotient', 'a ÷ b'), fn('gcd', 'Greatest common divisor', 'gcd'),
    fn('lcm', 'Least common multiple', 'lcm'), fn('factor', 'factor(360) = 2³ · 3² · 5', 'primes'),
    fn('isprime', 'isprime(n) → 1 or 0', 'prime?'), fn('divisors', 'Every divisor of n', 'all d|n'),
    fn('re', 'Real part', 'real'), fn('im', 'Imaginary part', 'imag'),
    fn('arg', 'Angle of a complex number (Deg/Rad)', 'angle'), fn('conj', 'Conjugate', 'a − bi'),
    op('a', 'a'), op('b', 'b'),
    op('c', 'c'), op('n', 'n'),
  ]),
  panel('Trig', [
    hero('sin', 'Sine (uses Deg/Rad)'), fn('asin', 'Inverse sine; the range shows under the answer', 'arcsin', 'sin⁻¹'),
    hero('cos', 'Cosine (uses Deg/Rad)'), fn('acos', 'Inverse cosine', 'arccos', 'cos⁻¹'),
    hero('tan', 'Tangent (uses Deg/Rad)'), fn('atan', 'Inverse tangent', 'arctan', 'tan⁻¹'),
    op('π', 'π'), op('°', '°', 'Degrees: 30° works in either mode', 'degrees'),
    op('θ', 'θ', 'Theta (type theta)'), fn('atan2', 'atan2(y, x): angle of a point, all quadrants', '(y, x)'),
    fn('csc', 'Cosecant', '1/sin'), fn('sec', 'Secant', '1/cos'),
    fn('cot', 'Cotangent', '1/tan'), op('sin²', 'sin(¦)^2', 'sin(x)²'),
    fn('torad', 'Degrees → radians', '° → rad'), fn('todeg', 'Radians → degrees', 'rad → °'),
    fn('arclen', 'arclen(r, θ) = rθ', 'rθ'), fn('sector', 'sector(r, θ) = ½r²θ', '½r²θ'),
    fn('unitcircle', 'unitcircle(θ): exact (cos θ, sin θ)', 'cos, sin'), fn('period', 'period(b) = 2π/|b| or 360/|b|', '2π/b'),
    op('y =', 'y = ', 'Graph it'), op('x', 'x'),
    fn('trigform', 'trigform(a, b, c, d): amplitude, period, shift, midline of a·sin(b(x − c)) + d', 'amp·period'),
    fn('tanform', 'tanform(a, b, c, d): period and asymptotes of a·tan(b(x − c)) + d', 'tan period'),
  ]),
  // Calculus: slopes and areas, polynomials, sums and sequences.
  panel('Calculus', [
    hero('deriv', 'deriv(expr, x, a): slope at x = a. In a graph, y = deriv(x^3, x)', 'd/dx'), fn('deriv2', 'deriv2(expr, x, a): second derivative', 'd²/dx²'),
    { label: '∫', ins: 'integral(¦, x, , )', title: 'integral(expr, x, a, b); -inf and inf work as bounds', sub: 'area', tone: 'hero' }, op('t', 't', 'The variable t. deriv and ∫ work with it as well as x'),
    hero('roots', 'roots(a, b, c, …): every root of a polynomial, highest power first', 'p(x) = 0'), fn('polyval', 'polyval({a, b, c}, x) = ax² + bx + c', 'p(x)'),
    fn('sum', 'sum(list) or sum(expr, n, a, b)', 'Σ'), fn('seq', 'seq(expr, n, a, b): a list', 'list'),
    fn('gamma', 'Γ(x); gamma(n) = (n − 1)!', 'Γ(x)'),
  ]),
  panel('Matrix', [
    act('new matrix', 'matrix', 'Build a matrix in a grid', 'grid editor'), op('[[ ]]', '[[¦]]', 'Matrix: [[1,2],[3,4]]', 'matrix'),
    hero('det', 'Determinant', '|A|'), hero('inv', 'Inverse', 'A⁻¹'),
    op('A^-1', '^-1', 'Inverse power', 'inverse'), fn('transpose', 'Transpose', 'Aᵀ'),
    op('[ ]', '[¦]', 'A vector or a matrix row', 'row'), op('⟨ ⟩', '⟨¦⟩', 'Vector: ⟨3, 4⟩', 'vector'),
    fn('identity', 'identity(n)', 'Iₙ'), fn('rref', 'Reduced row echelon form', 'reduce'),
    fn('linsolve', 'linsolve(A, B) = A⁻¹B solves AX = B', 'AX = B'), fn('trace', 'Sum of the diagonal', 'Σ diag'),
    fn('rank', 'Number of independent rows', 'rank'), fn('eigen', 'Eigenvalues of a 2×2 or 3×3 matrix', 'λ'),
    fn('dot', 'Dot product', 'u·v'), fn('cross', 'Cross product (3D)', 'u×v'),
    fn('mag', 'Magnitude', '‖v‖'), fn('unit', 'Unit vector', 'v/‖v‖'),
    fn('vec', 'vec(x, y)', '⟨x, y⟩'), fn('angle', 'Angle between vectors', 'θ'),
    fn('rotation', 'rotation(θ): rotation matrix, counterclockwise', 'turn θ'), fn('dilation', 'dilation(k)', 'scale k'),
    name('reflectx', 'Reflect over the x-axis', 'over x'), name('reflecty', 'Reflect over the y-axis', 'over y'),
    name('reflectyx', 'Reflect over y = x', 'over y=x'), fn('apply', 'apply(M, points)', 'M · pts'),
  ]),
  // Stats. Normal: the bell curve. Data: summaries of a list, and fits. Chance: counting and the discrete
  // distributions. Inference: t and χ², critical values, margins of error.
  panel('Normal', [
    { label: 'normaldist', ins: 'normaldist(0, 1)', title: 'normaldist(μ, σ): the curve on the graph, with a Cumulative probability box and Min/Max bounds', sub: 'curve + shading', tone: 'hero' }, fn('zscore', 'zscore(x, μ, σ) = (x − μ)/σ', '(x−μ)/σ'),
    hero('normalcdf', 'normalcdf(z) = P(Z ≤ z); normalcdf(a, b); normalcdf(a, b, μ, σ) = P(a ≤ X ≤ b)', 'P(a<X<b)'), fn('x_from_z', 'x_from_z(z, μ, σ) = μ + zσ', 'μ + zσ'),
    hero('invNorm', 'Normal percentile: invNorm(p) → the z with P(Z ≤ z) = p, so invNorm(0.95) = 1.645 is the 95th percentile; invNorm(p, μ, σ) → x', 'area → z'), fn('normalpdf', 'normalpdf(x, μ, σ): height of the curve', 'height'),
    op('−∞', '-inf', 'Negative infinity, for an open left bound', '-inf'), op('∞', 'inf', 'Infinity, for an open right bound', 'inf'),
    fn('normleft', 'normleft(x, μ, σ) = P(X < x)', 'P(X<x)', 'left tail'), fn('normright', 'normright(x, μ, σ) = P(X > x)', 'P(X>x)', 'right tail'),
    fn('normbetween', 'normbetween(a, b, μ, σ) = P(a < X < b)', 'P(a<X<b)', 'between'), fn('normoutside', 'normoutside(a, b, μ, σ) = P(X < a or X > b)', 'both tails', 'outside'),
    op('μ', 'μ', 'Mean (type mu)'), op('σ', 'σ', 'Standard deviation (type sigma)'),
    op('μ =', 'μ = ', 'Define μ; it gets a slider'), op('σ =', 'σ = ', 'Define σ; it gets a slider'),
    fn('empirical', 'empirical(μ, σ) lists cut points; empirical(μ, σ, a, b) adds up the 34 / 13.5 / 2.35 / 0.15 slices', '68·95·99.7'),
  ]),
  panel('Data', [
    hero('mean', 'Mean of a list', 'x̄'), op('{ }', '{¦}', 'A list: {2, 5, 7}', 'list'),
    hero('sdp', 'Population SD (÷ n). The course default', '÷ n'), fn('sds', 'Sample SD (÷ n−1)', '÷ n−1'),
    fn('median', 'Median', 'middle'), hero('linreg', 'linreg(xs, ys): a, b, r, r² for y = ax + b', 'y = ax+b'),
    fn('mode', 'Mode', 'most'), fn('range', 'Max − min', 'max−min'),
    act('+ table', 'table', 'Add a table for outcomes and probabilities, or data columns', 'x, P, E(X)'), fn('quartiles', 'Q1, median, Q3, IQR', 'Q1–Q3'),
    fn('fivenum', 'Min, Q1, median, Q3, max', 'box plot'), fn('stats', 'n, mean, σ, s, Σx at once', 'summary'),
    fn('percentile', 'Data percentile: percentile(list, p), the value p% of the way up a list (p from 0 to 100)', 'p%'), fn('corr', 'corr(xs, ys): correlation r', 'r'),
    fn('quadreg', 'quadreg(xs, ys): y = ax² + bx + c', 'ax²+bx+c'), fn('expreg', 'expreg(xs, ys): y = a·b^x', 'a·bˣ'),
    fn('sd', 'SD using the Pop/Sample switch', 'switch'), fn('varp', 'Population variance', 'σ²'),
    fn('sort', 'Sort a list', 'low→high'), fn('max', 'Largest value in a list', 'top'),
    fn('min', 'Smallest value in a list', 'bottom'),
  ]),
  panel('Chance', [
    hero('binompdf', 'binompdf(n, p, k) = P(X = k)', 'P(X=k)'), hero('binomcdf', 'binomcdf(n, p, k) = P(X ≤ k)', 'P(X≤k)'),
    hero('nCr', 'Combinations: nCr(8, 3) = 56', 'choose'), fn('nPr', 'Permutations: nPr(5, 2) = 20', 'arrange'),
    hero('EV', 'EV({values}, {probabilities}): expected value, warns if ΣP ≠ 1', 'Σ x·p'), op('{ }', '{¦}', 'A list: {0.2, 0.5, 0.3}', 'list'),
    fn('binomge', 'binomge(n, p, k) = P(X ≥ k)', 'P(X≥k)'), fn('binomgt', 'binomgt(n, p, k) = P(X > k)', 'P(X>k)'),
    fn('binomlt', 'binomlt(n, p, k) = P(X < k)', 'P(X<k)'), fn('binombetween', 'binombetween(n, p, a, b) = P(a ≤ X ≤ b)', 'P(a≤X≤b)', 'between'),
    { label: 'binomdist', ins: 'binomdist(10, 0.5)', title: 'binomdist(n, p): bars on the graph, with a Cumulative box', sub: 'bars', tone: 'fn' }, fn('binomstats', 'Mean, variance, SD of a binomial', 'np, σ'),
    fn('geompdf', 'geompdf(p, k): first success on trial k', '1st on k'), fn('poissonpdf', 'poissonpdf(λ, k) = P(X = k)', 'λ, =k'),
    fn('poissoncdf', 'poissoncdf(λ, k) = P(X ≤ k)', 'λ, ≤k'), fn('netgain', 'netgain({values}, {probs}, cost) = EV − cost', 'EV − cost'),
    fn('count', 'count(a, b, c) = a·b·c (counting principle)', 'a·b·c'), op('p', 'p', 'Probability variable'),
  ]),
  panel('Inference', [
    hero('zcrit', 'Middle area: zcrit(0.95) = 1.96, the z that leaves the middle 95% (the 95th percentile is invNorm(0.95) = 1.645)', 'mid 95%'), hero('invT', 'invT(p, df): t with area p to its left', 'area → t'),
    hero('tcdf', 'tcdf(a, b, df) = P(a ≤ T ≤ b)', 't area'), fn('moe', 'moe(n) = 1/√n; moe(z, n) = z/√n', '1/√n'),
    fn('phat', 'phat(x, n) = x/n', 'x/n'), fn('sep', 'sep(p, n) = √(p(1−p)/n)', 'SE'),
    fn('moep', 'moep(p̂, n, z) = z·√(p̂(1−p̂)/n)', 'z·SE'), fn('chi2cdf', 'chi2cdf(a, b, df)', 'χ²'),
  ]),
  // Graph, with Geometry's points and shapes as its last columns.
  panel('Graph', [
    { label: 'y =', ins: 'y = ', title: 'Graph y as a function of x', tone: 'hero' }, op('x', 'x'),
    op('x =', 'x = ', 'Vertical line or x as a function of y'), op('y', 'y'),
    op('f(x)=', 'f(x) = ', 'Define a function; it graphs too'), op('( , )', '(¦, )', 'A point'),
    op('<', ' < ', 'Shade below (dashed edge)'), op('>', ' > ', 'Shade above (dashed edge)'),
    op('≤', ' <= ', 'Shade below (solid edge)'), op('≥', ' >= ', 'Shade above (solid edge)'),
    op('{x>0}', ' {x > ¦0}', 'Domain restriction: y = x² {x > 0}', 'domain'), op('{ : }', '{x < 0: ¦, }', 'Piecewise: {x < 0: −x, x}', 'piecewise'),
    op('a =', 'a = ', 'Define a; it gets a slider', 'slider'), op('b =', 'b = ', 'Define b; it gets a slider', 'slider'),
    op('c =', 'c = ', 'Define c; it gets a slider', 'slider'), op('d =', 'd = ', 'Define d; it gets a slider', 'slider'),
    fn('distance', 'distance(p, q)', '|pq|'), fn('slope', 'slope(p, q)', 'rise/run'),
    fn('midpoint', 'midpoint(p, q)', 'middle'), fn('area', 'area(polygon) or area of listed points (shoelace)', 'shoelace'),
    fn('polygon', 'polygon((0,0), (1,0), (0,1)): draw a shape', 'shape'),
  ]),
  // Money and units: payments and interest, unit conversion and number bases. "Money & units" doesn't fit the bank
  // button a key wide at 12 px; "Units & $" does.
  panel('Units & $', [
    { label: 'convert', ins: 'convert(¦, "mi", "km")', title: 'convert(x, "from", "to"): length, mass, time, volume, area, speed, °C/°F/K, data, angle, pressure, power, energy, flow', sub: 'units', tone: 'hero' }, hero('pmt', 'pmt(rate per period, periods, loan): payment', 'payment'),
    hero('compound', 'compound(P, r, n, t) = P(1 + r/n)^(nt)', 'P(1+r/n)ⁿᵗ'), fn('simple', 'simple(P, r, t) = P(1 + rt)', 'P(1+rt)'),
    fn('continuous', 'continuous(P, r, t) = Pe^(rt)', 'Peʳᵗ'), fn('pctchange', 'pctchange(old, new) in percent', '% change'),
    op('" "', '"¦"', 'Text in quotes, for units and digits', 'text'), fn('hex', 'hex(255) = "FF"', 'base 16'),
    fn('bin', 'bin(10) = "1010"', 'base 2'), { label: 'dec', ins: 'dec("¦", 16)', title: 'dec("ff", 16) = 255', sub: 'to base 10', tone: 'fn' },
  ]),
  // HVAC: three banks in US units. "SI" as the last input switches any of them to metric.
  panel('Air', [
    hero('psych', 'psych(db, rh): dry bulb °F and %RH → wet bulb, dew point, enthalpy, humidity, volume, density. Add altitude in ft', 'all'), fn('wetbulb', 'wetbulb(db, rh): °F', 'db, rh'),
    hero('enthalpy', 'enthalpy(db, rh): Btu/lb dry air', 'Btu/lb'), fn('dewpoint', 'dewpoint(db, rh): °F', 'db, rh'),
    hero('coil', 'coil(cfm, edb, erh, ldb, lrh): total, sensible and latent load, tons, SHR, condensate', 'tons'), hero('coilwb', 'coilwb(cfm, edb, ewb, ldb, lwb): the same from wet bulb readings', 'from wb'),
    fn('grains', 'grains(db, rh): grains of moisture per lb dry air', 'gr/lb'), op('SI', '"SI"', 'Last input of an HVAC function: use °C, m, L/s, kPa', 'metric'),
    fn('sensibleheat', 'sensibleheat(cfm, ΔT) = 1.08·CFM·ΔT in Btu/h', '1.08QΔT', 'sensible'), fn('latentheat', 'latentheat(cfm, Δgrains) = 0.68·CFM·Δgr in Btu/h', '.68QΔgr', 'latent'),
    fn('totalheat', 'totalheat(cfm, Δh) = 4.5·CFM·Δh in Btu/h', '4.5QΔh', 'total'), fn('shratio', 'shratio(sensible, total)', 'SHR'),
    fn('psychwb', 'psychwb(db, wb): every property from dry bulb and wet bulb', 'from wb'), fn('psychdp', 'psychdp(db, dp): every property from dry bulb and dew point', 'from dp'),
    fn('rhfromwb', 'rhfromwb(db, wb): %RH from a sling reading', 'wb→%RH', 'RH from wb'), fn('rhfromdp', 'rhfromdp(db, dp): %RH', 'dp→%RH', 'RH from dp'),
    fn('specvol', 'specvol(db, rh): ft³/lb dry air', 'ft³/lb'), fn('airdensity', 'airdensity(db, rh): lb/ft³', 'lb/ft³', 'density'),
    fn('humratio', 'humratio(db, rh): lb water per lb dry air', 'lb/lb'), fn('airflow', 'airflow(Btu/h, ΔT): CFM needed', 'to CFM'),
    fn('temprise', 'temprise(Btu/h, cfm): ΔT across a furnace or coil', 'to ΔT'), fn('mixair', 'mixair(cfm1, db1, rh1, cfm2, db2, rh2): two airstreams mixed', 'mix 2'),
    fn('oapercent', 'oapercent(mixed, return, outdoor): percent outdoor air', 'by temps', 'outdoor air %'), fn('mixtemp', 'mixtemp(t1, q1, t2, q2): mixed temperature', 'by flow'),
    fn('bypassfactor', 'bypassfactor(edb, ldb, adp)', 'BF', 'bypass'), fn('airchanges', 'airchanges(cfm, volume): air changes per hour', 'to ACH', 'air changes'),
    fn('uaheat', 'uaheat(U, area, ΔT) = U·A·ΔT', 'U·A·ΔT'), fn('uvalue', 'uvalue(r1, r2, …) = 1/ΣR', '1/ΣR'),
    fn('altpressure', 'altpressure(ft): standard air pressure in psia', 'psia', 'altitude'),
  ]),
  panel('Refrig', [
    hero('superheat', 'superheat("R410A", psig, suction °F): above the dew point', 'SH'), hero('subcool', 'subcool("R410A", psig, liquid °F): below the bubble point', 'SC'),
    hero('ptchart', 'ptchart("R410A", °F): bubble and dew pressure in psig', '°F→psig'), hero('refcycle', 'refcycle("R410A", evap, cond, superheat, subcool, eff): effect, work, COP, EER, kW/ton, flow, discharge temperature', 'COP, EER'),
    op('410A', '"R410A"', 'R-410A, in quotes', 'R-410A'), op('454B', '"R454B"', 'R-454B, in quotes', 'R-454B'),
    op('32', '"R32"', 'R-32, in quotes', 'R-32'), op('22', '"R22"', 'R-22, in quotes', 'R-22'),
    op('134a', '"R134a"', 'R-134a, in quotes', 'R-134a'), op('404A', '"R404A"', 'R-404A, in quotes', 'R-404A'),
    op('" "', '"¦"', 'Any refrigerant in quotes: "R407C", "R290", "R744"', 'other'), { label: 'list', ins: 'refrigerants()', title: 'Every refrigerant with a table', sub: 'fluids', tone: 'fn' },
    fn('sattemp', 'sattemp("R410A", psig): bubble and dew temperature, and the glide', 'psig→°F'), op('SI', '"SI"', 'Last input of an HVAC function: use °C, kPa gauge, kJ/kg', 'metric'),
    fn('targetsuperheat', 'targetsuperheat(indoor wb, outdoor db): fixed-orifice target superheat. Follow the unit\'s own chart first', 'orifice', 'target SH'), fn('refprops', 'refprops("R410A", °F): saturated enthalpy, entropy, density, latent heat', 'h, s, ρ'),
    fn('tbubble', 'tbubble("R410A", psig): °F', 'liq °F'), fn('tdew', 'tdew("R410A", psig): °F', 'vap °F'),
    fn('pbubble', 'pbubble("R410A", °F): psig', 'liq psi'), fn('pdew', 'pdew("R410A", °F): psig', 'vap psi'),
    fn('eertocop', 'eertocop(eer) = EER ÷ 3.412. Works for SEER and HSPF as seasonal averages', '÷ 3.412'), fn('coptoeer', 'coptoeer(cop) = COP × 3.412', '× 3.412'),
    fn('coptokwton', 'coptokwton(cop) = 3.517 ÷ COP', 'kW/ton', 'coptokw'), fn('kwtontocop', 'kwtontocop(kW/ton) = 3.517 ÷ kW/ton', 'kW/ton', 'kwtocop'),
    fn('carnotcop', 'carnotcop(evap, cond): the ideal limit', 'ideal', 'carnot'), fn('psat', 'psat(°F): saturation pressure of water in psia', 'water'),
  ]),
  panel('Flow', [
    hero('ductvel', 'ductvel(cfm, d) or ductvel(cfm, w, h): FPM, sizes in inches', 'FPM'), hero('ductloss', 'ductloss(cfm, d) or ductloss(cfm, w, h): in. w.c. per 100 ft, galvanized', 'in/100'),
    hero('ductsize', 'ductsize(cfm, friction): round size in inches. 0.1 in. w.c. per 100 ft is common', 'by loss'), fn('ductdia', 'ductdia(cfm, fpm): round size in inches', 'by FPM'),
    fn('eqdia', 'eqdia(w, h): the round duct with the same friction', 'rect→rnd'), fn('rectduct', 'rectduct(d, w): the other side for a round size', 'rnd→rect'),
    op('SI', '"SI"', 'Last input of an HVAC function: use L/s, mm, m/s, Pa', 'metric'),
    fn('velpressure', 'velpressure(fpm) = (V/4005)² in in. w.c.', 'VP', 'velpress'), fn('velfromvp', 'velfromvp(in. w.c.) = 4005√VP: a pitot reading to FPM', 'VP→FPM', 'pitot'),
    fn('fanlaws', 'fanlaws(flow, pressure, power, rpm1, rpm2): new flow, pressure, power', 'rpm'), fn('fanpower', 'fanpower(cfm, SP, eff): BHP', 'BHP'),
    fn('achflow', 'achflow(ach, volume): CFM for air changes per hour', 'to CFM'), fn('ventair', 'ventair(people, Rp, area, Ra): ASHRAE 62.1 breathing zone CFM', '62.1'),
    fn('waterheat', 'waterheat(gpm, ΔT) = 500·GPM·ΔT in Btu/h', '500QΔT', 'water heat'), fn('waterflow', 'waterflow(Btu/h, ΔT): GPM needed', 'to GPM', 'water flow'),
    fn('pumppower', 'pumppower(gpm, head ft, eff): BHP', 'BHP', 'pump power'), fn('pipevel', 'pipevel(gpm, inside d): ft/s', 'ft/s'),
    fn('pipeloss', 'pipeloss(gpm, inside d, C): ft of head per 100 ft, Hazen-Williams', 'ft/100'), fn('valvecv', 'valvecv(gpm, Δpsi): the Cv needed', 'Cv'),
    fn('valveflow', 'valveflow(Cv, Δpsi): GPM', 'to GPM', 'Cv flow'), fn('gasinput', 'gasinput(ft³, seconds): clock a gas meter, Btu/h', 'clock it'),
    fn('elecpower', 'elecpower(volts, amps, pf, phases): kW', 'V, A, PF', 'electric power'), fn('voltimbalance', 'voltimbalance(a, b, c): percent', 'percent', 'V imbal'),
  ]),
];

/**
 * Key heights for a phone held upright and typed on with one thumb, in points (dp on Android, px on the web): the
 * bank's two rows and the pad's four, 6 apart. A short screen takes a little off; no key goes under 44.
 */
export function phoneRows(screenH: number): { bank: number; pad: number } {
  if (screenH >= 800) return { bank: 48, pad: 56 };
  if (screenH >= 700) return { bank: 46, pad: 50 };
  return { bank: 44, pad: 46 };
}
export const PHONE_GAP = 6;
