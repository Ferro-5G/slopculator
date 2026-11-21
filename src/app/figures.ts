// Figure blocks, drawn: src/ui/figures.ts decides which lines draw, their math, their marks and what a drag writes;
// this draws the marks as SVG in the line's block, under its line and answer, with the figure/numbers switch in the
// block's corner (src/ui/blockcontrols.ts), and takes the handles' drags and arrow keys.
import { blockControls, figureControls, viewOf, type ChoiceControl } from '../ui/blockcontrols';
import {
  dragHandle, figureData, figureKind, figureLabel, figureQuiet, figureScene, figureSize, handleAt, HANDLE_HIT, HANDLE_R, holdFigure, nudgeHandle, pairedRows, riemannRuleText,
  type FigHandle, type FigMark, type FigureData, type FigureEdit, type FigureHold, type FigureKind, type FigureScene, type NudgeKey,
} from '../ui/figures';
import { rowReadouts, type Readout } from '../ui/readouts';
import type { Size } from '../ui/canvas';
import type { Row } from './docmodel';
import { h } from './dom';
import { dragEnds, dragLine } from './edits';
import { views } from './rowviews';
import { doc, results, rowIndex, saveSoon, sheetChanged } from './sheet';

export const NS = 'http://www.w3.org/2000/svg';

interface Fig {
  id: string;
  kind: FigureKind;
  host: HTMLElement;
  svg: SVGSVGElement;
  marks: SVGGElement;
  handles: SVGGElement;
  handleEls: Map<string, SVGGElement>;
  readouts: HTMLElement;
  rule: HTMLElement | null;
  data: FigureData | null;
  scene: FigureScene | null;
  size: Size;
  /** What a drag holds from its press to its release. */
  hold: FigureHold | null;
  active: string | null;
}
const figs = new Map<string, Fig>();
const switches = new Map<string, HTMLElement>();
/** Each figure block's readouts beside its figure (a stats block's n, x̄, s and median). */
const readsEls = new Map<string, HTMLElement>();

/** A block's readouts: a row per result, each marked with the port its wires leave from. */
export function readoutsEl(el: HTMLElement | null, readouts: readonly Readout[]): HTMLElement {
  const box = el ?? h('div', { class: 'cv-reads' });
  box.replaceChildren(...readouts.map((r) => {
    const k = h('span', { class: `k${r.math ? '' : ' w'}` }, r.label);
    if (r.sub) k.append(h('sub', {}, r.sub));
    if (r.sup) k.append(h('sup', {}, r.sup));
    const v = h('span', { class: 'v' }, r.text);
    if (r.unit) v.append(h('span', { class: 'u' }, r.unit));
    return h('div', { class: 'rd', ...(r.port ? { 'data-port': r.port } : {}) }, k, v);
  }));
  return box;
}

/** Every readout that has a port, by row and port: the canvas takes each port's height from these. */
export function figurePorts(): Map<string, Map<string, HTMLElement>> {
  const out = new Map<string, Map<string, HTMLElement>>();
  for (const [id, el] of readsEls) {
    if (!el.isConnected || !el.offsetParent) continue;
    const m = new Map<string, HTMLElement>();
    for (const rd of el.querySelectorAll<HTMLElement>('[data-port]')) m.set(rd.dataset.port!, rd);
    if (m.size) out.set(id, m);
  }
  return out;
}
let relayout: () => void = () => {};

export function initFigures(onChange: () => void): void {
  relayout = onChange;
}
/** Whether a row's block is drawing its figure: a front end's layout gives it a figure's room. */
export const isFigureBlock = (id: string): boolean => figs.has(id) && !figs.get(id)!.host.hidden;

/** A choice drawn as the block controls' segmented group: each option a button, the chosen one pressed. */
export function choiceGroup(c: ChoiceControl, onPick: (value: string) => void): HTMLElement {
  const g = h('div', { class: `cv-ctl cv-seg cv-seg-${c.id}`, role: 'group', 'aria-label': c.label });
  for (const o of c.options) {
    const b = h('button', { type: 'button', 'data-value': o.value, 'aria-label': o.label, title: o.label, 'aria-pressed': 'false' }, o.glyph);
    b.addEventListener('click', (e) => { e.stopPropagation(); onPick(o.value); });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    g.append(b);
  }
  return g;
}
export function pressChoice(g: HTMLElement, value: string): void {
  for (const b of g.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.value === value));
}

