// A block's readouts, shared by every front end: the named results a block with several shows in a column beside its
// figure (a moist-air state's Tdp, W and h; a list's n, x̄, s and median; a fit's slope, intercept and R²), each with
// the port its wires leave from (src/ui/ports.ts) when a line can read it on its own. Values come from the engine.
// No DOM here.
import type { RecordV } from '../engine/values';
import type { RowResult } from '../engine/document';
import type { CanvasRow } from './canvas';
import { figureData, type FigureScope } from './figures';
import { R2_PORT, rowPorts } from './ports';
import { unitsOf } from './psych';
import { tagNumber } from './wiretags';

export interface Readout {
  /** The port a wire reading this result leaves from, or null when no line can read it on its own. */
  port: string | null;
  /** Its name: set in the math face (italic) when `math`, else as a word. `sub` and `sup` go after it. */
  label: string;
  math: boolean;
  sub?: string;
  sup?: string;
  /** The value as the block shows it, and its unit. */
  text: string;
  unit: string | null;
}

const fixed = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d).replace('-', '−') : '—');
const sig = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? tagNumber(v) : '—');

function airReadouts(v: RecordV): Readout[] {
  const si = /°C/.test(v.rows[0]?.label ?? '');
  const u = unitsOf(si);
  const f = (key: string) => { const x = v.rows.find((r) => r.key === key)?.value; return typeof x === 'number' ? x : NaN; };
  return [
    { port: 'Tdp', label: 'T', sub: 'dp', math: true, text: fixed(f('Tdp'), 1), unit: u.t },
    { port: 'W', label: 'W', math: true, text: fixed(f('W') * u.wScale, si ? 2 : 1), unit: u.w },
    { port: 'h', label: 'h', math: true, text: fixed(f('h'), si ? 1 : 2), unit: u.h },
  ];
}

/**
 * A row's readouts, in the order its block shows them, or null for a row that has none: a named moist-air state, a
 * list of numbers (a stats block), and paired data (a fit, linreg, or a list of points).
 */
export function rowReadouts(scope: FigureScope): Readout[] | null {
  const k = scope.rows.findIndex((r) => r.id === scope.id);
  const row: CanvasRow | undefined = scope.rows[k], result: RowResult | undefined = scope.results[k];
  if (!row || row.kind !== 'expr' || !result || result.error) return null;
  const v = result.value;
  if (typeof v === 'object' && v.t === 'record' && v.kind === 'air') return airReadouts(v);
  const ports = rowPorts(row, result);
  const has = (p: string) => (ports?.ports.includes(p) ? p : null);
  const data = figureData(scope);
  if (data?.kind === 'stats') {
    const s = data.sum;
    return [
      { port: has('n'), label: 'n', math: true, text: String(s.n), unit: null },
      { port: has('mean'), label: 'x̄', math: true, text: sig(s.mean), unit: null },
      ...(s.s === null ? [] : [{ port: has('s'), label: 's', math: true, text: sig(s.s), unit: null }]),
      { port: has('median'), label: 'median', math: false, text: sig(s.median), unit: null },
    ];
  }
  if (data?.kind === 'pairs') {
    return [
      { port: null, label: 'n', math: true, text: String(data.pts.length), unit: null },
      ...data.params.map((p): Readout => ({ port: p.port && has(p.port) ? p.port : null, label: p.label, math: p.label.length === 1, text: sig(p.value), unit: null })),
      ...(data.r2 === null ? [] : [{ port: has(R2_PORT) ?? has('r2'), label: data.source === 'fit' ? 'R' : 'r', sup: '2', math: true, text: sig(data.r2), unit: null }]),
    ];
  }
  return null;
}
