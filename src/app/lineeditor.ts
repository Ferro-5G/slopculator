import { cmdOrCtrl } from './platform';
import { BUILTINS } from '../engine/builtins';
import type { RowResult } from '../engine/document';
import { closerOf, TYPED_CLOSERS } from '../ui/brackets';
import { type Completion, completions as findCompletions, sheetCandidates, type Candidate, applyCompletion, nextSlot, enclosingCall as callAt, ownFunctionUsage, inEmptyArgument, USAGE, signatureParts } from '../ui/complete';
import { lineCopy, nextColor } from '../ui/document';
import { enterStep, isFinishedLine, planInsert, searchInsertLabel } from '../ui/lineedit';
import { heldBack, typingState } from '../ui/linestate';
import { play } from './sound';
import { slotStep, wantsMatrix, matrixCell } from '../ui/slots';
import { openMatrixEditor } from './editors';
import { newId, type Row } from './docmodel';
import { h } from './dom';
import { addRow, applyFix, asOwnStep, moveRow, deleteRow, nextLine } from './edits';
import { pulse } from './feedback';
import { views, focusRow, viewOfInput } from './rowviews';
import { draftId, editingId } from './composer';
import { currentResults, rowIndex, doc, results, activeId, rowsChanged, activeInput } from './sheet';

