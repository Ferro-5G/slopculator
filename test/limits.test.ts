// Inputs that used to hang, run out of memory, or give a wrong answer. Each case is from an audit of the engine.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { run } from './sheet';
import { plainNumber } from '../src/engine/format';
import { roundTo } from '../src/engine/numeric';

const one = (line: string) => run([line]).lines[0];

describe('work that used to hang or run out of memory', () => {
  it('evaluates a diamond of definitions in linear time', () => {
    // Each signature used to contain both dependencies' signatures in full, doubling per level: at this depth that
    // runs out of memory.
    const lines = ['a0 = 1', 'b0 = 2'];
    for (let k = 1; k <= 60; k++) lines.push(`a${k} = a${k - 1} + b${k - 1}`, `b${k} = a${k - 1} - b${k - 1}`);
    const res = run(lines).lines;
    // Two steps of (a, b) → (a + b, a − b) double both, so b₆₀ = 2³⁰ · b₀.
    expect(res.at(-1)!.result).toBe(String(2 ** 31));
  });
  it('stops a line that runs past its time budget', () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
    const res = run(['f(n) = {n < 1: 1, f(n-1) + f(n-1)}', 'f(60)']).lines;
    expect(res[1].error).toMatch(/more than 2 seconds/);
  });
  it('stops a line that builds too many values', () => {
    // Test the allocation guard independently of the wall-clock budget, which has its own test above.
    vi.spyOn(Date, 'now').mockReturnValue(0);
    expect(one('seq(seq(k, k, 1, 1000000), n, 1, 1000000)').error).toMatch(/more than 10 million values/);
  });
  it('limits augment, roots, and binomial lists to sizes that fit', () => {
    const nest = (n: number): string => (n ? `g(${nest(n - 1)})` : 'identity(20)');
    expect(run(['g(M) = augment(M, M)', nest(22)]).lines[1].error).toMatch(/million entries/);
    expect(one('roots(seq(1, n, 1, 3000))').error).toMatch(/degree 500/);
    expect(one('binompdf(10^9, 0.5)').error).toMatch(/up to n = 100000/);
    expect(one('binomcdf(10^15, 0.5, 10^15)').error).toMatch(/10 million terms/);
  });
  it('stops nCr and nPr as soon as they overflow', () => {
    expect(one('nCr(10^12, 5*10^11)').error).toMatch(/too large/);
    expect(one('nPr(10^12, 10^12)').error).toMatch(/too large/);
  });
  it('works on lists too long to spread into Math.max', () => {
    expect(one('max(seq(k, k, 1, 200000))').result).toBe('200000');
    expect(one('range(seq(k, k, 1, 200000))').result).toBe('199999');
  });
  it('keeps the recursion limit after it trips', () => {
    // The guard reset its count to 0 while 200 calls were still unwinding, so each trip lowered the limit.
    const res = run(['f(x) = f(x)', ...Array.from({ length: 40 }, () => 'f(1)')]).lines.slice(1);
    for (const r of res) expect(r.error).toMatch(/calls itself too deeply/);
  });
});

describe('binomial probabilities for large n', () => {
  it('matches the exact values to about 12 digits', () => {
    expect(one('binompdf(10^7, 0.5, 5*10^6)').value).toBeCloseTo(2.52313245894e-4, 14);
    expect(one('binomcdf(10^7, 0.5, 5*10^6)').value).toBeCloseTo(0.500126156622, 11);
    expect((one('binompdf(1001, 0.5, 0)').value as number) / 2 ** -1001).toBeCloseTo(1, 12);
    expect((one('binompdf(2000, 0.999, 2000)').value as number) / 0.999 ** 2000).toBeCloseTo(1, 12);
  });
  it('refuses n past 2^53, where whole numbers stop being exact', () => {
    expect(one('binomdist(1e17, 0.5)').error).toMatch(/at most 2\^53/);
  });
});

describe('results that used to be wrong', () => {
  it('raises matrices to powers past 2^31', () => {
    expect(one('[[1,1],[0,1]]^(2^32)').result).toBe('[[1, 4294967296], [0, 1]]');
  });
  it('reduces a matrix of small entries', () => {
    expect(one('rref([[1e-13,2e-13],[3e-13,4e-13]])').result).toBe('[[1, 0], [0, 1]]');
    expect(one('rref([[1,2,3],[4,5,6],[7,8,9]])').result).toBe('[[1, 0, -1], [0, 1, 2], [0, 0, 0]]');
  });
  it('rounds 16-digit numbers and huge ones without losing digits or overflowing', () => {
    expect(roundTo(1234567890123456.7, 0)).toBe(1234567890123457);
    expect(roundTo(1e300, 10)).toBe(1e300);
    expect(roundTo(1.5, 309)).toBe(1.5);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(plainNumber(5e21, 2)).toBe('5E21');
  });
  it('treats prototype names as names', () => {
    expect(one('toString').error).toMatch(/Unknown name "toString"/);
    expect(one('constructor + 1').error).toMatch(/Unknown name "constructor"/);
  });
  it('refuses a function named after a constant', () => {
    expect(run(['e(x) = x + 1']).lines[0].error).toMatch(/constant/);
  });
  it('checks sizes in linsolve and angle', () => {
    expect(one('linsolve([[1,2],[3,4]], {})').error).toMatch(/one row for each/);
    expect(one('angle(vec(1,0), vec(1,0,0))').error).toMatch(/same size/);
    expect(one('angle(vec(0,0), vec(1,0))').error).toMatch(/zero vector/);
  });
});

