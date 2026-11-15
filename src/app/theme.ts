import modernCss from '../styles/modern.css?inline';
import retroCss from '../styles/retro.css?inline';
import { type AppearanceChoice, appearancePatch, appearanceOf, GRAPH_RATE_NAMES, GRAPH_RATE_NOTE, graphFrameGap, type GraphRatePref, MODE_NAMES, MOTION_NAMES, type MotionPref, type ColorPref, COLOR_NAMES, type WebTheme, themeOfChoice, luminance, contrast, atLeast, type ThemeValue, LOOK_NAMES, THEME_NAMES } from '../ui/appearance';
import { PAD, capTone, isWordKey } from '../ui/keypad';
import { tabHues } from '../ui/palettes';
import { colorTokens } from '../ui/webtokens';
import { play } from './sound';
import { syncers } from './controls';
import { CURVES } from '../ui/document';
import type { LookName } from './docmodel';
import { h } from './dom';
import { motionNow, osReduceMotion } from './feedback';
import { syncSheetTitle, buildMenu, toggleKeySound } from './file';
import { fitKeyLabels, switchPadSide } from './keypad';
import { modeBar, graph } from './layout';
import { placePopover, addPopover, closePopovers } from './overlay';
import { dark, coarse } from './platform';
import { prideUnlocked, setPride, prideOn } from './pride';
import { SLIDERS_ICON, headPill, refitBar } from './settings';
import { doc, saveSoon, recompute } from './sheet';
import { showToast } from './toast';
import { settleMotions } from './motion';

