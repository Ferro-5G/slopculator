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

const MATRIX_MIN_FONT = 12;

/** The font size that fits a matrix `need` wide into `room`, or null when it already fits or there's no room to measure. */
export function matrixFitFont(font: number, room: number, need: number): number | null {
  return room && need > room ? Math.max(MATRIX_MIN_FONT, Math.floor(font * (room / need) * 10) / 10) : null;
}

/** Null for an answer with no single line of text, like a matrix. */
export function isLongAnswer(text: string | null | undefined, o: DisplayOpts): boolean {
  return !!o.fullDigits && !!text && !text.includes('×') && text.replace(/[^0-9]/g, '').length > DIGITS.wholeOnScreen;
}