function setView(row: Row, view: string): void {
  if (view === 'numbers') row.view = 'numbers';
  else delete row.view;
  saveSoon();
  relayout();
  switches.get(row.id)?.querySelector<HTMLButtonElement>(`[data-value="${view}"]`)?.focus({ preventScroll: true });
}

/** A drag's or a key's edits: each line rewritten or slider moved, as one drag (the pulse runs). */
export function apply(edits: readonly FigureEdit[], ownId: string): void {
  for (const e of edits) {
    const row = doc.rows[rowIndex(e.kind === 'line' ? ownId : e.id)];
    if (row?.kind === 'expr' && row.text !== e.text) dragLine(row, e.text);
  }
  if (edits.length) sheetChanged();
}

export const KEYS: Record<string, NudgeKey> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function makeFig(id: string, kind: FigureKind): Fig {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cv-fig-svg');
  const marks = document.createElementNS(NS, 'g');
  marks.setAttribute('aria-hidden', 'true');
  const handles = document.createElementNS(NS, 'g');
  svg.append(marks, handles);
  const readouts = h('div', { class: 'cv-readouts' });
  const host = h('div', { class: `cv-fig cv-fig-${kind}`, role: 'img' }, svg, readouts);
  const f: Fig = { id, kind, host, svg, marks, handles, handleEls: new Map(), readouts, rule: null, data: null, scene: null, size: { w: 0, h: 0 }, hold: null, active: null };
  // A press near a handle takes it; anywhere else the press is the block's (a click edits it, a drag moves it).
  const local = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect(), s = r.width / (f.size.w || 1);
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };
  svg.addEventListener('pointerdown', (e) => {
    if (!f.scene || !f.data || e.button !== 0) return;
    const hit = handleAt(f.scene, local(e), e.pointerType !== 'mouse');
    if (!hit || !hit.draggable) return;
    e.preventDefault();
    e.stopPropagation();
    try { svg.setPointerCapture(e.pointerId); } catch { /* a pointer the browser doesn't track */ }
    f.hold = holdFigure(f.data, f.scene);
    f.active = hit.id;
    host.classList.add('grabbing');
    const move = (m: PointerEvent) => {
      if (!f.data || !f.hold || !f.active) return;
      apply(dragHandle(f.data, f.size, f.hold, f.active, local(m)), f.id);
    };
    const up = () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
      host.classList.remove('grabbing');
      f.hold = null;
      f.active = null;
      dragEnds();
      draw(f);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    move(e);
  });
  svg.addEventListener('pointermove', (e) => {
    if (f.active || !f.scene) return;
    const hit = handleAt(f.scene, local(e), e.pointerType !== 'mouse');
    host.classList.toggle('over-handle', !!hit?.draggable);
  });
  return f;
}

/** A handle's element: a wide invisible target, a soft ring and the dot. Kept between draws, so focus stays on it. */
function handleEl(f: Fig, hid: string): SVGGElement {
  let g = f.handleEls.get(hid);
  if (g) return g;
  g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'fh');
  g.dataset.h = hid;
  handleParts(g);
  g.addEventListener('keydown', (e) => {
    const key = KEYS[e.key];
    if (!key || !f.data) return;
    e.preventDefault();
    e.stopPropagation();
    apply(nudgeHandle(f.data, null, hid, key, e.shiftKey), f.id);
    // Key presses in a row are one step to undo.
    dragEnds(700);
  });
  g.addEventListener('keyup', (e) => { if (KEYS[e.key]) e.stopPropagation(); });
  f.handles.append(g);
  f.handleEls.set(hid, g);
  return g;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
const BASE = { top: 'hanging', middle: 'central', bottom: 'text-after-edge' } as const;

export function markSvg(m: FigMark): string {
  switch (m.t) {
    case 'line': return `<line x1="${n1(m.x1)}" y1="${n1(m.y1)}" x2="${n1(m.x2)}" y2="${n1(m.y2)}" class="fs-${m.tone}" stroke-width="${m.w}"${m.dash ? ` stroke-dasharray="${m.dash.join(' ')}"` : ''}${m.op !== undefined ? ` opacity="${m.op}"` : ''}/>`;
    case 'path': {
      if (!m.d) return '';
      const cls = [m.stroke ? `fs-${m.stroke}` : 'fs-none', m.fill ? `ff-${m.fill}` : 'ff-none'].join(' ');
      return `<path d="${m.d}" class="${cls}"${m.w ? ` stroke-width="${m.w}"` : ''}${m.fillOp !== undefined ? ` fill-opacity="${m.fillOp}"` : ''}${m.dash ? ` stroke-dasharray="${m.dash.join(' ')}"` : ''}${m.op !== undefined ? ` stroke-opacity="${m.op}"` : ''}/>`;
    }
    case 'text': return `<text x="${n1(m.x)}" y="${n1(m.y)}" class="ft ff-${m.tone}${m.math ? ' math' : ''}${m.plate ? ' plate' : ''}" font-size="${m.size}" font-weight="${m.weight}" text-anchor="${m.anchor}" dominant-baseline="${BASE[m.base]}">${esc(m.s)}</text>`;
    case 'dot': return `<circle cx="${n1(m.x)}" cy="${n1(m.y)}" r="${m.r}" class="fd ff-${m.tone}"/>`;
  }
}

