import { type RowResult, evaluateDocument } from '../engine/document';
import type { DisplayOpts } from '../engine/format';
import { SAVE_DELAY_MS, SAVED_SHEETS_FAILED, saveFailureReporter } from '../ui/document';
import { loadDoc, restoredSheet, store, KEYS, writeSheet } from './persistence';
import { showToast } from './toast';

export interface SheetScreen {
  rebuildRows(): void;
  renderResults(): void;
  focusRow(id: string): void;
  inputOf(id: string): HTMLInputElement | undefined;
}
export let screen: SheetScreen;
export function connectScreen(s: SheetScreen): void {
  screen = s;
}

const loaded = loadDoc();
/** The stored sheet and its name as this tab last read or wrote them, for noticing that another tab has saved since. */
let storedText = store.get(KEYS.document);
let storedName: string | null = null;
/** After this tab stores a sheet name itself, or restoring one took a stale name out of storage. */
export function storedNameIsOurs(): void {
  storedName = store.get(KEYS.current);
}
export let doc = loaded.doc;
export let results: RowResult[] = [];
export let activeId: string | null = null;
let target: HTMLInputElement | null = null;
export function activeInput(): HTMLInputElement | null {
  return target && document.contains(target) ? target : null;
}
/** Set while a line is focused by code that chooses the selection itself (an error mark), so focus doesn't move the caret. */
export let keepSelection = false;
export const saveSoon = (() => {
  let t = 0;
  const report = saveFailureReporter(showToast);
  const save = () => {
    clearTimeout(t);
    t = 0;
    storedText = JSON.stringify(doc);
    const currentOK = store.set(KEYS.document, storedText);
    const namedOK = autosaveSheet(false);
    report(currentOK && namedOK);
  };
  // A change made just before closing the tab would otherwise never reach storage. A phone can discard a tab in the
  // background without a pagehide, so going to the background saves too.
  window.addEventListener('pagehide', () => { if (t) save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && t) save(); });
  return Object.assign(() => {
    clearTimeout(t);
    t = window.setTimeout(save, SAVE_DELAY_MS);
  }, { pending: () => t !== 0 });
})();
/**
 * The sheet another tab has saved since this one last read or wrote it, with its name, or null. Null too while this
 * tab has an edit of its own waiting to save: that edit is newer than anything it could take.
 */
export function sheetFromAnotherTab(): { doc: typeof doc; name: string | null } | null {
  if (saveSoon.pending()) return null;
  const text = store.get(KEYS.document), name = store.get(KEYS.current);
  // A rename in the other tab changes the name and not a line: keeping the old name here would save into it again.
  if (text === null || (text === storedText && name === storedName)) return null;
  storedText = text;
  const next = loadDoc();
  const restoredName = restoredSheet(next.restored);
  storedNameIsOurs();
  return { doc: next.doc, name: restoredName };
}
/** Results now, for an edit that has to show its answer before returning (the agent API). Everything else goes through recompute. */
export function renderNow(): void {
  results = evaluateDocument(doc.rows, doc.settings);
  screen.renderResults();
}
export function sheetChanged(): void {
  saveSoon();
  recompute();
}
export function rowsChanged(focus?: string): void {
  screen.rebuildRows();
  sheetChanged();
  if (focus) screen.focusRow(focus);
}
export const opts = (): DisplayOpts => ({ places: doc.display.places, exact: doc.display.exact, percent: doc.display.percent, fullDigits: !!doc.display.fullDigits });
// A fallback blank document must never inherit a saved name and overwrite that saved sheet on the next edit.
export let currentSheet: string | null = restoredSheet(loaded.restored);
storedNameIsOurs();
export function autosaveSheet(notify = true): boolean {
  if (!currentSheet) return true;
  const ok = writeSheet(currentSheet, doc);
  if (!ok && notify) showToast(SAVED_SHEETS_FAILED);
  return ok;
}
export function rowIndex(id: string): number {
  return doc.rows.findIndex((r) => r.id === id);
}
/**
 * The rows as the sheet is worked out from them: the composer can stand a line it's about to change in for the one on
 * the sheet (typing r = 6 while r = 4 is there previews the change), so the sheet never reads r as defined twice.
 */
let evalRows: (rows: typeof doc.rows) => typeof doc.rows = (rows) => rows;
export function setEvalRows(fn: typeof evalRows): void {
  evalRows = fn;
}
/** Results as of this moment: a keystroke's recompute waits for the next frame, and Enter can arrive first. */
export function currentResults(): RowResult[] {
  if (scheduled) results = evaluateDocument(evalRows(doc.rows), doc.settings);
  return results;
}
let scheduled = false;
export function recompute(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    results = evaluateDocument(evalRows(doc.rows), doc.settings);
    screen.renderResults();
  });
}

export function setDoc(value: typeof doc): void {
  doc = value;
}

export function setCurrentSheetName(value: typeof currentSheet): void {
  currentSheet = value;
}

export function setActiveId(value: typeof activeId): void {
  activeId = value;
}

export function setTarget(value: typeof target): void {
  target = value;
}

export function setKeepSelection(value: typeof keepSelection): void {
  keepSelection = value;
}