export function commitLine(id: string): void {
  const v = views.get(id);
  const i = rowIndex(id);
  const row = doc.rows[i];
  if (v?.input && row?.kind === 'expr') {
    const step = enterStep(v.input.value, v.input.selectionStart ?? 0, v.input.selectionEnd ?? 0, currentResults()[i]?.error);
    if (step.cell !== null) {
      v.input.focus();
      v.input.setSelectionRange(step.cell, step.cell);
      v.refresh?.();
      return;
    }
    if (step.fix !== null) applyFix(row, step.fix);
  }
  if (currentResults()[rowIndex(id)]?.error) pulse(views.get(id)?.el, 'shake');
  nextLine(id);
}
export function rowKeys(e: KeyboardEvent, id: string, input: HTMLInputElement): void {
  const i = rowIndex(id);
  if (e.key === 'Enter') {
    e.preventDefault();
    commitLine(id);
  } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && e.shiftKey && !e.ctrlKey) {
    e.preventDefault();
    const row = doc.rows[i];
    if (row.kind !== 'expr') return;
    const copy = lineCopy(row);
    if (e.key === 'ArrowDown') addRow(id, copy);
    else {
      const before = i > 0 ? doc.rows[i - 1].id : null;
      if (before) addRow(before, copy);
      else {
        const newRow = { id: newId(), color: nextColor(doc.rows), ...copy } as Row;
        doc.rows.unshift(newRow);
        rowsChanged(newRow.id);
      }
    }
  } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && !e.ctrlKey) {
    e.preventDefault();
    moveRow(id, e.key === 'ArrowUp' ? -1 : 1);
  } else if (e.key === 'ArrowUp' && !e.altKey) {
    if (i > 0) { e.preventDefault(); focusRow(doc.rows[i - 1].id); }
  } else if (e.key === 'ArrowDown' && !e.altKey) {
    if (i < doc.rows.length - 1) { e.preventDefault(); focusRow(doc.rows[i + 1].id); }
  } else if (e.key === 'Backspace' && cmdOrCtrl(e) && e.shiftKey) {
    e.preventDefault();
    // A block deleted from the composer leaves the composer on its new line, not on the line above.
    if (editingId === id) { deleteRow(id, false); focusRow(draftId()); } else deleteRow(id);
  } else if (e.key === 'Backspace' && input.value === '' && doc.rows.length > 1) {
    e.preventDefault();
    deleteRow(id);
  }
}
function completions(input: HTMLInputElement): Completion | null {
  const caret = input.selectionStart ?? 0;
  if (caret !== input.selectionEnd) return null;
  return findCompletions(input.value, caret, sheetCandidates(doc.rows, results));
}
export function applyEdit(input: HTMLInputElement, edit: { text: string; caret: number }): void {
  if (edit.text !== input.value) input.value = edit.text;
  input.setSelectionRange(edit.caret, edit.caret);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
/** Through editText, so what ⌫ removes goes on the browser's undo stack like a keystroke. */
export function applyBackspace(input: HTMLInputElement, edit: { text: string; caret: number }): void {
  const removed = input.value.length - edit.text.length;
  if (removed) editText(input, '', edit.caret, edit.caret + removed);
  else input.setSelectionRange(edit.caret, edit.caret);
  viewOfInput.get(input)?.refresh?.();
}
export function complete(input: HTMLInputElement, item?: Candidate): boolean {
  const c = completions(input);
  if (!c) return false;
  applyEdit(input, applyCompletion(input.value, c, item ?? c.items[0]));
  return true;
}
export function jumpToNextSlot(input: HTMLInputElement): boolean {
  const caret = input.selectionStart ?? 0;
  if (caret !== input.selectionEnd) return false;
  const edit = nextSlot(input.value, caret);
  if (!edit) return false;
  applyEdit(input, edit);
  return true;
}
export const CLOSERS = new Set(TYPED_CLOSERS);
/** Returns true if it handled the key. */
export function autoPair(e: KeyboardEvent, input: HTMLInputElement): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  const s = input.selectionStart ?? 0, end = input.selectionEnd ?? 0;
  const v = input.value;
  const next = v[end] ?? '';
  const type = (text: string, from: number, to: number) => editText(input, text, from, to);
  const closer = closerOf(e.key);
  if (closer) {
    if (s !== end) {
      e.preventDefault();
      type(e.key + v.slice(s, end) + closer, s, end);
      return true;
    }
    if (next === '' || /[\s,)\]}]/.test(next)) {
      e.preventDefault();
      type(e.key + closer, s, end);
      input.setSelectionRange(s + 1, s + 1);
      return true;
    }
    return false;
  }
  if (CLOSERS.has(e.key) && s === end && next === e.key) {
    e.preventDefault();
    input.setSelectionRange(s + 1, s + 1);
    return false; // caret moved only; no text change
  }
  if (e.key === 'Backspace' && s === end && s > 0 && closerOf(v[s - 1]) === next && next !== '') {
    e.preventDefault();
    editText(input, '', s - 1, s + 1);
    return true;
  }
  return false;
}
export function enclosingCall(text: string, caret: number): { name: string; arg: number } | null {
  const call = callAt(text, caret);
  return call && (BUILTINS[call.name] || ownFunctionUsage(call.name, doc.rows)) ? call : null;
}
const selectionOf = (input: HTMLInputElement) => ({ start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length });
export function lineCalm(row: Extract<Row, { kind: 'expr' }>, r: RowResult, input: HTMLInputElement): boolean {
  if (document.activeElement !== input) return false;
  return heldBack(typingState(row.text, r.error, selectionOf(input), r.heading !== undefined));
}
export function drawSlots(input: HTMLInputElement, ghost: HTMLElement): void {
  const id = viewOfInput.get(input)?.row.id;
  const heading = !!id && currentResults()[rowIndex(id)]?.heading !== undefined;
  const hints = document.activeElement === input ? typingState(input.value, undefined, selectionOf(input), heading).hints ?? [] : [];
  input.classList.toggle('slotted', hints.length > 0);
  ghost.hidden = !hints.length;
  if (!hints.length) return;
  const cs = getComputedStyle(input);
  Object.assign(ghost.style, {
    left: `${input.offsetLeft}px`, top: `${input.offsetTop}px`, width: `${input.offsetWidth}px`, height: `${input.offsetHeight}px`,
    // Property by property: cs.font is empty in Chrome when font-variant-numeric is set, which left the copy at the
    // wrong size with the field's caret running ahead of it.
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, fontStretch: cs.fontStretch,
    fontVariantNumeric: cs.fontVariantNumeric, fontFeatureSettings: cs.fontFeatureSettings,
    letterSpacing: cs.letterSpacing, lineHeight: cs.lineHeight, textAlign: cs.textAlign,
    padding: cs.padding, borderStyle: 'solid', borderColor: 'transparent', borderWidth: cs.borderWidth,
  });
  const text = input.value;
  ghost.replaceChildren(...hints.flatMap((hint, i) => [text.slice(i ? hints[i - 1].at : 0, hint.at), h('span', { class: hint.current ? 'slot current' : 'slot' }, hint.text)]), text.slice(hints[hints.length - 1].at));
  ghost.scrollLeft = input.scrollLeft;
}
export function commaSteps(): boolean {
  const inp = activeInput();
  if (!inp || inp.selectionStart !== inp.selectionEnd) return false;
  const to = slotStep(inp.value, inp.selectionStart ?? 0);
  if (to === null) return false;
  inp.focus();
  inp.setSelectionRange(to, to);
  viewOfInput.get(inp)?.refresh?.();
  return true;
}
export function updateHint(input: HTMLInputElement, hint: HTMLElement): void {
  const rowEl = input.closest('.row');
  rowEl?.classList.remove('completing');
  if (document.activeElement !== input) {
    hint.hidden = true;
    return;
  }
  const c = completions(input);
  if (c) {
    rowEl?.classList.add('completing');
    const pick = (item: Candidate) => {
      const b = h('button', { type: 'button', class: item === c.items[0] ? 'cand first' : 'cand', tabindex: '-1', title: `Insert ${item.name}` }, item.name);
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        complete(input, item);
        updateHint(input, hint);
      });
      return b;
    };
    hint.replaceChildren(h('kbd', {}, 'Tab'), ...c.items.map(pick));
    hint.hidden = false;
    return;
  }
  const caret = input.selectionStart ?? 0;
  const phone = caret === input.selectionEnd;
  const next = phone ? nextButton(input) : null;
  if (phone && wantsMatrix(input.value, caret)) {
    const b = h('button', { type: 'button', class: 'cand grid-chip', tabindex: '-1', 'aria-label': 'Build matrix', title: 'Open the visual Matrix Builder and insert here' }, 'Build matrix…');
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      const from = input.selectionStart ?? caret;
      const to = input.selectionEnd ?? from;
      play('fn');
      openMatrixEditor({
        inline: true,
        onInsert: (m) => {
          input.focus();
          editText(input, m, from, to);
        },
      });
    });
    hint.replaceChildren(b, next ?? '');
    hint.hidden = false;
    return;
  }
  const cell = phone ? matrixCell(input.value, caret) : null;
  if (cell) {
    hint.replaceChildren(h('span', { class: 'sig cell' }, `Row ${cell.row}, column ${cell.col} `, h('span', { class: 'of' }, `of ${cell.rows} × ${cell.cols}`)), next ?? '');
    hint.hidden = false;
    return;
  }
  const call = enclosingCall(input.value, caret);
  if (call) {
    const usage = ownFunctionUsage(call.name, doc.rows) ?? USAGE.get(call.name) ?? `${call.name}(…)`;
    if (inEmptyArgument(input.value, caret)) rowEl?.classList.add('completing');
    const parts = signatureParts(usage, call.arg);
    hint.replaceChildren(h('span', { class: 'sig' }, ...(parts ? [parts.before, h('b', {}, parts.current), parts.after] : [usage])), next ?? '');
    hint.hidden = false;
    return;
  }
  if (next) {
    hint.replaceChildren(next);
    hint.hidden = false;
    return;
  }
  hint.hidden = true;
}
function nextButton(input: HTMLInputElement): HTMLButtonElement | null {
  const text = input.value, caret = input.selectionStart ?? 0;
  const to = slotStep(text, caret, true);
  const edit = to !== null ? { text, caret: to } : nextSlot(text, caret);
  if (!edit) return null;
  const b = h('button', { type: 'button', class: 'next-slot', tabindex: '-1', 'aria-label': 'Next argument', title: 'Moves to the next argument, or out of the brackets' }, 'Next');
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => {
    play('detent');
    applyEdit(input, edit);
    viewOfInput.get(input)?.refresh?.();
  });
  return b;
}
/**
 * Replaces from..to in the line the way typing would. execCommand puts the edit on the browser's undo stack, so
 * Ctrl+Z takes back a keypad insert like a keystroke, and it fires the input event itself. setRangeText is the
 * fallback where execCommand is missing, and then the event is sent by hand.
 */
