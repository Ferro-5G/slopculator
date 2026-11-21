// The psychrometric chart, drawn: src/ui/psych.ts finds the sheet's moist-air states and decides the chart, its marks
// and what a drag writes; this draws the marks as SVG in one block, with each state's line and readouts beside it
// (the states' own views, moved in), the figure/numbers switch in its corner, and takes the points' drags and keys.
import { blockControls, type ChoiceControl } from '../ui/blockcontrols';
import type { Size } from '../ui/canvas';
import { handleAt } from '../ui/figures';
import { dragPsych, holdPsych, nudgePsych, psychLabel, psychScene, psychSize, psychStates, PSYCH_BLOCK, PSYCH_SIZE, type PsychHold, type PsychScene, type PsychState } from '../ui/psych';
import { rowReadouts } from '../ui/readouts';
import { h } from './dom';
import { dragEnds } from './edits';
import { apply, choiceGroup, handleParts, KEYS, NS, placeHandle, pressChoice, readoutsEl, sceneSvg } from './figures';
import { listEl } from './layout';
import { views } from './rowviews';
import { doc, results, saveSoon } from './sheet';

const svg = document.createElementNS(NS, 'svg');
svg.setAttribute('class', 'cv-fig-svg');
const marksG = document.createElementNS(NS, 'g');
marksG.setAttribute('aria-hidden', 'true');
const handlesG = document.createElementNS(NS, 'g');
svg.append(marksG, handlesG);
const fig = h('div', { class: 'cv-fig cv-fig-psych', role: 'img' }, svg);
const statesEl = h('div', { class: 'cv-states' });
/** The chart's block: its switch, the chart, and its states' lines with their readouts. */
export const psychBlock = h('div', { class: 'blk-psych', role: 'group', 'aria-label': 'Psychrometric chart' }, fig, statesEl);
let sw: HTMLElement | null = null;

let states: PsychState[] = [];
let scene: PsychScene | null = null;
let size: Size = PSYCH_SIZE;
let hold: PsychHold | null = null;
let active: string | null = null;
const handleEls = new Map<string, SVGGElement>();
const readsEls = new Map<string, HTMLElement>();
let relayout: () => void = () => {};
let hosted: string[] = [];

export function initPsych(onChange: () => void): void {
  relayout = onChange;
}
/** The states drawn inside the chart's block, in sheet order: the layout's hosted rows. */
export const psychHosted = (): readonly string[] => hosted;

const local = (e: PointerEvent) => {
  const r = svg.getBoundingClientRect(), s = r.width / (size.w || 1);
  return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
};

svg.addEventListener('pointerdown', (e) => {
  if (!scene || e.button !== 0) return;
  const hit = handleAt(scene, local(e), e.pointerType !== 'mouse');
  if (!hit || !hit.draggable) return;
  e.preventDefault();
  e.stopPropagation();
  try { svg.setPointerCapture(e.pointerId); } catch { /* a pointer the browser doesn't track */ }
  hold = holdPsych(states, scene);
  active = hit.id;
  fig.classList.add('grabbing');
  const move = (m: PointerEvent) => {
    const st = states.find((s) => s.id === active);
    if (!st || !hold) return;
    apply(dragPsych(st, size, hold, local(m)), st.id);
  };
  const up = () => {
    svg.removeEventListener('pointermove', move);
    svg.removeEventListener('pointerup', up);
    svg.removeEventListener('pointercancel', up);
    fig.classList.remove('grabbing');
    hold = null;
    active = null;
    dragEnds();
    draw();
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
});
svg.addEventListener('pointermove', (e) => {
  if (active || !scene) return;
  fig.classList.toggle('over-handle', !!handleAt(scene, local(e), e.pointerType !== 'mouse')?.draggable);
});

function handleEl(id: string): SVGGElement {
  let g = handleEls.get(id);
  if (g) return g;
  g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'fh');
  g.dataset.h = id;
  handleParts(g);
  g.addEventListener('keydown', (e) => {
    const key = KEYS[e.key];
    const st = states.find((s) => s.id === id);
    if (!key || !st) return;
    e.preventDefault();
    e.stopPropagation();
    apply(nudgePsych(st, null, key, e.shiftKey), st.id);
    // Key presses in a row are one step to undo.
    dragEnds(700);
  });
  g.addEventListener('keyup', (e) => { if (KEYS[e.key]) e.stopPropagation(); });
  handlesG.append(g);
  handleEls.set(id, g);
  return g;
}

