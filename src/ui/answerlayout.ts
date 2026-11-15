import { DIGITS } from '../engine/exact';
import type { DisplayOpts } from '../engine/format';
import type { UnitCircleFigure } from '../engine/values';

export const UNIT_CIRCLE = { size: 120, center: 60, radius: 40, arcRadius: 12, axisFrom: 6, axisTo: 114, cosLabel: [114, 55], sinLabel: [64, 13] } as const;

export interface UnitCircleDrawing {
  tip: [number, number];
  /** The angle's arc from the positive x-axis, counter-clockwise; null at 0. */
  arc: { large: boolean; end: [number, number] } | null;
  label: string;
}

export function unitCircleDrawing({ cos, sin, angle }: UnitCircleFigure): UnitCircleDrawing {
  const { center, radius, arcRadius } = UNIT_CIRCLE;
  const turn = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return {
    tip: [center + radius * cos, center - radius * sin],
    arc: turn > 1e-9 ? { large: turn > Math.PI, end: [center + arcRadius * Math.cos(turn), center - arcRadius * Math.sin(turn)] } : null,
    label: `Unit circle with an arrow to the point (${cos.toFixed(2)}, ${sin.toFixed(2)})`,
  };
}

/** The most rows, and the most columns, a matrix answer shows. identity() stops at 20, so most matrices fit whole. */
export const MATRIX_SHOWN_MAX = 20;

/**
 * The cells a matrix answer shows, formatted by cell: all of them, or the top-left corner of a bigger matrix with … and
 * ⋮ where the rest would be, plus a line that says so. A 256 × 256 matrix (twenty lines of augment) used to draw all
 * 65,536 cells on every load, which froze the page for seconds. Copying the answer still copies every entry.
 */
export function matrixCells<T>(m: readonly (readonly T[])[], cell: (c: T, i: number, j: number) => string): { cells: string[][]; more: string | null } {
  const rows = m.length, cols = m[0]?.length ?? 0;
  const r = Math.min(rows, MATRIX_SHOWN_MAX), c = Math.min(cols, MATRIX_SHOWN_MAX);
  const cells = m.slice(0, r).map((row, i) => {
    const out = row.slice(0, c).map((x, j) => cell(x, i, j));
    if (c < cols) out.push('…');
    return out;
  });
  if (r < rows) cells.push(Array.from({ length: cells[0]?.length ?? 0 }, () => '⋮'));
  return { cells, more: r < rows || c < cols ? `${rows} × ${cols} matrix, showing the top-left ${r} × ${c}` : null };
}

const MATRIX_MIN_FONT = 12;

/** The font size that fits a matrix `need` wide into `room`, or null when it already fits or there's no room to measure. */
export function matrixFitFont(font: number, room: number, need: number): number | null {
  return room && need > room ? Math.max(MATRIX_MIN_FONT, Math.floor(font * (room / need) * 10) / 10) : null;
}

/** Null for an answer with no single line of text, like a matrix. */
export function isLongAnswer(text: string | null | undefined, o: DisplayOpts): boolean {
  return !!o.fullDigits && !!text && !text.includes('×') && text.replace(/[^0-9]/g, '').length > DIGITS.wholeOnScreen;
}
