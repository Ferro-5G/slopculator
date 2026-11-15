import { USAGE } from '../ui/complete';
import { DIV } from '../ui/keypad';
import { play } from './sound';
import { matrixAddRow } from '../ui/slots';
import { FLUIDS, TABS, ROW1, type Tile, tileKey, faceRuns, tileLabel, tileCaption, COLUMNS, type Page, tileFor, hasFluidChips, rowsOf, tileHeight, TILE_MAX } from '../ui/thumbindex';
import { h } from './dom';
import { pulse } from './feedback';
import { keyButton, keyHint, cancelKeyHintTimer, clearKeyHintSoon, runKeyAction } from './keypad';
import { tape, listEl } from './layout';
import { openMatrixEditor, openShapeEditor, openVectorEditor } from './editors';
import { editText, insertFromSearch } from './lineeditor';
import { narrow, kb } from './platform';
import { focusLine, views } from './rowviews';
import { doc, activeId } from './sheet';

export const ti = { tab: null as number | null, page: 0, fluid: FLUIDS[0].key.ins! };
export const tiRows = h('div', { class: 'ti-rows' });
export const tiPage = h('div', { class: 'ti-page', id: 'ti-page', role: 'dialog', hidden: true });
export const tiTabs: HTMLButtonElement[] = [];
const tabIcon = (body: string) => `<svg class="ti-glyph" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const FLAKE_ARM = '<path d="M8 1.5v13M6.2 2.9 8 4.6l1.8-1.7M6.2 13.1 8 11.4l1.8 1.7"/>';
const TAB_ICONS = [
  '<span class="ti-glyph ti-fx" aria-hidden="true">ƒ(x)</span>',
  tabIcon('<rect x="2" y="8" width="3" height="6" rx="0.6"/><rect x="6.5" y="3" width="3" height="11" rx="0.6"/><rect x="11" y="6" width="3" height="8" rx="0.6"/>'),
  tabIcon('<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><circle cx="5.6" cy="5.6" r="0.5" fill="currentColor"/><circle cx="8" cy="8" r="0.5" fill="currentColor"/><circle cx="10.4" cy="10.4" r="0.5" fill="currentColor"/>'),
  tabIcon('<rect x="2" y="2" width="3" height="3" rx="0.5"/><rect x="6.5" y="2" width="3" height="3" rx="0.5"/><rect x="11" y="2" width="3" height="3" rx="0.5"/><rect x="2" y="6.5" width="3" height="3" rx="0.5"/><rect x="6.5" y="6.5" width="3" height="3" rx="0.5"/><rect x="11" y="6.5" width="3" height="3" rx="0.5"/><rect x="2" y="11" width="3" height="3" rx="0.5"/><rect x="6.5" y="11" width="3" height="3" rx="0.5"/><rect x="11" y="11" width="3" height="3" rx="0.5"/>'),
  tabIcon(`${FLAKE_ARM}<g transform="rotate(60 8 8)">${FLAKE_ARM}</g><g transform="rotate(120 8 8)">${FLAKE_ARM}</g>`),
];
const CLOSE_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>';
export function buildThumbRows(): void {
  const div = keyButton(DIV);
  div.classList.add('ti-div');
  tiTabs.length = 0;
  TABS.forEach((t, i) => {
    const b = h('button', {
      type: 'button', class: 'key fn word ti-tab',
      'aria-label': t.name, 'aria-description': t.subtitle, 'aria-expanded': 'false', 'aria-controls': 'ti-page', 'aria-haspopup': 'dialog',
    }, h('span', { class: 'kl' }, t.name));
    // Set as properties, not in a style attribute: a strict content security policy drops inline style attributes,
    // which once left every tab without its color.
    b.style.setProperty('--tab', `var(--tab-${i})`);
    b.style.setProperty('--tab-on', `var(--tab-on-${i})`);
    b.insertAdjacentHTML('afterbegin', TAB_ICONS[i]);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      play('toggle');
      b.classList.remove('pop');
      void b.offsetWidth;
      b.classList.add('pop');
      toggleTab(i, e.detail === 0);
    });
    tiTabs.push(b);
  });
  tiRows.replaceChildren(
    h('div', { class: 'ti-row', role: 'group', 'aria-label': 'Everyday keys' }, ...ROW1.map((k) => keyButton(k))),
    h('div', { class: 'ti-row', role: 'group', 'aria-label': 'Function tabs' }, ...(doc.ui.padLeft ? [div, ...tiTabs] : [...tiTabs, div])),
  );
  syncTabs();
}
function syncTabs(): void {
  tiTabs.forEach((b, i) => {
    b.classList.toggle('lit', ti.tab === i);
    b.setAttribute('aria-expanded', String(ti.tab === i));
  });
}
export function toggleTab(i: number, keyboard = false): void {
  if (ti.tab === i) { closeThumb(); return; }
  const was = ti.tab;
  ti.tab = i;
  ti.page = 0;
  syncTabs();
  drawThumbPage();
  tiPage.hidden = false;
  placeThumbPage();
  if (was === null) pulse(tiPage, 'ti-in');
  if (keyboard) tiPage.querySelector<HTMLElement>(narrow.matches ? '.ti-tile, .ti-seg[aria-selected=true]' : '.ti-tile')?.focus({ preventScroll: true });
}
export function turnPage(dir: number): void {
  if (ti.tab === null) return;
  const n = TABS[ti.tab].pages.length;
  if (n < 2) return;
  const onTile = (document.activeElement as HTMLElement | null)?.classList.contains('ti-tile');
  const onSeg = (document.activeElement as HTMLElement | null)?.classList.contains('ti-seg');
  play('detent');
  ti.page = (ti.page + dir + n) % n;
  drawThumbPage();
  placeThumbPage();
  if (onTile) tiPage.querySelector<HTMLElement>('.ti-tile')?.focus({ preventScroll: true });
  else if (onSeg) tiPage.querySelector<HTMLElement>('.ti-seg[aria-selected=true]')?.focus({ preventScroll: true });
}
export function closeThumb(): void {
  if (ti.tab === null) return;
  const hadFocus = tiPage.contains(document.activeElement);
  ti.tab = null;
  syncTabs();
  tiPage.hidden = true;
  listEl.style.paddingBottom = '';
  if (hadFocus) focusLine();
}
function chooseTile(tile: Tile): void {
  closeThumb();
  play('fn');
  const view = activeId ? views.get(activeId) : undefined;
  const inp = view?.input;
  if (tile.matrixRow && inp) {
    const added = matrixAddRow(inp.value, inp.selectionStart ?? inp.value.length);
    if (added) {
      editText(inp, added.text, 0, inp.value.length);
      inp.setSelectionRange(added.caret, added.caret);
      view?.refresh?.();
      return;
    }
  }
  const k = tileKey(tile, ti.fluid);
  if (k.action) runKeyAction(k.action);
  else insertFromSearch(k.ins ?? k.label);
}

function drawThumbPage(): void {
  if (ti.tab === null) return;
  const openEditor = { matrix: openMatrixEditor, shape: openShapeEditor, vector: openVectorEditor };
  const t = TABS[ti.tab];
  const pg = t.pages[Math.min(ti.page, t.pages.length - 1)];
  const tapButton = (b: HTMLElement) => { b.addEventListener('mousedown', (e) => e.preventDefault()); return b; };
  const head = t.pages.length > 1
    ? h('div', { class: 'ti-segs', role: 'tablist', 'aria-label': `${t.name} pages` }, ...t.pages.map((q, j) => {
      const b = tapButton(h('button', { type: 'button', role: 'tab', class: 'ti-seg', 'aria-selected': String(j === ti.page), tabindex: j === ti.page ? '0' : '-1' }, q.name));
      b.addEventListener('click', () => {
        if (ti.page === j) return;
        play('detent');
        ti.page = j;
        drawThumbPage();
        placeThumbPage();
        tiPage.querySelector<HTMLElement>('.ti-seg[aria-selected=true]')?.focus({ preventScroll: true });
      });
      return b;
    }))
    : h('div', { class: 'ti-title', role: 'heading', 'aria-level': '2' }, h('b', {}, t.name));
  const close = tapButton(h('button', { type: 'button', class: 'ti-close', 'aria-label': `Close ${t.name}` }));
  close.innerHTML = CLOSE_ICON;
  close.addEventListener('click', () => { play('toggle'); closeThumb(); });
  const chips = hasFluidChips(pg)
    ? h('div', { class: 'ti-chips', role: 'radiogroup', 'aria-label': 'Refrigerant' }, h('span', { class: 'ti-chips-label', 'aria-hidden': 'true' }, 'Fluid'), ...FLUIDS.map((f) => {
      const on = f.key.ins === ti.fluid;
      const b = tapButton(h('button', { type: 'button', role: 'radio', class: 'ti-chip', 'aria-checked': String(on), 'aria-label': `R-${f.label}` }, f.label));
      b.addEventListener('click', () => { play('detent'); ti.fluid = f.key.ins!; drawThumbPage(); placeThumbPage(); });
      return b;
    }))
    : null;
  const grid = h('div', { class: 'ti-grid' }, ...pg.tiles.map((tile) => {
    const face = h('span', { class: 'ti-face' }, ...faceRuns(tile.face).map((r) => (r.sub ? h('sub', {}, r.text) : r.text)));
    const b = tapButton(h('button', { type: 'button', class: 'ti-tile', 'aria-label': tileLabel(tile) }, face, h('span', { class: 'ti-name', 'aria-hidden': 'true', hidden: !tileCaption(tile) }, tile.name)));
    b.addEventListener('click', () => chooseTile(tile));
    b.addEventListener('mouseenter', () => showTileHelp(tile));
    b.addEventListener('focus', () => showTileHelp(tile));
    b.addEventListener('mouseleave', () => showTileHelp(null));
    b.addEventListener('blur', () => showTileHelp(null));
    return b;
  }));
  const editor = pg.editor;
  if (editor) {
    const b = tapButton(h('button', { type: 'button', class: editor.wide ? 'ti-tile ti-any' : 'ti-tile', 'aria-label': editor.label, title: editor.title },
      h('span', { class: 'ti-face' }, editor.face), h('span', { class: 'ti-name', 'aria-hidden': 'true' }, editor.name)));
    b.addEventListener('click', () => { closeThumb(); play('fn'); openEditor[editor.editor](); });
    grid.append(b);
  }
  tiPage.setAttribute('aria-label', t.pages.length > 1 ? `${t.name}: ${pg.name}` : t.name);
  tiPage.style.setProperty('--tab', `var(--tab-${ti.tab})`);
  tiPage.style.setProperty('--tab-on', `var(--tab-on-${ti.tab})`);
  tiPage.style.setProperty('--tab-name', `var(--tab-name-${ti.tab})`);
  tiPage.replaceChildren(h('div', { class: 'ti-strip' }, head, close), chips ?? '', grid);
}
function showTileHelp(tile: Tile | null): void {
  if (!keyHint.offsetParent) return;
  cancelKeyHintTimer();
  if (!tile) { clearKeyHintSoon(); return; }
  const k = tileKey(tile, ti.fluid);
  const callOf = (t: string) => /^[A-Za-z_]\w*\([^)]*\)/.exec(t)?.[0];
  const title = k.title ? kb(k.title) : '';
  const usage = USAGE.get(tile.name) ?? '';
  const sig = callOf(usage) ?? callOf(title) ?? tile.name;
  const rest = (t: string) => { const c = callOf(t); return (c ? t.slice(c.length) : t).replace(/^\s*[:=—-]?\s*/, ''); };
  const what = rest(title) || rest(usage) || tile.say;
  keyHint.replaceChildren(h('span', { class: 'kh-text wrap' }, h('b', { class: 'kh-name' }, sig), ' ', h('span', { class: 'kh-what' }, what)));
}
/** The page's top margin, in px. */
const TI_TOP = 4;
const DESK_TILE_MAX = 64;
const DESK_TILE_MIN = 30;
/** Desktop tiles keep one comfortable size, and the page sits on the keys rather than covering the notebook. */
const DESK_TILE = 50;
const FIVE_ACROSS = 560;
export function placeThumbPage(): void {
  if (ti.tab === null || tiPage.hidden) return;
  const t = TABS[ti.tab];
  const tapeR = tape.getBoundingClientRect(), listR = listEl.getBoundingClientRect();
  const desk = !narrow.matches;
  const cols = desk && tapeR.width >= FIVE_ACROSS ? 5 : COLUMNS;
  const rowsAt = (q: Page) => rowsOf(q, cols);
  const sized = desk ? TABS.flatMap((x) => x.pages) : t.pages;
  tiPage.style.setProperty('--ti-cols', String(cols));
  const foot = listR.top + listEl.clientTop + listEl.clientHeight - tapeR.top;
  const cs = getComputedStyle(tiPage);
  const px = (name: string) => parseFloat(cs.getPropertyValue(name));
  const fit = (compact: boolean) => {
    const metric = (name: string) => px(compact ? `--ti-${name}-compact` : `--ti-${name}`);
    const strip = metric('strip'), pad = metric('pad'), gap = metric('gap');
    const chrome = (q: Page) => strip + (hasFluidChips(q) ? metric('chips') : 0) + pad + px('--ti-grid-top') + gap * (rowsAt(q) - 1);
    const sizeFor = (room: number) => Math.min(...sized.map((q) => Math.floor((room - chrome(q)) / rowsAt(q))));
    return { chrome, sizeFor };
  };
  const room = foot - TI_TOP;
  const deskNeed = desk ? Math.max(...sized.map((q) => fit(false).chrome(q) + rowsAt(q) * DESK_TILE)) : Infinity;
  if (deskNeed <= room) {
    tiPage.classList.remove('compact', 'scrolling');
    tiPage.style.setProperty('--tile-h', `${DESK_TILE}px`);
    tiPage.style.top = `${foot - deskNeed}px`;
    tiPage.style.height = `${deskNeed}px`;
    revealAbove(deskNeed);
    fitTiles();
    return;
  }
  revealAbove(0);
  const { tileH, compact } = tileHeight((c) => fit(c).sizeFor(room), desk ? DESK_TILE_MAX : TILE_MAX);
  tiPage.classList.toggle('compact', compact);
  const scrolling = desk && tileH < DESK_TILE_MIN;
  tiPage.classList.toggle('scrolling', scrolling);
  tiPage.style.setProperty('--tile-h', `${scrolling ? DESK_TILE_MIN : tileH}px`);
  tiPage.style.top = `${TI_TOP}px`;
  tiPage.style.height = `${room}px`;
  fitTiles();
}
/** Keep the line being edited in view above a desktop page that covers the foot of the notebook. */
function revealAbove(cover: number): void {
  listEl.style.paddingBottom = cover ? `${cover + 8}px` : '';
  if (!cover) return;
  const row = (activeId ? views.get(activeId)?.input : undefined)?.closest<HTMLElement>('.row');
  if (!row) return;
  const lr = listEl.getBoundingClientRect(), rr = row.getBoundingClientRect();
  const limit = lr.top + listEl.clientTop + listEl.clientHeight - cover - 8;
  if (rr.bottom > limit) listEl.scrollTop += rr.bottom - limit;
}
/** A face or name too wide for its tile shrinks to fit rather than run off it: a face to 10 px, a name to 8.25 (¾ of 11, as iOS). */
function fitTiles(): void {
  const els = [...tiPage.querySelectorAll<HTMLElement>('.ti-face, .ti-name, .ti-seg')];
  for (const e of els) e.style.fontSize = '';
  const fits = els.map((e) => [e, e.clientWidth && e.scrollWidth > e.clientWidth ? parseFloat(getComputedStyle(e).fontSize) * (e.clientWidth / e.scrollWidth) * 0.97 : 0] as const);
  for (const [e, px] of fits) if (px) e.style.fontSize = `${Math.max(e.classList.contains('ti-face') ? 10 : 8.25, Math.floor(px * 10) / 10)}px`;
}
export function flashTab(name: string): void {
  const at = tileFor(name);
  const tab = at ? tiTabs[at.tab] : undefined;
  if (!tab) return;
  tab.classList.remove('found');
  void tab.offsetWidth;
  tab.classList.add('found');
  setTimeout(() => tab.classList.remove('found'), 2000);
}

export function initThumb(): void {
  tape.append(tiPage);
  new ResizeObserver(() => placeThumbPage()).observe(tape);
  tiPage.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const tab = ti.tab !== null ? tiTabs[ti.tab] : null;
      closeThumb();
      if (narrow.matches) tab?.focus();
      else focusLine();
      return;
    }
    if (e.ctrlKey && e.altKey) return;
    const seg = (e.target as HTMLElement).closest('.ti-seg');
    if (seg && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && ti.tab !== null) {
      e.preventDefault();
      const n = TABS[ti.tab].pages.length;
      (tiPage.querySelectorAll<HTMLButtonElement>('.ti-seg')[(ti.page + (e.key === 'ArrowRight' ? 1 : n - 1)) % n])?.click();
      return;
    }
    if (!e.key.startsWith('Arrow') || e.altKey || e.metaKey || e.ctrlKey) return;
    const tiles = [...tiPage.querySelectorAll<HTMLButtonElement>('.ti-tile')];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    const cols = getComputedStyle(tiPage.querySelector('.ti-grid')!).gridTemplateColumns.split(' ').length || 4;
    if (at < 0) {
      if (e.key === 'ArrowDown' && tiles[0]) { e.preventDefault(); tiles[0].focus(); }
      return;
    }
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key] ?? 0;
    const to = at + step;
    e.preventDefault();
    if (to >= 0 && to < tiles.length) tiles[to].focus();
    else if (e.key === 'ArrowDown' && Math.floor(at / cols) < Math.floor((tiles.length - 1) / cols)) tiles[tiles.length - 1].focus();
    else if (e.key === 'ArrowUp') tiPage.querySelector<HTMLElement>('.ti-seg[aria-selected=true], .ti-chip[aria-checked=true], .ti-close')?.focus();
  });
}
