import { addPopover, closePopovers } from './overlay';
import { CHOICES, SWITCHES } from '../ui/modes';
import { ROUND_SLIDER_MAX, roundToSlider, roundShort } from '../ui/rounding';
import { play } from './sound';
import { syncers, seg, toggle, MODES, setMode, bindRound } from './controls';
import { h, iconLabel, roving } from './dom';
import { motionNow } from './feedback';
import { setMenu, menuWrap } from './file';
import { modeBar, leftPane, app, main } from './layout';
import { openPalette } from './palette';
import { kb, narrow, isMac } from './platform';
import { views, isLineField } from './rowviews';
import { doc, activeId } from './sheet';
import { setKeypad, keypadOn, setGraph, graphOn } from './shell';
import { appearBody } from './theme';
import { PresenceMotion } from './motion';

const roundSlider = h('input', { type: 'range', class: 'slider round-slider', min: '0', max: String(ROUND_SLIDER_MAX), step: '1', 'aria-label': 'Rounding', title: 'Rounding for every result and for copying' }) as HTMLInputElement;
const roundOut = h('output', { class: 'round-out' });
/** The bar and its menu have less room than the sheet: [what the group is called, the short word for each side]. */
const SEG_WORDS = {
  angle: ['Angle unit', 'Deg', 'Rad'],
  answers: ['Display', 'Dec', 'Exact'],
  huge: ['Huge answers', 'Short', 'Every digit'],
  sd: ['Standard deviation', 'Pop', 'Sample'],
  addPercent: ['Adding a percent', '92', '80.15'],
  working: ['Working', 'Show', 'Hide'],
} satisfies Record<keyof typeof CHOICES, [string, string, string]>;
const segWord = (id: keyof typeof CHOICES) => () => SEG_WORDS[id][MODES[id].on() ? 1 : 2];
function modeSeg(id: keyof typeof CHOICES): HTMLElement {
  const [label, a, b] = SEG_WORDS[id], m = MODES[id];
  return seg(label, a, b, m.on, (v) => setMode(m, v), m.key ?? '');
}
function modeToggle(id: keyof typeof MODES, name: string, title: string): HTMLElement {
  const m = MODES[id];
  const b = toggle(name, m.on, (v) => setMode(m, v), title);
  b.dataset.mode = id;
  return b;
}
const PERCENT_TITLE = 'Adding a percent. 92: 15% of 80 is added. 80.15: 15% is read as 0.15';
const WORKING_TITLE = 'Angle units under trig answers, substituted formulas, the unit circle drawing and asymptote lines. Answers are the same either way.';
function percentSeg(): HTMLElement {
  const el = modeSeg('addPercent');
  el.title = PERCENT_TITLE;
  for (const b of el.querySelectorAll('button')) b.removeAttribute('title');
  return el;
}
const modeMenu = h('div', { class: 'menu mode-menu', role: 'group', 'aria-label': 'Modes', hidden: true },
  h('div', { class: 'mode-row', 'data-bar': 'angle' }, h('span', {}, 'Angle'), modeSeg('angle')),
  h('div', { class: 'mode-row', 'data-bar': 'answers' }, h('span', {}, 'Answers'), modeSeg('answers')),
  h('div', { class: 'mode-row' }, h('span', {}, 'Huge answers'), modeSeg('huge')),
  h('div', { class: 'mode-row', 'data-bar': 'sd' }, h('span', {}, 'Std dev'), modeSeg('sd')),
  h('div', { class: 'mode-row pct-row', title: PERCENT_TITLE }, h('span', {}, '80 + 15% ='), percentSeg()),
  h('div', { class: 'mode-row', title: WORKING_TITLE }, h('span', {}, 'Working'), modeSeg('working')),
  h('div', { class: 'mode-row toggles', 'data-bar': 'percent letters complex' }, h('span', {}, 'Also'), h('div', { class: 'togs' },
    modeToggle('percent', '%', 'Show probabilities as percents (Ctrl+Alt+P)'),
    modeToggle('letters', 'A=line', 'Line letters: line 1 is A, line 2 is B, … (Ctrl+Alt+L)'),
    modeToggle('complex', 'a+bi', 'Complex numbers: √(−1) = i'),
  )),
  h('div', { class: 'mode-row' }, h('span', {}, 'Rounding'), h('label', { class: 'round-wrap' }, roundSlider, roundOut)),
);
function closeModeMenu(): void {
  modeMenu.hidden = true;
  modeMenuAnchor?.setAttribute('aria-expanded', 'false');
  modesEl.querySelectorAll('.pill').forEach((p) => p.setAttribute('aria-expanded', 'false'));
}
let modeMenuAnchor: HTMLElement | null = null;
function openModeMenu(anchor: HTMLElement, focus: string): void {
  closePopovers();
  modeMenuAnchor = anchor;
  for (const row of modeMenu.querySelectorAll<HTMLElement>('.mode-row')) {
    const on = (row.dataset.bar ?? '').split(' ').filter(Boolean).map((k) => barModes[k as keyof typeof barModes]);
    row.hidden = anchor === deskMore && on.length > 0 && on.every((el) => !el.hidden && !!el.offsetParent);
  }
  const r = anchor.getBoundingClientRect();
  modeMenu.hidden = false;
  const w = modeMenu.offsetWidth, hgt = modeMenu.offsetHeight;
  modeMenu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  modeMenu.style.top = `${r.bottom + 6 + hgt > window.innerHeight ? Math.max(8, r.top - 6 - hgt) : r.bottom + 6}px`;
  anchor.setAttribute('aria-expanded', 'true');
  const target = modeMenu.querySelector<HTMLElement>(focus);
  (target?.matches('[aria-pressed=true]') ? target : target?.querySelector<HTMLElement>('[aria-pressed=true]') ?? target)?.focus();
}
type ModePill = { el: HTMLButtonElement; text: () => string; on: () => boolean; show: () => boolean };
const modePills: ModePill[] = [];
const pill = (title: string, text: () => string, on: () => boolean, show: () => boolean, focus: string, menu = false) => {
  const el = h('button', { type: 'button', class: menu ? 'pill menu-pill' : 'pill', title: kb(title), 'aria-haspopup': 'true', 'aria-expanded': 'false' });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!modeMenu.hidden) { closeModeMenu(); return; }
    setMenu(false);
    openModeMenu(el, focus);
  });
  modePills.push({ el, text, on, show });
  return el;
};
// The toggles come first, so one turning on or off never shifts the three menus beside File.
const modesEl = h('div', { class: 'modes', role: 'group', 'aria-label': 'Modes' },
  pill('Probabilities as percents (Ctrl+Alt+P)', () => '%', () => true, MODES.percent.on, '.togs [data-mode=percent]'),
  pill('Line letters (Ctrl+Alt+L)', () => 'A=line', () => true, MODES.letters.on, '.togs [data-mode=letters]'),
  pill('Complex numbers', () => 'a+bi', () => true, MODES.complex.on, '.togs [data-mode=complex]'),
  pill('Rounding', () => roundShort(doc.display.places), () => true, () => doc.display.places !== null, '.round-slider'),
  pill('Angle unit (Ctrl+Alt+D)', segWord('angle'), () => false, () => true, ".mode-row[data-bar='angle'] .seg", true),
  pill('Decimal or exact answers (Ctrl+Alt+E)', segWord('answers'), () => false, () => true, ".mode-row[data-bar='answers'] .seg", true),
  pill('Population or sample standard deviation (Ctrl+Alt+M)', segWord('sd'), () => false, () => true, ".mode-row[data-bar='sd'] .seg", true),
);
function syncModes(): void {
  for (const p of modePills) {
    p.el.textContent = p.text();
    p.el.classList.toggle('on', p.on());
    p.el.hidden = !p.show();
  }
}
// The wide bar: the name, then Deg|Rad, Dec|Exact and Pop|Sample, the Percent, Line letters and Complex switches and the Round chip,
// then Appearance, Keypad, Graph, File and ?. A window too narrow for them all folds the lowest first (Round, a+bi,
// A=line, %, Pop|Sample, Dec|Exact, Deg|Rad) out of the bar; Modes opens every mode, those included. The phone keeps
// its pills and its sheet.
const barRound = h('input', { type: 'range', class: 'slider round-slider bar-round-slider', min: '0', max: String(ROUND_SLIDER_MAX), step: '1', 'aria-label': 'Rounding', title: 'Rounding for every result and for copying' }) as HTMLInputElement;
const barRoundOut = h('output', { class: 'round-out' });
const roundChipText = h('span', {}, 'Round: Auto');
const roundPop = h('div', { class: 'round-pop', role: 'dialog', 'aria-label': 'Rounding', hidden: true }, h('label', { class: 'bar-round' }, h('span', {}, 'Round'), barRound, barRoundOut));
const roundChip = h('button', { type: 'button', class: 'tog round-chip', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Rounding for every result and for copying' }, roundChipText);
// The bar clips what overflows it (that's how items fold), so the popover sits on the page under the chip.
const setRoundPop = (open: boolean) => {
  if (open && !roundPop.isConnected) document.body.append(roundPop);
  if (open) {
    const r = roundChip.getBoundingClientRect();
    roundPop.style.top = `${Math.round(r.bottom + 6)}px`;
    roundPop.style.left = `${Math.round(Math.min(r.left, innerWidth - parseFloat(getComputedStyle(roundPop).getPropertyValue('--round-pop-w')) - 12))}px`;
  }
  roundPop.hidden = !open;
  roundChip.setAttribute('aria-expanded', String(open));
  if (open) barRound.focus({ preventScroll: true });
};
const foldable = (el: HTMLElement, fold: number) => { el.dataset.fold = String(fold); el.classList.add('bar-mode'); return el; };
const longLabel = (el: HTMLElement, short: string, rest: string) => { el.replaceChildren(short, h('span', { class: 'long' }, rest)); return el; };
const barModes = {
  angle: foldable(modeSeg('angle'), 7),
  answers: foldable(modeSeg('answers'), 6),
  sd: foldable(modeSeg('sd'), 5),
  // Words a newcomer can read; the old shorthand (%, A=line, a+bi) is in each one's title.
  percent: foldable(modeToggle('percent', 'Percent', 'Percent (%): show probabilities as percents (Ctrl+Alt+P)'), 4),
  letters: foldable(modeToggle('letters', 'Line letters', 'Line letters (A=line): line 1 is A, line 2 is B, … (Ctrl+Alt+L)'), 3),
  complex: foldable(longLabel(modeToggle('complex', 'Complex', 'Complex numbers (a+bi): √(−1) = i'), 'Complex', ' numbers'), 2),
};
const deskModes = h('div', { class: 'desk-modes', role: 'group', 'aria-label': 'Modes' },
  barModes.angle, barModes.answers, barModes.sd,
  h('span', { class: 'bar-gap', 'aria-hidden': 'true' }),
  barModes.percent, barModes.letters, barModes.complex,
  h('span', { class: 'bar-gap', 'aria-hidden': 'true' }),
  foldable(roundChip, 1),
);
// A menu button, so it says so with its ▾ and isn't mistaken for one of the toggles beside it.
const deskMore = h('button', { type: 'button', class: 'pill desk-more', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'More modes: huge answers, adding a percent and rounding, and any the bar has no room for' }, 'Modes');
export const barKeypad = h('button', { type: 'button', class: 'bar-tog', 'aria-controls': 'keypad', title: kb('Show or hide the keypad (Ctrl+Alt+Shift+K)'), onclick: () => { play('toggle'); setKeypad(!keypadOn()); } }, 'Keypad');
export const barGraph = h('button', { type: 'button', class: 'bar-tog', title: kb('Show or hide the graph (Ctrl+Alt+Shift+G)'), onclick: () => { play('toggle'); setGraph(!graphOn()); } }, 'Graph');
export const refitBar = () => requestAnimationFrame(fitBar);

export function fitBar(): void {
  if (narrow.matches) return;
  const items = ([...deskModes.querySelectorAll<HTMLElement>('.bar-mode')]).sort((a, b) => Number(a.dataset.fold) - Number(b.dataset.fold));
  for (const el of items) el.hidden = false;
  deskModes.classList.remove('short');
  const fits = () => modeBar.scrollWidth <= modeBar.clientWidth + 1;
  if (!fits()) deskModes.classList.add('short');
  for (const el of items) {
    if (fits()) break;
    el.hidden = true;
  }
  for (const gap of deskModes.querySelectorAll<HTMLElement>('.bar-gap')) {
    const before = [...deskModes.children].slice(0, [...deskModes.children].indexOf(gap)).some((c) => c.classList.contains('bar-mode') && !(c as HTMLElement).hidden);
    const after = [...deskModes.children].slice([...deskModes.children].indexOf(gap) + 1).some((c) => c.classList.contains('bar-mode') && !(c as HTMLElement).hidden);
    gap.hidden = !before || !after;
  }
}
function placeBar(): void {
  if (narrow.matches) { if (modeBar.parentElement !== leftPane) leftPane.prepend(modeBar); }
  else if (modeBar.parentElement !== app) app.insertBefore(modeBar, main);
  refitBar();
}
const headFind = h('button', { type: 'button', class: 'head-find', 'aria-label': 'Find a function', 'aria-keyshortcuts': isMac ? 'Meta+K' : 'Control+K', title: kb('Find a function or command (Ctrl+K)'), onclick: () => openPalette() }, ...iconLabel('search', 'Find'));
export const headPill = h('div', { class: 'head-pill', role: 'group', 'aria-label': 'Find and file' });
export const SLIDERS_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 4.5h7M12.5 4.5H14M2 11.5h1.5M7 11.5h7"/><circle cx="10.75" cy="4.5" r="1.75"/><circle cx="5.25" cy="11.5" r="1.75"/></svg>';
const modesMore = h('button', { type: 'button', class: 'pill more', 'aria-label': 'Modes', 'aria-haspopup': 'dialog', title: 'Modes' });
function choice(label: string, a: [string, string], b: [string, string], isA: () => boolean, set: (a: boolean) => void): HTMLElement {
  const opt = ([name, hint]: [string, string], v: boolean) => {
    const el = h('button', { type: 'button', role: 'radio' }, h('span', { class: 'name' }, name), h('span', { class: 'hint' }, hint));
    el.addEventListener('click', () => { if (isA() !== v) { play('toggle'); set(v); } });
    return el;
  };
  const ea = opt(a, true), eb = opt(b, false);
  const box = h('div', { class: 'choice', role: 'radiogroup', 'aria-label': label }, ea, eb);
  const sync = () => {
    ea.setAttribute('aria-checked', String(isA()));
    eb.setAttribute('aria-checked', String(!isA()));
    box.classList.toggle('b', !isA());
  };
  syncers.push(sync);
  sync();
  return h('section', { class: 'ms-group' }, h('h3', {}, label), box);
}
function switchRow(name: string, hint: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const el = h('button', { type: 'button', role: 'switch', class: 'ms-switch' },
    h('span', { class: 'ms-text' }, h('span', { class: 'name' }, name), h('span', { class: 'hint' }, hint)),
    h('span', { class: 'knob', 'aria-hidden': 'true' }));
  el.addEventListener('click', () => { play('toggle'); set(!get()); });
  const sync = () => el.setAttribute('aria-checked', String(get()));
  syncers.push(sync);
  sync();
  return el;
}
const sheetRound = h('input', { type: 'range', class: 'ms-round', min: '0', max: String(ROUND_SLIDER_MAX), step: '1', 'aria-label': 'Rounding' }) as HTMLInputElement;
const sheetRoundOut = h('output', { class: 'ms-round-out' });
const modeSheetDone = h('button', { type: 'button', class: 'ms-done' }, 'Done');
const msAppear = h('section', { class: 'ms-group ms-appear' }, h('h3', {}, 'Appearance'));
const modeSheet = h('div', { class: 'mode-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Modes', hidden: true },
  h('div', { class: 'ms-grab', 'aria-hidden': 'true' }),
  h('header', {}, h('h2', {}, 'Modes'), modeSheetDone),
  h('div', { class: 'ms-body' },
    ...(Object.keys(CHOICES) as (keyof typeof CHOICES)[]).map((id) => choice(CHOICES[id].title, CHOICES[id].a, CHOICES[id].b, MODES[id].on, (v) => setMode(MODES[id], v))),
    h('section', { class: 'ms-group' }, h('h3', {}, 'Also'), h('div', { class: 'ms-list' },
      ...(Object.keys(SWITCHES) as (keyof typeof SWITCHES)[]).map((id) => switchRow(SWITCHES[id].title, SWITCHES[id].hint, MODES[id].on, (v) => setMode(MODES[id], v))),
    )),
    h('section', { class: 'ms-group' }, h('h3', {}, 'Rounding', sheetRoundOut),
      h('div', { class: 'ms-round-wrap' }, sheetRound, h('div', { class: 'ms-round-ends', 'aria-hidden': 'true' }, h('span', {}, 'Auto'), h('span', {}, String(ROUND_SLIDER_MAX - 1))))),
    msAppear,
  ),
);
const modeScrim = h('div', { class: 'mode-scrim', hidden: true });
let modeSheetReturn: HTMLElement | null = null;
let modeSheetInert: HTMLElement[] = [];
function modeSheetKeys(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeModeSheet();
  } else if (e.key === 'Tab') {
    const stops = [...modeSheet.querySelectorAll<HTMLElement>('button, input, select')].filter((el) => !el.closest('[hidden]'));
    if (!stops.length) return;
    const first = stops[0], last = stops[stops.length - 1];
    const at = document.activeElement;
    if (e.shiftKey ? at === first || !modeSheet.contains(at) : at === last || !modeSheet.contains(at)) {
      e.preventDefault();
      e.stopPropagation();
      (e.shiftKey ? last : first).focus();
    }
  }
}
const modeSheetMotion = new PresenceMotion([modeSheet, modeScrim], (phase) => {
  modesMore.setAttribute('aria-expanded', String(phase === 'opening' || phase === 'open'));
  if (phase !== 'closed') return;
  window.removeEventListener('keydown', modeSheetKeys, true);
  for (const el of modeSheetInert) el.inert = false;
  modeSheetInert = [];
  if (modeSheetReturn?.isConnected && !isLineField(modeSheetReturn)) modeSheetReturn.focus({ preventScroll: true });
  modeSheetReturn = null;
});
function openModeSheet(): void {
  if (modeSheetMotion.open) return;
  play('toggle');
  closePopovers();
  msAppear.append(appearBody);
  if (modeSheetMotion.phase === 'closed') {
    modeSheetReturn = document.activeElement as HTMLElement | null;
    if (isLineField(modeSheetReturn)) modeSheetReturn.blur();
    modeSheetInert = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== modeSheet && el !== modeScrim && !el.inert);
    for (const el of modeSheetInert) el.inert = true;
  }
  window.addEventListener('keydown', modeSheetKeys, true);
  modeSheetMotion.set(true, motionNow() === 'full');
  modeSheet.querySelector<HTMLElement>('[aria-checked=true]')?.focus({ preventScroll: true });
}
function closeModeSheet(): void {
  if (modeSheetMotion.open) modeSheetMotion.set(false, motionNow() === 'full');
}
export const refreshModeBar = roving(modeBar, '.brand-home, .sheet-title,.desk-modes .seg button, .desk-modes .tog, .bar-round-slider, .pill, .bar-tog, .appear-btn, .head-find, .menu-btn, .help-btn');

