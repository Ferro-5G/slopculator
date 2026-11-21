import { type Key, keyCall, capTone, keyCaption, legendText, LONG_LABEL, keyLegend, CLEAR_ARM_MS, CLEAR_MS, CARET_DELAY_MS, CARET_REPEAT_MS, CARET_SCRUB, LABEL_TWO, LABEL_MIN, padRows, isWordKey } from '../ui/keypad';
import { play } from './sound';
import { caretStep } from '../ui/lineedit';
import { backspaceEdit } from '../ui/slots';
import { h } from './dom';
import { pushStep, deleteRow, addTable, clearAll, withoutRecording } from './edits';
import { buildMenu } from './file';
import { keypadEl } from './layout';
import { applyBackspace, editText, commitLine, commaSteps, insertText } from './lineeditor';
import { openMatrixEditor } from './editors';
import { kb } from './platform';
import { konamiStep, KONAMI_KEYS } from './pride';
import { views, viewOfInput } from './rowviews';
import { doc, saveSoon, rowIndex, activeId, currentResults, activeInput } from './sheet';
import { closeThumb, tiRows, buildThumbRows } from './thumb';

let redrawKeys = () => {};
export function switchPadSide(): void {
  doc.ui.padLeft = !doc.ui.padLeft;
  saveSoon();
  redrawKeys();
  buildMenu();
}
export function runKeyAction(action: NonNullable<Key['action']>): void {
  const inp = activeInput();
  switch (action) {
    case 'left':
    case 'right': {
      if (!inp) return;
      inp.focus();
      const c = caretStep(inp.value, inp.selectionStart ?? 0, action === 'left');
      inp.setSelectionRange(c, c);
      return;
    }
    case 'clear': {
      if (!inp || !inp.value) return;
      const id = viewOfInput.get(inp)?.row.id;
      const was = inp.value, caret = inp.selectionStart ?? was.length;
      inp.focus();
      withoutRecording(() => editText(inp, '', 0, inp.value.length));
      if (id) pushStep({
        label: 'Cleared the line',
        undo: () => {
          const back = views.get(id)?.input;
          if (!back || back.value !== '') return;
          back.focus();
          withoutRecording(() => editText(back, was, 0, back.value.length));
          back.setSelectionRange(caret, caret);
        },
        redo: () => {
          const back = views.get(id)?.input;
          if (!back || back.value !== was) return;
          back.focus();
          withoutRecording(() => editText(back, '', 0, back.value.length));
        },
      }, false);
      return;
    }
    case 'back': {
      if (!inp) return;
      inp.focus();
      const s = inp.selectionStart ?? 0, e = inp.selectionEnd ?? 0;
      const id = viewOfInput.get(inp)?.row.id;
      if (id && inp.value === '' && doc.rows.length > 1) {
        deleteRow(id);
        return;
      }
      applyBackspace(inp, backspaceEdit(inp.value, s, e));
      return;
    }
    case 'enter':
      if (activeId && rowIndex(activeId) >= 0) commitLine(activeId);
      return;
    case 'table':
      addTable();
      return;
    case 'matrix':
      openMatrixEditor();
      return;
    case 'clearall':
      clearAll();
      return;
  }
}
const BACK_ICON = '<svg class="kicon back" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.2 4.5h8.55c.97 0 1.75.78 1.75 1.75v7.5c0 .97-.78 1.75-1.75 1.75H7.2L2.5 10z"/><path d="M9.5 7.5l5 5M14.5 7.5l-5 5"/></svg>';
const arrowIcon = (left: boolean) => `<svg class="kicon" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${left ? 'M16 10H4.5M9 5 4 10l5 5' : 'M4 10h11.5M11 5l5 5-5 5'}"/></svg>`;
export function keyButton(k: Key): HTMLButtonElement {
  const tone = capTone(k);
  const sub = keyCaption(k);
  const face = legendText(k.label);
  const words = isWordKey(k);
  const long = [...face].length >= LONG_LABEL || keyLegend(k.label).length > 1;
  const b = h('button', {
    type: 'button',
    class: `key ${tone}${k.tone === 'red' ? ' clear-all' : ''}${words ? ' word' : ''}${sub ? ' has-sub' : ''}${long ? ' long' : !words && face.length > 4 ? ' mid' : ''}`,
    'aria-label': k.title ? `${k.label}: ${kb(k.title)}` : k.label,
    'data-key': k.label,
    'data-action': k.action,
  },
    h('span', { class: 'kl', 'data-label': long ? k.label : undefined }, face),
    sub ? h('span', { class: 'ks' }, sub) : null,
  );
  // The ⌫ and arrow glyphs come out tiny in most fonts; draw them at the digits' size instead.
  if (k.action === 'back') b.querySelector('.kl')!.innerHTML = BACK_ICON;
  if (k.action === 'left' || k.action === 'right') b.querySelector('.kl')!.innerHTML = arrowIcon(k.action === 'left');
  // A modifier letter (xʸ, eˣ) comes from a fallback face, with a gap; set it as a superscript in the key's own font.
  const sup = /^(.+?)([ˣʸ])$/u.exec(face);
  if (sup) b.querySelector('.kl')!.replaceChildren(sup[1], h('sup', { class: 'ksup' }, sup[2] === 'ʸ' ? 'y' : 'x'));
  b.addEventListener('mousedown', (e) => e.preventDefault());
  if (k.action === 'left' || k.action === 'right') caretKey(b, k);
  const cleared = k.action === 'back' ? backKey(b) : null;
  b.addEventListener('click', (e) => {
    if ((k.action === 'left' || k.action === 'right') && e.detail !== 0) return;
    if (cleared?.()) return;
    closeThumb();
    play(k.action === 'enter' ? (activeId && currentResults()[rowIndex(activeId)]?.error ? 'error' : 'enter') : tone === 'num' ? 'tick' : 'fn');
    b.classList.remove('pop');
    void b.offsetWidth; // restart the press animation
    b.classList.add('pop');
    if (k.action) runKeyAction(k.action);
    else if (k.ins === ',' && commaSteps()) { /* stepped to the next slot */ }
    else insertText(k.ins ?? k.label);
    konamiStep(k.action === 'left' ? 'L' : k.action === 'right' ? 'R' : KONAMI_KEYS[k.label]);
  });
  b.addEventListener('mouseenter', () => showKeyHelp(k, b, false));
  b.addEventListener('focus', () => showKeyHelp(k, b, true));
  b.addEventListener('mouseleave', () => showKeyHelp(null));
  b.addEventListener('blur', () => showKeyHelp(null));
  return b;
}
function caretKey(b: HTMLButtonElement, k: Key): void {
  let repeat = 0, start = 0;
  let pointer: { id: number; lastX: number; acc: number; scrubbing: boolean; before: number | null; repeating: boolean } | null = null;
  const step = runKeyAction;
  const line = activeInput;
  const stop = () => { clearTimeout(start); clearInterval(repeat); pointer = null; b.classList.remove('held'); };
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    pointer = { id: e.pointerId, lastX: e.clientX, acc: 0, scrubbing: false, before: line()?.selectionStart ?? null, repeating: false };
    b.classList.add('held');
    closeThumb();
    play('fn');
    step(k.action as 'left' | 'right');
    konamiStep(k.action === 'left' ? 'L' : 'R');
    start = window.setTimeout(() => {
      if (pointer) pointer.repeating = true;
      repeat = window.setInterval(() => step(k.action as 'left' | 'right'), CARET_REPEAT_MS);
    }, CARET_DELAY_MS);
  });
  b.addEventListener('pointermove', (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    pointer.acc += e.clientX - pointer.lastX;
    pointer.lastX = e.clientX;
    if (!pointer.scrubbing && Math.abs(pointer.acc) < CARET_SCRUB) return;
    if (!pointer.scrubbing) {
      pointer.scrubbing = true;
      clearTimeout(start);
      clearInterval(repeat);
      const inp = line();
      if (!pointer.repeating && inp && pointer.before !== null) inp.setSelectionRange(pointer.before, pointer.before);
    }
    while (Math.abs(pointer.acc) >= CARET_SCRUB) {
      step(pointer.acc > 0 ? 'right' : 'left');
      pointer.acc -= Math.sign(pointer.acc) * CARET_SCRUB;
    }
  });
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointercancel', stop);
  b.addEventListener('lostpointercapture', stop);
}
/** Returns whether the hold just cleared the line, so the click that ends it does nothing more. */
function backKey(b: HTMLButtonElement): () => boolean {
  let arm = 0, fire = 0, cleared = false;
  const stop = () => { clearTimeout(arm); clearTimeout(fire); b.classList.remove('arming'); };
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    cleared = false;
    stop();
    arm = window.setTimeout(() => b.classList.add('arming'), CLEAR_ARM_MS);
    fire = window.setTimeout(() => {
      cleared = true;
      b.classList.remove('arming');
      play('fn');
      runKeyAction('clear');
    }, CLEAR_MS);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(ev, stop);
  return () => { const was = cleared; cleared = false; return was; };
}
let keyHelp: HTMLElement | null = null;
let keyHelpTimer = 0;
export const keyHint = h('div', { class: 'key-hint', 'aria-live': 'polite' });
export function cancelKeyHintTimer(): void {
  clearTimeout(keyHelpTimer);
}
export function clearKeyHintSoon(): void {
  keyHelpTimer = window.setTimeout(() => keyHint.replaceChildren(), 80);
}
function showKeyHelp(k: Key | null, key?: HTMLElement, now = false): void {
  const tip = keyHelp;
  if (!tip) return;
  // A digit or point types just itself: "6 types 6" says nothing.
  if (k && !k.title && (k.ins ?? k.label) === k.label) k = null;
  cancelKeyHintTimer();
  if (keyHint.offsetParent) {
    if (k) fillKeyHelp(keyHint, k);
    else clearKeyHintSoon();
    return;
  }
  if (!k || !key) {
    keyHelpTimer = window.setTimeout(() => { tip.classList.remove('on'); }, 80);
    return;
  }
  if (!now && !tip.classList.contains('on')) {
    keyHelpTimer = window.setTimeout(() => showKeyHelp(k, key, true), 450);
    return;
  }
  fillKeyHelp(tip, k);
  const host = tip.offsetParent as HTMLElement | null;
  if (!host) return;
  const hr = host.getBoundingClientRect(), kr = key.getBoundingClientRect();
  tip.classList.add('on');
  const half = tip.offsetWidth / 2;
  const x = Math.max(half + 2, Math.min(hr.width - half - 2, kr.left + kr.width / 2 - hr.left));
  tip.style.left = `${x}px`;
  tip.style.top = `${kr.top - hr.top - 6}px`;
}
function fillKeyHelp(keyHelp: HTMLElement, k: Key): void {
  const insert = k.ins ? k.ins.replace('¦', '…') : '';
  const text = k.title ? kb(k.title) : insert || k.label;
  const name = keyCall(k);
  if (name && text.startsWith(name)) {
    keyHelp.replaceChildren(h('span', { class: 'kh-text' }, h('b', { class: 'kh-name' }, name), text.slice(name.length)));
    return;
  }
  keyHelp.replaceChildren(h('span', { class: 'kh-key' }, k.label), h('span', { class: 'kh-text' }, k.title ? text : `types ${insert || k.label}`));
}
/**
 * Measured rather than styled by length, because the two looks use different faces and the key width follows the window.
 * Reads happen in one pass and writes in another, so it costs two layouts per keypad build or resize.
 */
