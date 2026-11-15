import type { RowInput } from '../engine/document';

type Dist = Extract<RowInput, { kind: 'expr' }>['dist'];

export type StarterId = 'normal' | 'zscore' | 'binomial' | 'sliders' | 'moistAir' | 'charge' | 'coil';

export interface Starter {
  id: StarterId;
  title: string;
  lines: string[];
  dist?: Dist;
  hvac?: boolean;
}

export const STARTERS: Starter[] = [
  { id: 'normal', title: 'Shade a normal curve', lines: ['μ = 400', 'σ = 50', 'normaldist(μ, σ)'], dist: { cdf: true, min: '350', max: '500' } },
  { id: 'zscore', title: 'z-score, then the area', lines: ['zscore(180, 280, 40)', 'normalcdf(-inf, ans)'] },
  { id: 'binomial', title: 'Binomial: exactly or at most', lines: ['binompdf(10, 0.5, 6)', 'binomcdf(10, 0.5, 6)'] },
  { id: 'sliders', title: 'Graph with sliders', lines: ['a = 1', 'y = a(x - 1)^2 - 3'] },
  { id: 'moistAir', title: 'HVAC: moist air', lines: ['psych(75, 50)', 'psychwb(75, 62.6)'], hvac: true },
  { id: 'charge', title: 'HVAC: check a charge', lines: ['superheat("R410A", 118, 50)', 'subcool("R410A", 340, 95)', 'refcycle("R410A", 45, 105, 10, 10, 70)'], hvac: true },
  { id: 'coil', title: 'HVAC: coil and duct', lines: ['coil(1200, 75, 50, 55, 90)', 'ductsize(1000, 0.1)', 'ductvel(1000, 14)'], hvac: true },
];

/** The lines a starter opens as. Its shading, if it has one, goes on the last. */
export const starterRows = (ex: Starter): { text: string; dist?: Dist }[] =>
  ex.lines.map((text, i) => (ex.dist && i === ex.lines.length - 1 ? { text, dist: { ...ex.dist } } : { text }));