export function initSettings(): void {
  addPopover({ close: closeModeMenu, exclusive: true, outside: true });
  addPopover({ close: () => { if (!roundPop.hidden) setRoundPop(false); }, outside: true });
  bindRound(roundSlider, (pl) => { roundOut.textContent = roundShort(pl); });
  document.body.append(modeMenu);
  modeMenu.addEventListener('click', (e) => e.stopPropagation());
  modeMenu.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !modeMenu.contains(e.relatedTarget as Node)) closeModeMenu();
  });
  modeMenu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeModeMenu();
      (modeMenuAnchor?.offsetParent ? modeMenuAnchor : views.get(activeId ?? '')?.input)?.focus();
    }
  });
  syncers.push(syncModes);
  syncModes();
  modeBar.insertBefore(modesEl, menuWrap);
  addEventListener('resize', () => { if (!roundPop.hidden) setRoundPop(false); });
  roundChip.addEventListener('click', (e) => { e.stopPropagation(); setRoundPop(!!roundPop.hidden); });
  roundPop.addEventListener('click', (e) => e.stopPropagation());
  roundPop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRoundPop(false); roundChip.focus(); } });
  bindRound(barRound, (pl) => {
    barRoundOut.textContent = roundShort(pl);
    roundChipText.textContent = `Round: ${roundShort(pl)}`;
  });
  deskMore.insertAdjacentHTML('beforeend', '<svg class="menu-chev" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.25 8 9.75l3.5-3.5"/></svg>');
  deskMore.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!modeMenu.hidden) { closeModeMenu(); return; }
    setMenu(false);
    openModeMenu(deskMore, '.mode-row:not([hidden]) .seg');
  });
  // Right after the name; the spacer then pushes Appearance, Keypad, Graph, File and ? to the right edge.
  const barSpacer = modeBar.querySelector('.spacer')!;
  modeBar.insertBefore(deskModes, barSpacer);
  modeBar.insertBefore(deskMore, barSpacer);
  modeBar.insertBefore(barKeypad, menuWrap);
  modeBar.insertBefore(barGraph, menuWrap);
  new ResizeObserver(() => fitBar()).observe(modeBar);
  narrow.addEventListener('change', placeBar);
  placeBar();
  modeBar.insertBefore(headPill, menuWrap);
  headPill.append(headFind, menuWrap);
  modesMore.innerHTML = SLIDERS_ICON;
  modesMore.addEventListener('click', (e) => {
    e.stopPropagation();
    if (narrow.matches) openModeSheet();
    else if (!modeMenu.hidden) closeModeMenu();
    else {
      setMenu(false);
      openModeMenu(modesMore, ".mode-row[data-bar='angle'] .seg");
    }
  });
  modesEl.append(modesMore);
  bindRound(sheetRound, (pl) => {
    sheetRound.style.setProperty('--fill', `${(roundToSlider(pl) / ROUND_SLIDER_MAX) * 100}%`);
    sheetRoundOut.textContent = pl === null ? 'Auto' : pl === 0 ? 'Whole numbers' : `${pl} decimal place${pl === 1 ? '' : 's'}`;
  }, (next) => { if (next !== doc.display.places) play('detent'); });
  document.body.append(modeScrim, modeSheet);
  modeSheet.addEventListener('click', (e) => e.stopPropagation());
  modeSheetDone.addEventListener('click', closeModeSheet);
  modeScrim.addEventListener('click', (e) => { e.stopPropagation(); closeModeSheet(); });
  {
    let y0 = -1, dy = 0;
    modeSheet.addEventListener('touchstart', (e) => {
      const body = modeSheet.querySelector('.ms-body')!;
      y0 = body.scrollTop > 0 && body.contains(e.target as Node) ? -1 : e.touches[0].clientY;
      dy = 0;
    }, { passive: true });
    modeSheet.addEventListener('touchmove', (e) => {
      if (y0 < 0 || (e.target as HTMLElement).closest('input')) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      modeSheet.style.transform = dy ? `translateY(${dy}px)` : '';
      modeSheet.style.transition = 'none';
    }, { passive: true });
    modeSheet.addEventListener('touchend', () => {
      modeSheet.style.transition = '';
      modeSheet.style.transform = '';
      if (dy > 90) closeModeSheet();
      y0 = -1;
    });
    // The system took the touch (a call, a gesture): the sheet goes back up where it was.
    modeSheet.addEventListener('touchcancel', () => {
      modeSheet.style.transition = '';
      modeSheet.style.transform = '';
      y0 = -1;
      dy = 0;
    });
  }
  narrow.addEventListener('change', () => { if (!narrow.matches) closeModeSheet(); });
  modeBar.setAttribute('role', 'toolbar');
  modeBar.setAttribute('aria-label', 'Sheet and modes');
  syncers.push(refreshModeBar);
}
