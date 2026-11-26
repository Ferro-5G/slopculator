// Property-based tests for the math engine: ball arithmetic containment, exact rational guardrails,
// Hermes BigInt bit limits, cache equivalence across re-evaluations, and crash-free parsing.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cleanSettings, evaluateDocument, type RowInput } from '../src/engine/document';
import { plainValue, type DisplayOpts } from '../src/engine/format';
import { fromLatex } from '../src/engine/latex';
import { parse } from '../src/engine/parser';
import * as X from '../src/engine/exact';
import * as R from '../src/engine/real';

const DEG = cleanSettings({ deg: true });
const RAD = cleanSettings({ deg: false });
const AUTO: DisplayOpts = { places: null, exact: false, percent: false };
const HERMES_MAX_BITS = 65536;

/** True iff the exact rational p/q (with q > 0) lies inside the ball [(m - r)*2^e, (m + r)*2^e]. */
function ballContainsRat(b: R.Ball, p: bigint, q: bigint): boolean {
  if (q < 0n) {
    p = -p;
    q = -q;
  }
  const lo = b.m - b.r;
  const hi = b.m + b.r;
  if (b.e >= 0) {
    const shift = BigInt(b.e);
    return (lo << shift) * q <= p && p <= (hi << shift) * q;
  }
  const shift = BigInt(-b.e);
  const scaled = p << shift;
  return lo * q <= scaled && scaled <= hi * q;
}

/** True iff the ball contains 0 (either exactly 0 or straddling 0). */
function ballContainsZero(b: R.Ball): boolean {
  const s = R.sign(b);
  return s === 0 || s === null;
}

/** True iff every BigInt inside a Precise value stays below Hermes's 65,536-bit ceiling. */
function checkHermesBits(v: unknown): void {
  if (typeof v === 'bigint') {
    expect(R.bitLength(v)).toBeLessThan(HERMES_MAX_BITS);
    return;
  }
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const item of v) checkHermesBits(item);
    return;
  }
  for (const val of Object.values(v)) checkHermesBits(val);
}

const smallInt = fc.bigInt({ min: -100000n, max: 100000n });
const smallPosInt = fc.bigInt({ min: 1n, max: 100000n });
const smallRat = fc.tuple(smallInt, smallPosInt).map(([n, d]) => X.rat(n, d));
const precisionArb = fc.constantFrom(64, 128, 256);

