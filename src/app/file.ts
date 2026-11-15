import { downloadBlob, fileDate, fileStem } from './download';
import { showPrivacy } from './privacydialog';
import { copyName, isEmptyLine, linesLabel, SAVED_SHEETS_FAILED, sheetAsText as sheetText, sheetLineCount, withSheetView } from '../ui/document';
import { setSound, play } from './sound';
import { showHelp, COMMANDS } from './commands';
import { syncers } from './controls';
import { type Doc, normalizeDoc, type Row, blankRow } from './docmodel';
import { h } from './dom';
import { undos, runUndo, runRedo, clearAll, dragEnds, pushStep, leaveSheet } from './edits';
import { copy } from './feedback';
import { exportSVG, copyGraphImage } from './graphpane';
import { openHistoryDialog } from './historydialog';
import { switchPadSide } from './keypad';
import { graph, modeBar } from './layout';
import { placePopover, dialogShell, cancelButton, closePopovers, arrowsMove, addPopover } from './overlay';
import { type SavedSheet, loadSessions, store, sheetExists, writeSheet, removeSession, KEYS } from './persistence';
import { coarse, kb } from './platform';
import { setReorder, rebuildRows } from './rows';
import { focusRow, focusLine } from './rowviews';
import { currentSheet, doc, saveSoon, autosaveSheet, setDoc, setCurrentSheetName, opts, results, sheetChanged, sheetFromAnotherTab, storedNameIsOurs, recompute } from './sheet';
import { keypadOn, graphOn, applyUI } from './shell';
import { applyTheme, syncAppearanceSlots } from './theme';
import { hideToast, showToast } from './toast';

