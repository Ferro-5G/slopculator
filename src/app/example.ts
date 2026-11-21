// The first run's example: a slider wired to a curve, wired to the graph, on the canvas beside the composer. It's made
// of ordinary lines (flagged `example`), so it can be edited like any other; Clear example takes it away with an
// Undo, and Help or File brings it back.
import { EXAMPLE_CLEARED, EXAMPLE_LINES, isExampleRow } from '../ui/canvas';
import { isBlankSheet, nextColor } from '../ui/document';
import { type Row, newId } from './docmodel';
import { pushStep } from './edits';
import { KEYS, store } from './persistence';
import { doc, rowsChanged, saveSoon } from './sheet';
import { play } from './sound';

export const hasExample = (): boolean => doc.rows.some(isExampleRow);

function exampleRows(): Row[] {
  const rows: Row[] = [];
  for (const l of EXAMPLE_LINES) {
    rows.push({ id: newId(), kind: 'expr', text: l.text, color: nextColor([...doc.rows, ...rows]), example: true, ...(l.slider ? { slider: { ...l.slider } } : {}) });
  }
  return rows;
}

/** Puts the example ahead of the sheet's lines. The wide canvas gives it the first column (src/ui/canvas.ts flowLayout). */
function putExample(): Row[] {
  const added = exampleRows();
  doc.rows = [...added, ...doc.rows];
  return added;
}

/** On the very first run, a blank sheet gets the example once. */
export function firstRunExample(): void {
  if (store.get(KEYS.firstRun) || !isBlankSheet(doc.rows)) return;
  store.set(KEYS.firstRun, 'example');
  putExample();
  saveSoon();
}

export function clearExample(): void {
  const before = doc.rows;
  const after = before.filter((r) => !isExampleRow(r));
  if (after.length === before.length) return;
  play('clear');
  const put = (rows: Row[]) => {
    doc.rows = rows;
    rowsChanged();
  };
  put(after);
  pushStep({ label: EXAMPLE_CLEARED, undo: () => put(before), redo: () => put(before.filter((r) => !isExampleRow(r))) });
}

export function showExample(): void {
  if (hasExample()) return;
  const before = doc.rows;
  putExample();
  const after = doc.rows;
  rowsChanged();
  pushStep({ label: 'Example added', undo: () => { doc.rows = before; rowsChanged(); }, redo: () => { doc.rows = after; rowsChanged(); } }, true);
}
