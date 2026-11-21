import { AC } from '../ui/keypad';
import { USAGE } from '../ui/complete';
import { play } from './sound';
import { matrixAddRow } from '../ui/slots';
import { FLUIDS, TABS, ROW1, type Tile, tileKey, faceRuns, tileLabel, tileCaption, tileFor, hasFluidChips } from '../ui/thumbindex';
import { h } from './dom';
import { motionNow, pulse } from './feedback';
import { CURVES, DURATIONS } from '../ui/motiontokens';
import { keyButton, keyHint, cancelKeyHintTimer, clearKeyHintSoon, runKeyAction } from './keypad';
import { tape, listEl, keypadEl, composerDock } from './layout';
import { composerTabs, stirAurora } from './composer';
import { openBuilder } from './editors';
import { editText, insertFromSearch } from './lineeditor';
import { coarse, narrow, kb } from './platform';
import { focusLine, views } from './rowviews';
import { activeId, doc } from './sheet';
import { toggleSysKeyboard } from './shell';

export const ti = { tab: null as number | null, page: 0, fluid: FLUIDS[0].key.ins! };
export const tiRows = h('div', { class: 'ti-rows' });
export const tiPage = h('div', { class: 'ti-page', id: 'ti-page', role: 'dialog', hidden: true });
export const tiTabs: HTMLButtonElement[] = [];
const deckPadBtn = h('button', {
  type: 'button',
  class: 'deck-pad ti-close lit',
  'aria-label': 'Number pad',
  'aria-pressed': 'true',
  title: 'Back to number pad',
}, '123');
deckPadBtn.addEventListener('mousedown', (e) => e.preventDefault());
deckPadBtn.addEventListener('click', () => {
  if (coarse.matches && doc.ui.sysKeyboard) {
    closeThumb();
    toggleSysKeyboard();
  } else if (ti.tab !== null) {
    play('toggle');
    closeThumb();
  }
});
export const deckBar = h('div', { class: 'deck-bar', role: 'toolbar', 'aria-label': 'Keypad categories' });
/** The deck bar's liquid ink, sliding from the deck left to the deck chosen. */
const deckInk = h('span', { class: 'deck-ink', 'aria-hidden': 'true' });
let inkRun: Animation | null = null;
let deckAcBtn: HTMLButtonElement | null = null;
const deckKbBtn = h('button', {
  type: 'button',
  class: 'deck-kb',
  'aria-label': 'Use system keyboard',
  title: 'Switch to system keyboard',
}, 'ABC');
deckKbBtn.addEventListener('mousedown', (e) => e.preventDefault());
deckKbBtn.addEventListener('click', () => { closeThumb(); toggleSysKeyboard(); });
const tabIcon = (body: string) => `<svg class="ti-glyph" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const FLAKE_ARM = '<path d="M8 1.5v13M6.2 2.9 8 4.6l1.8-1.7M6.2 13.1 8 11.4l1.8 1.7"/>';
const TAB_ICONS = [
  '<span class="ti-glyph ti-fx" aria-hidden="true">ƒ(x)</span>',
  tabIcon('<rect x="2" y="8" width="3" height="6" rx="0.6"/><rect x="6.5" y="3" width="3" height="11" rx="0.6"/><rect x="11" y="6" width="3" height="8" rx="0.6"/>'),
  tabIcon('<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><circle cx="5.6" cy="5.6" r="0.5" fill="currentColor"/><circle cx="8" cy="8" r="0.5" fill="currentColor"/><circle cx="10.4" cy="10.4" r="0.5" fill="currentColor"/>'),
  tabIcon('<rect x="2" y="2" width="3" height="3" rx="0.5"/><rect x="6.5" y="2" width="3" height="3" rx="0.5"/><rect x="11" y="2" width="3" height="3" rx="0.5"/><rect x="2" y="6.5" width="3" height="3" rx="0.5"/><rect x="6.5" y="6.5" width="3" height="3" rx="0.5"/><rect x="11" y="6.5" width="3" height="3" rx="0.5"/><rect x="2" y="11" width="3" height="3" rx="0.5"/><rect x="6.5" y="11" width="3" height="3" rx="0.5"/><rect x="11" y="11" width="3" height="3" rx="0.5"/>'),
  tabIcon(`${FLAKE_ARM}<g transform="rotate(60 8 8)">${FLAKE_ARM}</g><g transform="rotate(120 8 8)">${FLAKE_ARM}</g>`),
];
const DECK_COLS = 3;
export function buildThumbRows(): void {
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
  // The everyday row tops the keypad; the unified deck bar (123 | categories | AC) sits right above it.
  tiRows.replaceChildren(h('div', { class: 'ti-row', role: 'group', 'aria-label': 'Everyday keys' }, ...ROW1.map((k) => keyButton(k))));
  composerTabs.replaceChildren(...tiTabs);
  if (!deckAcBtn) {
    deckAcBtn = keyButton(AC);
    deckAcBtn.classList.add('deck-ac');
  }
  deckKbBtn.hidden = !coarse.matches;
  if (!deckBar.contains(composerTabs)) {
    deckBar.replaceChildren(
      deckInk,
      deckPadBtn,
      h('span', { class: 'deck-sep', 'aria-hidden': 'true' }),
      composerTabs,
      h('span', { class: 'deck-sep deck-ac-sep', 'aria-hidden': 'true' }),
      deckKbBtn,
      deckAcBtn,
    );
  }
  syncTabs();
}
export function syncTabs(): void {
  const onKb = coarse.matches && !!doc.ui.sysKeyboard;
  const onPad = !onKb && ti.tab === null;
  // Aurora Glow and Keyboard Glow take the open deck's color (the number pad's is the accent); the dock, and the canvas behind the
  // blocks, glide between them.
  const deckColor = onPad || onKb ? 'var(--cv-accent)' : `var(--tab-${ti.tab})`;
  composerDock.style.setProperty('--au-a', deckColor);
  tape.style.setProperty('--au-deck', deckColor);
  // Keyboard Glow backlights the keys in the same color.
  keypadEl.style.setProperty('--kg', deckColor);
  tiPage.style.setProperty('--kg', deckColor);
  deckPadBtn.classList.toggle('lit', onPad);
  deckPadBtn.setAttribute('aria-pressed', String(onPad));
  deckPadBtn.setAttribute('aria-label', onPad ? 'Number pad' : onKb ? 'Use number pad' : `Close ${TABS[ti.tab!].name}`);
  deckKbBtn.classList.toggle('lit', onKb);
  deckKbBtn.setAttribute('aria-pressed', String(onKb));
  tiTabs.forEach((b, i) => {
    b.classList.toggle('lit', !onKb && ti.tab === i);
    b.setAttribute('aria-expanded', String(!onKb && ti.tab === i));
  });
}
/** Where the ink is now (still moving, or on the selected deck's button), in the deck bar's own coordinates. */
interface Ink { left: number; top: number; width: number; height: number; color: string }
const deckButton = (tab: number | null): HTMLElement | undefined => (tab === null ? deckPadBtn : tiTabs[tab]);
function inkAt(el: HTMLElement, color: string): Ink | null {
  const box = deckBar.getBoundingClientRect(), r = el.getBoundingClientRect();
  return r.width > 0 && box.width > 0 ? { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height, color } : null;
}
/** A deck button's solid fill, resolved from its color token so the ink never waits on the button's own transition. */
const deckColor = (el: HTMLElement): string => getComputedStyle(el).getPropertyValue(el === deckPadBtn ? '--cv-accent' : '--tab').trim();
function inkStart(tab: number | null): Ink | null {
  if (motionNow() !== 'full' || !deckInk.isConnected || getComputedStyle(deckInk).display === 'none') return null;
  if (inkRun?.playState === 'running') return inkAt(deckInk, getComputedStyle(deckInk).backgroundColor);
  const el = deckButton(tab);
  return el ? inkAt(el, deckColor(el)) : null;
}
/**
 * Slides the ink from where it was to the selected deck, its leading edge arriving first (DURATIONS.snapLead of
 * DURATIONS.snapTrail) so it stretches and gathers like a drop. The chosen button's own fill waits under it (.has-ink)
 * and locks in as it lands. Reduced and no motion skip it: the fill's color change is the whole transition then.
 */
function slideInk(from: Ink | null): void {
  const el = deckButton(ti.tab);
  const to = from && el ? inkAt(el, deckColor(el)) : null;
  inkRun?.cancel();
  inkRun = null;
  if (!from || !to || Math.abs(from.left - to.left) < 1) { deckBar.classList.remove('has-ink'); return; }
  const lead = DURATIONS.snapLead / DURATIONS.snapTrail;
  const right = to.left > from.left;
  const fromR = from.left + from.width, toR = to.left + to.width;
  const midL = right ? from.left + (to.left - from.left) * lead * 0.75 : to.left;
  const midR = right ? toR : fromR + (toR - fromR) * lead * 0.75;
  const box = (l: number, w: number, t: number, ht: number) => ({ left: `${l}px`, width: `${w}px`, top: `${t}px`, height: `${ht}px` });
  deckBar.classList.add('has-ink');
  const run = deckInk.animate([
    { ...box(from.left, from.width, from.top, from.height), backgroundColor: from.color, offset: 0 },
    { ...box(midL, midR - midL, (from.top + to.top) / 2, (from.height + to.height) / 2), offset: lead },
    { ...box(to.left, to.width, to.top, to.height), backgroundColor: to.color, offset: 1 },
  ], { duration: DURATIONS.snapTrail, easing: CURVES.snap });
  inkRun = run;
  run.finished.then(() => { if (inkRun === run) { inkRun = null; deckBar.classList.remove('has-ink'); } }, () => {});
}

export function toggleTab(i: number, keyboard = false): void {
  if (coarse.matches && doc.ui.sysKeyboard) toggleSysKeyboard();
  if (ti.tab === i) { closeThumb(); return; }
  const was = ti.tab;
  const ink = inkStart(was);
  ti.tab = i;
  ti.page = 0;
  syncTabs();
  slideInk(ink);
  drawThumbPage();
  tiPage.hidden = false;
  keypadEl.classList.add('deck-open');
  placeThumbPage();
  // The page comes in from the side of the deck it left: the number pad counts as left of every tab.
  tiPage.style.setProperty('--ti-dx', String(Math.sign(i - (was ?? -1))));
  pulse(tiPage, 'ti-in');
  stirAurora();
  if (keyboard) tiPage.querySelector<HTMLElement>(narrow.matches ? '.ti-grid .ti-tile, .ti-seg[aria-selected=true]' : '.ti-grid .ti-tile')?.focus({ preventScroll: true });
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
  const ink = inkStart(ti.tab);
  ti.tab = null;
  syncTabs();
  slideInk(ink);
  stirAurora();
  tiPage.hidden = true;
  keypadEl.classList.remove('deck-open');
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

/** The tab whose page was drawn last: its page underline slides only between pages of the same tab. */
let drawnTab: number | null = null;
/** The selected page's place in its strip, measured before a redraw replaces the strip. */
function segAt(seg: HTMLElement | null): { left: number; width: number } | null {
  const strip = seg?.parentElement;
  if (!seg || !strip) return null;
  const r = seg.getBoundingClientRect(), box = strip.getBoundingClientRect();
  return r.width > 0 ? { left: r.left - box.left, width: r.width } : null;
}
/** The page underline slides from the page left to the page chosen; the chosen page's own underline waits under it. */
function slideSegInk(segs: HTMLElement, from: { left: number; width: number } | null): void {
  if (!from || motionNow() !== 'full') return;
  const ink = segs.querySelector<HTMLElement>('.ti-ink');
  const to = segAt(segs.querySelector<HTMLElement>('.ti-seg[aria-selected=true]'));
  if (!ink || !to || Math.abs(to.left - from.left) < 1 || getComputedStyle(ink).display === 'none') return;
  // The underline sits 7 px inside its page, as the page's own does.
  const at = (r: { left: number; width: number }) => ({ left: `${r.left + 7}px`, width: `${Math.max(0, r.width - 14)}px` });
  const lead = DURATIONS.snapLead / DURATIONS.snapTrail;
  const right = to.left > from.left;
  const mid = right
    ? { left: from.left + (to.left - from.left) * lead * 0.75, width: to.left + to.width - (from.left + (to.left - from.left) * lead * 0.75) }
    : { left: to.left, width: from.left + from.width + (to.left + to.width - from.left - from.width) * lead * 0.75 - to.left };
  segs.classList.add('has-ink');
  const run = ink.animate([{ ...at(from), offset: 0 }, { ...at(mid), offset: lead }, { ...at(to), offset: 1 }], { duration: DURATIONS.snapTrail, easing: CURVES.snap });
  run.finished.then(() => segs.classList.remove('has-ink'), () => segs.classList.remove('has-ink'));
}
function drawThumbPage(): void {
  if (ti.tab === null) return;
  const segFrom = drawnTab === ti.tab ? segAt(tiPage.querySelector<HTMLElement>('.ti-seg[aria-selected=true]')) : null;
  drawnTab = ti.tab;
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
    }), h('span', { class: 'ti-ink', 'aria-hidden': 'true' }))
    : null;
  const chips = hasFluidChips(pg)
    ? h('div', { class: 'ti-chips', role: 'radiogroup', 'aria-label': 'Refrigerant' }, h('span', { class: 'ti-chips-label', 'aria-hidden': 'true' }, 'Fluid'), ...FLUIDS.map((f) => {
      const on = f.key.ins === ti.fluid;
      const b = tapButton(h('button', { type: 'button', role: 'radio', class: 'ti-chip', 'aria-checked': String(on), 'aria-label': `R-${f.label}` }, f.label));
      b.addEventListener('click', () => { play('detent'); ti.fluid = f.key.ins!; drawThumbPage(); placeThumbPage(); });
      return b;
    }))
    : null;
  const note = h('div', { class: 'ti-note', 'aria-live': 'polite' }, pg.note ?? t.subtitle);
  const resetNote = () => { note.replaceChildren(pg.note ?? t.subtitle); };
  const setNote = (sig: string, what: string) => {
    note.replaceChildren(h('b', { class: 'ti-note-sig' }, sig), ' ', h('span', { class: 'ti-note-what' }, what));
  };
  const helpFor = (tile: Tile) => {
    const k = tileKey(tile, ti.fluid);
    const callOf = (txt: string) => /^[A-Za-z_]\w*\([^)]*\)/.exec(txt)?.[0];
    const title = k.title ? kb(k.title) : '';
    const usage = USAGE.get(tile.name) ?? '';
    const sig = callOf(usage) ?? callOf(title) ?? tile.name;
    const rest = (txt: string) => { const c = callOf(txt); return (c ? txt.slice(c.length) : txt).replace(/^\s*[:=—-]?\s*/, ''); };
    const what = rest(title) || rest(usage) || tile.say;
    return { sig, what };
  };
  const grid = h('div', { class: 'ti-grid' }, ...pg.tiles.map((tile) => {
    const face = h('span', { class: 'ti-face' }, ...faceRuns(tile.face).map((r) => (r.sub ? h('sub', {}, r.text) : r.text)));
    const b = tapButton(h('button', { type: 'button', class: 'ti-tile', 'aria-label': tileLabel(tile) }, face, h('span', { class: 'ti-name', 'aria-hidden': 'true', hidden: !tileCaption(tile) }, tile.name)));
    const enter = () => { const { sig, what } = helpFor(tile); setNote(sig, what); showTileHelp(tile); };
    const leave = () => { resetNote(); showTileHelp(null); };
    b.addEventListener('click', () => chooseTile(tile));
    b.addEventListener('mouseenter', enter);
    b.addEventListener('focus', enter);
    b.addEventListener('mouseleave', leave);
    b.addEventListener('blur', leave);
    return b;
  }));
  const editor = pg.editor;
  let hero: HTMLElement | null = null;
  if (editor) {
    hero = tapButton(h('button', { type: 'button', class: 'ti-tile ti-editor ti-hero', 'aria-label': editor.label, title: editor.title },
      h('span', { class: 'ti-hero-copy' }, h('span', { class: 'ti-face' }, editor.face), h('span', { class: 'ti-name', 'aria-hidden': 'true' }, editor.name)),
      h('span', { class: 'ti-hero-chev', 'aria-hidden': 'true' }, '›')));
    hero.addEventListener('click', () => { closeThumb(); play('fn'); openBuilder(editor.editor, editor.mode); });
    hero.addEventListener('mouseenter', () => setNote(editor.face, editor.title));
    hero.addEventListener('focus', () => setNote(editor.face, editor.title));
    hero.addEventListener('mouseleave', resetNote);
    hero.addEventListener('blur', resetNote);
  }
  const scroll = h('div', { class: 'ti-scroll' }, hero ?? '', grid);
  tiPage.setAttribute('aria-label', t.pages.length > 1 ? `${t.name}: ${pg.name}` : t.name);
  tiPage.style.setProperty('--tab', `var(--tab-${ti.tab})`);
  tiPage.style.setProperty('--tab-on', `var(--tab-on-${ti.tab})`);
  tiPage.style.setProperty('--tab-name', `var(--tab-name-${ti.tab})`);
  tiPage.replaceChildren(head ? h('div', { class: 'ti-strip' }, head) : '', note, chips ?? '', scroll);
  // After this frame's layout, once the caller has fitted the strip's labels to their width.
  if (head && segFrom) requestAnimationFrame(() => slideSegInk(head, segFrom));
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
export function placeThumbPage(): void {
  if (ti.tab === null || tiPage.hidden) return;
  const desk = !narrow.matches;
  tiPage.style.setProperty('--ti-cols', String(DECK_COLS));
  tiPage.classList.remove('compact');
  tiPage.classList.add('scrolling', 'ti-deck');
  tiPage.style.left = '';
  tiPage.style.right = '';
  tiPage.style.top = '';
  tiPage.style.width = '';
  tiPage.style.height = '';
  tiPage.style.setProperty('--tile-h', desk ? '45px' : '44px');
  fitTiles();
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
  // tiPage is mounted inside #keypad's .pad-stage by buildKeypad(), right below .deck-bar.
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
    else if (e.key === 'ArrowUp') (tiPage.querySelector<HTMLElement>('.ti-seg[aria-selected=true], .ti-chip[aria-checked=true]') ?? deckPadBtn).focus();
  });
}
