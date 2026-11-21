// Names and forms people bring from other calculators: Desmos (total, quantile, normaldist(0, 1).cdf(1), L[2],
// [1...10]), a TI (nDeriv, fnInt, randInt, iPart), and code (pow, hypot, trunc). Most are another name for a function
// that is already here; the rest are small.
import { arityText, chargeWork, fail } from './errors';
import type { Env } from './evaluator';
import type { Builtin, Def } from './builtin-types';
import { one } from './args';
import { type Value, arith, list, mapNum, num, nums, tidy, typeName, vector, whole, prob, pos } from './values';
import { binomPdf, binomQuantile, binomRange, hypotOf, invNormStd, isWhole, normBetween, normCdf, normPdf } from './numeric';

/** Another name for a built-in, by the name it already has. */
const ALIASES: Record<string, string> = {
  sgn: 'sign', ceiling: 'ceil', binomial: 'nCr', comb: 'nCr', std: 'sds', stddev: 'sds', variance: 'vars',
  cuberoot: 'cbrt', surd: 'nthroot', nroot: 'nthroot', product: 'prod', total: 'sum',
  arcsec: 'asec', arccsc: 'acsc', arccot: 'acot', geometpdf: 'geompdf', geometcdf: 'geomcdf',
  derivative: 'deriv', diff: 'deriv', nDeriv: 'deriv', fnInt: 'integral', integrate: 'integral',
  zeros: 'roots', degrees: 'todeg', radians: 'torad', dim: 'len', size: 'len', remainder: 'rem',
  binomialdist: 'binomdist', sortA: 'sort', trunc: 'iPart', frac: 'fPart',
  arcsinh: 'asinh', arsinh: 'asinh', arccosh: 'acosh', arcosh: 'acosh', arctanh: 'atanh', artanh: 'atanh',
  invcdf: 'inversecdf', concat: 'join',
};

/** A list's numbers, and whether it came as a [ ] vector, so the answer can go back the way it came. */
function items(v: Value, what: string): { xs: Value[]; wrap: (out: Value[]) => Value } {
  if (typeof v === 'object' && v.t === 'list') return { xs: v.items, wrap: list };
  if (typeof v === 'object' && v.t === 'vector') return { xs: v.c, wrap: (out) => (out.every((x) => typeof x === 'number') ? vector(out as number[]) : list(out)) };
  return fail(`${what} needs a list like [1, 2, 3], got a ${typeName(v)}`);
}

/**
 * Random numbers that hold still. A sheet is worked out again on every keystroke, so a fresh roll each time would
 * make every random line flicker while another line is typed. Each sheet draws from the same sequence in the same
 * order, so a line keeps its numbers until a random line above it changes. The sequence is new on every load.
 */
