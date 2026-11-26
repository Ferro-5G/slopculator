import modernCss from '../styles/modern.css?inline';
import canvasCss from '../styles/canvas.css?inline';
import { type AppearanceChoice, appearancePatch, appearanceOf, GRAPH_RATE_NAMES, GRAPH_RATE_NOTE, graphFrameGap, type GraphRatePref, MOTION_NAMES, type MotionPref, type WebTheme, themeOfChoice, luminance, contrast, atLeast, type ThemeValue } from '../ui/appearance';
import { tabHues } from '../ui/palettes';
import { CURVES } from '../ui/document';
import { h } from './dom';
import { motionNow, osReduceMotion } from './feedback';
import { syncSheetTitle, buildMenu } from './file';
import { fitKeyLabels, switchPadSide } from './keypad';
import { modeBar, graph } from './layout';
import { placePopover, addPopover, closePopovers } from './overlay';
import { dark } from './platform';
import { SLIDERS_ICON, headPill, refitBar } from './settings';
import { doc, saveSoon, recompute } from './sheet';
import { settleMotions } from './motion';

const lookSheet = document.createElement('style');
// A content security policy can authorize the packaged styles by nonce. The runtime look needs the same nonce,
// including when its text changes, since unsafe-inline is ignored once a nonce is set.
const styleNonce = document.querySelector<HTMLStyleElement>('style[nonce]')?.nonce;
if (styleNonce) lookSheet.nonce = styleNonce;
export let curveColors: string[] = [];

function setAppearance(change: Partial<AppearanceChoice>): void {
  Object.assign(doc.ui, appearancePatch(doc.ui, change));
  appearanceChanged();
}
export function appearanceChanged(): void {
  applyTheme();
  saveSoon();
}
/** Kept for programmatic testing via the page API. */
export function setThemeValue(t: ThemeValue): void {
  setAppearance(appearanceOf({ theme: t }));
}

const motionSel = h('select', { class: 'motion', title: 'Reduced keeps quick fades without bounce or slide.', 'aria-label': 'Motion' },
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

const deviceSlot = h('div', { class: 'device-slot' });
export function syncAppearanceSlots(): void {
  const padLeft = !!doc.ui.padLeft;
  const setPadSide = (left: boolean) => { if (!!doc.ui.padLeft !== left) { switchPadSide(); buildMenu(); } };
  deviceSlot.replaceChildren(
    h('div', { class: 'menu-row' },
      h('span', {}, 'Number pad'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Number pad' },
        h('button', { type: 'button', 'aria-pressed': String(padLeft), onclick: () => setPadSide(true) }, 'Left'),
        h('button', { type: 'button', 'aria-pressed': String(!padLeft), onclick: () => setPadSide(false) }, 'Right'),
      )),
  );
}

export const appearBody = h('div', { class: 'appear-body' },
  h('label', { class: 'menu-row' }, h('span', {}, 'Motion'), motionSel),
  motionNote,
  h('label', { class: 'menu-row' }, h('span', {}, 'Graph frame rate'), rateSel),
  deviceSlot,
);
export const appearBtn = h('button', { type: 'button', class: 'appear-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Appearance' });
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
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  // Aurora Glow is the default look; Keyboard Glow is removed.
  document.documentElement.toggleAttribute('data-glow', !appearanceOf(doc.ui).contrast);
  document.documentElement.removeAttribute('data-keyglow');
  document.documentElement.dataset.look = 'modern';
  lookSheet.textContent = modernCss + canvasCss;
  applyMotion();
  syncSheetTitle();
  const cs = getComputedStyle(document.documentElement);
  curveColors = Array.from({ length: CURVES }, (_, i) => cs.getPropertyValue(`--curve-${i + 1}`).trim());
  syncTabColors();
  // Browser chrome and standalone status bars match the top canvas surface, not the lighter card fill.
  const chromeBg = theme === 'ink'
    ? '#06070c'
    : theme === 'paper'
      ? '#f3f5f9'
      : cs.getPropertyValue('--bg').trim();
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name=theme-color]')];
  const meta = metas[0] ?? h('meta', { name: 'theme-color' });
  if (!meta.isConnected) document.head.append(meta);
  meta.removeAttribute('media');
  meta.content = chromeBg;
  for (const extra of metas.slice(1)) extra.remove();
  graph.refreshTheme();
  recompute();
  fitKeyLabels();
  refitBar();
}

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
  const caps = [v('--key-fn')].filter((c): c is string => !!c);
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
  addPopover({ close: () => setAppear(false), exclusive: true, outside: true, isOpen: () => !appearMenu.hidden, returnFocus: () => appearBtn.focus() });
  document.head.append(lookSheet);
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
