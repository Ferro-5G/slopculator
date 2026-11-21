// Least squares for a regression line like y1 ~ m x1 + b: the values of the unknowns that make the sum of squared
// differences smallest. A model that is linear in its unknowns (m x + b, a x^2 + b x + c, a sin(x) + b) is solved
// directly. Any other (a b^x, a/(x + b)) is walked downhill from a few starting points.
import { charge, fail } from './errors';

/** The differences at each data point for some values of the unknowns, or null where the model has no value. */
export type Residuals = (theta: number[]) => number[] | null;

export interface Fit {
  params: number[];
  /** Sum of squared differences at the answer. */
  rss: number;
}

const sumSq = (r: number[]): number => {
  let s = 0;
  for (const x of r) s += x * x;
  return s;
};

const finite = (r: number[] | null): r is number[] => r !== null && r.every(Number.isFinite);

/** Solves the least-squares problem min |A t + b| by Householder QR. Null when the columns of A aren't independent. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length, k = A.length;
  const a = A.map((col) => col.slice());
  const rhs = b.map((x) => -x);
  const diag = new Array<number>(k).fill(0);
  let scale = 0;
  for (const col of a) scale = Math.max(scale, Math.sqrt(sumSq(col)));
  for (let j = 0; j < k; j++) {
    let norm = 0;
    for (let i = j; i < n; i++) norm += a[j][i] * a[j][i];
    norm = Math.sqrt(norm);
    if (!(norm > 1e-10 * scale)) return null;
    const alpha = a[j][j] > 0 ? -norm : norm;
    const v = a[j].slice(j);
    v[0] -= alpha;
    const vv = sumSq(v);
    const reflect = (col: number[]): void => {
      let dot = 0;
      for (let i = j; i < n; i++) dot += v[i - j] * col[i];
      const f = (2 * dot) / vv;
      for (let i = j; i < n; i++) col[i] -= f * v[i - j];
    };
    if (vv > 0) {
      for (let c = j + 1; c < k; c++) reflect(a[c]);
      reflect(rhs);
    }
    diag[j] = alpha;
  }
  const t = new Array<number>(k).fill(0);
  for (let j = k - 1; j >= 0; j--) {
    let s = rhs[j];
    for (let c = j + 1; c < k; c++) s -= a[c][j] * t[c];
    t[j] = s / diag[j];
  }
  return t;
}

/**
 * solveLinear on columns it can tell apart. Data far from zero, x from 1,000,000,000 to 1,000,000,002, makes the x
 * column nearly a multiple of an intercept's column of ones, and the difference between them is lost in rounding. So
 * with a constant column there, every other column is measured from its own mean first, which changes only what
 * the constant's unknown has to be. Each column is also scaled to length 1, so no unknown's size hides another.
 */
function solveColumns(cols: number[][], b: number[]): number[] | null {
  const k = cols.length;
  const flat = cols.findIndex((c) => c[0] !== 0 && c.every((x) => Math.abs(x - c[0]) <= 1e-12 * Math.abs(c[0])));
  const shift = cols.map((c, j) => (flat < 0 || j === flat ? 0 : c.reduce((s, x) => s + x, 0) / c.length / cols[flat][0]));
  const centered = cols.map((c, j) => (shift[j] === 0 ? c : c.map((x, i) => x - shift[j] * cols[flat][i])));
  const size = centered.map((c) => Math.sqrt(sumSq(c)));
  if (size.some((s) => !(s > 0))) return null;
  const t = solveLinear(centered.map((c, j) => c.map((x) => x / size[j])), b);
  if (!t) return null;
  const out = t.map((x, j) => x / size[j]);
  if (flat >= 0) for (let j = 0; j < k; j++) if (j !== flat) out[flat] -= shift[j] * out[j];
  return out;
}

/** The model is linear in its unknowns when a third point lands where the first k + 1 say it should. */
function linearParts(resid: Residuals, k: number): { r0: number[]; cols: number[][] } | null {
  const r0 = resid(new Array<number>(k).fill(0));
  if (!finite(r0)) return null;
  const cols: number[][] = [];
  for (let j = 0; j < k; j++) {
    const e = new Array<number>(k).fill(0);
    e[j] = 1;
    const r = resid(e);
    if (!finite(r)) return null;
    cols.push(r.map((x, i) => x - r0[i]));
  }
  const probe = Array.from({ length: k }, (_, j) => 0.37 + 1.61 * j * (j % 2 ? -1 : 1));
  const got = resid(probe);
  if (!finite(got)) return null;
  for (let i = 0; i < r0.length; i++) {
    let want = r0[i], size = Math.abs(r0[i]);
    for (let j = 0; j < k; j++) { want += probe[j] * cols[j][i]; size += Math.abs(probe[j] * cols[j][i]); }
    if (Math.abs(got[i] - want) > 1e-9 * Math.max(1, size)) return null;
  }
  return { r0, cols };
}