/** A scene's wells and marks as SVG, in draw order; a run of marks on one pane shares its clip. */
export function sceneSvg(id: string, scene: Pick<FigureScene, 'panes' | 'marks'>): string {
  const clip = (i: number) => `fc-${id}-${i}`;
  let s = '<defs>' + scene.panes.map((p, i) => `<clipPath id="${clip(i)}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6"/></clipPath>`).join('') + '</defs>';
  s += scene.panes.map((p) => `<rect class="fw" x="${p.x + 0.5}" y="${p.y + 0.5}" width="${p.w - 1}" height="${p.h - 1}" rx="6"/>`).join('');
  let open = -2;
  for (const m of scene.marks) {
    if (m.pane !== open) {
      if (open >= 0) s += '</g>';
      if (m.pane >= 0) s += `<g clip-path="url(#${clip(m.pane)})">`;
      open = m.pane;
    }
    s += markSvg(m);
  }
  if (open >= 0) s += '</g>';
  return s;
}

/** Puts a handle's element where the scene says, for screen readers too. */
export function placeHandle(g: SVGGElement, hd: FigHandle, active: boolean): void {
  g.setAttribute('transform', `translate(${n1(hd.x)},${n1(hd.y)})`);
  g.classList.toggle('fixed', !hd.draggable);
  g.classList.toggle('on', active);
  g.style.setProperty('--fh', `var(--fig-${hd.tone})`);
  if (hd.draggable) {
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'slider');
    g.setAttribute('aria-label', hd.label);
    g.setAttribute('aria-valuetext', hd.value);
  } else {
    for (const a of ['tabindex', 'role', 'aria-label', 'aria-valuetext']) g.removeAttribute(a);
  }
}

/** A handle's parts: a wide invisible target, a soft ring and the dot. */
export function handleParts(g: SVGGElement): void {
  const hit = document.createElementNS(NS, 'circle');
  hit.setAttribute('class', 'fh-hit');
  hit.setAttribute('r', String(HANDLE_HIT.mouse));
  const halo = document.createElementNS(NS, 'circle');
  halo.setAttribute('class', 'fh-halo');
  halo.setAttribute('r', '12');
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('class', 'fh-dot');
  dot.setAttribute('r', String(HANDLE_R));
  g.append(hit, halo, dot);
}

function draw(f: Fig): void {
  const { data } = f;
  if (!data) return;
  const scene = figureScene(data, f.size, { view: f.hold?.view, active: f.active });
  f.scene = scene;
  const { w, h: hh } = f.size;
  f.svg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
  f.svg.setAttribute('width', String(w));
  f.svg.setAttribute('height', String(hh));
  f.marks.innerHTML = sceneSvg(f.id, scene);
  const seen = new Set<string>();
  for (const hd of scene.handles) {
    const g = handleEl(f, hd.id);
    seen.add(hd.id);
    placeHandle(g, hd, f.active === hd.id);
  }
  for (const [hid, g] of f.handleEls) if (!seen.has(hid)) { g.remove(); f.handleEls.delete(hid); }
  f.readouts.hidden = !scene.readouts.length;
  f.readouts.replaceChildren(...scene.readouts.map((r) => h('div', { class: `ro ro-${r.id}` }, h('span', { class: 'rl' }, r.label), h('span', { class: 'eq' }, '='), h('span', { class: 'rv' }, r.value))));
}

/**
 * Brings every figure block up to date: its switch, its figure at the size the block gives it (its own size on a wide
 * canvas, the column's width on a narrow one), and its answer hidden where the figure says the same. Runs before the
 * canvas measures blocks; returns the rows drawing a figure.
 */
