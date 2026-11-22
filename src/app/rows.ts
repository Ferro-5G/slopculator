import { addPopover, arrowsMove, closePopovers } from './overlay';
import type { RowResult } from '../engine/document';
import { lineCopy } from '../ui/document';
import { copyableValue, slotInfo } from '../ui/linestate';
import { caretAt } from './mathdom';
import { play } from './sound';
import { TYPING_PAUSE_MS } from '../ui/text';
import { backspaceEdit, matrixPrevCell, matrixRowStep, slotForEnd, slotStep } from '../ui/slots';
import type { Row } from './docmodel';
import { h, lineIcon } from './dom';
import { COMBINE_OPS, combineLines as numericLines } from '../ui/combine';
import { moveRow, addRow, combineAll, deleteRow, dragEnds, recordTyping, pushStep, setLineText, commitRow, committed } from './edits';
import { pulse, copy } from './feedback';

import { syncGraphChips, syncGraphSliders } from './graphpane';
import { graph, listEl, announcer } from './layout';
import { updateHint, drawSlots, lineCalm, CLOSERS, complete, jumpToNextSlot, autoPair, rowKeys, applyBackspace } from './lineeditor';
import { lineFixes, measureTex } from './lineoutput';
import { syncListEdges, revealRow } from './listscroll';
import { coarse, kb } from './platform';
import { renderResults } from './render';
import { type RowView, views, viewOfInput, focusRow, isHostedRow } from './rowviews';
import { doc, activeId, setActiveId, rowIndex, results, opts, currentResults, keepSelection, setTarget, sheetChanged, rowsChanged } from './sheet';
import { makeTableView } from './tableview';
import { composerHead, composerRowId, composerSlot, draftId, finishEdit } from './composer';

export function rebuildRows(): void {
  draftId();
  const keep = new Set(doc.rows.map((r) => r.id));
  for (const [id, v] of views) if (!keep.has(id)) { v.el.remove(); views.delete(id); }
  if (activeId && !keep.has(activeId)) {
    setActiveId(null);
    graph.update({ activeRowId: null });
  }
  // A removed line never gets its mouseleave, so its curve would stay lit.
  if (graph.hoveredRow && !keep.has(graph.hoveredRow)) graph.update({ hoverRowId: null });
  const fresh: HTMLElement[] = [];
  const had = views.size;
  doc.rows.forEach((row, k) => {
    let v = views.get(row.id);
    // Opening a sheet or importing a file brings new row objects under the same ids. A view built for the old object
    // would show its text and write edits to it, where nothing reads them.
    if (v && v.row !== row) {
      v.el.remove();
      views.delete(row.id);
      v = undefined;
      if (graph.hoveredRow === row.id) graph.update({ hoverRowId: null });
    }
    if (!v) {
      v = row.kind === 'table' ? makeTableView(row) : makeExprView(row);
      views.set(row.id, v);
      fresh.push(v.el);
    }
    v.idx.textContent = String(k + 1);
  });
  // The line being written lives in the composer; every other line is a block on the canvas, in the sheet's order
  // after the canvas's own layers (its wires, the editing ghost, the example's frame).
  const cid = composerRowId();
  const inComposer = views.get(cid)?.el;
  if (inComposer && inComposer.parentElement !== composerSlot) composerSlot.replaceChildren(inComposer);
  let at = [...listEl.children].findIndex((el) => el.classList.contains('row') || el.classList.contains('blk-graph'));
  if (at < 0) at = listEl.children.length;
  for (const row of doc.rows) {
    if (row.id === cid || isHostedRow(row.id)) continue;
    const el = views.get(row.id)!.el;
    if (listEl.children[at] !== el) listEl.insertBefore(el, listEl.children[at] ?? null);
    at++;
  }
  if (had > 0 && fresh.length <= 3) for (const el of fresh) pulse(el, 'enter');
  syncListEdges();
  if (reordering) syncReorder();
}
let closeLineMenu = () => {};