let fitQueued = false;
export function fitKeyLabels(): void {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    const labels = [...keypadEl.querySelectorAll<HTMLElement>('.key .kl')];
    for (const l of labels) {
      l.style.fontSize = '';
      l.hidden = false;
      if (l.dataset.label && l.classList.contains('two')) { l.textContent = legendText(l.dataset.label); l.classList.remove('two'); }
      l.classList.remove('cond');
    }
    const two = labels.filter((l) => {
      if (!l.dataset.label || !l.clientWidth || keyLegend(l.dataset.label).length < 2) return false;
      const size = parseFloat(getComputedStyle(l).fontSize);
      return l.scrollWidth * (LABEL_TWO / size) > l.clientWidth;
    });
    for (const l of two) {
      // Broken between its words, never inside one, with the space kept between the lines (it draws nothing in the
      // column), so the key still reads "new matrix", not "newmatrix", to find and to copy.
      const [a, b] = keyLegend(l.dataset.label!);
      l.replaceChildren(h('span', {}, a), ' ', h('span', {}, b));
      l.classList.add('two');
    }
    const widest = (l: HTMLElement) => (l.classList.contains('two') ? Math.max(...[...l.children].map((c) => (c as HTMLElement).scrollWidth)) : l.scrollWidth);
    const cond = labels.filter((l) => l.clientWidth && widest(l) * (LABEL_MIN / parseFloat(getComputedStyle(l).fontSize)) > l.clientWidth);
    for (const l of cond) l.classList.add('cond');
    const shrink: [HTMLElement, number][] = [];
    for (const l of labels) {
      const room = l.clientWidth;
      const need = l.classList.contains('two') ? Math.max(...[...l.children].map((c) => (c as HTMLElement).scrollWidth)) : l.scrollWidth;
      if (need <= room || !room) continue;
      const size = parseFloat(getComputedStyle(l).fontSize);
      // A hair under the exact ratio, so the last pixel fits too.
      const fit = Math.floor(size * (room / need) * 0.97 * 10) / 10;
      shrink.push([l, Math.max(LABEL_MIN, fit)]);
    }
    for (const [l, px] of shrink) l.style.fontSize = `${px}px`;
    const keys = [...keypadEl.querySelectorAll<HTMLElement>('.key')].filter((k) => k.offsetParent);
    const rows = new Map<string, HTMLElement[]>();
    const heights = keys.map((k) => k.getBoundingClientRect().height).sort((a, b) => a - b);
    const usual = heights[Math.floor(heights.length / 2)] ?? 0;
    for (const k of keys) {
      const r = k.getBoundingClientRect();
      const id = `${Math.round(r.top)}:${r.height > 1.5 * usual ? 'tall' : ''}`;
      rows.set(id, [...(rows.get(id) ?? []), k]);
    }
    const captioned = (k: HTMLElement) => { const ks = k.querySelector<HTMLElement>('.ks'); return !!ks && !ks.hidden && getComputedStyle(ks).display !== 'none'; };
    for (const row of rows.values()) {
      const on = row.some(captioned);
      for (const k of row) k.classList.toggle('cap-row', on);
    }
  });
}
export function buildKeypad(): void {
  const numpad = h('div', { class: 'numpad', role: 'group', 'aria-label': 'Number pad' });
  const grid = h('div', { class: 'keys' }, tiRows, numpad);
  keyHelp = h('div', { class: 'key-help', role: 'tooltip', 'aria-live': 'polite' });

  const row = (r: Key[]) => h('div', { class: 'krow' }, ...r.map((k) => keyButton(k)));
  const navRows = (): HTMLButtonElement[][] => [...tiRows.children, ...numpad.querySelectorAll<HTMLElement>('.krow')].map((r) => [...r.querySelectorAll<HTMLButtonElement>('.key')]);

  const show = () => {
    redrawKeys = show;
    // A key with focus is about to be replaced; focus stays in the keys instead of falling to the page, where the next
    // digit typed would be lost.
    const keyFocused = grid.contains(document.activeElement);
    numpad.replaceChildren(...padRows(doc.ui.padLeft).map(row));
    buildThumbRows();
    grid.classList.toggle('pad-left', !!doc.ui.padLeft);
    grid.setAttribute('aria-label', 'Keys over the number pad. Arrow keys move; typing goes to the line.');
    const first = tiRows.querySelector<HTMLButtonElement>('.key');
    grid.querySelectorAll<HTMLButtonElement>('.key').forEach((k) => (k.tabIndex = k === first ? 0 : -1));
    if (first && (keyFocused || (document.activeElement === document.body && keypadEl.contains(lastKeyFocus)))) first.focus({ preventScroll: true });
    fitKeyLabels();
  };

  new ResizeObserver(() => fitKeyLabels()).observe(grid);
  let lastRow = 0;
  grid.addEventListener('keydown', (e) => {
    const cur = document.activeElement as HTMLButtonElement;
    if (!cur.classList.contains('key')) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== ' ') {
      e.preventDefault();
      closeThumb();
      insertText(e.key);
      return;
    }
    if (e.key === 'Backspace') { e.preventDefault(); runKeyAction('back'); return; }
    const rows = navRows();
    const ri = rows[lastRow]?.includes(cur) ? lastRow : rows.findIndex((r) => r.includes(cur));
    if (ri < 0) return;
    const inRow = rows[ri];
    const ci = inRow.indexOf(cur);
    let next: HTMLButtonElement | undefined;
    const centerX = (k: HTMLElement) => { const r = k.getBoundingClientRect(); return r.left + r.width / 2; };
    if (e.key === 'ArrowRight') next = inRow[ci + 1] ?? rows[ri + 1]?.[0];
    else if (e.key === 'ArrowLeft') next = inRow[ci - 1];
    else if (e.key === 'Home') next = inRow[0];
    else if (e.key === 'End') next = inRow[inRow.length - 1];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const up = e.key === 'ArrowUp';
      const target = rows[ri + (up ? -1 : 1)];
      if (target) {
        const cx = centerX(cur);
        next = target.reduce((best, k) => (Math.abs(centerX(k) - cx) < Math.abs(centerX(best) - cx) ? k : best));
      }
    }
    if (next) lastRow = e.key === 'ArrowUp' ? ri - 1 : e.key === 'ArrowDown' ? ri + 1 : rows[ri].includes(next) ? ri : ri + 1;
    if (!next) return;
    e.preventDefault();
    grid.querySelectorAll<HTMLButtonElement>('.key').forEach((k) => (k.tabIndex = -1));
    next.tabIndex = 0;
    next.focus();
  });
  grid.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains('key')) return;
    grid.querySelectorAll<HTMLButtonElement>('.key').forEach((k) => (k.tabIndex = k === t ? 0 : -1));
  });
  // AC and enter are on the composer; the foot of the keys says what the key or tile you point at does.
  keypadEl.append(h('div', { class: 'pad' }, h('div', { class: 'pad-main' }, grid, keyHelp)), h('div', { class: 'key-foot' }, keyHint));
  show();
}
let lastKeyFocus: Element | null = null;

export function initKeypad(): void {
  document.addEventListener('focusin', (e) => { if ((e.target as Element).classList?.contains('key')) lastKeyFocus = e.target as Element; });
}
