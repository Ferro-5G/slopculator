/**
 * Shared motion physics and timing tokens used across front ends.
 * Pure numbers and CSS timing strings; stylesheets mirror the curves here.
 */

export interface SpringSpec {
  readonly damping: number;
  readonly stiffness: number;
  readonly mass: number;
}

export const SPRINGS = {
  /** Tactile keycap rebound after release (~0.7% overshoot, ~240 ms). */
  pressOut: { damping: 17, stiffness: 600, mass: 0.5 },
  /** Leading edge of sliding tab and sub-tab indicators. */
  snapLead: { damping: 22, stiffness: 420, mass: 0.6 },
  /** Trailing edge of sliding indicators, creating a gentle liquid stretch. */
  snapTrail: { damping: 24, stiffness: 240, mass: 0.8 },
  /** Sent expression gliding from the composer into its committed block. */
  launch: { damping: 24, stiffness: 220, mass: 0.9 },
  /** Sibling blocks settling smoothly to make room. */
  settle: { damping: 26, stiffness: 260, mass: 0.9 },
} as const satisfies Record<string, SpringSpec>;

export const DURATIONS = {
  pressIn: 60,
  pressOut: 280,
  pressFlash: 220,
  snapLead: 260,
  snapTrail: 360,
  launch: 420,
  settle: 300,
  fade: 140,
  fadeOut: 110,
  clearBreath: 160,
  answerAppear: 180,
  answerCool: 600,
  deckSlide: 220,
  tintSwap: 200,
  stepGrow: 200,
  stepEnter: 320,
  stepClose: 120,
  auroraDrift: 9000,
  auroraSheen: 700,
  auroraTint: 360,
  auroraLandHalo: 1200,
  emptyDraw: 900,
  emptyFillDelay: 300,
  emptyFadeOut: 160,
} as const;

export const CURVES = {
  pressIn: 'cubic-bezier(.3, .7, .4, 1)',
  pressOut: 'cubic-bezier(.2, .8, .2, 1)',
  snap: 'cubic-bezier(.32, .72, 0, 1)',
  launch: 'cubic-bezier(.22, 1, .36, 1)',
  settle: 'cubic-bezier(.2, .8, .2, 1)',
  fade: 'ease-out',
  cool: 'cubic-bezier(.22, 1, .36, 1)',
  auroraDrift: 'cubic-bezier(.45, 0, .55, 1)',
} as const;

export const PRESS_DEPTH = {
  num: 0.955,
  fn: 0.955,
  op: 0.955,
  act: 0.955,
  red: 0.955,
  hero: 0.975,
  wide: 0.975,
  pill: 0.96,
  block: 0.985,
} as const;

export const STAGGER = {
  stepMs: 28,
  maxIndex: 8,
  starterMs: 40,
} as const;