afterEach(() => vi.restoreAllMocks());

describe('answers and messages a hands-on audit found wrong', () => {
  it('says a line is too deep in words about the line, not the JavaScript engine\'s', () => {
    for (const line of ['('.repeat(10000) + '1' + ')'.repeat(10000), Array(20001).fill('1').join('+')]) {
      const r = one(line);
      expect(r.error).toMatch(/too long or too deeply nested/);
      expect(r.error).not.toMatch(/RangeError|call stack/);
    }
    expect(run([`a = ${Array(20001).fill('1').join('+')}`, 'a + 1']).lines[1].error).not.toMatch(/RangeError|call stack/);
  });
  it('counts a row of ordinary numbers under a row of huge ones', () => {
    expect(one('rank([[1e20, 0], [0, 1]])').result).toBe('2');
    expect(one('rank([[1, 2], [2, 4]])').result).toBe('1');
    expect(one('rank([[0, 0], [0, 0]])').result).toBe('0');
  });
  it('finds the real eigenvalues of a matrix of tiny or huge entries', () => {
    expect(one('eigen([[1e-20, 0], [0, 2e-20]])').result).toBe('{1E-20, 2E-20}');
    expect(one('eigen([[1e20, 0], [0, 2e20]])').result).toBe('{1E20, 2E20}');
    expect(one('eigen([[2, 1], [1, 2]])').result).toBe('{1, 3}');
    // Mixed sizes keep their small eigenvalues.
    expect(one('eigen([[1, 0], [0, 1e20]])').result).toBe('{1, 1E20}');
    expect(one('eigen([[1, 1e20, 0], [0, 2, 0], [0, 0, 3]])').result).toBe('{1, 2, 3}');
  });
  it('shows a fraction only for a number that is that fraction to rounding', () => {
    // 0.3333333333334 and 0.5 + 4e-13 are near 1/3 and 1/2, not equal to them.
    expect(one('percentile({0, 1}, 33.33333333334)').fraction).toBeUndefined();
    expect(one('normalcdf(1e-12)').fraction).toBeUndefined();
    expect(one('normalcdf(0)').fraction).toBe('1/2');
    expect(one('integral(x^2, x, 0, 1)').fraction).toBe('1/3');
  });
  it('gives no value for an integral across a pole', () => {
    expect(one('integral(1/(x - 0.1)^2, x, -1, 1)').error).toMatch(/did not settle/);
    expect(one('integral(1/(x - 0.1), x, -1, 1)').error).toMatch(/did not settle/);
    // A singularity that integrates is still an answer: ∫ |x − 0.1|^(−1/2) over −1 to 1 is 2(√1.1 + √0.9).
    expect(Number(one('integral(1/sqrt(abs(x - 0.1)), x, -1, 1)').result)).toBeCloseTo(2 * (Math.sqrt(1.1) + Math.sqrt(0.9)), 6);
    // And a tall finite peak is not a pole: 1e-9/(x² + 1e-18) reaches 1e9 at 0 and integrates to 2·atan(1e9), which is π less 2e-9.
    expect(Number(one('integral(1e-9/(x^2 + 1e-18), x, -1, 1)').result)).toBeCloseTo(Math.PI - 2e-9, 8);
    expect(Number(one('integral(1e-6/((x - 0.3)^2 + 1e-12), x, 0, 1)').result)).toBeCloseTo(Math.atan(0.7e6) + Math.atan(0.3e6), 6);
  });
  it('warns when a range has more solutions than its scan can separate', () => {
    expect(one('solve(sin(10000x) = 0, x, 0, 360)').notes?.join(' ')).toMatch(/packed too closely/);
    expect(one('solve(sin(x) = 0.5, x, 0, 360)').notes?.join(' ') ?? '').not.toMatch(/packed too closely/);
  });
  it('takes a count of successes from 0 to n', () => {
    expect(one('phat(3, 10)').result).toBe('0.3');
    expect(one('phat(11, 10)').error).toMatch(/from 0 to n/);
    expect(one('phat(-1, 10)').error).toMatch(/from 0 to n/);
  });
});
