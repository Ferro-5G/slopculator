/** A note is brief; an action leaves time to read it and reach Undo on every platform. */
export const TOAST_MS = { note: 1600, action: 10000 } as const;
/**
 * Where a toast sits on every front end: centred over the composer, this far above it (its tabs on the web). Never over
 * the composer, the keys, or the line being worked on, which is in the composer.
 */
export const TOAST_GAP = 8;
