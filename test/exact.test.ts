// Exact math for displayed results. Reference values come from Python integers and mpmath at 80 digits
// (see the comment on each block), never from this engine.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { evaluateDocument, type RowInput, type RowResult } from '../src/engine/document';
import { formatValue, plainValue, type DisplayOpts } from '../src/engine/format';
import type { Settings } from '../src/engine/evaluator';
import { tokenize } from '../src/engine/lexer';
import { parse } from '../src/engine/parser';
import * as X from '../src/engine/exact';
import * as R from '../src/engine/real';
import { fullAnswer } from '../src/ui/history';

afterEach(() => vi.restoreAllMocks());

const DEG: Settings = { deg: true, complex: false, sample: false };
const RAD: Settings = { ...DEG, deg: false };
const AUTO: DisplayOpts = { places: null, exact: false, percent: false };
const EXACT: DisplayOpts = { ...AUTO, exact: true };

function rows(lines: string[]): RowInput[] {
  return lines.map((text, i) => ({ id: String(i), kind: 'expr', text }));
}
function last(lines: string[], s: Settings = DEG): RowResult {
  const r = evaluateDocument(rows(lines), s).at(-1)!;
  if (r.error) throw new Error(`${lines.at(-1)}: ${r.error}`);
  return r;
}
/** What the line shows (ASCII, the copy text) with the default display. */
function shows(expr: string | string[], s: Settings = DEG, o: DisplayOpts = AUTO): string {
  const r = last(Array.isArray(expr) ? expr : [expr], s);
  return plainValue(r.value!, o, r.prob, r.precise);
}
/** The first 30 proven digits of the exact value, as "d.ddd…e±k". */
function digits30(expr: string, s: Settings = DEG): string {
  const r = last([expr], s);
  if (!r.precise || !('k' in r.precise)) throw new Error(`${expr} has no exact value`);
  const d = X.toSig(r.precise, 30);
  return `${d.neg ? '-' : ''}${d.digits[0]}.${d.digits.slice(1)}e${d.exp}`;
}
/** mpmath's 40-digit "d.ddd…e±k" rounded half up to 30 digits, in the same form. */
function mp(s: string): string {
  const m = /^(-?)(\d)\.(\d+)(?:e([+-]\d+))?$/.exec(s)!;
  const all = m[2] + m[3];
  let q = BigInt(all.slice(0, 30)) + (Number(all[30]) >= 5 ? 1n : 0n);
  let exp = Number(m[4] ?? 0);
  if (q.toString().length > 30) {
    q /= 10n;
    exp++;
  }
  const t = q.toString();
  return `${m[1]}${t[0]}.${t.slice(1)}e${exp}`;
}

const HILBERT6 = `det([${[0, 1, 2, 3, 4, 5].map((i) => `[${[0, 1, 2, 3, 4, 5].map((j) => `1/${i + j + 1}`).join(',')}]`).join(',')}])`;

