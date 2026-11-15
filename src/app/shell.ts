import { play } from './sound';
import { syncers } from './controls';
import { h, iconLabel } from './dom';
import { motionNow } from './feedback';
import { buildMenu } from './file';
import { keypadEl, main, leftPane, graphPane, splitter, mobileNav, graphHost } from './layout';
import { keysToggle } from './listtools';
import { narrow, coarse } from './platform';
import { lineInputMode } from './rows';
import { views, focusLine, isLineField } from './rowviews';
import { barKeypad, barGraph, refreshModeBar } from './settings';
import { doc, saveSoon } from './sheet';
import { closeThumb } from './thumb';
import { finishPresence, initialPresence, presenceOpen, requestPresence } from '../ui/presence';
import { registerMotionSettler } from './motion';

/** The graph is always up beside the notebook, so the window never has a blank half; Hide graph in File is the only way off. */
export function graphOn(): boolean {
  return doc.ui.graph !== false;
}
export function setGraph(show: boolean): void {
  doc.ui.graph = show;
  if (show) doc.ui.graphPinned = true;
  else delete doc.ui.graphPinned;
  applyUI({ glide: true });
  saveSoon();
}
export function keypadOn(): boolean {
  return narrow.matches ? doc.ui.keypad : doc.ui.deskKeypad !== false;
}
export function setKeypad(show: boolean): void {
  if (narrow.matches) doc.ui.keypad = show;
  else doc.ui.deskKeypad = show;
  applyUI({ glide: true });
  saveSoon();
}
let keypadFold: Animation | null = null;
let keypadPresence = initialPresence(true);
keypadEl.dataset.presence = keypadPresence.phase;
function foldKeypad(open: boolean, glide: boolean): void {
  const animate = glide && motionNow() === 'full' && !narrow.matches;
  const next = requestPresence(keypadPresence, open, animate);
  if (next === keypadPresence) return;
  const from = keypadFold ? { height: keypadEl.getBoundingClientRect().height, opacity: Number(getComputedStyle(keypadEl).opacity) } : null;
  keypadPresence = next;
  keypadEl.dataset.presence = next.phase;
  keypadFold?.cancel();
  keypadFold = null;
  keypadEl.style.overflow = '';
  if (!animate) {
    keypadEl.hidden = !open;
    return;
  }
  keypadEl.hidden = false;
  const full = keypadEl.offsetHeight;
  const start = from ?? (open ? { height: 0, opacity: 0 } : { height: full, opacity: 1 });
  const end = open ? { height: full, opacity: 1 } : { height: 0, opacity: 0 };
  keypadEl.style.overflow = 'hidden';
  const anim = keypadEl.animate(
    [{ height: `${start.height}px`, opacity: start.opacity }, { height: `${end.height}px`, opacity: end.opacity }],
    { duration: full > 0 ? Math.max(60, (200 * Math.abs(end.height - start.height)) / full) : 200, easing: open ? 'cubic-bezier(0.2, 0.8, 0.2, 1)' : 'cubic-bezier(0.4, 0, 1, 1)' },
  );
  keypadFold = anim;
  anim.onfinish = () => {
    if (keypadPresence.generation !== next.generation) return;
    keypadPresence = finishPresence(keypadPresence, next.generation);
    keypadEl.dataset.presence = keypadPresence.phase;
    keypadEl.style.overflow = '';
    if (!open) keypadEl.hidden = true;
    keypadFold = null;
  };
  anim.oncancel = () => { if (keypadPresence.generation === next.generation) keypadEl.style.overflow = ''; };
}
let graphPresence = initialPresence(true);
let graphEntry: Animation[] = [];
function cancelGraphEntry(): void {
  for (const animation of graphEntry) animation.cancel();
  graphEntry = [];
  main.style.overflow = '';
}
function settleGraphEntry(show: boolean): void {
  graphPresence = requestPresence(graphPresence, show, false);
  cancelGraphEntry();
  graphPane.dataset.presence = graphPresence.phase;
}
registerMotionSettler(() => {
  foldKeypad(presenceOpen(keypadPresence), false);
  settleGraphEntry(!graphPane.hidden);
});
export function applyUI({ glide = false } = {}): void {
  const onGraph = narrow.matches && doc.ui.view === 'graph';
  const show = graphOn();
  const from = glide && show && main.classList.contains('no-graph') && !narrow.matches && motionNow() === 'full' ? leftPane.getBoundingClientRect().left : null;
  graphPane.hidden = !show && !onGraph;
  splitter.hidden = !show;
  main.classList.toggle('no-graph', !show);
  main.classList.toggle('view-graph', onGraph);
  if (!show || !glide || narrow.matches || motionNow() !== 'full') settleGraphEntry(!graphPane.hidden);
  if (from !== null) {
    cancelGraphEntry();
    graphPresence = requestPresence(graphPresence, true, true);
    const generation = graphPresence.generation;
    graphPane.dataset.presence = graphPresence.phase;
    const dx = from - leftPane.getBoundingClientRect().left;
    const ease = { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
    main.style.overflow = 'clip';
    if (Math.abs(dx) > 1) graphEntry.push(leftPane.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], ease));
    graphEntry.push(graphPane.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], ease));
    void Promise.allSettled(graphEntry.map((a) => a.finished)).then(() => {
      if (graphPresence.generation !== generation) return;
      graphPresence = finishPresence(graphPresence, generation);
      graphPane.dataset.presence = graphPresence.phase;
      graphEntry = [];
      main.style.overflow = '';
    });
  }
  const sysKeyboard = !!doc.ui.sysKeyboard;
  foldKeypad(keypadOn() && !(coarse.matches && sysKeyboard), glide);
  keysToggle.setAttribute('aria-expanded', String(keypadOn()));
  barKeypad.setAttribute('aria-pressed', String(keypadOn()));
  barGraph.setAttribute('aria-pressed', String(show));
  for (const v of views.values()) if (v.input) v.input.inputMode = lineInputMode();
  syncers.forEach((s) => s());
  if (onGraph || !keypadOn() || (coarse.matches && sysKeyboard)) closeThumb();
  refreshModeBar();
  syncMobileNav();
  buildMenu();
}
const navCalc = h('button', { type: 'button', class: 'nav-view', 'aria-pressed': 'true' }, 'Calculate');
const navGraph = h('button', { type: 'button', class: 'nav-view' }, 'Graph');
const navKeys = h('button', { type: 'button', class: 'nav-keys', title: 'Switch between the keypad and the system keyboard' }, ...iconLabel('keys', 'ABC'));
export function setView(view: 'calc' | 'graph'): void {
  if (doc.ui.view !== view) play('toggle');
  doc.ui.view = view;
  saveSoon();
  applyUI();
  if (view === 'graph') graphHost.focus({ preventScroll: true });
  else focusLine();
}
function syncMobileNav(): void {
  const chose = doc.ui.view === 'graph';
  navCalc.setAttribute('aria-pressed', String(!chose));
  navGraph.setAttribute('aria-pressed', String(chose));
  navKeys.querySelector('.gl')!.textContent = doc.ui.sysKeyboard ? 'Keys' : 'ABC';
  navKeys.setAttribute('aria-label', doc.ui.sysKeyboard ? 'Use the keypad' : 'Use the system keyboard');
  navKeys.setAttribute('aria-pressed', String(!!doc.ui.sysKeyboard));
  navKeys.hidden = !coarse.matches || chose;
}

export function initShell(): void {
  mobileNav.append(h('div', { class: 'nav-seg', role: 'group', 'aria-label': 'Pane' }, navCalc, navGraph), h('span', { class: 'spacer' }), navKeys);
  navCalc.addEventListener('click', () => setView('calc'));
  navGraph.addEventListener('click', () => setView('graph'));
  navKeys.addEventListener('click', () => {
    doc.ui.sysKeyboard = !doc.ui.sysKeyboard;
    play('toggle');
    saveSoon();
    applyUI();
    // Refocus so the keyboard appears or goes away right now.
    const active = document.activeElement as HTMLElement | null;
    if (isLineField(active)) { active.blur(); active.focus(); }
    else focusLine();
  });
  narrow.addEventListener('change', () => {
    if (!narrow.matches) doc.ui.view = 'calc';
    applyUI();
  });
  coarse.addEventListener('change', () => applyUI());
}
