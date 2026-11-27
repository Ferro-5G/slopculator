import { isEmptyLine } from '../ui/document';
import { EDGE_CLEAR, edgeCovers } from '../ui/listedges';
import { motionNow } from './feedback';
import { listEl, tape, coverTop, coverBottom } from './layout';
import { narrow } from './platform';
import { views } from './rowviews';
import { doc } from './sheet';
import { registerMotionSettler } from './motion';

const markListEdges = () => {
  const top = listEl.scrollTop;
  tape.classList.toggle('scrolled', top > 2);
  tape.classList.toggle('more', top + listEl.clientHeight < listEl.scrollHeight - 2);
};
/**
 * Whether the sheet counts as fitting, so nothing scrolls and no paper is added: every line ends inside the list, or on
 * a phone all but the trailing empty line do and that line is cut by less than a row (48 px). Revealing it there would
 * only push line 1 out of sight and leave empty paper under the last line.
 */
const SHEET_SLACK = 48;
const sheetFits = (): boolean => {
  // Skip absolute canvas overlays (wires SVG, tag layer, example frame) so the actual last block is measured.
  let last: HTMLElement | null = null;
  for (let i = listEl.children.length - 1; i >= 0; i--) {
    const el = listEl.children[i];
    if (el instanceof HTMLElement && !el.hidden && el.offsetHeight > 0 && getComputedStyle(el).position !== 'absolute') {
      last = el;
      break;
    }
  }
  if (!last) return true;
  const base = listEl.getBoundingClientRect().top - listEl.scrollTop;
  // The free-scrolling column (the phone's, under its floating header) keeps its foot clear of the composer too, as
  // the phones' list does; elsewhere the foot is --end-pad's to size.
  const cs = getComputedStyle(listEl);
  const foot = cs.scrollSnapType === 'none' ? parseFloat(cs.paddingBottom) || 0 : 0;
  const over = last.getBoundingClientRect().bottom + foot - base - listEl.clientHeight;
  if (over <= 1) return true;
  const row = doc.rows[doc.rows.length - 1];
  const trailingEmpty = row && isEmptyLine(row) && views.get(row.id)?.el === last;
  return narrow.matches && trailingEmpty && over < SHEET_SLACK;
};
const padListEnd = () => {
  const was = parseFloat(listEl.style.getPropertyValue('--end-pad')) || 0;
  const max = listEl.scrollHeight - was - listEl.clientHeight;
  let pad = 0;
  if (sheetFits()) {
    if (was) listEl.style.setProperty('--end-pad', '0px');
    if (listEl.scrollTop) listEl.scrollTop = 0;
    return;
  }
  if (max > 0) {
    const base = listEl.getBoundingClientRect().top - listEl.scrollTop;
    for (const r of listEl.children as HTMLCollectionOf<HTMLElement>) {
      const t = r.getBoundingClientRect().top - base - (parseFloat(getComputedStyle(r).scrollMarginTop) || 0);
      if (t >= max - 0.5) { pad = t - max; break; }
    }
    if (pad > listEl.clientHeight / 2) pad = 0;
  }
  if (Math.abs(pad - was) > 0.5) listEl.style.setProperty('--end-pad', `${pad.toFixed(1)}px`);
};
/**
 * At rest after a scroll, the top edge settles on a line boundary: a line cut by it backs up into view if at least
 * half of it shows, otherwise the list moves on to the next line (settleTop). At the bottom edge, a line showing less
 * than a sliver (ui/listedges.ts) goes under a band of the list's own background with the edge's shadow on its inner side; one showing
 * more stays, clipped under the shadow, as "more below". The top band is only a fallback for a sliver settling
 * couldn't take away. No band is ever taller than that. The bands lift while the list moves (a drag or a fling),
 * so nothing pops in mid-motion, and come back once it settles. The starter's heading and cards count as lines.
 */
/**
 * What the list is doing, in one place, changed only by listEvent (and shown as the list's data-scroll):
 * - rest: still. The only state that shows the edge bands.
 * - touch: a finger is down and the list hasn't moved under it yet (a tap, or a drag about to start).
 * - drag: a finger is down and the list has moved under it.
 * - user: a person's scroll (a wheel, keys, the scrollbar, a fling) is still moving. It settles once it stops.
 * - code: the app scrolled it (revealing a line). That never settles.
 * - settling: the glide onto a line boundary.
 */
type ListState = 'rest' | 'touch' | 'drag' | 'user' | 'code' | 'settling';
type ListEvent = 'intent' | 'scroll' | 'quiet' | 'touchstart' | 'lift' | 'settled';
let listState: ListState = 'rest';
/**
 * Until when a scroll counts as the person's: a wheel turn, a key or a press on the scrollbar only says they mean to
 * scroll. It counts once the list actually moves, so one that moves nothing (a wheel at the top) settles nothing.
 */