function draw(): void {
  if (!states.length) return;
  scene = psychScene(states, size, { view: hold?.view, active, measure: measureText });
  svg.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
  svg.setAttribute('width', String(size.w));
  svg.setAttribute('height', String(size.h));
  marksG.innerHTML = sceneSvg('psych', scene);
  const seen = new Set<string>();
  for (const hd of scene.handles) {
    seen.add(hd.id);
    placeHandle(handleEl(hd.id), hd, active === hd.id);
  }
  for (const [id, g] of handleEls) if (!seen.has(id)) { g.remove(); handleEls.delete(id); }
  fig.setAttribute('aria-label', psychLabel(states));
}

/** A label's width in the face the chart sets it in, so a state's name picks the side it fits. */
let ctx: CanvasRenderingContext2D | null = null;
function measureText(s: string, px: number, weight: number, math: boolean): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return s.length * px * 0.6;
  ctx.font = `${math ? 'italic ' : ''}${weight} ${px}px ${math ? 'STIX Two Text' : 'Schibsted Grotesk'}, sans-serif`;
  return ctx.measureText(s).width;
}

function setView(view: string): void {
  if (view === 'numbers') doc.ui.psych = 'numbers';
  else delete doc.ui.psych;
  saveSoon();
  relayout();
  sw?.querySelector<HTMLButtonElement>(`[data-value="${view}"]`)?.focus({ preventScroll: true });
}

/**
 * Brings the chart up to date: the sheet's states (the one in the composer drawn but not moved in), each state's view
 * moved into the block with its readouts, and the chart at the size the block gives it. Runs before the canvas
 * measures blocks; returns the hosted states' ids, or none when the sheet has no states.
 */
export function syncPsych(composerId: string, wide: boolean): string[] {
  states = psychStates({ rows: doc.rows, results, settings: doc.settings });
  hosted = states.map((s) => s.id).filter((id) => id !== composerId && views.has(id));
  if (!states.length) {
    for (const el of [...statesEl.children]) listEl.append(el);
    psychBlock.remove();
    for (const el of readsEls.values()) el.remove();
    readsEls.clear();
    hosted = [];
    return hosted;
  }
  if (psychBlock.parentElement !== listEl) listEl.append(psychBlock);
  const numbers = doc.ui.psych === 'numbers';
  const controls = blockControls({ figure: 'matrix', view: numbers ? 'numbers' : 'figure', steps: false, stepsOpen: false, failed: false });
  const view = controls.find((c): c is ChoiceControl => c.kind === 'choice' && c.id === 'view')!;
  if (!sw) {
    sw = choiceGroup(view, (value) => setView(value));
    sw.classList.add('cv-psych-view');
    psychBlock.prepend(sw);
  }
  pressChoice(sw, view.value);
  psychBlock.classList.toggle('flat', numbers);
  fig.hidden = numbers;
  // Each state's own view, moved in, in sheet order, with its color and readouts.
  hosted.forEach((id, i) => {
    const v = views.get(id)!;
    const st = states.find((s) => s.id === id)!;
    if (statesEl.children[i] !== v.el) statesEl.insertBefore(v.el, statesEl.children[i] ?? null);
    v.el.classList.remove('blk', 'blk-value', 'blk-curve', 'blk-slider', 'blk-figure', 'fig-quiet');
    v.el.classList.add('blk-pstate');
    v.el.style.left = v.el.style.top = '';
    v.el.style.setProperty('--sc', `var(--fig-${st.tone})`);
    const readouts = rowReadouts({ rows: doc.rows, results, settings: doc.settings, id });
    const el = readoutsEl(readsEls.get(id) ?? null, readouts ?? []);
    readsEls.set(id, el);
    const body = v.el.querySelector('.body') ?? v.el;
    if (el.parentElement !== body) body.append(el);
  });
  for (const [id, el] of readsEls) if (!hosted.includes(id)) { el.remove(); readsEls.delete(id); views.get(id)?.el.classList.remove('blk-pstate'); }
  // A line that stopped being a state goes back to the canvas.
  for (const el of [...statesEl.children]) if (!hosted.some((id) => views.get(id)?.el === el)) listEl.append(el);
  if (!numbers) {
    if (!hold) size = wide ? PSYCH_SIZE : psychSize(Math.max(220, (psychBlock.clientWidth || 320) - 28));
    draw();
  }
  return hosted;
}

/** Each hosted state's readouts that have a port, by row and port: the canvas takes each port's height from these. */
export function psychPorts(): Map<string, Map<string, HTMLElement>> {
  const out = new Map<string, Map<string, HTMLElement>>();
  for (const [id, el] of readsEls) {
    if (!el.isConnected || !el.offsetParent) continue;
    const m = new Map<string, HTMLElement>();
    for (const rd of el.querySelectorAll<HTMLElement>('[data-port]')) m.set(rd.dataset.port!, rd);
    out.set(id, m);
  }
  return out;
}

export { PSYCH_BLOCK };