describe('the audit table', () => {
  // Python: 2**64, 3**40, 7**30, math.factorial(25), math.comb(100, 50), math.perm(30, 15), 10**20 + 1.
  it.each([
    ['2^64', '18446744073709551616'],
    ['3^40', '12157665459056928801'],
    ['7^30', '22539340290692258087863249'],
    ['25!', '15511210043330985984000000'],
    ['nCr(100, 50)', '100891344545564193334812497256'],
    ['nPr(30, 15)', '202843204931727360000'],
    ['9007199254740993', '9007199254740993'],
    ['10^20 + 1', '100000000000000000001'],
    ['1e16 + 1 - 1e16', '1'],
    ['1e308 * 10 / 10', '1E308'],
  ])('%s shows %s', (expr, want) => expect(shows(expr)).toBe(want));

  it('det of the 6×6 Hilbert matrix is not 0', () => {
    // mpmath: det(hilbert(6)) = 5.367299887358687732788830353916689114243e-18
    expect(shows(HILBERT6)).toBe('5.36729988736E-18');
    expect(digits30(HILBERT6)).toBe(mp('5.367299887358687732788830353916689114243e-18'));
    // Exactly 1/186313420339200000.
    const r = last([HILBERT6]);
    expect(r.precise).toEqual({ k: 'q', n: 1n, d: 186313420339200000n });
  });

  it('e^100 has the right last digit', () => {
    // mpmath: exp(100) = 2.688117141816135448412625551580013587361e+43
    expect(shows('e^100')).toBe('2.68811714181614E43');
    expect(digits30('e^100')).toBe(mp('2.688117141816135448412625551580013587361e+43'));
    expect(shows('exp(100)')).toBe('2.68811714181614E43');
  });

  it('the line values are the nearest doubles to the exact answers', () => {
    expect(last(['1e16 + 1 - 1e16']).value).toBe(1);
    expect(last(['1e308 * 10 / 10']).value).toBe(1e308);
    expect(last([HILBERT6]).value).toBe(5.367299887358687732788830353916689114243e-18);
    expect(last(['e^100']).value).toBe(Math.exp(100));
  });
});

describe('cases the audit found correct stay correct', () => {
  // mpmath at 80 digits, rounded to the 12 digits shown. Far normal tails from erfc.
  it.each([
    ['0.1 + 0.2', '0.3', DEG],
    ['1.1 * 1.1', '1.21', DEG],
    ['sin(30)', '0.5', DEG],
    ['cos(1)', '0.540302305868', RAD],
    ['normalcdf(-1, 1)', '0.682689492137', DEG],
    ['normleft(-10)', '7.61985302416E-24', DEG],
    ['normright(5)', '2.86651571879E-7', DEG],
    ['binompdf(20, 0.3, 7)', '0.164261985217', DEG],
    ['binomcdf(20, 0.3, 7)', '0.772271797418', DEG],
    ['integral(x^2, x, 0, 1)', '0.333333333333', DEG],
    ['integral(e^(-x^2), x, -inf, inf)', '1.77245385091', DEG],
    ['deriv(sin(x), x, 1)', '0.540302305868', RAD],
    ['solve(x^2 = 2, x, 1)', '1.41421356237', DEG],
    ['invNorm(0.975)', '1.95996398454', DEG],
    ['compound(1000, 0.05, 12, 10)', '1647.00949769', DEG],
  ])('%s = %s', (expr, want, s) => expect(shows(expr, s)).toBe(want));
});

describe('proven digits of transcendental results', () => {
  // mpmath at 80 digits, first 40 significant digits.
  it.each([
    ['exp(1000)', '1.970071114017046993888879352243323125317e+434', RAD],
    ['exp(-1000)', '5.075958897549456765291809479574336919306e-435', RAD],
    ['sqrt(2)', '1.414213562373095048801688724209698078570', RAD],
    ['ln(10)', '2.302585092994045684017991454684364207601', RAD],
    ['sin(1e22)', '-8.522008497671888017727058937530293682618e-1', RAD],
    ['π', '3.141592653589793238462643383279502884197', RAD],
    ['atan(1/3)', '3.217505543966421934014046143586613190208e-1', RAD],
    ['cbrt(2)', '1.259921049894873164767210607278228350570', RAD],
    ['2^0.1', '1.071773462536293164213006325023342022906', RAD],
    ['sinh(1e-20)', '1.000000000000000000000000000000000000000e-20', RAD],
    ['log(2)', '3.010299956639811952137388947244930267682e-1', RAD],
    ['asin(1/3)', '3.398369094541219370963925133917640663882e-1', RAD],
    ['e', '2.718281828459045235360287471352662497757', RAD],
  ])('%s', (expr, want, s) => expect(digits30(expr, s)).toBe(mp(want)));

  it('shows 12 digits of them, correctly rounded', () => {
    expect(shows('exp(1000)', RAD)).toBe('1.97007111401705E434');
    expect(shows('sqrt(2)')).toBe('1.41421356237');
    expect(shows('sin(1e22)', RAD)).toBe('-0.852200849767');
  });

  it('keeps digits doubles lose to cancellation', () => {
    // mpmath: tan((10^30 − sinh(π))°) = 36.98609718477…; doubles drop the sinh(π) and get 0.28674…
    expect(shows(['b = 1e3^10 - sinh(π)', 'tan(b)'])).toBe('36.9860971848');
  });
});