let intentUntil = 0;
let settleTimer = 0;
let settleFrame = 0;
let settleDestination: number | null = null;
const listUnits = (): HTMLElement[] =>
  ([...listEl.children] as HTMLElement[]).flatMap((el) => (el.classList.contains('starter') ? [...el.querySelectorAll<HTMLElement>('.starter-head, .starter-card')] : [el]));
function placeCovers(): void {
  let t = 0, b = 0;
  if (listState === 'rest' && listEl.clientHeight > 0) {
    const top = listEl.getBoundingClientRect().top + listEl.clientTop;
    const bottom = top + listEl.clientHeight;
    ({ top: t, bottom: b } = edgeCovers(listUnits().map((el) => el.getBoundingClientRect()), top, bottom));
    const origin = tape.getBoundingClientRect().top + tape.clientTop;
    if (t > 0) Object.assign(coverTop.style, { top: `${top - origin}px`, height: `${t}px` });
    if (b > 0) Object.assign(coverBottom.style, { top: `${bottom - b - origin}px`, height: `${b}px` });
  }
  coverTop.classList.toggle('on', t > 0);
  coverBottom.classList.toggle('on', b > 0);
  tape.classList.toggle('covered', b > 0);
}
function settleTarget(): number | null {
  // A list that scrolls freely (the phone column under its floating header, as the phone apps' does) rests where it's left.
  if (getComputedStyle(listEl).scrollSnapType === 'none') return null;
  const cur = listEl.scrollTop;
  const view = listEl.clientHeight;
  const max = listEl.scrollHeight - view;
  if (cur < 1 || cur > max - 1 || view < 1) return null;
  const base = listEl.getBoundingClientRect().top + listEl.clientTop - cur;
  const tops = [...new Set(listUnits().filter((el) => el.offsetHeight > 0).map((el) => {
    const margin = el.parentElement === listEl ? parseFloat(getComputedStyle(el).scrollMarginTop) || 0 : 0;
    return Math.round(el.getBoundingClientRect().top - base - margin);
  }))].sort((x, y) => x - y);
  let above = -Infinity, below = Infinity;
  for (const t of tops) {
    if (t <= cur + 0.5) above = t;
    else { below = t; break; }
  }
  if (Math.abs(cur - above) <= 0.5 || !Number.isFinite(above) || !Number.isFinite(below)) return null;
  if (below - above > view) return null;
  const to = below - cur >= (below - above) / 2 ? above : below;
  return Math.max(0, Math.min(to, max));
}
const endSettle = () => {
  cancelAnimationFrame(settleFrame);
  settleFrame = 0;
  settleDestination = null;
  listEl.classList.remove('settling');
};
/** Returns whether it started; listEvent('settled') ends it. */
function settleTop(): boolean {
  const to = settleTarget();
  if (to === null) return false;
  settleDestination = to;
  const from = listEl.scrollTop;
  // Snapping would pull the glide's in-between positions back to a line, so it's off until the list lands.
  listEl.classList.add('settling');
  if (motionNow() !== 'full') {
    listEl.scrollTop = to;
    // Snapping comes back a frame after the jump has landed, not in the same task, or it snaps again from the start.
    settleFrame = requestAnimationFrame(() => (settleFrame = requestAnimationFrame(() => listEvent('settled'))));
    return true;
  }
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / 180);
    listEl.scrollTop = from + (to - from) * (1 - Math.pow(1 - k, 3));
    if (k < 1) settleFrame = requestAnimationFrame(step);
    else listEvent('settled');
  };
  settleFrame = requestAnimationFrame(step);
  return true;
}
/** scrollend says when a fling and its snap are done. The timer covers browsers without it. */
const QUIET_MS = 'onscrollend' in window ? 600 : 160;
const userIntends = () => performance.now() < intentUntil;
function listEvent(ev: ListEvent): void {
  const was = listState;
  switch (ev) {
    case 'intent':
      intentUntil = Math.max(intentUntil, performance.now() + 250);
      if (listState === 'settling') {
        endSettle();
        listState = 'user';
        armQuiet();
      }
      break;
    case 'scroll':
      if (listState === 'rest' || listState === 'code') listState = userIntends() ? 'user' : 'code';
      // A tap that focuses a line can scroll it into view under the finger; only a moving finger makes a drag.
      else if (listState === 'touch' && userIntends()) listState = 'drag';
      armQuiet();
      break;
    case 'quiet':
      clearTimeout(settleTimer);
      settleTimer = 0;
      if (intentUntil !== Infinity) intentUntil = 0;
      if (listState === 'user') listState = settleTop() ? 'settling' : 'rest';
      else if (listState === 'code') listState = 'rest';
      break;
    case 'touchstart':
      if (listState === 'settling') endSettle();
      listState = 'touch';
      break;
    case 'lift':
      if (listState === 'touch') listState = 'rest';
      else if (listState === 'drag') {
        listState = 'user';
        if (!settleTimer) return listEvent('quiet');
      }
      break;
    case 'settled':
      if (listState !== 'settling') break;
      endSettle();
      listState = 'rest';
      break;
  }
  if (listState !== was) {
    listEl.dataset.scroll = listState;
    placeCovers();
  }
}
function armQuiet(): void {
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => listEvent('quiet'), QUIET_MS);
}
registerMotionSettler(() => {
  if (listState !== 'settling') return;
  if (settleDestination !== null) listEl.scrollTop = settleDestination;
  listEvent('settled');
});
export const syncListEdges = () => {
  padListEnd();
  markListEdges();
  placeCovers();
};
let coverFrame = 0;
export function revealRow(el: HTMLElement): void {
  padListEnd();
  if (sheetFits()) {
    placeCovers();
    return;
  }
  const rows = [...listEl.children] as HTMLElement[];
  const k = rows.indexOf(el);
  if (k < 0) return;
  const base = listEl.getBoundingClientRect().top - listEl.scrollTop;
  const top = (r: HTMLElement) => r.getBoundingClientRect().top - base - parseFloat(getComputedStyle(r).scrollMarginTop || '0');
  const rowTop = el.getBoundingClientRect().top - base;
  const rowBottom = rowTop + el.offsetHeight;
  const view = listEl.clientHeight;
  const cur = listEl.scrollTop;
  let to = cur;
  // Near the top edge, measured from where a line comes to rest there (its scroll margin: under a floating header).
  if (top(el) < cur + EDGE_CLEAR) {
    const prev = rows[k - 1];
    to = prev && top(el) - top(prev) <= view / 3 ? top(prev) : top(el);
  } else if (rowBottom > cur + view - EDGE_CLEAR) {
    const want = rowBottom + EDGE_CLEAR - view;
    to = top(el);
    for (const r of rows.slice(0, k + 1)) {
      const t = top(r);
      if (t >= want) { to = t; break; }
    }
  }
  to = Math.max(0, Math.min(to, listEl.scrollHeight - view));
  if (Math.abs(to - cur) > 1) listEl.scrollTop = to;
  else placeCovers();
}

