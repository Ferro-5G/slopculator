import type { RowInput } from '../engine/document';

type Dist = Extract<RowInput, { kind: 'expr' }>['dist'];

export type StarterId = 'normal' | 'zscore' | 'binomial' | 'sliders' | 'moistAir' | 'charge' | 'coil';

export interface Starter {
  id: StarterId;
  title: string;
  subtitle?: string;
  lines: string[];
  dist?: Dist;
  hvac?: boolean;
}

export const STARTERS: Starter[] = [
  { id: 'normal', title: 'Shaded normal curve', subtitle: 'Interactive mean & SD sliders with cumulative area shading', lines: ['μ = 400', 'σ = 50', 'normaldist(μ, σ)'], dist: { cdf: true, min: '350', max: '500' } },
  { id: 'zscore', title: 'z-score to left-tail area', subtitle: 'Standardize a raw value and integrate the normal tail', lines: ['zscore(180, 280, 40)', 'normalcdf(-inf, ans)'] },
  { id: 'binomial', title: 'Binomial probabilities', subtitle: 'Compare exact P(X = 6) against cumulative P(X ≤ 6)', lines: ['binompdf(10, 0.5, 6)', 'binomcdf(10, 0.5, 6)'] },
  { id: 'sliders', title: 'Interactive parabola', subtitle: 'Drag a live slider to reshape a graphed curve in real time', lines: ['a = 1', 'y = a(x - 1)^2 - 3'] },
  { id: 'moistAir', title: 'Moist-air psychrometrics', subtitle: 'Full air state from dry bulb & %RH or wet-bulb sling reading', lines: ['psych(75, 50)', 'psychwb(75, 62.6)'], hvac: true },
  { id: 'charge', title: 'Refrigerant charge check', subtitle: 'R-410A superheat, subcooling, and full refrigeration cycle COP', lines: ['superheat("R410A", 118, 50)', 'subcool("R410A", 340, 95)', 'refcycle("R410A", 45, 105, 10, 10, 70)'], hvac: true },
  { id: 'coil', title: 'Cooling coil & duct sizing', subtitle: 'Tons, SHR, friction-rate duct diameter, and air velocity', lines: ['coil(1200, 75, 50, 55, 90)', 'ductsize(1000, 0.1)', 'ductvel(1000, 14)'], hvac: true },
];

export const EMPTY_STARTERS: StarterId[] = ['normal', 'sliders', 'binomial'];

/** The lines a starter opens as. Its shading, if it has one, goes on the last. */
export const starterRows = (ex: Starter): { text: string; dist?: Dist }[] =>
  ex.lines.map((text, i) => (ex.dist && i === ex.lines.length - 1 ? { text, dist: { ...ex.dist } } : { text }));