const lookSheet = document.createElement('style');
// A content security policy can authorize the packaged styles by nonce. The runtime look needs the same nonce,
// including when its text changes, since unsafe-inline is ignored once a nonce is set.
const styleNonce = document.querySelector<HTMLStyleElement>('style[nonce]')?.nonce;
if (styleNonce) lookSheet.nonce = styleNonce;
export let curveColors: string[] = [];
// Appearance's Mode (System, Light, Dark), Pure black when dark and High contrast, as on the phones. They replace the
// old five-way theme, which is still read (appearanceOf) and kept in step (appearancePatch). Ctrl+Alt+T cycles the old
// themes.
function setAppearance(change: Partial<AppearanceChoice>): void {
  Object.assign(doc.ui, appearancePatch(doc.ui, change));
  appearanceChanged();
}
export function appearanceChanged(): void {
  applyTheme();
  saveSoon();
}
export function setThemeValue(t: ThemeValue): void {
  setAppearance(appearanceOf({ theme: t }));
}
/** The drawn part of a role=switch button; its aria-checked moves it. */
const knob = () => h('span', { class: 'knob', 'aria-hidden': 'true' });
const modeButtons = MODE_NAMES.map(([m, label]) => h('button', { type: 'button', onclick: () => setAppearance({ mode: m }) }, label));
const modeSeg = h('div', { class: 'seg mode-seg', role: 'group', 'aria-label': 'Mode' }, ...modeButtons);
const switchSyncs: (() => void)[] = [];
function appearSwitch(name: string, hint: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const b = h('button', { type: 'button', role: 'switch', class: 'appear-pride appear-switch', title: hint, onclick: () => { play('toggle'); set(!get()); } }, h('span', {}, name), knob());
  const sync = () => b.setAttribute('aria-checked', String(get()));
  switchSyncs.push(sync);
  sync();
  return b;
}
const pureBlackSwitch = appearSwitch('Pure black when dark', 'Dark draws on true black', () => appearanceOf(doc.ui).pureBlack, (v) => setAppearance({ pureBlack: v }));
const contrastSwitch = appearSwitch('High contrast', 'Black and white, outlined keys, the color raised to 7:1', () => appearanceOf(doc.ui).contrast, (v) => setAppearance({ contrast: v }));
/** Mode and the two switches all read one appearance, so a change to any of them redraws all three. */
const syncAppearance = () => {
  const m = appearanceOf(doc.ui).mode;
  MODE_NAMES.forEach(([v], i) => modeButtons[i].setAttribute('aria-pressed', String(v === m)));
  for (const sync of switchSyncs) sync();
};
const lookSel = h('select', { class: 'look', title: 'Look', 'aria-label': 'Look' },
  ...LOOK_NAMES.map(([v, label]) => h('option', { value: v }, label)),
);
const motionSel = h('select', { class: 'motion', title: 'Reduced keeps quick fades, and nothing bounces or slides. Off stops every animation.', 'aria-label': 'Motion' },
  ...MOTION_NAMES.map(([v, label]) => h('option', { value: v }, label)),
);
const motionNote = h('div', { class: 'menu-note', hidden: true }, 'Reduce motion is on in system settings, so Full acts like Reduced.');
const rateSel = h('select', { class: 'motion', title: GRAPH_RATE_NOTE, 'aria-label': 'Graph frame rate' },
  ...GRAPH_RATE_NAMES.map(([v, label]) => h('option', { value: v }, label)),
) as HTMLSelectElement;
export function setGraphRate(r: GraphRatePref): void {
  doc.ui.graphRate = r;
  applyMotion();
  saveSoon();
}
export function setMotion(m: MotionPref): void {
  doc.ui.motion = m;
  applyMotion();
  saveSoon();
}
function applyMotion(): void {
  const motion = motionNow();
  document.documentElement.dataset.motion = motion;
  motionSel.value = doc.ui.motion ?? 'full';
  motionNote.hidden = !osReduceMotion.matches;
  graph.motionOff = motion !== 'full';
  if (motion !== 'full') settleMotions();
  graph.frameGap = graphFrameGap(doc.ui.graphRate);
  rateSel.value = doc.ui.graphRate ?? 'high';
}
export const setColor = (c: ColorPref) => {
  doc.ui.color = c;
  appearanceChanged();
};
const swatches = new Map(COLOR_NAMES.map(([c, label]) => [c, h('button', { type: 'button', class: 'swatch', role: 'radio', title: label, 'aria-label': `${label} color`, onclick: () => setColor(c) })]));
const colorRow = h('div', { class: 'menu-row' }, h('span', {}, 'Color'), h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' }, ...swatches.values()));
let colorProps: string[] = [];
function applyColor(look: LookName, theme: WebTheme): void {
  const root = document.documentElement;
  for (const k of colorProps) root.style.removeProperty(k);
  const pride = prideOn();
  const own = getComputedStyle(root).getPropertyValue('--accent').trim();
  const chosen = doc.ui.color ?? 'default';
  for (const [c, el] of swatches) {
    el.style.setProperty('--swatch', colorTokens(look, theme, c)['--accent'] ?? own);
    el.setAttribute('aria-checked', String(c === chosen));
  }
  colorRow.hidden = pride;
  const tokens = pride ? {} : colorTokens(look, theme, chosen);
  colorProps = Object.keys(tokens);
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
}
const prideSlot = h('div', { class: 'pride-slot' });
const deviceSlot = h('div', { class: 'pride-slot device-slot' });
export function syncAppearanceSlots(): void {
  deviceSlot.replaceChildren(...(coarse.matches ? [
    h('button', { type: 'button', role: 'switch', class: 'appear-pride', 'aria-checked': String(doc.ui.sound !== false), onclick: () => toggleKeySound() },
      h('span', {}, 'Key sounds'), knob()),
    h('button', { type: 'button', class: 'appear-pride', onclick: () => { switchPadSide(); buildMenu(); } },
      h('span', {}, 'Number pad'), h('span', { class: 'hint word' }, doc.ui.padLeft ? 'left' : 'right')),
  ] : []));
  prideSlot.replaceChildren(...(prideUnlocked() ? [h('button', { type: 'button', role: 'switch', class: 'appear-pride', 'aria-checked': String(!!doc.ui.pride), onclick: () => setPride(!doc.ui.pride) },
    h('span', {}, 'Pride colors'), knob())] : []));
}
function appearSample(): HTMLElement {
  const keys = ['7', '8', '9', '×', 'enter'].map((l) => PAD.flat().find((k) => k.label === l)!);
  return h('div', { class: 'appear-sample', role: 'img', 'aria-label': 'Sample: the line 7 + 5 with its answer 12, and the keys 7, 8, 9, times and enter, in the chosen appearance' },
    h('div', { class: 'as-line' }, h('span', { class: 'as-idx' }, '2'), h('span', { class: 'as-expr' }, '7+5'), h('span', { class: 'as-ans' }, '12')),
    h('div', { class: 'as-keys' }, ...keys.map((k) => h('span', { class: `key ${capTone(k)}${isWordKey(k) ? ' word' : ''}` }, h('span', { class: 'kl' }, k.label)))));
}
export const appearBody = h('div', { class: 'appear-body' },
  appearSample(),
  h('label', { class: 'menu-row' }, h('span', {}, 'Look'), lookSel),
  h('div', { class: 'menu-row' }, h('span', {}, 'Mode'), modeSeg),
  colorRow,
  pureBlackSwitch,
  contrastSwitch,
  h('label', { class: 'menu-row' }, h('span', {}, 'Motion'), motionSel),
  motionNote,
  h('label', { class: 'menu-row' }, h('span', {}, 'Graph frame rate'), rateSel),
  prideSlot,
  deviceSlot,
);
export const appearBtn = h('button', { type: 'button', class: 'appear-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Appearance', title: 'Appearance: look, mode, color and motion' });
export const appearMenu = h('div', { class: 'menu appear-menu', role: 'dialog', 'aria-label': 'Appearance', hidden: true }, appearBody);
const appearWrap = h('div', { class: 'menu-wrap appear-wrap' }, appearBtn, appearMenu);
export function setAppear(open: boolean, focusFirst = false): void {
  if (open) {
    closePopovers();
    appearMenu.append(appearBody);
  }
  appearMenu.hidden = !open;
  placePopover(appearMenu, appearBtn);
  appearBtn.setAttribute('aria-expanded', String(open));
  if (open && focusFirst) appearMenu.querySelector<HTMLElement>('select, button')?.focus();
}
export const themeIsLight = () => { const t = resolvedTheme(); return t === 'paper' || t === 'contrastLight'; };

function resolvedTheme(): WebTheme {
  return themeOfChoice(appearanceOf(doc.ui), dark.matches);
}
/**
 * The order is the point: the look's stylesheet goes in before anything reads
 * its colors, the curve colors before the tabs that are made from them, and the graph and the keys' fit last.
 */
export function applyTheme(): void {
  document.documentElement.dataset.theme = resolvedTheme();
  document.documentElement.toggleAttribute('data-pride', prideOn());
  const look = doc.ui.look ?? 'modern';
  document.documentElement.dataset.look = look;
  lookSheet.textContent = look === 'retro' ? retroCss : modernCss;
  lookSel.value = look;
  applyColor(look, resolvedTheme());
  applyMotion();
  syncSheetTitle();
  const cs = getComputedStyle(document.documentElement);
  curveColors = Array.from({ length: CURVES }, (_, i) => cs.getPropertyValue(`--curve-${i + 1}`).trim());
  syncTabColors();
  syncAppearance();
  // Browser chrome on phones, and a native title bar, follows the panel color.
  let meta = document.querySelector<HTMLMetaElement>('meta[name=theme-color]');
  if (!meta) { meta = h('meta', { name: 'theme-color' }); document.head.append(meta); }
  meta.content = cs.getPropertyValue('--panel').trim();
  graph.refreshTheme();
  recompute();
  fitKeyLabels();
  // A look's faces change the chips' widths without resizing the bar, so it folds again here.
  refitBar();
}
export function cycleTheme(): void {
  const i = THEME_NAMES.findIndex(([t]) => t === (doc.ui.theme ?? 'system'));
  const next = THEME_NAMES[(i + 1) % THEME_NAMES.length];
  setThemeValue(next[0]);
  showToast(`Theme: ${next[1]}`);
}
/**
 * The tabs' colour notches: Math blue, Stats green, Chance violet, Matrix amber, HVAC teal, from the theme's own curve
 * colours, each pushed until it stands 3:1 off the key it sits on, so a notch reads in every look and theme, High
 * contrast and pure black included. A lit tab wears its colour with black
 * or white over it, whichever stands further off; a tile's name wears it where it reads at 4.5:1, else the third ink.
 */
/** Any CSS colour as #rrggbb, read back from the browser; null for one that isn't a plain colour. */
function cssHex(c: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const probe = h('i', { hidden: true });
  probe.style.color = c;
  if (!probe.style.color) return null;
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g);
  probe.remove();
  return m && m.length >= 3 ? `#${m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}` : null;
}
function syncTabColors(): void {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cssHex(cs.getPropertyValue(name).trim());
  const retro = doc.ui.look === 'retro';
  // Retro's is a gradient, so a colour has to stand off both its ends.
  const caps = (retro ? [v('--cap-fn'), v('--cap-fn-top')] : [v('--key-fn')]).filter((c): c is string => !!c);
  const tile = caps[0] ?? '#d1d3da';
  const darkTheme = luminance(v('--panel') ?? '#ffffff') < 0.2;
  const hues = tabHues(curveColors.map((c) => cssHex(c)), darkTheme);
  const third = v('--ink-3') ?? '#5f6068';
  const root = document.documentElement.style;
  hues.forEach((hue, i) => {
    let c = hue;
    for (const cap of [...caps].sort((a, b) => contrast(c, a) - contrast(c, b))) c = atLeast(c, cap, 3);
    root.setProperty(`--tab-${i}`, c);
    root.setProperty(`--tab-on-${i}`, contrast('#ffffff', c) >= contrast('#000000', c) ? '#ffffff' : '#000000');
    root.setProperty(`--tab-name-${i}`, contrast(c, tile) >= 4.5 ? c : third);
  });
}

export function initTheme(): void {
  addPopover({ close: () => setAppear(false), exclusive: true, outside: true });
  document.head.append(lookSheet);
  syncers.push(syncAppearance);
  lookSel.addEventListener('change', () => {
    doc.ui.look = lookSel.value as LookName;
    appearanceChanged();
  });
  rateSel.addEventListener('change', () => setGraphRate(rateSel.value as GraphRatePref));
  motionSel.addEventListener('change', () => {
    setMotion(motionSel.value as MotionPref);
  });
  osReduceMotion.addEventListener('change', applyMotion);
  appearBtn.innerHTML = SLIDERS_ICON + '<span class="appear-word">Appearance</span>';
  modeBar.insertBefore(appearWrap, headPill);
  appearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setAppear(!!appearMenu.hidden, e.detail === 0);
  });
  appearBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAppear(true, true); }
  });
  appearMenu.addEventListener('click', (e) => e.stopPropagation());
  appearMenu.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !appearMenu.contains(e.relatedTarget as Node)) setAppear(false);
  });
  appearMenu.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    setAppear(false);
    appearBtn.focus();
  });
}