describe('exact arithmetic', () => {
  it('keeps decimal literals exact', () => {
    expect(last(['0.1']).precise).toEqual({ k: 'q', n: 1n, d: 10n });
    expect(shows('0.1 + 0.2', DEG, EXACT)).toBe('3/10');
    expect(shows('1/3 + 1/7', DEG, EXACT)).toBe('10/21');
  });

  it('prints every digit of whole numbers and terminating decimals', () => {
    // Python: math.factorial(171), 2**200.
    expect(shows('171!')).toBe('1241018070217667823424840524103103992616605577501693185388951803611996075221691752992751978120487585576464959501670387052809889858690710767331242032218484364310473577889968548278290754541561964852153468318044293239598173696899657235903947616152278558180061176365108428800000000000000000000000000000000000000000');
    expect(shows('2^200')).toBe('1606938044258990275541962092341162602522202993782792835301376');
    expect(shows('10^20 + 0.5')).toBe('100000000000000000000.5');
    expect(shows('1234567.891011121314')).toBe('1234567.891011121314');
    expect(shows('1e400')).toBe('1E400');
    expect(shows('1/1e400')).toBe('1E-400');
  });

  it('rounds what does not terminate to 12 digits', () => {
    expect(shows('1/3')).toBe('0.333333333333');
    expect(shows('-2/3')).toBe('-0.666666666667');
    expect(shows('(10^20 + 1)/3')).toBe('3.33333333333333E19');
  });

  it('works through variables, ans, and user functions', () => {
    expect(shows(['a = 2^64', 'a + 1'])).toBe('18446744073709551617');
    expect(shows(['2^64', 'ans + 1'])).toBe('18446744073709551617');
    expect(shows(['f(x) = x^2 + 1', 'f(2^40)'])).toBe('1208925819614629174706177');
    expect(shows(['b = a + 1', 'a = 1e16 + 1 - 1e16', 'b'])).toBe('2');
  });

  it('gives graphs the corrected double of a variable', () => {
    const res = evaluateDocument(rows(['a = 1e16 + 1 - 1e16', 'y = a x']), DEG);
    expect(res[0].value).toBe(1);
    const g = res[1].graph[0] as { f: (x: number) => number };
    expect(g.f(3)).toBe(3);
  });

  it('computes factorials doubles overflow on the way', () => {
    expect(shows('200!/199!')).toBe('200');
    expect(shows(['a = 171!', 'a/170!'])).toBe('171');
  });

  it('gives exact matrices, lists, and vectors', () => {
    expect(formatValue(last(['inv([[1,2],[3,4]])']).value!, EXACT, false, last(['inv([[1,2],[3,4]])']).precise)).toBe('[[−2, 1], [3/2, −1/2]]');
    expect(shows('{1/3, 2^70}')).toBe('{0.333333333333, 1180591620717411303424}');
    expect(shows('[[1,2],[3,4]]^20')).toBe('[[95799031216999, 139620104992450], [209430157488675, 305229188705674]]');
    expect(shows('abs(⟨3, 4⟩)')).toBe('5');
    expect(shows('mean({1, 2, 2})', DEG, EXACT)).toBe('5/3');
  });

  it('gets exact trig values at special angles', () => {
    expect(last(['sin(30)']).precise).toEqual({ k: 'q', n: 1n, d: 2n });
    expect(last(['cos(π/3)'], RAD).precise).toEqual({ k: 'q', n: 1n, d: 2n });
    expect(shows('sin(π)', RAD)).toBe('0');
    expect(shows('tan(45)')).toBe('1');
    expect(shows('asin(0.5)')).toBe('30');
    const pretty = (e: string, st: Settings) => { const r = last([e], st); return formatValue(r.value!, EXACT, r.prob, r.precise); };
    expect(pretty('acos(-1/2)', RAD)).toBe('2π/3');
    expect(pretty('sin(45)', DEG)).toBe('√2/2');
    expect(pretty('atan2(1, -1)', RAD)).toBe('3π/4');
  });

  it('roots, powers, and logs that come out whole are whole', () => {
    expect(shows('8^(1/3)')).toBe('2');
    expect(shows('(-8)^(1/3)')).toBe('-2');
    expect(shows('(1/27)^(-2/3)')).toBe('9');
    expect(shows('log(0.001)')).toBe('-3');
    expect(shows('log_2(1024)')).toBe('10');
    expect(shows('sqrt(2)^2')).toBe('2');
    expect(shows('sqrt(2)^2 - 2')).toBe('0');
  });

  it('follows the float rules for rounding and mod', () => {
    expect(shows('round(2.5)')).toBe('3');
    expect(shows('round(-2.5)')).toBe('-3');
    expect(shows('round(1.005, 2)')).toBe('1.01');
    expect(shows('mod(-7, 3)')).toBe('2');
    expect(shows('mod(7.5, -2)')).toBe('-0.5');
    expect(shows('floor(-7/2)')).toBe('-4');
  });

  it('fixed decimal places come from the exact value', () => {
    const P2: DisplayOpts = { ...AUTO, places: 2 };
    expect(shows('2^64', DEG, P2)).toBe('18446744073709551616.00');
    expect(shows('-2/3', DEG, P2)).toBe('-0.67');
    expect(shows('1/3 - 1/3', DEG, P2)).toBe('0.00');
  });

  it('exact mode never names a fraction the value only resembles', () => {
    // The double heuristic called this 1/3. It is an exact 15-digit decimal, so it shows in full.
    expect(shows('0.333333333333333', DEG, EXACT)).toBe('0.333333333333333');
    expect(shows('1/3 + 10^-20', DEG, EXACT)).toBe('0.333333333333');
  });
});

