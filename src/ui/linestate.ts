import { BUILTINS } from '../engine/builtins';
import type { LineWarning } from '../engine/diagnostics';
import { lineName, type RowInput, type RowResult } from '../engine/document';
import { formatNumber, plainValue, type DisplayOpts } from '../engine/format';
import { isUnit, otherUnit } from '../engine/units';
import { isDist, type Value } from '../engine/values';
import { emptyArgumentHint, inEmptyArgument, USAGE } from './complete';
import { calmWhileTyping, leadingOperator, spokenError, UNFINISHED_HINT } from './errortext';
import { slots, unfilled, type FnInfo, type SlotHint } from './slots';
import { assignsLiteral } from './typeset';

export const slotInfo: FnInfo = (n) => ({ usage: USAGE.get(n), min: BUILTINS[n]?.min });

export interface TypingState {
  hints: SlotHint[] | null;
  pending: boolean;
  calm: boolean;
  unfinished: boolean;
  lead: boolean;
}

/** What a line being typed in shows. No caret yet counts as a caret at the end. */
export function typingState(text: string, error: string | undefined, caret: { start: number; end: number } | undefined, heading: boolean): TypingState {
  const collapsed = !caret || caret.start === caret.end;
  const slotted = collapsed && !heading ? slots(text, caret?.start ?? text.length, slotInfo) : null;
  const calm = !!error && calmWhileTyping(text, error, caret?.start);
  return {
    hints: slotted?.hints.length ? slotted.hints : null,
    pending: !!slotted?.pending || unfilled(text, slotInfo) > 0,
    calm,
    unfinished: !!caret && collapsed && inEmptyArgument(text, caret.start),
    lead: calm && leadingOperator(text, error),
  };
}

/** A line in this state shows a hint, or nothing, where its error or answer would go. */
export const heldBack = (s: TypingState): boolean => s.calm || s.unfinished || s.pending;

/** A line's first warning, if it's on screen: most wait for the typing pause. */
export function shownWarning(r: RowResult | undefined, typing: boolean): LineWarning | undefined {
  const first = r?.warnings?.[0];
  return first && !r.error && (!typing || first.instant) ? first : undefined;
}

export const warningFixes = (w: LineWarning): string[] => [w.fix, w.alt].filter((f): f is string => !!f);

/** Whether a value reads as one answer. Each kind is named, so a new one can't compile without choosing. */
function hasOneAnswer(v: Value): boolean {
  if (typeof v === 'number') return true;
  switch (v.t) {
    case 'normal': case 'binom': case 'polygon': case 'record': return false;
    case 'complex': case 'list': case 'point': case 'vector': case 'matrix': case 'text': return true;
  }
}

function spokenAnswer(r: RowResult, name: string, text: string, o: DisplayOpts): string {
  if (r.truth !== undefined) return `${name} equals ${r.truth}`;
  if (r.distProb !== undefined) return `${name}: probability ${formatNumber(r.distProb, o, true)}`;
  return r.value !== undefined && hasOneAnswer(r.value) && !assignsLiteral(text) ? `${name} equals ${plainValue(r.value, o, r.prob, r.precise)}` : '';
}

/**
 * What a screen reader hears for the line in use: what the screen shows there. Empty when it shows nothing to say.
 * @param held the screen is holding the line's error or answer back (`heldBack`).
 * @param typing typing hasn't paused yet.
 */
export function spokenLine({ text, r, index, held, caret, typing, rows, o }: { text: string; r: RowResult | undefined; index: number; held: boolean; caret: { start: number; end: number } | undefined; typing: boolean; rows: readonly RowInput[]; o: DisplayOpts }): string {
  if (!r) return '';
  const name = r.lineName ?? `Line ${index + 1}`;
  const withWarning = (said: string) => {
    const warning = shownWarning(r, typing);
    return warning ? `${said || name}. Check this: ${warning.message}` : said;
  };
  if (!r.error && !held) return withWarning(spokenAnswer(r, name, text, o));
  if (typing) return '';
  const slot = held && caret && caret.start === caret.end ? emptyArgumentHint(text, caret.start, rows) : null;
  if (slot) return `${name}: ${slot.usage}`;
  return r.error ? `${name}: ${spokenError(text, r.error, held, isUnit, otherUnit)}` : withWarning(`${name}: ${UNFINISHED_HINT}`);
}

export function lineLabel(r: RowResult | undefined, index: number, lettersOn: boolean): { label: string; unlettered: boolean } {
  const unlettered = lettersOn && r?.heading === undefined && !r?.lineName;
  return { label: r?.lineName ?? (unlettered ? lineName(index) : String(index + 1)), unlettered };
}

/** What Copy result takes from a line: a shaded curve's probability, nothing from an unshaded one, otherwise its value. */
export function copyableValue(r: RowResult | undefined, o: DisplayOpts): (() => string) | undefined {
  if (!r || r.error) return undefined;
  const { value, distProb, prob, precise } = r;
  if (distProb !== undefined) return () => plainValue(distProb, o, true);
  return value !== undefined && !isDist(value) ? () => plainValue(value, o, prob, precise) : undefined;
}