const SESSION = Math.floor(Math.random() * 0x100000000);
const streams = new WeakMap<Env, { s: number }>();
function random(env: Env): number {
  let st = streams.get(env);
  if (!st) streams.set(env, (st = { s: SESSION }));
  // mulberry32
  st.s = (st.s + 0x6d2b79f5) | 0;
  let t = st.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** One draw, or a list of n draws when a count is given. */
function draws(count: Value | undefined, draw: () => number): Value {
  if (count === undefined) return draw();
  const n = whole(num(count, 'How many'), 'How many');
  if (n < 1 || n > 100000) fail('Ask for between 1 and 100,000 random numbers');
  return list(Array.from({ length: n }, draw));
}

function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

const snap = (r: number): number => (Math.abs(r - Math.round(r * 2) / 2) < 1e-15 ? Math.round(r * 2) / 2 : r);
/** undefinedAt says when the angle is a pole: tand(90) is undefined, not the 1.6e16 that cos(90°) ≈ 6e-17 gives. */
const degTrig = (f: (r: number) => number, name: string, undefinedAt?: (r: number) => boolean): Builtin => one((x) => {
  const r = ((x % 360) * Math.PI) / 180;
  if (undefinedAt?.(r)) fail(`${name}(${x}) is undefined`);
  return snap(f(r));
}, name);

export function registerCompat(def: Def, table: Record<string, Builtin>): void {
  const fnOf = (name: string) => table[name].fn!;

  def('pow', { min: 2, max: 2, usage: 'pow(a, b) is a^b', fn: (a) => arith('^', a[0], a[1]) });
  def('sqr', one((x) => x * x, 'sqr'));
  def('ld', { min: 1, max: 1, usage: 'ld(x) is log base 2', fn: (a, env) => fnOf('log')([2, a[0]], env) });
  def('lg', { min: 1, max: 1, usage: 'lg(x) is log base 10', fn: (a, env) => fnOf('log')([a[0]], env) });
  def('logBASE', { min: 2, max: 2, usage: 'logBASE(x, b) is log base b of x', fn: (a, env) => fnOf('log')([a[1], a[0]], env) });
  def('hypot', { min: 1, max: Infinity, usage: 'hypot(a, b) is √(a² + b²)', fn: (a) => tidy(hypotOf(a.flatMap((v) => nums(v)))) });
  def('iPart', one(Math.trunc, 'iPart'));
  def('fPart', one((x) => tidy(x - Math.trunc(x), Math.abs(x)), 'fPart'));
  def('clamp', { min: 3, max: 3, usage: 'clamp(x, low, high)', fn: (a) => { const lo = num(a[1], 'low'), hi = num(a[2], 'high'); return mapNum(a[0], (x) => Math.min(Math.max(x, lo), hi), 'clamp'); } });
  def('if', {
    min: 3, max: 3, usage: 'if(condition, then, otherwise)',
    // Only the side the condition picks is worked out, so if(x > 0, ln(x), 0) can guard the ln.
    lazy: (args, locals, _env, compile) => {
      const [cond, then, otherwise] = args.map((a) => compile(a, locals));
      return (s) => (num(cond(s), 'The condition') !== 0 ? then(s) : otherwise(s));
    },
  });

  // True is 1 and false is 0, as a comparison answers.
  const truth = (v: Value): boolean => num(v, 'Each side') !== 0;
  def('_and', { min: 2, max: 2, usage: 'a and b', fn: (a) => (truth(a[0]) && truth(a[1]) ? 1 : 0) });
  def('_or', { min: 2, max: 2, usage: 'a or b', fn: (a) => (truth(a[0]) || truth(a[1]) ? 1 : 0) });
  def('_xor', { min: 2, max: 2, usage: 'a xor b', fn: (a) => (truth(a[0]) !== truth(a[1]) ? 1 : 0) });
  def('not', { min: 1, max: 1, usage: 'not(a)', fn: (a) => (truth(a[0]) ? 0 : 1) });

  def('sind', degTrig(Math.sin, 'sind'));
  def('cosd', degTrig(Math.cos, 'cosd'));
  def('tand', degTrig(Math.tan, 'tand', (r) => snap(Math.cos(r)) === 0));
  def('asinh', one(Math.asinh, 'asinh'));
  def('acosh', one((x) => { if (x < 1) fail(`acosh needs a number of at least 1, got ${x}`); return Math.acosh(x); }, 'acosh'));
  def('atanh', one((x) => { if (!(x > -1 && x < 1)) fail(`atanh needs a number between −1 and 1, got ${x}`); return Math.atanh(x); }, 'atanh'));
  def('sech', one((x) => 1 / Math.cosh(x), 'sech'));
  def('csch', one((x) => { if (x === 0) fail('csch(0) is undefined'); return 1 / Math.sinh(x); }, 'csch'));
  def('coth', one((x) => { if (x === 0) fail('coth(0) is undefined'); return 1 / Math.tanh(x); }, 'coth'));

  // ---------- lists ----------
  def('_span', {
    min: 2, max: 3, usage: '[1...10] counts by ones; [1, 3, ..., 9] by the step its first two give', fn: (a) => {
      const first = num(a[0], 'The start'), last = num(a[a.length - 1], 'The end');
      const step = a.length === 3 ? num(a[1], 'The second number') - first : last >= first ? 1 : -1;
      if (step === 0 || !Number.isFinite(step)) fail('A range needs two different numbers to step by');
      const n = Math.floor((last - first) / step + 1e-9) + 1;
      if (!(n >= 0) || n > 1e6) fail('That range has more than a million numbers');
      return list(Array.from({ length: n }, (_, k) => tidy(first + k * step, Math.abs(first) + Math.abs(last))));
    },
  });
  def('_item', {
    min: 2, max: Infinity, usage: 'L[2] is the second item of L', fn: (a) => {
      const base = a[0];
      // A number against a bracket multiplies, as a[1, 2] always has, whatever the bracket's length: a[1, 2, 3].
      if (typeof base === 'number' || (typeof base === 'object' && base.t === 'complex')) {
        const rest = a.slice(1);
        return arith('*', base, rest.length === 1 ? vector([num(rest[0], 'Vector component')]) : vector(rest.map((v) => num(v, 'Vector component'))));
      }
      if (a.length > 3) fail(arityText('item', 2, 3, a.length, 'L[2] is the second item of L'));
      const pick = <T>(xs: T[], i: Value, what: string): T => {
        const k = whole(num(i, 'The position'), 'The position');
        if (k < 1 || k > xs.length) fail(`${what} ${k} isn't there: this has ${xs.length}`);
        return xs[k - 1];
      };
      if (typeof base === 'object' && base.t === 'matrix') {
        const row = pick(base.m, a[1], 'Row');
        return a.length === 3 ? pick(row, a[2], 'Column') : vector(row);
      }
      if (a.length === 3) fail('Only a matrix takes a row and a column, like A[1, 2]');
      const { xs, wrap } = items(base, 'An item');
      const at = a[1];
      // L[[1, 3]] and L[1...3] pick several.
      if (typeof at === 'object' && (at.t === 'list' || at.t === 'vector')) return wrap(nums(at).map((k) => pick(xs, k, 'Item')));
      return pick(xs, at, 'Item');
    },
  });
  def('_each', {
    min: 3, max: 3, binds: true, usage: '[n^2 for n = [1...5]]',
    lazy: (args, locals, _env, compile) => {
      if (args[1].k !== 'id') fail('for needs a plain name, like [n^2 for n = [1...5]]');
      const body = compile(args[0], [...locals, args[1].name]);
      const over = compile(args[2], locals);
      return (s) => {
        const slot = s.length;
        const sc = s.slice();
        return list(items(over(s), 'for').xs.map((x) => { sc[slot] = x; return body(sc); }));
      };
    },
  });
  def('_with', {
    min: 3, max: 3, binds: true, usage: 'x^2 with x = 3',
    lazy: (args, locals, _env, compile) => {
      if (args[1].k !== 'id') fail('with needs a plain name, like x^2 with x = 3');
      const body = compile(args[0], [...locals, args[1].name]);
      const value = compile(args[2], locals);
      return (s) => { const sc = s.slice(); sc[s.length] = value(s); return body(sc); };
    },
  });
  def('first', { min: 1, max: 1, fn: (a) => { const { xs } = items(a[0], 'first'); if (!xs.length) fail('first needs at least one item'); return xs[0]; } });
  def('last', { min: 1, max: 1, fn: (a) => { const { xs } = items(a[0], 'last'); if (!xs.length) fail('last needs at least one item'); return xs[xs.length - 1]; } });
  def('reverse', { min: 1, max: 1, fn: (a) => { const { xs, wrap } = items(a[0], 'reverse'); return wrap(xs.slice().reverse()); } });
  def('join', { min: 1, max: Infinity, usage: 'join(list, list, …) puts lists end to end', fn: (a) => list(a.flatMap((v) => (typeof v === 'number' ? [v] : items(v, 'join').xs))) });
  def('repeat', {
    min: 2, max: 2, usage: 'repeat(list, n)', fn: (a) => {
      const xs = typeof a[0] === 'number' ? [a[0]] : items(a[0], 'repeat').xs;
      const n = whole(num(a[1], 'How many times'), 'How many times');
      if (!xs.length) return list([]);
      if (n < 0 || n * xs.length > 1e6) fail('That is more than a million items');
      return list(Array.from({ length: n }, () => xs).flat());
    },
  });
  def('quantile', {
    min: 2, max: 2, usage: 'quantile(list, p) with p from 0 to 1', fn: (a, env) => fnOf('percentile')([a[0], prob(num(a[1], 'p')) * 100], env),
  });
  def('quartile', {
    min: 2, max: 2, usage: 'quartile(list, 1) is Q1; 0 to 4 run from the smallest value to the largest', fn: (a, env) => {
      const q = whole(num(a[1], 'Which quartile'), 'Which quartile');
      if (q < 0 || q > 4) fail('Quartiles run from 0 (the smallest value) to 4 (the largest)');
      const five = fnOf('fivenum')([a[0]], env);
      const row = typeof five === 'object' && five.t === 'record' ? five.rows[q] : undefined;
      return row ? row.value : fail('quartile needs a list of numbers');
    },
  });
  def('spearman', {
    min: 2, max: 2, usage: 'spearman(xs, ys): rank correlation', fn: (a, env) => {
      const xs = nums(a[0]), ys = nums(a[1]);
      if (xs.length !== ys.length) fail(`spearman needs lists of the same length (${xs.length} and ${ys.length})`);
      return fnOf('corr')([list(ranks(xs)), list(ranks(ys))], env);
    },
  });

  // ---------- parts of a value ----------
  const coord = (k: number, letter: string): Builtin => ({
    min: 1, max: 1, fn: (a) => {
      const pick = (v: Value): Value => {
        if (typeof v === 'object' && v.t === 'list') return list(v.items.map(pick));
        if (typeof v !== 'object' || (v.t !== 'point' && v.t !== 'vector')) return fail(`.${letter} reads a point, like (1, 2).${letter}, not a ${typeName(v)}`);
        if (k >= v.c.length) fail(`This ${v.t} has no ${letter}`);
        return v.c[k];
      };
      return pick(a[0]);
    },
  });
  def('_x', coord(0, 'x'));
  def('_y', coord(1, 'y'));
  def('_z', coord(2, 'z'));
  const distOf = (v: Value, fn: string) => {
    if (typeof v === 'object' && (v.t === 'normal' || v.t === 'binom')) return v;
    return fail(`${fn} reads a distribution, like normaldist(0, 1).${fn}(1), not a ${typeName(v)}`);
  };
  def('pdf', {
    min: 2, max: 2, prob: true, usage: 'normaldist(μ, σ).pdf(x)', fn: (a) => {
      const d = distOf(a[0], 'pdf');
      return mapNum(a[1], (x) => (d.t === 'normal' ? normPdf((x - d.mu) / d.sigma) / d.sigma : isWhole(x) ? binomPdf(d.n, d.p, x) : 0), 'pdf');
    },
  });
  def('cdf', {
    min: 2, max: 3, prob: true, usage: 'normaldist(μ, σ).cdf(x), or .cdf(low, high)', fn: (a) => {
      const d = distOf(a[0], 'cdf');
      const upTo = (x: number) => (d.t === 'normal' ? normCdf((x - d.mu) / d.sigma) : binomRange(d.n, d.p, 0, Math.floor(x)));
      if (a.length === 2) return mapNum(a[1], upTo, 'cdf');
      const lo = num(a[1], 'low'), hi = num(a[2], 'high');
      if (lo > hi) fail('low is above high');
      return d.t === 'normal' ? normBetween((lo - d.mu) / d.sigma, (hi - d.mu) / d.sigma) : binomRange(d.n, d.p, Math.ceil(lo), Math.floor(hi));
    },
  });
  def('inversecdf', {
    min: 2, max: 2, usage: 'normaldist(μ, σ).inversecdf(p)', fn: (a) => {
      const d = distOf(a[0], 'inversecdf');
      return mapNum(a[1], (p) => {
        prob(p);
        if (d.t === 'normal') return tidy(d.mu + d.sigma * invNormStd(p), Math.abs(d.mu) + d.sigma);
        return binomQuantile(d.n, d.p, p);
      }, 'inversecdf');
    },
  });

  // ---------- random ----------
  const gauss = (env: Env): number => Math.sqrt(-2 * Math.log(1 - random(env))) * Math.cos(2 * Math.PI * random(env));
  /** One binomial draw: n coin flips, counted against the line's time. */
  const flips = (env: Env, n: number, p: number): number => {
    if (n > 1e6) fail('A random binomial flips at most a million coins');
    chargeWork(n);
    let k = 0;
    for (let t = 0; t < n; t++) if (random(env) < p) k++;
    return k;
  };
  def(['random', 'rand'], {
    min: 0, max: 1, usage: 'random() from 0 to 1, random(n) for a list of n, or random(distribution)', fn: (a, env) => {
      const d = a[0];
      if (typeof d === 'object' && d.t === 'normal') return d.mu + d.sigma * gauss(env);
      if (typeof d === 'object' && d.t === 'binom') return flips(env, d.n, d.p);
      return draws(d, () => random(env));
    },
  });
  def('randInt', {
    min: 2, max: 3, usage: 'randInt(low, high), or randInt(low, high, n) for a list', fn: (a, env) => {
      const lo = whole(num(a[0], 'low'), 'low'), hi = whole(num(a[1], 'high'), 'high');
      if (lo > hi) fail('low is above high');
      return draws(a[2], () => lo + Math.floor(random(env) * (hi - lo + 1)));
    },
  });
  def('randNorm', {
    min: 2, max: 3, usage: 'randNorm(μ, σ), or randNorm(μ, σ, n) for a list', fn: (a, env) => {
      const mu = num(a[0], 'μ'), sigma = pos(num(a[1], 'σ'), 'σ');
      return draws(a[2], () => mu + sigma * gauss(env));
    },
  });
  def('randBin', {
    min: 2, max: 3, usage: 'randBin(n, p), or randBin(n, p, count) for a list', fn: (a, env) => {
      const n = whole(num(a[0], 'n'), 'n'), p = prob(num(a[1], 'p'));
      if (n < 0) fail('n must be 0 or more');
      if (a[2] !== undefined && n * num(a[2], 'How many') > 1e7) fail('That is more than ten million coin flips. Ask for fewer draws, or a smaller n');
      return draws(a[2], () => flips(env, n, p));
    },
  });
  def('shuffle', {
    min: 1, max: 1, usage: 'shuffle(list)', fn: (a, env) => {
      const { xs, wrap } = items(a[0], 'shuffle');
      const out = xs.slice();
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random(env) * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
      return wrap(out);
    },
  });

  for (const [name, existing] of Object.entries(ALIASES)) def(name, table[existing]);
}
