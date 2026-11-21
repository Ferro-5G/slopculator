// A block's controls, shared by every front end: one style for every control a block carries in its top corner.
// A figure block switches between its figure and its numbers (△ and =), a line with working opens its Steps, and a
// Riemann figure picks where its strips sample. Each is a choice of options or a toggle; the platforms draw them the
// same way (a group with a fine edge, the chosen one raised). No DOM here.
import type { FigureKind, RiemannRule } from './figures';
import { UNFOLD_LABEL } from './unfold';

/** What a figure block shows: its figure (the default), or its numbers, as a value block shows them. */
export type BlockView = 'figure' | 'numbers';

export interface ControlOption { value: string; glyph: string; label: string }
export interface ChoiceControl { kind: 'choice'; id: 'view' | 'rule'; label: string; options: readonly ControlOption[]; value: string }
/** `flag`: the line fails, which shows on the toggle while it's off. */
export interface ToggleControl { kind: 'toggle'; id: 'steps'; text: string; label: string; on: boolean; flag: boolean }
export type BlockControl = ChoiceControl | ToggleControl;

export const VIEW_OPTIONS: readonly ControlOption[] = [
  { value: 'figure', glyph: '△', label: 'Figure' },
  { value: 'numbers', glyph: '=', label: 'Numbers' },
];
export const RULE_OPTIONS: readonly ControlOption[] = [
  { value: 'left', glyph: 'Left', label: 'Left ends' },
  { value: 'mid', glyph: 'Middle', label: 'Middles' },
  { value: 'right', glyph: 'Right', label: 'Right ends' },
];

export interface BlockControlState {
  figure: FigureKind | null;
  view: BlockView;
  /** Whether the line has steps to open (canUnfold), and whether they're open. */
  steps: boolean;
  stepsOpen: boolean;
  failed: boolean;
}

/** The controls in a block's top corner, in order: its view, then its Steps. */
export function blockControls(s: BlockControlState): BlockControl[] {
  const out: BlockControl[] = [];
  if (s.figure) out.push({ kind: 'choice', id: 'view', label: 'Show', options: VIEW_OPTIONS, value: s.view });
  if (s.steps) out.push({ kind: 'toggle', id: 'steps', text: UNFOLD_LABEL, label: s.stepsOpen ? 'Hide the steps' : 'Show the steps', on: s.stepsOpen, flag: s.failed });
  return out;
}

/** The controls a figure carries over its own corner: a Riemann sum's rule. */
export function figureControls(kind: FigureKind, view: BlockView, rule: RiemannRule): ChoiceControl[] {
  return kind === 'riemann' && view === 'figure' ? [{ kind: 'choice', id: 'rule', label: 'Sample at', options: RULE_OPTIONS, value: rule }] : [];
}

/** A row's stored view: only numbers is stored, figure being the default. */
export const viewOf = (row: { view?: 'numbers' }): BlockView => (row.view === 'numbers' ? 'numbers' : 'figure');