describe('falling back to doubles', () => {
  it('leaves lines exact math does not cover exactly as they were', () => {
    const r = last(['normalcdf(-1, 1)']);
    expect(r.precise).toBeUndefined();
    expect(last(['√(-4)'], { ...DEG, complex: true }).precise).toBeUndefined();
    expect(last(['stats({1,2,3})']).precise).toBeUndefined();
  });

  it('works out powers too large to keep exact as proven balls', () => {
    // mpmath at 120 digits: 2^100000 = 9.990020930143845079…e+30102, (1 + 10^−30)^(10^30) = 2.71828182845904523536…
    expect(shows('2^100000')).toBe('9.99002093014385E30102');
    expect(shows('(1 + 1/10^30)^(10^30)')).toBe('2.71828182846');
    expect(shows('(-3)^70001')).toBe('-9.22468682839386E33398');
  });

  it('gives up on numbers it cannot reach, without an error', () => {
    expect(shows('2^(10^20)')).toBe('inf');
    expect(evaluateDocument(rows(['5001!']), DEG)[0].error).toMatch(/too large/);
  });

  it('never shows a ball that is still too wide after the last precision', () => {
    // Exactly 1, but e^10000 needs more than 2000 bits to cancel. The double's NaN shows rather than a claimed 0.
    const r = last(['e^10000 + 1 - e^10000']);
    expect(r.precise).toBeUndefined();
    expect(plainValue(r.value!, AUTO, false, r.precise)).toBe('undefined');
    // A ball within 2^-1075 of 0 still reads as 0, the same as its nearest double.
    expect(shows('sqrt(2)^2 - 2')).toBe('0');
  });

  it('formats huge and tiny balls without expanding their exponents', () => {
    // mpmath: e^(10^6) = 3.03321539680209…e+434294, e^(−10^6) = 3.29683147808856…e−434295.
    expect(shows('exp(1e6)')).toBe('3.03321539680209E434294');
    expect(shows('exp(-1e6)')).toBe('3.29683147809E-434295');
    expect(shows('exp(1e6)', DEG, { ...AUTO, places: 2 })).toBe('3.03321539680209E434294');
    expect(shows('exp(-1e6)', DEG, { ...AUTO, places: 2 })).toBe('0.00');
    // Past 2^(2^30) the double stays: e^(10^12) used to throw "Maximum BigInt size exceeded".
    expect(shows('exp(1e12)')).toBe('inf');
    expect(shows('exp(-1e12)')).toBe('0');
    expect(shows('floor(exp(1e5))')).toBe('inf');
  });

  it('gives up when an expression runs out of time, and keeps the double', () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 20));
    const r = last(['sum(1/n, n, 1, 20000)']);
    expect(r.precise).toBeUndefined();
    expect(plainValue(r.value!, AUTO, false, r.precise)).toBe('10.4807282172');
  });

  it('gives up on long loops and keeps the double', () => {
    const r = last(['sum(n, n, 1, 100000)']);
    expect(r.precise).toBeUndefined();
    expect(r.value).toBe(5000050000);
  });

  it('keeps errors the float path reports', () => {
    for (const e of ['1/0', 'tan(90)', 'nCr(8.5, 3)', 'inv([[1,2],[2,4]])', 'ln(0)']) expect(evaluateDocument(rows([e]), DEG)[0].error, e).toBeDefined();
  });
});

