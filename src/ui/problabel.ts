export interface ProbLabelInput {
  a: number;
  b: number;
  mu: number;
  pdf: (x: number) => number;
  X: (x: number) => number;
  Y: (y: number) => number;
}

export interface ProbLabelPlacement {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  big: boolean;
}

const INSIDE_W = 56;
const INSIDE_H = 40;

export function probLabelPlacement({ a, b, mu, pdf, X, Y }: ProbLabelInput): ProbLabelPlacement {
  const xc = (a + b) / 2;
  const y0 = Y(0);
  if (X(b) - X(a) >= INSIDE_W && y0 - Y(pdf(xc)) >= INSIDE_H) {
    return { x: X(xc), y: Y(pdf(xc) * 0.42), anchor: 'middle', big: true };
  }
  const xa = Math.min(b, Math.max(a, mu));
  const anchor = xa >= b ? 'end' : xa <= a ? 'start' : 'middle';
  const nudge = anchor === 'end' ? -6 : anchor === 'start' ? 6 : 0;
  return { x: X(xa) + nudge, y: Y(pdf(xa)) - 14, anchor, big: false };
}