const menuBtn = h('button', { type: 'button', class: 'menu-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, 'File');
const menu = h('div', { class: 'menu', role: 'menu', hidden: true });
export function toggleKeySound(chirp = false): void {
  doc.ui.sound = doc.ui.sound === false;
  setSound(doc.ui.sound);
  saveSoon();
  buildMenu();
  if (chirp && doc.ui.sound) play('toggle');
}

export function buildMenu(): void {
  const item = (label: string, keys: string, fn: () => void, word = '') =>
    h('button', { type: 'button', role: 'menuitem', tabindex: '-1', onclick: () => { setMenu(false); fn(); } }, h('span', {}, label),
      keys && coarse.matches ? null : h('span', { class: keys ? 'hint' : 'hint word' }, keys ? kb(keys) : word));
  const small = (word: string, label: string, hint: string, fn: () => void) =>
    h('button', { type: 'button', role: 'menuitem', tabindex: '-1', 'aria-label': label, title: `${label} (${hint})`, onclick: () => { setMenu(false); fn(); } }, word);
  const undoTop = undos.top(), redoNext = undos.peekRedo();
  const undoItems = [
    ...(undoTop ? [item(`Undo: ${undoTop.label}`, 'Ctrl+Z', runUndo)] : []),
    ...(redoNext ? [item(`Redo: ${redoNext.label}`, 'Ctrl+Shift+Z', runRedo)] : []),
    ...(undoTop || redoNext ? [h('hr')] : []),
  ];
  if (coarse.matches) {
    menu.replaceChildren(
      ...undoItems,
      item('New sheet', '', newSheet),
      item('Open…', '', openSessionDialog),
      item(currentSheet ? 'Save' : 'Save…', '', saveSheet),
      item('Duplicate', '', duplicateSheet),
      item('Rename…', '', renameSheet),
      h('hr'),
      ...(typeof navigator.share === 'function' ? [item('Share as text…', '', shareSheetText)] : []),
      item('Copy as text', '', () => copy(sheetAsText())),
      item('History…', '', openHistoryDialog),
      item('Reorder lines', '', () => setReorder(true)),
      item('Clear all', '', clearAll),
      item('Privacy', '', showPrivacy),
      h('hr'),
      h('div', { class: 'menu-row file-row', role: 'group', 'aria-label': 'Sheet file' }, h('span', { 'aria-hidden': 'true' }, 'Sheet file'),
        h('div', { class: 'menu-btns' }, small('Export', 'Export the sheet', '.json', exportJSON), small('Import', 'Import a sheet', '.json', importJSON))),
    );
    syncAppearanceSlots();
    return;
  }
  menu.replaceChildren(
    ...undoItems,
    item('New sheet', COMMANDS.newSheet.keys, COMMANDS.newSheet.run),
    item('Open…', COMMANDS.openSheet.keys, COMMANDS.openSheet.run),
    item(currentSheet ? 'Save' : 'Save…', COMMANDS.saveSheet.keys, COMMANDS.saveSheet.run),
    item('Duplicate', '', duplicateSheet),
    item('Rename…', '', renameSheet),
    item('History…', COMMANDS.history.keys, COMMANDS.history.run),
    item('Clear all', COMMANDS.clearAll.keys, COMMANDS.clearAll.run),
    ...recentSheetItems(item),
    h('hr'),
    item('Copy sheet as text', '', () => copy(sheetAsText())),
    item('Export…', '', exportJSON, '.json'),
    item('Import…', '', importJSON, '.json'),
    h('hr'),
    h('div', { class: 'menu-row graph-row', role: 'group', 'aria-label': 'Graph' }, h('span', { 'aria-hidden': 'true' }, 'Graph'),
      h('div', { class: 'menu-btns' },
        small('PNG', 'Save graph as PNG', 'P on the graph', () => graph.exportPNG()),
        small('SVG', 'Save graph as SVG', 'vector', () => exportSVG()),
        small('Copy', 'Copy graph as image', 'C on the graph', () => copyGraphImage()))),
    h('hr'),
    item(keypadOn() ? 'Hide keypad' : 'Show keypad', COMMANDS.toggleKeypad.keys, COMMANDS.toggleKeypad.run),
    item(graphOn() ? 'Hide graph' : 'Show graph', COMMANDS.toggleGraph.keys, COMMANDS.toggleGraph.run),
    item(`Move number pad to the ${doc.ui.padLeft ? 'right' : 'left'}`, '', switchPadSide),
    item(doc.ui.sound === false ? 'Turn key sounds on' : 'Turn key sounds off', '', () => toggleKeySound(true)),
    h('hr'),
    item('Find a function or command', COMMANDS.palette.keys, COMMANDS.palette.run),
    item('Keyboard shortcuts', COMMANDS.help.keys, COMMANDS.help.run),
    item('Privacy', '', showPrivacy),
  );
  syncAppearanceSlots();
}
export function setMenu(open: boolean, focusFirst = false): void {
  if (open) {
    closePopovers();
    buildMenu();
  }
  menu.hidden = !open;
  placePopover(menu, menuBtn);
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open && focusFirst) menu.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
}
function replaceDoc(next: Doc, name: string | null, msg: string): void {
  dragEnds();
  const before = { doc, name: currentSheet };
  const load = (d: Doc, n: string | null) => {
    // Undo and redo are document switches too. Save the outgoing named sheet before the pending timer changes owners.
    if (!autosaveSheet(false)) throw new Error(SAVED_SHEETS_FAILED);
    d.ui = withSheetView(doc.ui, d.ui);
    setDoc(d);
    setCurrentSheet(n);
    rebuildRows();
    applyTheme();
    applyUI();
    sheetChanged();
    syncers.forEach((s) => s());
    buildMenu();
    focusRow(doc.rows[doc.rows.length - 1].id);
  };
  try {
    load(next, name);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
    return;
  }
  let after = { doc: next, name };
  pushStep({
    label: msg,
    undo: () => { after = { doc, name: currentSheet }; load(before.doc, before.name); },
    redo: () => load(after.doc, after.name),
  }, false);
}
function openSavedSheet(sh: SavedSheet): void {
  if (!leaveSheet()) return;
  replaceDoc(normalizeDoc(JSON.parse(JSON.stringify(loadSessions().find((x) => x.name === sh.name)?.doc ?? sh.doc))), sh.name, `Opened "${sh.name}"`);
}
function recentSheetItems(item: (label: string, keys: string, fn: () => void, word?: string) => HTMLButtonElement): HTMLButtonElement[] {
  return loadSessions().slice(0, 3).map((sh) => item(`Open "${sh.name}"`, '', () => openSavedSheet(sh), sh.name === currentSheet ? 'current' : ''));
}
function sheetSummary(d: Doc): string {
    const first = d.rows.find((r) => r.kind === 'expr' && !isEmptyLine(r)) as Extract<Row, { kind: 'expr' }> | undefined;
  return `${linesLabel(sheetLineCount(d.rows))}${first ? ` · ${first.text.slice(0, 40)}` : ''}`;
}
const sheetTitle = h('button', { type: 'button', class: 'sheet-title', title: 'Name or rename this sheet', onclick: () => renameSheet() });
/**
 * On the website the build names the landing page here, and the logo goes back to it. In Modern an unnamed sheet's
 * title would read "Slopculator" beside the logo, so the link shows that name and the title steps aside until the sheet
 * has a name. The downloaded file has no home page, so there the logo stays a picture.
 */
const homeHref = document.querySelector<HTMLMetaElement>('meta[name="slopculator-home"]')?.content;
const brandName = h('span', { class: 'brand-name' }, 'Slopculator');
const wordmark = () => h('span', { class: 'wordmark', 'aria-hidden': 'true' }, 'SLOPCULATOR');
const brandHome = homeHref
  ? h('a', { class: 'brand-home', href: homeHref, 'aria-label': 'Slopculator home', title: 'Slopculator home' }, appMark(), wordmark(), brandName)
  : null;
function setCurrentSheet(name: string | null, persist = true): void {
  setCurrentSheetName(name);
  if (!persist) { /* another tab already stored it */ } else if (name) store.set(KEYS.current, name);
  else store.remove(KEYS.current);
  if (persist) storedNameIsOurs();
  document.title = name ? `${name} · Slopculator` : 'Slopculator';
  syncSheetTitle();
}
export function syncSheetTitle(): void {
  sheetTitle.textContent = currentSheet ?? (doc.ui.look === 'retro' ? 'Sheet' : 'Slopculator');
  sheetTitle.classList.toggle('unnamed', !currentSheet);
  const brandShowsName = !!brandHome && !currentSheet && doc.ui.look !== 'retro';
  brandName.hidden = !brandShowsName;
  sheetTitle.hidden = brandShowsName;
}
/** The answer is handled when the button is pressed, not when the dialog finishes closing, so an Open straight after sees it. */
function nameDialog(title: string, initial: string, ok: string, note: string, done: (name: string) => void, keep?: string): void {
  const name = h('input', { class: 'text', value: initial, placeholder: 'Unit 11 homework', 'aria-label': 'Sheet name', spellcheck: 'false' });
  const dialog = dialogShell(
    title,
    h('label', { class: 'field' }, h('span', {}, 'Name'), name),
    h('p', { class: 'muted' }, note),
    h('div', { class: 'mx-actions' }, cancelButton(), h('button', { type: 'submit', value: 'ok', class: 'primary' }, ok)),
  );
  dialog.querySelector('form')!.addEventListener('submit', (e) => {
    if ((e.submitter as HTMLButtonElement | null)?.value !== 'ok') return;
    const n = name.value.trim();
    if (!n) { e.preventDefault(); name.focus(); return; }
    if (n !== keep && sheetExists(n) && !confirm(`A saved sheet is already called "${n}". Replace it?`)) { e.preventDefault(); name.select(); return; }
    done(n);
  });
  // However it closes (Save, Cancel, Esc), focus goes back to the line being typed, not the button that opened it, so
  // the next keys typed go into the sheet and can't rename it again. After the dialog's own focus restore.
  dialog.addEventListener('close', () => setTimeout(() => focusLine(), 0));
  dialog.showModal();
  name.select();
}
export function saveSheet(): void {
  if (currentSheet) {
    if (!autosaveSheet()) return;
    showToast(`Saved "${currentSheet}"`);
    buildMenu();
    return;
  }
  nameDialog('Save sheet', '', 'Save', 'Saved sheets stay on this device, and every edit goes into them as you work. Use Export to move one to another computer.', (n) => {
    if (!writeSheet(n, doc)) return showToast(SAVED_SHEETS_FAILED);
    setCurrentSheet(n);
    showToast(`Saved "${n}"`);
    buildMenu();
  });
}
export function renameSheet(): void {
  const was = currentSheet;
  if (!was) return saveSheet();
  nameDialog('Rename sheet', was, 'Rename', 'The sheet keeps its lines; only its name changes.', (n) => {
    if (n === was) return;
    if (!writeSheet(n, doc, was)) return showToast(SAVED_SHEETS_FAILED);
    setCurrentSheet(n);
    showToast(`Renamed to "${n}"`);
    buildMenu();
  }, was);
}
export function duplicateSheet(): void {
  if (!leaveSheet()) return;
  const n = copyName(currentSheet ?? 'Sheet', loadSessions().map((x) => x.name));
  if (!writeSheet(n, doc)) return showToast(SAVED_SHEETS_FAILED);
  setCurrentSheet(n);
  showToast(`Duplicated as "${n}". Rename it from File`);
  buildMenu();
}
export function newSheet(): void {
  if (!leaveSheet()) return;
  const was = currentSheet;
  const next: Doc = { ...JSON.parse(JSON.stringify(doc)), rows: [blankRow()] };
  replaceDoc(next, null, was ? `New sheet. "${was}" is saved` : 'New sheet');
}
export function openSessionDialog(): void {
  const listBox = h('div', { class: 'sheet-list' });
  const dialog = dialogShell('Open sheet', listBox, h('div', { class: 'mx-actions' }, h('button', { type: 'submit', value: 'cancel' }, 'Close')));
  const draw = () => {
    const list = loadSessions();
    if (!list.length) {
      listBox.replaceChildren(h('p', { class: 'muted' }, 'No saved sheets yet. File → Save keeps the current one under a name.'));
      return;
    }
    listBox.replaceChildren(
      ...list.map((sh) => {
        const open = h('button', { type: 'button', class: 'sheet-open' },
          h('span', { class: 'sheet-name' }, sh.name),
          h('span', { class: 'sheet-meta' }, `${new Date(sh.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${sheetSummary(sh.doc)}`),
        );
        open.addEventListener('click', () => {
          dialog.close();
          openSavedSheet(sh);
        });
        const del = h('button', { type: 'button', class: 'sheet-del', title: `Delete "${sh.name}"`, 'aria-label': `Delete ${sh.name}` }, '×');
        del.addEventListener('click', () => {
          if (!confirm(`Delete the saved sheet "${sh.name}"?`)) return;
          if (!removeSession(sh.name)) return showToast(SAVED_SHEETS_FAILED);
          if (currentSheet === sh.name) setCurrentSheet(null);
          draw();
          buildMenu();
        });
        return h('div', { class: 'sheet-item' }, open, del);
      }),
    );
  };
  listBox.addEventListener('keydown', (e) => {
    const opens = [...listBox.querySelectorAll<HTMLButtonElement>('.sheet-open')];
    const at = opens.findIndex((b) => b === document.activeElement || b.parentElement?.contains(document.activeElement));
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? opens.length - 1 : null;
    if (to === null || !opens.length) return;
    e.preventDefault();
    opens[Math.max(0, Math.min(opens.length - 1, to))].focus();
  });
  draw();
  dialog.showModal();
  (listBox.querySelector('.sheet-open') as HTMLButtonElement | null)?.focus();
}
export function exportJSON(): void {
  downloadBlob(new Blob([JSON.stringify({ app: 'slopculator', version: 1, ...doc }, null, 2)], { type: 'application/json' }), `${fileStem(currentSheet)}-${fileDate()}.json`);
}
export function importJSON(): void {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      // The file isn't the named sheet that was open, so saving afterward mustn't write over that one.
      if (!leaveSheet()) return;
      replaceDoc(normalizeDoc(JSON.parse(await f.text())), null, `Loaded ${f.name}`);
    } catch (e) {
      showToast(`Couldn't read ${f.name}: ${e instanceof Error ? e.message : e}`);
    }
  });
  input.click();
}
function appMark(): HTMLElement {
  const m = h('span', { class: 'mark', 'aria-hidden': 'true' });
  m.innerHTML = '<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke-linecap="round" stroke-linejoin="round"><path class="mark-tail" d="M2.1 11.5L2.1 11.42L2.59 11.34L3.08 11.2L3.58 10.96L4.07 10.58L4.56 10.03L5.05 9.29L5.54 8.39L6.03 7.38L6.16 7.11L6.16 11.5Z"/><path d="M2.1 11.42L2.59 11.34L3.08 11.2L3.58 10.96L4.07 10.58L4.56 10.03L5.05 9.29L5.54 8.39L6.03 7.38L6.53 6.37L7.02 5.5L7.51 4.91L8 4.7L8.49 4.91L8.98 5.5L9.47 6.37L9.97 7.38L10.46 8.39L10.95 9.29L11.44 10.03L11.93 10.58L12.43 10.96L12.92 11.2L13.41 11.34L13.9 11.42" stroke="currentColor" stroke-width="1.3"/><path d="M2.1 11.5h11.8" stroke="currentColor" stroke-width="1"/></svg>';
  return m;
}
export const menuWrap = h('div', { class: 'menu-wrap' }, menuBtn, menu);
function shareSheetText(): void {
  const text = sheetAsText();
  navigator.share({ title: currentSheet ?? 'Slopculator sheet', text }).catch((e: unknown) => {
    if ((e as { name?: string })?.name === 'AbortError') return;
    void navigator.clipboard?.writeText(text).then(() => showToast('Sharing unavailable. Sheet copied.'), () => showToast("Sharing unavailable, and the sheet couldn't be copied"));
  });
}
export function sheetAsText(): string {
  return sheetText(doc.rows, results, opts());
}