export function editText(inp: HTMLInputElement, text: string, from: number, to: number): void {
  inp.focus();
  inp.setSelectionRange(from, to);
  let done = false;
  try {
    done = document.execCommand(text ? 'insertText' : 'delete', false, text);
  } catch {
    done = false;
  }
  if (!done) {
    inp.setRangeText(text, from, to, 'end');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
export function insertText(raw: string): void {
  let inp = activeInput() ?? (views.get(activeId ?? '')?.input ?? views.get(doc.rows[doc.rows.length - 1].id)?.input);
  if (!inp) return;
  // A finished line whose field doesn't have the caret (focus went to the graph or the bar) has no real caret to
  // insert at: its start isn't where you meant (normbetween()y = x). The key goes into a new line under it instead.
  if (document.activeElement !== inp && inp.value.trim()) {
    const id = viewOfInput.get(inp)?.row.id;
    if (id) inp = views.get(addRow(id, { kind: 'expr', text: '' }))?.input ?? inp;
  }
  const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? inp.value.length;
  const plan = planInsert(raw, inp.value, s, e);
  if (plan.insert === null) {
    inp.focus();
    inp.setSelectionRange(plan.caret, plan.caret);
    return;
  }
  editText(inp, plan.insert, s, e);
  if (raw.includes('¦') && s === e) {
    inp.setSelectionRange(plan.caret, plan.caret);
    viewOfInput.get(inp)?.refresh?.();
  }
}
export function insertFromSearch(raw: string): void {
  const id = activeId;
  const row = id ? doc.rows[rowIndex(id)] : undefined;
  const r = id ? currentResults()[rowIndex(id)] : undefined;
  const inp = id ? views.get(id)?.input : undefined;
  const atEnd = !!inp && (inp.selectionStart ?? inp.value.length) === inp.value.length && inp.selectionEnd === inp.selectionStart;
  if (id && isFinishedLine(row, r) && atEnd) addRow(id, { kind: 'expr', text: '' });
  asOwnStep(searchInsertLabel(raw), () => insertText(raw));
}