export function openLineMenu(row: Row, x: number, y: number): void {
  closePopovers();
  const id = row.id;
  const i = rowIndex(id);
  const r = results[i];
  type At = { k: number; row: Row; r: RowResult | undefined };
  const at = (): At | null => {
    const k = rowIndex(id);
    return k < 0 ? null : { k, row: doc.rows[k], r: results[k] };
  };
  // A long press opens it while the finger is still down, and lifting sends a mousedown of its own: for half a second
  // that can't close what it just opened.
  const opened = performance.now();
  const outside = (e: Event) => { if (performance.now() - opened > 500 && !menuEl.contains(e.target as Node)) close(); };
  const close = () => {
    menuEl.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('touchstart', outside, true);
    document.removeEventListener('scroll', close, true);
    if (closeLineMenu === close) closeLineMenu = () => {};
  };
  closeLineMenu = close;
  const act = (label: string, keys: string, fn: (a: At) => void, disabled = false) => {
    const b = h('button', { type: 'button', role: 'menuitem', disabled }, h('span', {}, label), keys && !coarse.matches ? h('span', { class: 'hint' }, keys) : null);
    b.addEventListener('click', () => {
      close();
      const a = at();
      if (a) fn(a);
    });
    return b;
  };
  const move = ({ row }: At, d: number) => moveRow(row.id, d);
  const canCombine = numericLines(doc.rows, results, doc.settings.lineNames).length >= 2;
  const combineRow = canCombine
    ? h('div', { class: 'menu-row combine-row', role: 'group', 'aria-label': 'Combine every line with a number into a new line' },
      h('span', { 'aria-hidden': 'true' }, 'Combine all'),
      h('div', { class: 'menu-btns' }, ...COMBINE_OPS.map(([op, label, word]) =>
        h('button', { type: 'button', role: 'menuitem', 'aria-label': `${word} all lines`, title: `${word} all lines`, onclick: () => { close(); combineAll(op); } }, label))))
    : null;
  const menuEl = h('div', { class: 'menu line-menu', role: 'menu' },
    act('Copy result', kb('Ctrl+Alt+C'), ({ r }) => { const value = copyableValue(r, opts()); if (value) void copy(value(), views.get(id)?.el.querySelector('.out .result, .dist-prob')); }, !copyableValue(r, opts())),
    act('Duplicate', kb('Alt+Shift+↓'), ({ row }) => row.kind === 'expr' && addRow(row.id, lineCopy(row)), row.kind !== 'expr'),
    act(row.hidden ? 'Show on graph' : 'Hide on graph', '', ({ row }) => { row.hidden = !row.hidden; sheetChanged(); focusRow(row.id); }, !r || r.graph.length === 0),
    act('Move up', kb('Alt+↑'), (a) => move(a, -1), i === 0),
    act('Move down', kb('Alt+↓'), (a) => move(a, 1), i === doc.rows.length - 1),
    ...(coarse.matches && doc.rows.length >= 2 ? [act('Reorder lines', '', () => setReorder(true))] : []),
    ...(combineRow ? [h('hr'), combineRow] : []),
    h('hr'),
    act('Delete', kb('Ctrl+Shift+⌫'), ({ row }) => deleteRow(row.id)),
  );
  menuEl.style.position = 'fixed';
  menuEl.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
  menuEl.style.top = `${Math.min(y, window.innerHeight - 240)}px`;
  menuEl.style.right = 'auto';
  document.body.append(menuEl);
  menuEl.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  menuEl.addEventListener('keydown', (e) => {
    const items = [...menuEl.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    const k = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); if (rowIndex(id) >= 0) focusRow(id); }
    else arrowsMove(items, e, k);
  });
  // After the press that opened it has passed, so that press doesn't count as one outside.
  setTimeout(() => {
    if (!menuEl.isConnected) return;
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('touchstart', outside, { capture: true, passive: true });
    document.addEventListener('scroll', close, { capture: true, passive: true });
  });
}
export function makeGutter(row: Row): { gutter: HTMLElement; idx: HTMLElement; chip: HTMLButtonElement } {
  const idx = h('span', { class: 'idx' });
  const chip = h('button', { type: 'button', class: 'chip', title: 'Show or hide on the graph' });
  chip.addEventListener('click', () => {
    row.hidden = !row.hidden;
    sheetChanged();
  });
  const gutter = h('div', { class: 'gutter', title: 'Right-click or long-press for line actions' }, idx, chip);
  gutter.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openLineMenu(row, e.clientX, e.clientY);
  });
  let hold = 0;
  gutter.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(hold);
    hold = window.setTimeout(() => { play('toggle'); openLineMenu(row, e.clientX, e.clientY); }, 420);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) gutter.addEventListener(ev, () => clearTimeout(hold));
  return { gutter, idx, chip };
}
export let reordering = false;
const reorderDone = h('button', { type: 'button', class: 'reorder-done', hidden: true, onclick: () => setReorder(false) }, 'Done');
export function setReorder(on: boolean): void {
  if (on) finishEdit();
  reordering = on;
  listEl.classList.toggle('reordering', on);
  reorderDone.hidden = !on;
  if (on) (document.activeElement as HTMLElement | null)?.blur?.();
  syncReorder();
  announcer.textContent = on ? 'Reordering lines. Use the up and down buttons, then Done.' : 'Done reordering';
}
function syncReorder(): void {
  const ids = doc.rows.map((r) => r.id);
  const typing = composerRowId();
  for (const [id, v] of views) {
    let box = v.el.querySelector<HTMLElement>(':scope > .reorder');
    // The line in the composer isn't on the canvas to move; blank lines aren't shown.
    const blank = v.row.kind === 'expr' && !v.row.text.trim();
    if (!reordering || id === typing || blank) { box?.remove(); continue; }
    const k = ids.indexOf(id);
    if (!box) {
      const btn = (d: number, label: string, path: string) => {
        const b = h('button', { type: 'button', class: 'reorder-btn', 'aria-label': label, onclick: (e: Event) => { e.stopPropagation(); moveRow(id, d); } });
        b.innerHTML = lineIcon(`<path d="${path}"/>`, { stroke: '1.8', extra: ' aria-hidden="true"' });
        return b;
      };
      box = h('div', { class: 'reorder', role: 'group', 'aria-label': `Move line ${k + 1}` }, btn(-1, 'Move up', 'M4 10l4-4 4 4'), btn(1, 'Move down', 'M4 6l4 4 4-4'));
      v.el.append(box);
    }
    const [up, down] = box.querySelectorAll<HTMLButtonElement>('button');
    up.disabled = k <= 0;
    down.disabled = k >= ids.length - 1;
  }
}
let delHeld = false;

