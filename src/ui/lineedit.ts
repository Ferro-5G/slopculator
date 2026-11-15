import type { RowInput, RowResult } from '../engine/document';
import { isUnit } from '../engine/units';
import { leadingCall, stepsOverCloser } from './brackets';
import { errorFixes, leadingOperator } from './errortext';
import { matrixNextEmpty } from './slots';
import { charAfter, charBefore } from './text';

export interface KeyEdit {
  text: string;
  caret: number;
  /** What replaces start..end, or null when the key only moves the caret. */
  insert: string | null;
}

export function definitionInsert(ins: string, rest: string, caret: number): string {
  const m = /^([A-Za-z]) = $/.exec(ins);
  if (!m) return ins;
  return rest.includes('=') || rest.slice(0, caret).trim() ? m[1] : ins;
}

/**
 * "¦" marks where the caret lands, and what's selected goes there
 * (select "x+1", press sin → sin(x+1)).
 */
export function planInsert(raw: string, text: string, start: number, end: number): KeyEdit {
  const caretAt = raw.indexOf('¦');
  const ins = definitionInsert(raw.replace('¦', ''), text.slice(0, start) + text.slice(end), start);
  const selected = text.slice(start, end);
  if (!selected && caretAt < 0 && stepsOverCloser(text, start, ins)) return { text, caret: start + 1, insert: null };
  const insert = selected && caretAt >= 0 ? ins.slice(0, caretAt) + selected + ins.slice(caretAt) : ins;
  return { text: text.slice(0, start) + insert + text.slice(end), caret: caretAt >= 0 && !selected ? start + caretAt : start + insert.length, insert };
}

/** What Enter does to a line: `cell` is the matrix cell to step to; otherwise it moves on, first taking `fix` when one is on offer. */
export function enterStep(text: string, start: number, end: number, error: string | undefined): { cell: number | null; fix: string | null } {
  const cell = start === end ? matrixNextEmpty(text, start) : null;
  if (cell !== null) return { cell, fix: null };
  const fixes = error && leadingOperator(text, error) ? errorFixes(text, error, isUnit) : [];
  return { cell: null, fix: fixes.length === 1 ? fixes[0].text : null };
}

export function caretStep(text: string, at: number, back: boolean): number {
  return Math.max(0, Math.min(text.length, back ? at - charBefore(text, at) : at + charAfter(text, at)));
}

export function searchInsertLabel(raw: string): string | undefined {
  return leadingCall(raw) ?? (raw.startsWith('[[') ? 'matrix' : raw.replace('¦', '').trim() || undefined);
}

export function isFinishedLine(row: RowInput | undefined, r: RowResult | undefined): boolean {
  return row?.kind === 'expr' && !!row.text.trim() && !!r && !r.error && (r.value !== undefined || r.distProb !== undefined);
}
