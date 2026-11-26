import type { Settings } from '../engine/evaluator';
import type { DisplayOpts } from '../engine/format';

export interface ModeDoc { settings: Required<Settings>; display: DisplayOpts }
export interface ModePatch { settings?: Partial<Settings>; display?: Partial<DisplayOpts> }

interface ModeBase {
  title: string;
  /** A choice: whether its first option is picked. A switch: whether it's on. */
  read: (doc: ModeDoc) => boolean;
  patch: (on: boolean) => ModePatch;
  /** The letter after Ctrl+Alt on a keyboard. */
  key?: string;
}
export interface ChoiceMode extends ModeBase { a: [name: string, hint: string]; b: [name: string, hint: string] }
export interface SwitchMode extends ModeBase { hint: string }

export const CHOICES = {
  angle: { title: 'Angles', a: ['Degrees', 'sin(30) = 0.5'], b: ['Radians', 'sin(π/6) = 0.5'], read: (d) => d.settings.deg, patch: (deg) => ({ settings: { deg } }), key: 'D' },
  answers: { title: 'Answers', a: ['Decimal', '1/3 = 0.333…'], b: ['Exact', '1/3 stays 1/3'], read: (d) => !d.display.exact, patch: (on) => ({ display: { exact: !on } }), key: 'E' },
  huge: { title: 'Huge answers', a: ['Short', '2⁶⁰ = 1.152921505 × 10¹⁸'], b: ['Every digit', 'All 19 digits'], read: (d) => !d.display.fullDigits, patch: (on) => ({ display: { fullDigits: !on } }) },
  sd: { title: 'Standard deviation', a: ['Population', 'σ, divides by n'], b: ['Sample', 's, divides by n − 1'], read: (d) => !d.settings.sample, patch: (on) => ({ settings: { sample: !on } }), key: 'M' },
  addPercent: { title: 'Adding a percent', a: ['Of the number', '80 + 15% = 92'], b: ['As a number', '80 + 15% = 80.15'], read: (d) => d.settings.percentOf, patch: (percentOf) => ({ settings: { percentOf } }) },
  working: { title: 'Working', a: ['Show', 'Angle units, formulas, drawings'], b: ['Hide', 'Answers only'], read: (d) => d.settings.working, patch: (working) => ({ settings: { working } }) },
} satisfies Record<string, ChoiceMode>;

export const SWITCHES = {
  percent: { title: 'Percent probabilities', hint: 'Shows 0.25 as 25%', read: (d) => d.display.percent, patch: (percent) => ({ display: { percent } }), key: 'P' },
  letters: { title: 'Line letters', hint: 'Line 1 is A, line 2 is B, …', read: (d) => d.settings.lineNames, patch: (lineNames) => ({ settings: { lineNames } }), key: 'L' },
  complex: { title: 'Complex numbers', hint: '√(−1) = i', read: (d) => d.settings.complex, patch: (complex) => ({ settings: { complex } }) },
} satisfies Record<string, SwitchMode>;

/** On the phones a sheet's everyday modes sit in Modes, and the ones set once and left sit in Settings. */
export const PHONE_MODES = ['angle', 'answers', 'sd'] as const;
export const PHONE_SETTINGS = ['huge', 'working', 'addPercent'] as const;
export type PhoneSetting = (typeof PHONE_SETTINGS)[number];

const SMALL_WORD = /^(a|an|and|as|of|or|the|to)$/;
/** A mode's words in Apple's title case: capitalized, but for small words after the first. */
export const titleCased = (words: string): string =>
  words.replace(/\S+/g, (w, at: number) => (at > 0 && SMALL_WORD.test(w) ? w : w[0].toUpperCase() + w.slice(1)));
