// A One Euro style filter for the graph's drag, run once per display frame. Touch reports arrive late and in coarse steps,
// so a slow drag advances in jerks unless the frames between reports are filled in. Cutoffs are in Hz and the speed is in
// points per second. Both functions run on the Reanimated UI runtime, so they call only Math and read nothing from this module.

export interface SmootherParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

/** Tuned on recorded slow drags from an iPhone at 120 Hz. */
export const DEFAULT_SMOOTHER: SmootherParams = { minCutoff: 8, beta: 0.7, dCutoff: 8 };

export interface SmootherState {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export function startSmoother(x: number, y: number): SmootherState {
  'worklet';
  return { x, y, dx: 0, dy: 0 };
}

/**
 * The state keeps no previous raw sample, so the velocity is the filtered path's own step. In steady motion that is the
 * finger's velocity, and the speed that sets the cutoff uses the velocity from the previous frame.
 */
export function stepSmoother(s: SmootherState, rawX: number, rawY: number, dtMs: number, p: SmootherParams): SmootherState {
  'worklet';
  const dt = Math.min(50, Math.max(0.5, dtMs)) / 1000;
  const k = 2 * Math.PI * dt;
  const speed = Math.sqrt(s.dx * s.dx + s.dy * s.dy);
  const cutoff = p.minCutoff + p.beta * speed;
  const a = (k * cutoff) / (1 + k * cutoff);
  const x = s.x + a * (rawX - s.x);
  const y = s.y + a * (rawY - s.y);
  const d = (k * p.dCutoff) / (1 + k * p.dCutoff);
  const dx = s.dx + d * ((x - s.x) / dt - s.dx);
  const dy = s.dy + d * ((y - s.y) / dt - s.dy);
  return { x, y, dx, dy };
}