export function lineInputMode(): 'none' | 'text' {
  return coarse.matches && !doc.ui.sysKeyboard && doc.ui.keypad ? 'none' : 'text';
}

/** Told when typing in a line pauses: the composer shows an error only then. */
let typingPaused: (id: string) => void = () => {};
export function setTypingPauseListener(fn: (id: string) => void): void {
  typingPaused = fn;
}

function makeExprView(row: Extract<Row, { kind: 'expr' }>): RowView {
  const { gutter, idx, chip } = makeGutter(row);
  const input = h('input', {
    class: 'expr', type: 'text', value: row.text, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
    'aria-label': 'Expression', placeholder: '', 'aria-describedby': `out-${row.id}`,
  });
  const out = h('div', { class: 'out', id: `out-${row.id}` });
  const extra = h('div', { class: 'extra' });
  const hint = h('div', { class: 'hint-line', hidden: true });
  const del = h('button', { type: 'button', class: 'del', title: kb('Delete line (Ctrl+Shift+Backspace)'), 'aria-label': 'Delete line', tabindex: '-1' }, '×');
  input.inputMode = lineInputMode();
  const warn = h('div', { class: 'warn-line', hidden: true });
  // The typeset line sits under the input, which stays in place (invisible) so focus, Tab and screen readers work as
  // they always have.
  const tex = h('div', { class: 'tex', 'aria-hidden': 'true' });
  const ghost = h('div', { class: 'slots', 'aria-hidden': 'true', hidden: true });
  const src = h('div', { class: 'src' }, input, ghost, tex);
  const body = h('div', { class: 'body' }, h('div', { class: 'line' }, src, out, hint), warn, extra);
  const el = h('div', { class: 'row', role: 'listitem' }, gutter, body, del);
  el.addEventListener('mouseenter', () => { if (!v.chip.hidden) graph.update({ hoverRowId: row.id }); });
  el.addEventListener('mouseleave', () => { if (graph.hoveredRow === row.id) graph.update({ hoverRowId: null }); });
  body.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement;
    if (t === body || t.classList.contains('line') || t.classList.contains('src') || t.classList.contains('out')) {
      e.preventDefault();
      focusRow(row.id);
      const slot = slotForEnd(input.value, slotInfo);
      if (slot !== null) { input.setSelectionRange(slot, slot); refreshHint(); }
    }
  });
  const refreshHint = () => {
    updateHint(input, hint);
    drawSlots(input, ghost);
    const r = currentResults()[rowIndex(row.id)];
    if (r && row.kind === 'expr' && lineCalm(row, r, input) !== !!v.calm) renderResults();
  };
  input.addEventListener('scroll', () => { ghost.scrollLeft = input.scrollLeft; });
  let typingTimer = 0;
  input.addEventListener('blur', () => { clearTimeout(typingTimer); el.classList.remove('typing', 'calm-held'); });
  input.addEventListener('blur', () => requestAnimationFrame(renderResults));
  input.addEventListener('focus', () => { if (el.classList.contains('has-error') || el.classList.contains('calm')) renderResults(); });
  input.addEventListener('input', () => {
    dragEnds();
    el.classList.add('typing');
    clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => {
      el.classList.remove('typing');
      if (el.querySelector('.out .calm-hint')) el.classList.add('calm-held');
      typingPaused(row.id);
    }, TYPING_PAUSE_MS);
    if (row.kind === 'expr' && row.note) row.note = undefined;
    const before = row.text;
    row.text = input.value;
    recordTyping(row.id, before, row.text);
    sheetChanged();
    refreshHint();
  });
  let pointerFocus = false;
  input.addEventListener('mousedown', (e) => {
    pointerFocus = true;
    if (e.button !== 0 || !el.classList.contains('typeset') || el.classList.contains('active')) return;
    const at = caretAt(tex, e.clientX, e.clientY, input.value.length);
    e.preventDefault();
    focusRow(row.id);
    input.setSelectionRange(at, at);
  });
  input.addEventListener('focus', () => {
    setTarget(input);
    setActive(row.id);
    // Tabbing in selects everything by default; put the caret at the end so typing adds instead of replacing.
    if (!pointerFocus && !keepSelection) {
      const n = input.value.length;
      requestAnimationFrame(() => { if (document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === n) input.setSelectionRange(n, n); });
    }
    pointerFocus = false;
    refreshHint();
  });
  input.addEventListener('blur', () => {
    hint.hidden = true;
    el.classList.remove('completing');
    drawSlots(input, ghost);
  });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const parts = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return;
    e.preventDefault();
    dragEnds();
    const before = row.text;
    const s = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? input.value.length;
    input.setRangeText(parts[0], s, end, 'end');
    row.text = input.value;
    const head = row.text;
    const inserted: Row[] = [];
    let after = row.id;
    for (const line of parts.slice(1)) {
      after = addRow(after, { kind: 'expr', text: line }, false);
      inserted.push({ ...doc.rows[rowIndex(after)] });
    }
    sheetChanged();
    focusRow(after);
    pushStep({
      label: `Pasted ${parts.length} lines`,
      undo: () => {
        doc.rows = doc.rows.filter((r) => !inserted.some((p) => p.id === r.id && p.kind === 'expr' && r.kind === 'expr' && p.text === r.text));
        const live = doc.rows[rowIndex(row.id)];
        if (live?.kind === 'expr' && live.text === head) setLineText(live.id, before);
        rowsChanged(row.id);
      },
      redo: () => {
        const live = doc.rows[rowIndex(row.id)];
        if (!live || live.kind !== 'expr') return;
        if (live.text === before) setLineText(live.id, head);
        let at = rowIndex(live.id) + 1;
        for (const pasted of inserted) {
          const existing = rowIndex(pasted.id);
          if (existing < 0) doc.rows.splice(at++, 0, { ...pasted });
          else at = existing + 1;
        }
        rowsChanged(inserted[inserted.length - 1].id);
      },
    }, false);
  });
  input.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || CLOSERS.has(e.key)) refreshHint(); });
  input.addEventListener('click', () => {
    const at = input.value.length;
    if (input.selectionStart === at && input.selectionEnd === at) {
      const slot = slotForEnd(input.value, slotInfo);
      if (slot !== null) input.setSelectionRange(slot, slot);
    }
    refreshHint();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && (complete(input) || jumpToNextSlot(input))) {
      e.preventDefault();
      refreshHint();
      return;
    }
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (plain && input.selectionStart === input.selectionEnd) {
      const at = input.selectionStart ?? 0;
      const to = (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey ? matrixRowStep(input.value, at, e.key === 'ArrowUp' ? -1 : 1)
        : e.key === 'Tab' && e.shiftKey ? matrixPrevCell(input.value, at)
          : null;
      if (to !== null) {
        e.preventDefault();
        input.setSelectionRange(to, to);
        refreshHint();
        return;
      }
    }
    if (e.key === 'Backspace' && plain && !e.shiftKey) {
      const edit = backspaceEdit(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0);
      if (edit.matrix) {
        e.preventDefault();
        applyBackspace(input, edit);
        return;
      }
    }
    const v = views.get(row.id);
    if (v && e.key === 'Tab' && !e.shiftKey && plain) {
      const first = lineFixes(v, true)[0];
      if (first) { e.preventDefault(); first.focus(); return; }
    }
    if (v && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const fixes = lineFixes(v, true);
      if (fixes.length === 1) { e.preventDefault(); fixes[0].click(); return; }
    }
    // Home and End go to the line's start and end (Chrome on a Mac does nothing with them in a field); Shift selects.
    if ((e.key === 'Home' || e.key === 'End') && plain) {
      e.preventDefault();
      const to = e.key === 'Home' ? 0 : input.value.length;
      if (e.shiftKey) {
        const anchor = input.selectionDirection === 'backward' ? (input.selectionEnd ?? 0) : (input.selectionStart ?? 0);
        input.setSelectionRange(Math.min(anchor, to), Math.max(anchor, to), to < anchor ? 'backward' : 'forward');
      } else input.setSelectionRange(to, to);
      refreshHint();
      return;
    }
    if (e.key === ',' && plain && input.selectionStart === input.selectionEnd) {
      const at = input.selectionStart ?? 0;
      const to = slotStep(input.value, at);
      if (to !== null && to > at && input.value.slice(at, to).includes(',')) {
        e.preventDefault();
        input.setSelectionRange(to, to);
        refreshHint();
        return;
      }
    }
    // The edit's input event fired before the caret settled between the brackets, so the hint is redrawn here.
    if (autoPair(e, input)) {
      refreshHint();
      return;
    }
    rowKeys(e, row.id, input);
  });
  del.addEventListener('click', (e) => {
    // The next line's × slides under the pointer; it waits for the mouse to move, so a double-click deletes one line.
    if (delHeld && e.detail !== 0) return;
    deleteRow(row.id, false);
    delHeld = true;
  });
  const v: RowView = { row, el, input, idx, chip, out, extra, warn, tex, refresh: refreshHint };
  viewOfInput.set(input, v);
  return v;
}
export function syncRowTabStops(): void {
  for (const [id, v] of views) {
    const on = id === activeId;
    v.el.querySelectorAll<HTMLElement>('input, button, select').forEach((el) => {
      if (el.classList.contains('cv-steps')) { el.tabIndex = 0; return; }
      const mouseOnly = el.classList.contains('del') || el.classList.contains('result') || el.classList.contains('chip') || el.classList.contains('add-col');
      el.tabIndex = on && !mouseOnly ? 0 : -1;
    });
  }
}
export function setActive(id: string): void {
  if (activeId === id) return;
  commitRow(activeId);
  if (activeId) {
    const was = views.get(activeId);
    was?.el.classList.remove('active');
    was?.el.querySelector<HTMLElement>('.line')?.style.removeProperty('min-height');
    if (was) measureTex(was);
  }
  setActiveId(id);
  const opened = doc.rows[rowIndex(id)];
  if (opened?.kind === 'expr' && !committed.has(id)) committed.set(id, opened.text.trim());
  const el = views.get(id)?.el;
  const line = el?.classList.contains('typeset') ? el.querySelector<HTMLElement>('.line') : null;
  const tall = line?.offsetHeight ?? 0;
  el?.classList.add('active');
  if (line && line.offsetHeight < tall) line.style.minHeight = `${tall}px`;
  // Focus only scrolls the input into view. The active row can grow (its result wraps under it on phones), so bring the whole row in.
  if (el) requestAnimationFrame(() => revealRow(el));
  syncRowTabStops();
  graph.update({ activeRowId: id });
  syncGraphChips();
  syncGraphSliders();
}

export function initRows(): void {
  addPopover({ close: () => closeLineMenu(), exclusive: true });
  // Done for reordering sits on the composer's edge, beside the tabs.
  composerHead.insertBefore(reorderDone, composerHead.lastElementChild);
  document.addEventListener('pointermove', (e) => { if (delHeld && (e.movementX || e.movementY)) delHeld = false; });
  document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') delHeld = false; });
}