export function syncFigures(composerId: string, wide: boolean, skip: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  // The lists a fit reads show as values: its scatter shows them.
  const paired = pairedRows(doc.rows, results);
  doc.rows.forEach((row, k) => {
    const v = views.get(row.id);
    if (!v || row.kind !== 'expr') return;
    const r = results[k];
    const kind = row.id === composerId || skip.has(row.id) ? null : figureKind(row.text, r, paired.has(row.id));
    // Stats and paired data show their readouts beside the figure, and in place of it as numbers.
    const readouts = kind === 'stats' || kind === 'pairs' ? rowReadouts({ rows: doc.rows, results, settings: doc.settings, id: row.id }) : null;
    let reads = readsEls.get(row.id);
    if (readouts) {
      reads = readoutsEl(reads ?? null, readouts);
      readsEls.set(row.id, reads);
      if (reads.parentElement !== v.el) v.el.append(reads);
      reads.classList.toggle('flat', viewOf(row) === 'numbers');
    } else if (reads) { reads.remove(); readsEls.delete(row.id); }
    v.el.classList.toggle('blk-reads', !!readouts);
    v.el.classList.toggle('blk-figure', !!kind);
    let sw = switches.get(row.id);
    const controls = kind ? blockControls({ figure: kind, view: viewOf(row), steps: false, stepsOpen: false, failed: false }) : [];
    const view = controls.find((c): c is ChoiceControl => c.kind === 'choice' && c.id === 'view');
    if (view) {
      if (!sw || sw.parentElement !== v.el) {
        sw?.remove();
        sw = choiceGroup(view, (value) => { const live = doc.rows[rowIndex(row.id)]; if (live) setView(live, value); });
        v.el.append(sw);
        switches.set(row.id, sw);
      }
      pressChoice(sw, view.value);
    } else if (sw) { sw.remove(); switches.delete(row.id); }

    let f = figs.get(row.id);
    if (!kind) {
      if (f) { f.host.remove(); figs.delete(row.id); }
      v.el.classList.remove('fig-quiet');
      return;
    }
    if (f && f.kind !== kind) { f.host.remove(); figs.delete(row.id); f = undefined; }
    if (!f) { f = makeFig(row.id, kind); figs.set(row.id, f); }
    if (f.host.parentElement !== v.el) v.el.append(f.host);
    const showing = viewOf(row) === 'figure';
    f.host.hidden = !showing;
    if (!showing) { v.el.classList.toggle('fig-quiet', !!readouts); return; }
    out.add(row.id);
    const data = figureData({ rows: doc.rows, results, settings: doc.settings, id: row.id });
    f.data = data;
    // The figure says what a table of its numbers would (the unit circle, the tangent, a typed matrix), so the
    // answer gives way to it; a number answer (an area, a sum) stays over it.
    const quiet = !!data && figureQuiet(data);
    v.el.classList.toggle('fig-quiet', quiet);
    f.host.setAttribute('aria-label', data ? figureLabel(data) : 'Figure');
    if (!data) { f.host.hidden = true; return; }
    // In a column the figure takes the block's width; on a wide canvas its own.
    f.host.style.width = wide ? `${figureSize(kind).w}px` : '';
    const width = wide ? undefined : f.host.clientWidth || v.el.clientWidth - 40;
    // Held still while a handle is held: its size can't change under the pointer.
    if (!f.hold) f.size = figureSize(kind, width);
    // Riemann's rule, over the figure's corner.
    const [rule] = data.kind === 'riemann' ? figureControls(kind, 'figure', data.rule) : [];
    if (rule && data.kind === 'riemann') {
      if (!f.rule) {
        f.rule = choiceGroup(rule, (value) => {
          const live = doc.rows[rowIndex(row.id)], d = f!.data;
          if (live?.kind !== 'expr' || d?.kind !== 'riemann') return;
          const text = riemannRuleText(d, value as 'left' | 'mid' | 'right');
          if (text && text !== live.text) { dragLine(live, text); sheetChanged(); dragEnds(); }
        });
        f.rule.classList.add('cv-fig-rule');
        f.host.append(f.rule);
      }
      pressChoice(f.rule, rule.value);
    } else if (f.rule) { f.rule.remove(); f.rule = null; }
    draw(f);
  });
  for (const [id, f] of figs) if (!doc.rows.some((r) => r.id === id)) { f.host.remove(); figs.delete(id); }
  for (const [id, sw] of switches) if (!doc.rows.some((r) => r.id === id)) { sw.remove(); switches.delete(id); }
  for (const [id, el] of readsEls) if (!doc.rows.some((r) => r.id === id)) { el.remove(); readsEls.delete(id); }
  return out;
}
