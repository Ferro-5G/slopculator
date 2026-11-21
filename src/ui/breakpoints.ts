// When a window gets the wide canvas, for every front end and the stylesheets. It imports nothing, so the build's
// config can read it as it is (vite.config.ts writes these queries into the stylesheets' (--phone) and (--desktop)).

/**
 * The narrowest window, in CSS px or points, that gets the wide canvas; anything narrower stacks the blocks in the
 * phone's column. A touch screen this short or shorter is a phone on its side, which keeps the column too (with the
 * keys down its right half): the canvas would have no room left over beside the keys.
 */
export const WIDE_MIN_W = 761;
export const SIDEWAYS_MAX_H = 460;
/** A phone on its side: a touch screen no taller than SIDEWAYS_MAX_H. The column goes on the left, the keys down the right. */
export const isSidewaysPhone = (height: number, touch: boolean): boolean => touch && height <= SIDEWAYS_MAX_H;
/** Whether a window takes the wide canvas. The web's narrow query is `(max-width: 760px), (max-height: 460px) and (pointer: coarse)`. */
export const isWideCanvas = (width: number, height: number, touch: boolean): boolean => width >= WIDE_MIN_W && !isSidewaysPhone(height, touch);
/** The web's narrow query, built from the same numbers. */
export const NARROW_QUERY = `(max-width: ${WIDE_MIN_W - 1}px), (max-height: ${SIDEWAYS_MAX_H}px) and (pointer: coarse)`;
/** Its opposite: the wide canvas. */
export const WIDE_QUERY = `(min-width: ${WIDE_MIN_W}px) and (min-height: ${SIDEWAYS_MAX_H + 1}px), (min-width: ${WIDE_MIN_W}px) and (pointer: fine)`;
