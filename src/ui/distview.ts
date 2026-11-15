import { formatNumber, type DisplayOpts } from '../engine/format';
import type { Value } from '../engine/values';

export const DIST_OFF = { cdf: false, min: '-inf', max: '' };

export interface DistBounds { min: string; max: string }

const isNegInf = (t: string) => /^[-−]\s*(inf|∞)$/.test(t);
const isPosInf = (t: string) => /^\+?\s*(inf|∞)$/.test(t);
const showBound = (t: string) => t.replace(/^-/, '−');

export function distStatement(dist: DistBounds, value: Value | undefined, o: DisplayOpts): { stmt: string; zText: string } {
  const normal = typeof value === 'object' && value.t === 'normal' ? value : null;
  const binom = typeof value === 'object' && value.t === 'binom';
  const lo = dist.min.trim() || '-inf', hi = dist.max.trim() || 'inf';
  const all = isNegInf(lo) && isPosInf(hi);
  const lt = binom ? '≤' : '<';
  const stmt = all ? 'P(all)' : isNegInf(lo) ? `P(X ${lt} ${showBound(hi)})` : isPosInf(hi) ? `P(X ${binom ? '≥' : '>'} ${showBound(lo)})` : `P(${showBound(lo)} ${lt} X ${lt} ${showBound(hi)})`;
  let zText = '';
  if (normal && !all) {
    const { mu, sigma } = normal;
    const zOf = (t: string) => {
      if (isNegInf(t)) return '−∞';
      if (isPosInf(t)) return '∞';
      const x = Number(t.replace('−', '-'));
      return Number.isFinite(x) ? formatNumber(Number(((x - mu) / sigma).toPrecision(6)), { ...o, exact: false, percent: false }) : '';
    };
    const zl = zOf(lo), zh = zOf(hi);
    if (zl && zh) zText = `z from ${zl} to ${zh}`;
  }
  return { stmt, zText };
}

const finite = (b: string, open: (t: string) => boolean) => (b.trim() && !open(b.trim()) ? b.trim() : '0');

export function distPresets(dist: DistBounds, value: Value | undefined) {
  const normal = typeof value === 'object' && value.t === 'normal' ? value : null;
  return {
    left: { min: '-inf', max: finite(dist.max, isPosInf) },
    right: { min: finite(dist.min, isNegInf), max: 'inf' },
    bands: normal ? [1, 2, 3].map((k) => ({ k, min: String(Number((normal.mu - k * normal.sigma).toPrecision(12))), max: String(Number((normal.mu + k * normal.sigma).toPrecision(12))) })) : [],
  };
}