/**
 * Two tabs share one stored sheet, and each used to save its own copy over the other's, so lines typed in one tab
 * vanished when the other was typed in next. A tab that hears another tab save now takes that tab's sheet: both show
 * the same lines. Its undo steps go, since they were steps on a sheet that is no longer here. So does a dialog that
 * was open here: it was opened about the old sheet (Rename holds the old name, an editor the line it would fill), and
 * cancelling it is the one answer that is right for all of them.
 */
function followOtherTab(): void {
  const next = sheetFromAnotherTab();
  if (!next) return;
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close('cancel');
  dragEnds();
  hideToast();
  undos.clear();
  setDoc(next.doc);
  setCurrentSheet(next.name, false);
  rebuildRows();
  applyTheme();
  applyUI();
  recompute();
  syncers.forEach((s) => s());
  buildMenu();
  // The line that had the caret was rebuilt, so the caret goes where a freshly opened sheet puts it.
  focusRow(doc.rows[doc.rows.length - 1].id);
}

export function initFile(): void {
  window.addEventListener('storage', (e) => { if (e.key === KEYS.document || e.key === KEYS.current) followOtherTab(); });
  window.addEventListener('focus', followOtherTab);
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMenu(!!menu.hidden, e.detail === 0);
  });
  menuBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setMenu(true, true); }
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (arrowsMove(items, e, i)) return;
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      setMenu(false);
      menuBtn.focus();
    }
  });
  addPopover({ close: () => setMenu(false), exclusive: true, outside: true });
  setCurrentSheet(currentSheet);
  modeBar.append(
    brandHome
      ? h('div', { class: 'brand' }, brandHome, sheetTitle)
      : h('div', { class: 'brand' }, appMark(), wordmark(), sheetTitle),
    h('div', { class: 'spacer' }),
    menuWrap,
    h('button', { type: 'button', class: 'help-btn', title: 'Keyboard shortcuts and typing tips', 'aria-label': 'Help', onclick: () => showHelp() }, '?'),
  );
}