describe('re-evaluation', () => {
  it('a slider change updates every line that depends on it', () => {
    expect(shows(['a = 2', 'a^64'])).toBe('18446744073709551616');
    expect(shows(['a = 3', 'a^64'])).toBe('3433683820292512484657849089281');
    expect(shows(['a = 3', 'b = a + 1', 'b^40'])).toBe('1208925819614629174706176');
    expect(shows(['a = 5', 'b = a + 1', 'b^40'])).toBe('13367494538843734067838845976576');
  });

  it('ans follows the line above when it changes', () => {
    expect(shows(['2^64', 'ans + 1'])).toBe('18446744073709551617');
    expect(shows(['2^65', 'ans + 1'])).toBe('36893488147419103233');
  });

  it('degrees and radians are kept apart', () => {
    expect(shows('sin(30)', DEG)).toBe('0.5');
    expect(shows('sin(30)', RAD)).toBe('-0.988031624093');
  });
});

describe('everything that shows a result gets the exact digits', () => {
  it('copy text and history keep every digit', () => {
    const r = last(['2^64']);
    expect(plainValue(r.value!, AUTO, r.prob, r.precise)).toBe('18446744073709551616');
    expect(fullAnswer(r)).toBe('18446744073709551616');
  });
});

describe('the lexer keeps literals as typed', () => {
  it('stores the source digits so exact math can read them', () => {
    const t = tokenize('9007199254740993 + 0.1')[0];
    expect(t.value).toBe('9007199254740993');
    expect(t.num).toBe(9007199254740992);
    expect(parse('1e308')).toEqual({ k: 'num', v: 1e308, s: '1e308' });
  });
});

