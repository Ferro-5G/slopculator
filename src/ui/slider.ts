import type { SliderRange } from '../engine/document';

export type { SliderRange };

export function niceCeil(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 5, 10]) {
    // Powers of ten below 1 aren't exact in binary, so compare with a little give and rebuild the result from text.
    const v = Number((m * p).toPrecision(12));
    if (v >= x * (1 - 1e-12)) return v;
  }
  return 10 * p;
}

function reaches(value: number, min: number, step: number): boolean {
  const k = (value - min) / step;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

/**
 * A whole number steps by 1 from 0 to a clean number at least twice it. Any other value runs either side of zero, with
 * a step fine enough to land on it. Past the safe integers a step of 1 means nothing, and ±far can be wider than a
 * double can say, so those run from 0 by about a hundredth of the value.
 */
export function wholeAwareRange(value: number, custom?: SliderRange | null): SliderRange {
  if (custom) return custom;
  if (!Number.isFinite(value)) return { min: -10, max: 10, step: 0.1 };
  // Doubling past 1.8e308 is Infinity, and a drag across an infinite range writes Infinity or NaN into the line.
  const twice = Math.max(2 * Math.abs(value), 10);
  const far = Number.isFinite(twice) ? Math.min(niceCeil(twice), Number.MAX_VALUE) : Number.MAX_VALUE;
  if (Number.isSafeInteger(value)) return value === 0 ? { min: -10, max: 10, step: 1 } : value > 0 ? { min: 0, max: far, step: 1 } : { min: -far, max: 0, step: 1 };
  // Steps are built from text ("1e-2"), so 0.01 is the double nearest 0.01 rather than 10 ** -2's rounding.
  const stepAt = (e: number) => Number(`1e${e}`);
  const exp = Math.floor(Math.log10(Math.abs(value))) - 2;
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER) return value > 0 ? { min: 0, max: far, step: stepAt(exp) } : { min: -far, max: 0, step: stepAt(exp) };
  const lowest = Math.min(exp, -1);
  for (let e = lowest; e >= lowest - 4; e--) if (reaches(value, -far, stepAt(e))) return { min: -far, max: far, step: stepAt(e) };
  return { min: -far, max: far, step: stepAt(lowest) };
}
