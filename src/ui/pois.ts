export type MarkKind = 'zero' | 'max' | 'min' | 'y-int' | 'intersection';
export interface Mark { x: number; y: number; kind: MarkKind; rowId?: string }
export interface MarkCurve { f: (x: number) => number; rowId?: string }

export function findMarks(curves: MarkCurve[], xs: number[], yr: number, yInt: boolean): Mark[] {
  const out: Mark[] = [];
  if (xs.length < 3) return out;
  const bisect = (g: (x: number) => number, a: number, b: number): number => {
    let ga = g(a);
    for (let k = 0; k < 60; k++) {
      const m = (a + b) / 2, gm = g(m);
      if (gm === 0) return m;
      if (Math.sign(gm) === Math.sign(ga)) { a = m; ga = gm; } else b = m;
    }
    return (a + b) / 2;
  };
  const roots = (g: (x: number) => number, scale: (x: number) => number, gs: number[]): number[] => {
    const rs: number[] = [];
    let prev = gs[0];
    for (let k = 1; k < xs.length; k++) {
      const cur = gs[k];
      if (Number.isFinite(prev) && Number.isFinite(cur)) {
        // A sample that lands on 0 is a root only on its own: inside a flat run (max(0, x), or two curves that
        // overlap) every sample is 0, and each one used to get a marker.
        if (cur === 0) {
          if (prev !== 0 && gs[k + 1] !== 0) rs.push(xs[k]);
        } else if (prev !== 0 && Math.sign(prev) !== Math.sign(cur)) {
          const r = bisect(g, xs[k - 1], xs[k]);
          // Reject sign flips across a pole.
          if (Math.abs(g(r)) < 1e-6 * Math.max(1, scale(r))) rs.push(r);
        }
      }
      prev = cur;
    }
    return rs;
  };
  const clean = (v: number) => (Math.abs(v) < yr * 1e-12 ? 0 : Number(v.toPrecision(12)));
  const ys = curves.map((c) => xs.map(c.f));
  curves.forEach((c, n) => {
    const f = c.f, y = ys[n];
    for (const r of roots(f, () => 1, y)) out.push({ x: clean(r), y: 0, kind: 'zero', rowId: c.rowId });
    if (yInt && xs[0] < 0 && xs[xs.length - 1] > 0) {
      const y0 = f(0);
      if (Number.isFinite(y0)) out.push({ x: 0, y: clean(y0), kind: 'y-int', rowId: c.rowId });
    }
    // Extrema: the slope changes sign between samples; refined with a golden-section search.
    for (let k = 1; k < xs.length - 1; k++) {
      // Equal samples in a row: a peak can fall exactly between two, but a longer flat run is a step or a constant
      // (floor(x) used to get a "max" at every step), not an extremum.
      let j = k + 1;
      while (j < xs.length && y[j] === y[k]) j++;
      if (j - k > 2) {
        k = j - 2;
        continue;
      }
      const a = y[k - 1], b = y[k], d = y[j];
      if (![a, b, d].every(Number.isFinite)) continue;
      const isMax = b > a && b > d, isMin = b < a && b < d;
      if (!isMax && !isMin) continue;
      let lo = xs[k - 1], hi = xs[j];
      const sgn = isMax ? -1 : 1, gr = (Math.sqrt(5) - 1) / 2;
      for (let it = 0; it < 60; it++) {
        const m1 = hi - gr * (hi - lo), m2 = lo + gr * (hi - lo);
        if (sgn * f(m1) < sgn * f(m2)) hi = m2; else lo = m1;
      }
      const x = (lo + hi) / 2, v = f(x);
      if (Number.isFinite(v) && Math.abs(v - b) < yr) out.push({ x: clean(x), y: clean(v), kind: isMax ? 'max' : 'min', rowId: c.rowId });
    }
    for (let m = n + 1; m < curves.length; m++) {
      const g = curves[m].f, gy = ys[m];
      const diff = (x: number) => f(x) - g(x);
      for (const r of roots(diff, (x) => Math.abs(f(x)) + Math.abs(g(x)), xs.map((_, k) => y[k] - gy[k]))) out.push({ x: clean(r), y: clean(f(r)), kind: 'intersection', rowId: c.rowId });
    }
  });
  return out;
}

export function markText(m: Mark, num: (v: number) => string): string {
  return `${m.kind} (${num(m.x)}, ${num(m.y)})`;
}