/** Levenberg–Marquardt from one starting point. */
function descend(resid: Residuals, start: number[]): Fit | null {
  const k = start.length;
  let theta = start.slice();
  let r = resid(theta);
  if (!finite(r)) return null;
  let rss = sumSq(r);
  let lambda = 1e-3;
  for (let iter = 0; iter < 200; iter++) {
    charge();
    const cols: number[][] = [];
    for (let j = 0; j < k; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(theta[j]));
      const up = theta.slice(), down = theta.slice();
      up[j] += h;
      down[j] -= h;
      const ru = resid(up), rd = resid(down);
      if (finite(ru) && finite(rd)) cols.push(ru.map((x, i) => (x - rd[i]) / (2 * h)));
      else if (finite(ru)) cols.push(ru.map((x, i) => (x - r![i]) / h));
      else if (finite(rd)) cols.push(rd.map((x, i) => (r![i] - x) / h));
      else return { params: theta, rss };
    }
    // (JᵀJ + λ·diag) δ = −Jᵀr, as the least-squares problem with k damping rows under J.
    let stepped = false;
    for (let tries = 0; tries < 30; tries++) {
      const damped = cols.map((col, j) => {
        const extra = new Array<number>(k).fill(0);
        extra[j] = Math.sqrt(lambda) * Math.max(Math.sqrt(sumSq(col)), 1e-12);
        return [...col, ...extra];
      });
      const delta = solveLinear(damped, [...r, ...new Array<number>(k).fill(0)]);
      const next = delta && theta.map((x, j) => x + delta[j]);
      const rn = next && resid(next);
      if (next && finite(rn) && sumSq(rn) <= rss) {
        const gain = rss - sumSq(rn);
        const moved = Math.max(...delta!.map((d, j) => Math.abs(d) / Math.max(1e-12, Math.abs(theta[j]))));
        theta = next;
        r = rn;
        rss = sumSq(rn);
        lambda = Math.max(lambda / 5, 1e-12);
        stepped = true;
        if (gain <= 1e-15 * rss || moved < 1e-13) return { params: theta, rss };
        break;
      }
      lambda *= 4;
      if (lambda > 1e12) break;
    }
    if (!stepped) break;
  }
  return { params: theta, rss };
}

/**
 * A walk stops a few parts in a billion short of a round answer: 1.9999999998 for 2. A value that close to a decimal
 * of six digits or fewer steps onto it, when that doesn't make the fit worse.
 */
function settle(resid: Residuals, fit: Fit): Fit {
  const params = fit.params.slice();
  let rss = fit.rss;
  for (let j = 0; j < params.length; j++) {
    const short = Number(params[j].toPrecision(6));
    if (short === params[j] || Math.abs(short - params[j]) > 1e-8 * Math.abs(params[j])) continue;
    const trial = params.slice();
    trial[j] = short;
    const r = resid(trial);
    if (finite(r) && sumSq(r) <= rss * (1 + 1e-9) + 1e-300) {
      params[j] = short;
      rss = Math.min(rss, sumSq(r));
    }
  }
  return { params, rss };
}

/** Where a walk starts: every unknown at 1 as Desmos has it, then other sizes and signs. */
const STARTS = [1, 0.5, 2, -1, 0.1, 10, -0.5, 0.01, 100, -10];

export function leastSquares(resid: Residuals, k: number): Fit {
  const lin = linearParts(resid, k);
  if (lin) {
    const t = solveColumns(lin.cols, lin.r0);
    if (!t) return fail('The data can\'t tell these unknowns apart. Use fewer of them, or more different data');
    const r = resid(t);
    if (!finite(r)) return { params: t, rss: NaN };
    // One round of refinement against the model's own differences: an intercept measured back from x's mean picks up
    // the slope's last digits times that mean, 0.999999997 for 1 over x from 1 to 200,000.
    const fix = solveColumns(lin.cols, r);
    const better = fix && t.map((x, j) => x + fix[j]);
    const rb = better && resid(better);
    if (better && finite(rb) && sumSq(rb) <= sumSq(r)) return { params: better, rss: sumSq(rb) };
    return { params: t, rss: sumSq(r) };
  }
  let best: Fit | null = null;
  for (let s = 0; s < STARTS.length; s++) {
    // Vary the unknowns against each other too, so a b^x doesn't always start with a = b.
    const start = Array.from({ length: k }, (_, j) => STARTS[(s + (s > 0 ? j : 0)) % STARTS.length]);
    const got = descend(resid, start);
    if (got && Number.isFinite(got.rss) && (!best || got.rss < best.rss)) best = got;
    if (best && best.rss === 0) break;
  }
  if (!best) return fail('The model has no value at the data for any start that was tried. Check it against the data, such as a log or a root of a negative number');
  return settle(resid, best);
}