describe('ball arithmetic containment (real.ts)', () => {
  it('fromRat always encloses the exact rational', () => {
    fc.assert(
      fc.property(smallInt, smallPosInt, precisionArb, (n, d, p) => {
        const b = R.fromRat(n, d, p);
        expect(ballContainsRat(b, n, d)).toBe(true);
        expect(b.r >= 0n).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('add, sub, mul, and div balls always enclose the exact rational answer', () => {
    fc.assert(
      fc.property(smallRat, smallRat, precisionArb, (a, b, p) => {
        const ba = R.fromRat(a.n, a.d, p);
        const bb = R.fromRat(b.n, b.d, p);

        const sum = R.add(ba, bb, p);
        expect(ballContainsRat(sum, a.n * b.d + b.n * a.d, a.d * b.d)).toBe(true);

        const diff = R.sub(ba, bb, p);
        expect(ballContainsRat(diff, a.n * b.d - b.n * a.d, a.d * b.d)).toBe(true);

        const prod = R.mul(ba, bb, p);
        expect(ballContainsRat(prod, a.n * b.n, a.d * b.d)).toBe(true);

        if (b.n !== 0n) {
          const quot = R.div(ba, bb, p);
          expect(ballContainsRat(quot, a.n * b.d, a.d * b.n)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('sqrt(x)^2 encloses x for every positive rational', () => {
    fc.assert(
      fc.property(smallPosInt, smallPosInt, precisionArb, (n, d, p) => {
        const bx = R.fromRat(n, d, p);
        const root = R.sqrt(bx, p);
        const sq = R.mul(root, root, p);
        expect(ballContainsRat(sq, n, d)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('sin(x)^2 + cos(x)^2 - 1 always encloses 0', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -50000n, max: 50000n }), fc.bigInt({ min: 1n, max: 500n }), fc.constantFrom(64, 128), (n, d, p) => {
        const x = R.fromRat(n, d, p);
        const s = R.sin(x, p);
        const c = R.cos(x, p);
        const one = R.add(R.mul(s, s, p), R.mul(c, c, p), p);
        expect(ballContainsZero(R.sub(one, R.ONE, p))).toBe(true);
      }),
      { numRuns: 120 },
    );
  });

  it('exp(ln(x)) encloses x for positive rationals and ln(exp(y)) encloses y', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 50000n }), fc.bigInt({ min: 1n, max: 5000n }), fc.constantFrom(64, 128), (n, d, p) => {
        const x = R.fromRat(n, d, p);
        const back = R.exp(R.ln(x, p), p);
        expect(ballContainsRat(back, n, d)).toBe(true);
      }),
      { numRuns: 100 },
    );

    fc.assert(
      fc.property(fc.bigInt({ min: -500n, max: 500n }), fc.bigInt({ min: 1n, max: 100n }), fc.constantFrom(64, 128), (n, d, p) => {
        const y = R.fromRat(n, d, p);
        const back = R.ln(R.exp(y, p), p);
        expect(ballContainsRat(back, n, d)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('exact rationals and Hermes guardrails (exact.ts)', () => {
  it('rat normalizes denominator positive and coprime', () => {
    fc.assert(
      fc.property(smallInt, fc.bigInt({ min: -100000n, max: 100000n }).filter((d) => d !== 0n), (n, d) => {
        const q = X.rat(n, d);
        expect(q.d > 0n).toBe(true);
        expect(X.gcd(q.n, q.d)).toBe(1n);
        expect(q.n * d).toBe(n * q.d);
      }),
      { numRuns: 200 },
    );
  });

  it('fromDouble round-trips through toNumber for every finite double', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
        const q = X.fromDouble(x);
        const back = X.toNumber(q);
        expect(Object.is(back, x) || (back === 0 && x === 0)).toBe(true);
        checkHermesBits(q);
      }),
      { numRuns: 300 },
    );
  });

  it('adversarial large powers and factorials never throw or exceed Hermes BigInt limits', () => {
    const bigExpr = fc.oneof(
      fc.tuple(fc.integer({ min: -10, max: 10 }), fc.integer({ min: 0, max: 200000 })).map(([a, b]) => `(${a})^${b}`),
      fc.integer({ min: 0, max: 6000 }).map((n) => `${n}!`),
      fc.integer({ min: -1000000, max: 1000000 }).map((x) => `exp(${x})`),
      fc.tuple(fc.integer({ min: 2, max: 20 }), fc.integer({ min: 2, max: 25 })).map(([a, b]) => `${a}^(${b}^10)`),
    );
    fc.assert(
      fc.property(bigExpr, (expr) => {
        const res = evaluateDocument([{ id: 'p', kind: 'expr', text: expr }], DEG);
        expect(res).toHaveLength(1);
        if (res[0].precise) checkHermesBits(res[0].precise);
        if (!res[0].error && res[0].value !== undefined) {
          const text = plainValue(res[0].value, AUTO, res[0].prob, res[0].precise);
          expect(typeof text).toBe('string');
          expect(text.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('document cache equivalence (document.ts)', () => {
  const safeExpr = fc.oneof(
    fc.tuple(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 })).map(([a, b]) => `${a} + ${b}`),
    fc.tuple(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 30 })).map(([a, b]) => `${a}/${b}`),
    fc.integer({ min: 0, max: 360 }).map((d) => `sin(${d})`),
    fc.constantFrom('a + 1', 'a * 2 + b', 'ans + 3', 'ans * 2', 'sqrt(abs(a) + 1)', 'mean({1, 2, a})'),
  );

  function summary(rows: RowInput[], settings: typeof DEG) {
    return evaluateDocument(rows, settings).map((r) => ({
      error: r.error ?? null,
      shown: !r.error && r.value !== undefined ? plainValue(r.value, AUTO, r.prob, r.precise) : null,
      truth: r.truth ?? null,
    }));
  }

  it('warm re-evaluation after edits matches a fresh cold sheet with new IDs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.array(safeExpr, { minLength: 1, maxLength: 6 }),
        fc.boolean(),
        (a1, a2, b1, tail, deg) => {
          const settings = deg ? DEG : RAD;
          const initial: RowInput[] = [
            { id: 'r0', kind: 'expr', text: `a = ${a1}` },
            { id: 'r1', kind: 'expr', text: `b = ${b1}` },
            ...tail.map((text, i): RowInput => ({ id: `r${i + 2}`, kind: 'expr', text })),
          ];
          // Warm all parser, fingerprint, exact, and graph caches on the initial sheet.
          evaluateDocument(initial, settings);

          const edited: RowInput[] = [
            { id: 'r0', kind: 'expr', text: `a = ${a2}` },
            { id: 'r1', kind: 'expr', text: `b = ${b1}` },
            ...tail.map((text, i): RowInput => ({ id: `r${i + 2}`, kind: 'expr', text })),
          ];
          const freshIds: RowInput[] = edited.map((r, i) => ({ ...r, id: `cold-${a1}-${a2}-${i}` }));
          expect(summary(edited, settings)).toEqual(summary(freshIds, settings));
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe('parser and LaTeX fuzzing (parser.ts, latex.ts)', () => {
  const mathTokens = fc.constantFrom(
    '0', '1', '2.5', '1e309', 'x', 'y', 'pi', 'π', '∞', '°',
    '+', '-', '*', '/', '^', '!', '%', '=', '<=', '>=', '!=', '~',
    '(', ')', '[', ']', '{', '}', '|', '⟨', '⟩', ',', ':', ';', ' ',
    '\\frac{1}{2}', '\\sqrt{x}', '\\sqrt[3]{8}', '\\left(', '\\right)', '\\operatorname{sin}',
    '\\binom{5}{2}', '\\', 'sin', 'ln', 'sum', 'ans', 'with', 'for', 'and', 'or', '#',
  );
  const tokenSoup = fc.array(mathTokens, { minLength: 0, maxLength: 24 }).map((parts) => parts.join(''));
  const arbitraryInput = fc.oneof(tokenSoup, fc.string({ maxLength: 80 }));

  it('fromLatex never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(arbitraryInput, (input) => {
        const out = fromLatex(input);
        expect(typeof out).toBe('string');
      }),
      { numRuns: 300 },
    );
  });

  it('evaluateDocument never throws uncaught exceptions on arbitrary inputs', () => {
    fc.assert(
      fc.property(arbitraryInput, fc.boolean(), (input, deg) => {
        const res = evaluateDocument([{ id: 'fuzz', kind: 'expr', text: input }], deg ? DEG : RAD);
        expect(res).toHaveLength(1);
        expect(res[0].id).toBe('fuzz');
        if (res[0].error !== undefined) expect(typeof res[0].error).toBe('string');
      }),
      { numRuns: 300 },
    );
  });

  it('parse throws only CalcError or returns a valid AST node', () => {
    fc.assert(
      fc.property(tokenSoup, (input) => {
        try {
          const node = parse(input);
          expect(node === null || typeof node.k === 'string').toBe(true);
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
          expect((err as Error).name).toBe('CalcError');
        }
      }),
      { numRuns: 250 },
    );
  });
});
