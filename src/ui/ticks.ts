export function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

const MAX_TICKS = 2000;

/**
 * The multiples of step from min to max. Each tick is k·step for a whole k rather than a running sum, and the count is
 * capped: far from 0 a step can be smaller than the gap between neighboring doubles (around 1e16, or after a deep
 * zoom), where `x += step` leaves x unchanged and a loop on it never ends.
 */
export function tickValues(min: number, max: number, step: number): number[] {
  if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  const k0 = Math.ceil(min / step), n = Math.floor(max / step) - k0;
  if (!(n >= 0) || n > MAX_TICKS) return [];
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push((k0 + i) * step);
  return out;
}