export function initListscroll(): void {
  listEl.addEventListener('scroll', () => {
    markListEdges();
    listEvent('scroll');
  }, { passive: true });
  listEl.addEventListener('scrollend', () => listEvent('quiet'));
  listEl.addEventListener('wheel', () => listEvent('intent'), { passive: true });
  listEl.addEventListener('touchmove', () => listEvent('intent'), { passive: true });
  listEl.addEventListener('keydown', (e) => {
    if (['PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key) && !(e.target as HTMLElement).matches('input, textarea, [contenteditable]')) listEvent('intent');
  });
  // A press on the list itself, not a line, is its scrollbar. Its drag can pause, so the intent lasts until release.
  listEl.addEventListener('pointerdown', (e) => {
    if (e.target !== listEl) return;
    listEvent('intent');
    intentUntil = Infinity;
  }, { passive: true });
  const releasePointer = (e: PointerEvent) => {
    if (intentUntil === Infinity) intentUntil = performance.now() + 250;
    // A tap on a line that removes it (its delete button) loses the touchend, but its pointerup/pointercancel still comes here.
    if (e.pointerType === 'touch' && e.isPrimary) listEvent('lift');
  };
  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
  listEl.addEventListener('animationend', () => {
    cancelAnimationFrame(coverFrame);
    coverFrame = requestAnimationFrame(placeCovers);
  });
  // A finger resting on the list may be about to drag it, so the bands wait for it to lift. The lift is caught on the
  // window, so a finger that ends on another element, or after its line was removed, still counts.
  listEl.addEventListener('touchstart', () => listEvent('touchstart'), { passive: true });
  for (const ev of ['touchend', 'touchcancel'] as const)
    window.addEventListener(ev, (e) => { if (!e.touches.length) listEvent('lift'); }, { passive: true });
  // Its border box, so the end padding set here doesn't wake it again.
  new ResizeObserver(syncListEdges).observe(listEl, { box: 'border-box' });
}
