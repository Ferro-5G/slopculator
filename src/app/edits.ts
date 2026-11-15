import { COMBINE_TOO_FEW, type CombineOp, combineLines, combineTarget, planCombine } from '../ui/combine';
import { CURVES, isBlankSheet, isEmptyLine, nextColor } from '../ui/document';
import { addEntry, commitLine } from '../ui/history';
import { play } from './sound';
import { movedLabel, UndoStack, type Step, typingRecorder, valueDrag } from '../ui/undo';
import { type Row, blankRow, newId } from './docmodel';
import { changeHistory } from './persistence';
import { narrow } from './platform';
import { listEl } from './layout';
import { autosaveSheet, renderNow, rowsChanged, sheetChanged, screen, doc, rowIndex, saveSoon, currentSheet, activeId, results } from './sheet';
import { showToast, hideToast } from './toast';

/** A line field never falls back on its own undo, which knew nothing of moves and once ate a moved line's text. */
export const undos = new UndoStack();
let applyingUndo = false;
/** The field's input event has to fire inside `write` (setting .value and execCommand both do), since the flag is off again once it returns. */
export function withoutRecording(write: () => void): void {
  applyingUndo = true;
  write();
  applyingUndo = false;
}
let ownStep: string | undefined;
/** As for withoutRecording, its input event has to fire inside `write`. */
export function asOwnStep(label: string | undefined, write: () => void): void {
  ownStep = label;
  write();
  ownStep = undefined;
}
function putLine(row: Extract<Row, { kind: 'expr' }>, text: string): void {
  row.text = text;
  const input = screen.inputOf(row.id);
  if (input) input.value = text;
}
function writeLine(row: Extract<Row, { kind: 'expr' }>, text: string): void {
  dragEnds();
  putLine(row, text);
}
export function dragLine(row: Extract<Row, { kind: 'expr' }>, text: string): void {
  dragBegins(row.id, row.text);
  putLine(row, text);
}
export function applyFix(row: Extract<Row, { kind: 'expr' }>, text: string, end = true): void {
  const before = row.text;
  writeLine(row, text);
  recordFix(row.id, before, text);
  play('fn');
  sheetChanged();
  if (end) screen.focusRow(row.id);
  else screen.inputOf(row.id)?.focus();
}
const typing = typingRecorder(undos, (rowId, text) => setLineText(rowId, text), (step) => undos.push(step));
export function recordTyping(rowId: string, before: string, after: string): void {
  if (!applyingUndo && before !== after) typing(rowId, before, after, ownStep);
}
function recordFix(rowId: string, before: string, after: string): void {
  if (before !== after) typing(rowId, before, after, 'Fix', true);
}
const valueDrags = valueDrag((rowId) => {
  const row = doc.rows[rowIndex(rowId)];
  return row?.kind === 'expr' ? row.text : undefined;
});
let valueDragTimer = 0;
function dragBegins(rowId: string, before: string): void {
  valueDrags.begins(rowId, before);
  clearTimeout(valueDragTimer);
}
export function dragEnds(wait = 0): void {
  clearTimeout(valueDragTimer);
  if (wait) { valueDragTimer = window.setTimeout(() => dragEnds(), wait); return; }
  const drag = valueDrags.finish();
  if (!drag) return;
  undos.push({
    label: drag.label,
    undo: () => drag.changes.forEach((c) => setLineText(c.rowId, c.before)),
    redo: () => drag.changes.forEach((c) => setLineText(c.rowId, c.after)),
  });
}
export function setLineText(rowId: string, text: string): void {
  const row = doc.rows[rowIndex(rowId)];
  if (!row || row.kind !== 'expr') return;
  const was = row.text;
  let at = 0;
  while (at < was.length && at < text.length && was[at] === text[at]) at++;
  let tail = 0;
  while (tail < was.length - at && tail < text.length - at && was[was.length - 1 - tail] === text[text.length - 1 - tail]) tail++;
  withoutRecording(() => writeLine(row, text));
  sheetChanged();
  screen.focusRow(rowId);
  const caret = text.length - tail;
  screen.inputOf(rowId)?.setSelectionRange(caret, caret);
}
export function pushStep(step: Step, actionOnly = true): void {
  undos.push(step);
  showToast(step.label, () => undoOwn(step), actionOnly);
}
export function runUndo(): void {
  dragEnds();
  try {
    const s = undos.undo();
    if (!s?.quiet) showToast(s ? `Undid: ${s.label}` : 'Nothing to undo');
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  }
}
export function runRedo(): void {
  dragEnds();
  try {
    const s = undos.redo();
    if (!s?.quiet) showToast(s ? `Redid: ${s.label}` : 'Nothing to redo');
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  }
}
function undoOwn(step: Step): void {
  dragEnds();
  if (undos.newestChange() !== step) return hideToast();
  try {
    undos.undoStep(step);
    showToast(`Undid: ${step.label}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  }
}
export const committed = new Map<string, string>();
export function commitRow(id: string | null): void {
  commitLine(committed, doc.rows, doc.settings, id, currentSheet, (entry) => changeHistory((list) => addEntry(list, entry)));
}
export function insertLine(text: string): void {
  const active = activeId ? doc.rows[rowIndex(activeId)] : undefined;
  if (active?.kind === 'expr' && isEmptyLine(active)) {
    writeLine(active, text);
    sheetChanged();
    screen.focusRow(active.id);
  } else {
    addRow(activeId, { kind: 'expr', text });
  }
}
export function appendLine(text: string): void {
  const last = doc.rows[doc.rows.length - 1];
  if (last.kind === 'expr' && isEmptyLine(last)) writeLine(last, String(text));
  else doc.rows.push({ id: newId(), kind: 'expr', text: String(text), color: nextColor(doc.rows) });
  screen.rebuildRows();
  renderNow();
  saveSoon();
}
export function replaceLines(texts: string[]): void {
  dragEnds();
  commitRow(activeId);
  const before = doc.rows, beforeActive = activeId;
  const rows: Row[] = texts.map((t, k) => ({ id: newId(), kind: 'expr' as const, text: String(t), color: k % (CURVES - 1) }));
  if (!rows.length) rows.push(blankRow());
  const put = (next: Row[], focus?: string | null) => {
    doc.rows = next;
    screen.rebuildRows();
    renderNow();
    saveSoon();
    if (focus) screen.focusRow(focus);
    else listEl.scrollTop = 0;
  };
  put(rows);
  pushStep({ label: 'Replaced lines', undo: () => put(before, beforeActive), redo: () => put(rows) }, false);
}
export function nextLine(id: string): void {
  const next = doc.rows[rowIndex(id) + 1];
  if (next && isEmptyLine(next)) screen.focusRow(next.id);
  else addRow(id, { kind: 'expr', text: '' });
}
export function addNormalCurve(): void {
  addRow(activeId, { kind: 'expr', text: 'normaldist(0, 1)', dist: { cdf: true, min: '-inf', max: '0' } });
}
/** False if that save failed, and then the switch doesn't happen. */
export function leaveSheet(): boolean {
  commitRow(activeId);
  return autosaveSheet();
}
/** Wipe every line at once. Undo brings them back; no confirm dialog in the way. */
export function clearAll(): void {
  dragEnds();
  commitRow(activeId);
  const before = doc.rows;
  if (isBlankSheet(before)) return;
  play('clear');
  const replacement = blankRow();
  doc.rows = [replacement];
  rowsChanged(doc.rows[0].id);
  const restore = (rows: Row[]) => {
    doc.rows = rows;
    rowsChanged(rows[rows.length - 1].id);
  };
  pushStep({
    label: 'Cleared every line',
    undo: () => restore([...before, ...doc.rows.filter((r) => !isEmptyLine(r))]),
    redo: () => restore([replacement]),
  }, !narrow.matches);
}
export function combineAll(op: CombineOp): void {
  dragEnds();
  const last = doc.rows[doc.rows.length - 1];
  const target = combineTarget(doc.rows, activeId);
  const plan = planCombine(combineLines(doc.rows, results, doc.settings.lineNames), op, target?.id);
  if (!plan.text) {
    play('error');
    showToast(COMBINE_TOO_FEW);
    return;
  }
  play('fn');
  const before = target ? { ...target } : undefined;
  let id: string;
  if (target?.kind === 'expr') {
    id = target.id;
    writeLine(target, plan.text);
    target.note = plan.note || undefined;
    sheetChanged();
    screen.focusRow(target.id);
  } else {
    id = addRow(last.id, { kind: 'expr', text: plan.text, note: plan.note || undefined });
  }
  const combined = { ...doc.rows[rowIndex(id)] };
  const index = rowIndex(id);
  pushStep({
    label: `Combined ${plan.used} lines`,
    undo: () => {
      const i = rowIndex(id), row = doc.rows[i];
      if (row?.kind !== 'expr' || row.text !== plan.text) return;
      if (before) doc.rows[i] = { ...before };
      else doc.rows.splice(i, 1);
      rowsChanged(before?.id ?? doc.rows[Math.max(0, i - 1)].id);
    },
    redo: () => {
      const i = rowIndex(id), row = doc.rows[i];
      if (i < 0) doc.rows.splice(Math.min(index, doc.rows.length), 0, { ...combined });
      else if (before?.kind === 'expr' && row?.kind === 'expr' && row.text === before.text) doc.rows[i] = { ...combined };
      rowsChanged(id);
    },
  });
}
export function addRow(afterId: string | null, init: Partial<Row> & { kind: Row['kind'] }, focus = true): string {
  dragEnds();
  const row = { id: newId(), color: nextColor(doc.rows), ...init } as Row;
  if (row.kind === 'expr' && row.text === undefined) row.text = '';
  committed.set(row.id, '');
  let i = afterId ? rowIndex(afterId) : -1;
  if (i < 0) i = doc.rows.length - 1;
  doc.rows.splice(i + 1, 0, row);
  rowsChanged(focus ? row.id : undefined);
  return row.id;
}
export function addTable(): void {
  addRow(activeId, { kind: 'table', columns: [{ header: 'x', cells: ['', '', ''] }, { header: 'P', cells: ['', '', ''] }] });
}
function removeRow(id: string, focusPrev: boolean, replacement?: Row) {
  dragEnds();
  const i = rowIndex(id);
  if (i < 0) return null;
  commitRow(id);
  const [removed] = doc.rows.splice(i, 1);
  const filler = doc.rows.length === 0 ? replacement ?? blankRow(nextColor(doc.rows)) : null;
  if (filler) doc.rows.push(filler);
  rowsChanged(focusPrev ? doc.rows[Math.max(0, i - 1)].id : undefined);
  return { i, removed, filler };
}
export function deleteRow(id: string, focusPrev = true): void {
  const gone = removeRow(id, focusPrev);
  if (!gone || isEmptyLine(gone.removed)) return;
  const { i, removed, filler } = gone;
  pushStep({
    label: `Deleted line ${i + 1}`,
    undo: () => {
      if (rowIndex(removed.id) >= 0) return;
      if (filler && doc.rows.length === 1 && doc.rows[0].id === filler.id && filler.kind === 'expr' && filler.text === '') doc.rows = [];
      doc.rows.splice(Math.min(i, doc.rows.length), 0, removed);
      rowsChanged(removed.id);
    },
    redo: () => removeRow(removed.id, true, filler ?? undefined),
  });
}
export function moveRow(id: string, d: number): void {
  const i = rowIndex(id);
  if (!shiftRow(id, d)) return;
  undos.push({ label: movedLabel(i + 1, d < 0), undo: () => shiftRow(id, -d), redo: () => shiftRow(id, d) });
}
function shiftRow(id: string, d: number): boolean {
  dragEnds();
  const i = rowIndex(id), j = i + d;
  if (i < 0 || j < 0 || j >= doc.rows.length) return false;
  const input = screen.inputOf(id);
  const caret = input && document.activeElement === input ? input.selectionStart : null;
  [doc.rows[i], doc.rows[j]] = [doc.rows[j], doc.rows[i]];
  rowsChanged(id);
  if (caret !== null) screen.inputOf(id)?.setSelectionRange(caret, caret);
  return true;
}

export function initEdits(): void {
  window.addEventListener('pagehide', () => commitRow(activeId));
  document.addEventListener('visibilitychange', () => { if (document.hidden) commitRow(activeId); });
}