describe('exact.ts and real.ts', () => {
  it('rounds rationals to the nearest double', () => {
    expect(X.toNumber(X.rat(1n, 3n))).toBe(1 / 3);
    expect(X.toNumber(X.rat(2n ** 53n + 1n))).toBe(2 ** 53);
    expect(X.toNumber(X.rat(2n ** 53n + 3n))).toBe(2 ** 53 + 4);
    expect(X.toNumber(X.rat(10n ** 400n))).toBe(Infinity);
    expect(X.toNumber(X.rat(1n, 10n ** 400n))).toBe(0);
    expect(X.toNumber(X.rat(-(10n ** 30n) - 1n, 3n))).toBe(-(10 ** 30) / 3);
  });

  it('writes whole numbers in full unless E notation is just as exact', () => {
    expect(X.integerString(10n ** 16n)).toBe('1E16');
    expect(X.integerString(10n ** 15n)).toBe('1000000000000000');
    expect(X.integerString(-(2n ** 64n))).toBe('-18446744073709551616');
    expect(X.integerString(123n * 10n ** 30n)).toBe('1.23E32');
  });

  it('keeps balls around the true value', () => {
    for (const p of [64, 200, 1000]) {
      const x = R.fromRat(7n, 3n, p);
      const s = R.sin(x, p), c = R.cos(x, p);
      // sin² + cos² − 1 must contain 0.
      const z = R.sub(R.add(R.mul(s, s, p), R.mul(c, c, p), p), R.ONE, p);
      expect(R.sign(z)).toBeNull();
      const back = R.sub(R.exp(R.ln(x, p), p), x, p);
      expect(R.sign(back) === null || R.sign(back) === 0).toBe(true);
    }
  });

  it('refuses to decide what a ball cannot', () => {
    const zeroish = R.sub(R.sqrt(R.fromInt(2n, 64), 64), R.sqrt(R.fromInt(2n, 64), 64), 64);
    expect(() => R.div(R.ONE, zeroish, 64)).toThrow(R.Undecided);
    expect(() => R.ln(zeroish, 64)).toThrow(R.Undecided);
  });
});

describe('where doubles and exact math disagree about an edge', () => {
  const errorOf = (lines: string[], s: Settings = DEG) => evaluateDocument(rows(lines), s).at(-1)!.error;
  it('a divisor that only doubles round to 0 is not 0', () => {
    // 1e16 + 1 − 1e16 is 0 in doubles and 1 in fact.
    expect(shows('1/(1e16+1-1e16)')).toBe('1');
    expect(shows('ln(1e16+1-1e16)')).toBe('0');
    expect(shows('sqrt(1e16+4-1e16)')).toBe('2');
    expect(shows(['c = 1/(1e16+1-1e16)', 'c + 1'])).toBe('2');
  });
  it('a divisor that is exactly 0 has no value, though doubles see 5.6e−17', () => {
    expect(errorOf(['1/(0.1+0.2-0.3)'])).toBe('Division by zero');
    expect(errorOf(['a = 0.1+0.2-0.3', '1/a'])).toBe('Division by zero');
    expect(errorOf(['a = 0.1+0.2-0.3', 'b = 1/a', 'b*2'])).toMatch(/Division by zero/);
    expect(errorOf(['1/sin(pi)'], RAD)).toBe('Division by zero');
    // A list or a matrix over it is the same division, entry by entry.
    expect(errorOf(['{1, 2}/(0.1+0.2-0.3)'])).toBe('Division by zero');
    expect(errorOf(['[[1, 2], [3, 4]]/(0.1+0.2-0.3)'])).toBe('Division by zero');
  });
  it('a near miss is still a number', () => {
    // 0.3333333333333333 is not 1/3, so this divisor is small and real.
    expect(errorOf(['1/(1/3-0.3333333333333333)'])).toBeUndefined();
  });
  it('real failures keep their own words', () => {
    expect(errorOf(['5/0'])).toBe('Division by zero');
    expect(errorOf(['ln(0)'])).toBe('ln is only defined for positive numbers, got 0');
    expect(errorOf(['sqrt(-4)'])).toMatch(/isn't real/);
    expect(errorOf(['{1, 2}/0'])).toBe('Division by zero');
  });
});
