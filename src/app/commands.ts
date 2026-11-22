import { fitGraph } from './graphpane';
import { closeOpenPopover, dialogOpen, mountDialog, modalOpen } from './overlay';
import { flipMode, type Mode, MODES } from './controls';
import { plainValue } from '../engine/format';
import { appearanceOf } from '../ui/appearance';
import { copyableValue } from '../ui/linestate';
import { TABS } from '../ui/thumbindex';
import { h } from './dom';
import { undos, runRedo, runUndo, clearAll, addNormalCurve } from './edits';
import { copy } from './feedback';
import { setMenu, newSheet, saveSheet, openSessionDialog } from './file';
import { openHistoryDialog } from './historydialog';
import { keypadEl, graphPane, graphHost } from './layout';
import { openPalette } from './palette';
import { kb, isMac, dark, primaryMod } from './platform';
import { reordering, setReorder } from './rows';
import { views, focusLine, isLineField } from './rowviews';
import { opts, currentResults, activeId, rowIndex, doc } from './sheet';
import { keypadOn, setKeypad, graphOn, setGraph } from './shell';
import { cycleTheme, applyTheme } from './theme';
import { closeThumb, toggleTab, ti, tiPage, turnPage } from './thumb';
import { showToast } from './toast';

function copyAnswer(): void {
  const o = opts();
  const res = currentResults();
  const pick = (k: number): { text: string; k: number } | undefined => {
    const r = res[k];
    if (!r || r.error) return undefined;
    const value = typeof r.value === 'object' && r.value.t === 'record' ? undefined : copyableValue(r, o);
    if (value) return { text: value(), k };
    if (r.table?.ev !== undefined) return { text: plainValue(r.table.ev, o), k };
    return undefined;
  };
  const i = activeId ? rowIndex(activeId) : -1;
  let got = i >= 0 ? pick(i) : undefined;
  for (let k = res.length - 1; k >= 0 && !got; k--) got = pick(k);
  if (!got) { showToast('No answer to copy'); return; }
  void copy(got.text, views.get(doc.rows[got.k].id)?.el.querySelector('.out .result, .dist-prob'));
}
export function showHelp(): void {
  const groups: [string, [string, string][]][] = [
    ['Lines', [
      ['Enter', 'New line below (or jump to the empty one)'],
      ['↑ / ↓', 'Move between lines'],
      ['Alt+↑ / Alt+↓', 'Move the line itself up or down'],
      ['Alt+Shift+↑ / ↓', 'Duplicate the line above or below'],
      ['In a table', 'Enter/↓/↑ move between cells, Tab across; Ctrl+Shift+Backspace deletes the row (or the column, in a header)'],
      ['In a matrix', 'Tab or Enter to the next empty cell, Shift+Tab back a cell, ↑/↓ by row'],
      ['Tab', 'Finish a function name; otherwise go to the next area'],
      ['Ctrl+Shift+Backspace', 'Delete the line (Backspace on an empty line too)'],
      ['Ctrl+Alt+Backspace', 'Clear every line'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo or redo: typing in the line first, then deleted lines, clears, new sheets and opens, as far back as you like'],
      ['Ctrl+Alt+C', 'Copy the answer on your line (or the last one)'],
      ['Ctrl+Alt+N', 'Add a normal curve'],
    ]],
    ['Getting around', [
      ['Tab / Shift+Tab', 'Top bar → line (its fix first, if it offers one) → keypad tabs and keys → graph'],
      ['Esc', 'Back to your line from anywhere'],
      ['Ctrl+Alt+K', 'Jump into the keypad (again: back to the line)'],
      ['Ctrl+Alt+G', 'Jump into the graph (again: back to the line)'],
      ['Ctrl+Alt+Shift+K / G', 'Show or hide the keypad / graph'],
      ['Arrows', 'Move inside the top bar, keypad, an open tab\'s tiles, and graph'],
      ['Ctrl+Alt+1…5', 'Open a keypad tab: Math, Stats, Chance, Matrix, HVAC (again: close it)'],
      ['Ctrl+Alt+← / →', 'The open tab\'s pages'],
      ['Enter / Esc', 'In a tab: insert the tile and go back to the line / close it'],
      ['Ctrl+K', 'Find any function or command (Ctrl+/ too)'],
      ['Ctrl+Alt+Y', 'History: everything you have calculated'],
      ['Ctrl+Alt+H', 'This list'],
    ]],
    ['In the graph', [
      ['Arrows (Shift: farther)', 'Pan'],
      ['+ / −', 'Zoom'],
      ['F / S / 0 / P', 'Fit, square axes, reset, save PNG'],
      ['C', 'Copy the graph image'],
      ['Shift+drag', 'Zoom into the box you draw'],
      ['Click a point', 'Pin its coordinates (click again to unpin; Delete clears pins)'],
      ['[ / ]', 'Step through the marks: zeros, highs and lows, crossings (Enter pins one)'],
    ]],
    ['Modes', [
      ['Ctrl+Alt+D / E / M / P', 'Deg–Rad, Exact, Sample SD, Percent'],
      ['Ctrl+Alt+L', 'Line letters (line 1 is A)'],
      ['Ctrl+Alt+T', 'Next theme'],
      ['Ctrl+Alt+S / O', 'Save / open a named sheet (a named sheet keeps every edit)'],
      ['Ctrl+Alt+Shift+N', 'New sheet'],
    ]],
  ];
  const dialog = h('dialog', { class: 'help' },
    h('form', { method: 'dialog' },
      // Focus lands on the title, so the dialog opens at the top instead of scrolled to Close.
      h('div', { class: 'help-head' },
        h('h1', { tabindex: '-1', autofocus: true }, 'Keyboard shortcuts'),
        h('button', { type: 'submit', class: 'help-close', 'aria-label': 'Close', title: 'Close (Esc)' }, '×'),
      ),
      ...groups.flatMap(([title, rows]) => [
        h('h2', {}, title),
        h('table', {}, ...rows.map(([k, d]) => h('tr', {}, h('th', {}, h('kbd', {}, kb(k))), h('td', {}, kb(d))))),
      ]),
      h('h2', {}, 'For scripts and AI agents'),
      h('p', {}, 'Run ', h('code', {}, 'slopculator.help()'), ' in the browser console. Links with ', h('code', {}, '#q=normalcdf(-inf,-2.5)'), ' open with that line added.'),
      h('h2', {}, 'Typing'),
      h('p', {}, 'Write ', h('code', {}, 'mu'), ', ', h('code', {}, 'sigma'), ', ', h('code', {}, 'pi'), ', ', h('code', {}, 'theta'), ' for μ σ π θ, ', h('code', {}, '-inf'), ' for −∞, ', h('code', {}, '*'), ' and ', h('code', {}, '/'), ' for × and ÷. ', h('code', {}, '2x'), ' and ', h('code', {}, 'nt'), ' multiply. ', h('code', {}, 'a = 3'), ' gets a slider.'),
      h('div', { class: 'mx-actions' }, h('button', { type: 'submit', class: 'primary' }, 'Close')),
    ),
  );
  mountDialog(dialog);
  dialog.showModal();
}
export const COMMANDS = {
  newSheet: { keys: 'Ctrl+Alt+Shift+N', run: () => newSheet() },
  openSheet: { keys: 'Ctrl+Alt+O', run: () => openSessionDialog() },
  saveSheet: { keys: 'Ctrl+Alt+S', run: () => saveSheet() },
  history: { keys: 'Ctrl+Alt+Y', run: () => openHistoryDialog() },
  clearAll: { keys: 'Ctrl+Alt+Backspace', run: () => clearAll() },
  help: { keys: 'Ctrl+Alt+H', run: () => showHelp() },
  normalCurve: { keys: 'Ctrl+Alt+N', run: () => addNormalCurve() },
  copyAnswer: { keys: 'Ctrl+Alt+C', run: () => copyAnswer() },
  toggleKeypad: { keys: 'Ctrl+Alt+Shift+K', run: () => setKeypad(!keypadOn()) },
  toggleGraph: { keys: 'Ctrl+Alt+Shift+G', run: () => setGraph(!graphOn()) },
  palette: { keys: 'Ctrl+K', run: () => openPalette() },
};

function focusRegion(which: 'keypad' | 'graph'): void {
  const el = which === 'keypad' ? keypadEl : graphPane;
  if (el.contains(document.activeElement)) return focusLine();
  if (which === 'keypad' && !keypadOn()) setKeypad(true);
  if (which === 'graph' && !graphOn()) setGraph(true);
  if (which === 'keypad') (keypadEl.querySelector<HTMLButtonElement>('.key[tabindex="0"]') ?? keypadEl.querySelector<HTMLButtonElement>('.key'))?.focus();
  else graphHost.focus();
}

export function initCommands(): void {
  // A line field never uses its own undo, which knows nothing of moves or deletes. Other fields (dialogs, table cells, the palette) keep theirs.
  document.addEventListener('keydown', (e) => {
    const mod = primaryMod(e);
    const key = e.key.toLowerCase();
    if (!mod || e.altKey || !(key === 'z' || (!isMac && key === 'y' && !e.shiftKey))) return;
    if (dialogOpen()) return;
    const el = document.activeElement as HTMLElement | null;
    const line = isLineField(el) ? el : null;
    if (!line && el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const redo = e.shiftKey || key === 'y';
    if (!line && (redo ? !undos.canRedo : !undos.canUndo)) return;
    e.preventDefault();
    if (redo ? undos.canRedo : undos.canUndo) {
      if (redo) runRedo();
      else runUndo();
    }
  });
  // The browser's own undo (the Edit menu, a shake on a phone) comes to the same stack for a line.
  document.addEventListener('beforeinput', (e) => {
    const t = e.target as HTMLElement;
    if (!isLineField(t)) return;
    if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
    e.preventDefault();
    if (e.inputType === 'historyRedo') runRedo();
    else runUndo();
  }, true);
  document.addEventListener('keydown', (e) => {
    // Ctrl+S saves the sheet, as it does in any desktop app, in place of the browser's Save page.
    if (primaryMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's' && !modalOpen()) {
      e.preventDefault();
      saveSheet();
      return;
    }
    // A Mac's Ctrl+K stays the text fields' own (delete to the end of the line).
    const findKey = !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k' && primaryMod(e);
    if (findKey || ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === '/' || (e.shiftKey && e.key.toLowerCase() === 'p')))) {
      e.preventDefault();
      if (!document.querySelector('dialog.palette[open]')) openPalette();
      return;
    }
    if (e.key === 'Escape' && reordering) {
      e.preventDefault();
      setReorder(false);
      return;
    }
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !dialogOpen()) {
      if (e.defaultPrevented) return;
      const inLine = isLineField(document.activeElement);
      // A tab's page opened with the mouse or a finger leaves the caret in the line, and Esc there closes the page too.
      if (ti.tab !== null) {
        e.preventDefault();
        closeThumb();
        if (!inLine) focusLine();
        return;
      }
      if (closeOpenPopover()) {
        e.preventDefault();
        return;
      }
      if (!inLine) {
        e.preventDefault();
        setMenu(false);
        focusLine();
      }
      return;
    }
    if (!(e.ctrlKey && e.altKey) || e.metaKey) return;
    if (modalOpen()) return;
    // Windows reports AltGr as Ctrl+Alt. It types { [ ] } € and ł on many layouts, so it never runs a shortcut.
    if (!isMac && e.getModifierState('AltGraph')) return;
    // On a Mac, Option changes the character (Option+D types ∂), so read the physical key instead.
    const k = (/^Key([A-Z])$/.exec(e.code)?.[1] ?? (e.code === 'Backspace' ? 'Backspace' : e.key)).toLowerCase();
    if (e.shiftKey && k === 'n') {
      e.preventDefault();
      newSheet();
      return;
    }
    if (e.shiftKey && (k === 'k' || k === 'g')) {
      e.preventDefault();
      if (k === 'k') setKeypad(!keypadOn());
      else setGraph(!graphOn());
      if (!keypadEl.contains(document.activeElement) && !graphPane.contains(document.activeElement)) return;
      focusLine();
      return;
    }
    const act: Record<string, () => void> = {
              g: () => focusRegion('graph'),
      k: () => focusRegion('keypad'),
      t: () => cycleTheme(),
      z: runUndo,
      f: () => fitGraph(),
    };
    for (const m of Object.values(MODES) as Mode[]) if (m.key) act[m.key.toLowerCase()] = () => flipMode(m);
    for (const c of Object.values(COMMANDS)) { const letter = /^Ctrl\+Alt\+(\w+)$/.exec(c.keys)?.[1]; if (letter) act[letter.toLowerCase()] = c.run; }
    const d = /^Digit([0-9])$/.exec(e.code)?.[1] ?? (/^[0-9]$/.test(e.key) ? e.key : null);
    const digit = d === null ? -1 : Number(d) - 1;
    if (digit >= 0 && digit < TABS.length) {
      e.preventDefault();
      if (!keypadOn()) setKeypad(true);
      toggleTab(digit, true);
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && ti.tab !== null && !tiPage.hidden) {
      e.preventDefault();
      turnPage(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (act[k]) {
      e.preventDefault();
      act[k]();
    }
  });
  dark.addEventListener('change', () => {
    if (appearanceOf(doc.ui).mode === 'system') applyTheme();
  });
}
