// Unfold, drawn: a line's steps (src/ui/unfold.ts works them out). A Steps button on a block opens them: on a wide
// canvas, a dashed tray under the line with the steps in columns, wired into each other and up into the line; on a
// narrow one, an indented tree under the block. During a drag only the steps that changed light, with their change.
import type { Rect, Size } from '../ui/canvas';
import { typeset, type SheetNames } from '../ui/typeset';
import { canUnfold, changedSteps, stepAnswer, stepDeltas, stepsReached, trayLayout, unfoldSteps, UNFOLD_LABEL, type TrayLayout, type Unfolded } from '../ui/unfold';
import type { DragSession } from '../ui/wiretags';
import type { Row } from './docmodel';
import { h } from './dom';
import { motionNow } from './feedback';
import { mathNode } from './mathdom';
import { views } from './rowviews';
import { doc, opts, results, saveSoon } from './sheet';

const NS = 'http://www.w3.org/2000/svg';

export interface OpenLine {
  id: string;
  u: Unfolded;
  tray: HTMLElement;
  /** The tree's connectors on a narrow canvas. */
  svg: SVGSVGElement;
  steps: Map<string, HTMLElement>;
  texts: Map<string, string>;
  /** The tray's layout on a wide canvas, in its own coordinates. */
  layout: TrayLayout | null;
  /** The steps when the last render ran, for which changed. */
  prev: Unfolded | null;
  /** The steps when the current drag began, for each step's change. */
  start: Unfolded | null;
  startOf: ReadonlyMap<string, number> | null;
}
const open = new Map<string, OpenLine>();
const buttons = new Map<string, HTMLButtonElement>();
const deltas = new Map<string, HTMLElement>();
let relayout: () => void = () => {};

export function initUnfold(onChange: () => void): void {
  relayout = onChange;
}
export const openLines = (): ReadonlyMap<string, OpenLine> => open;

const CHEVRON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function toggle(row: Row): void {
  if (row.open) delete row.open;
  else row.open = true;
  saveSoon();
  relayout();
  buttons.get(row.id)?.focus({ preventScroll: true });
  // In a narrow column the steps open under the line: bring them into sight, keeping the line in sight too.
  const o = open.get(row.id), line = views.get(row.id)?.el, list = o?.tray.parentElement;
  if (!o || !line || !list || !o.tray.classList.contains('narrow')) return;
  const box = list.getBoundingClientRect(), t = o.tray.getBoundingClientRect(), l = line.getBoundingClientRect();
  const by = Math.min(t.bottom + 12 - box.bottom, l.top - 8 - box.top);
  if (by > 0) list.scrollBy({ top: by, behavior: motionNow() === 'full' ? 'smooth' : 'auto' });
}

function button(row: Row, el: HTMLElement): HTMLButtonElement {
  let b = buttons.get(row.id);
  if (!b || b.parentElement !== el) {
    b?.remove();
    b = h('button', { type: 'button', class: 'cv-steps', 'aria-expanded': 'false' }, UNFOLD_LABEL);
    b.insertAdjacentHTML('beforeend', CHEVRON);
    b.append(h('span', { class: 'flag', 'aria-hidden': 'true' }));
    b.addEventListener('click', (e) => { e.stopPropagation(); const r = doc.rows.find((x) => x.id === row.id); if (r) toggle(r); });
    el.append(b);
    buttons.set(row.id, b);
  }
  return b;
}

/** Marks the part of the line a step works out, while the step is pointed at or focused. */
function markSpan(id: string, span: readonly [number, number] | null): void {
  const tex = views.get(id)?.tex;
  if (!tex) return;
  for (const run of tex.querySelectorAll<HTMLElement>('.m-run')) {
    const a = Number(run.dataset.a), n = Number(run.dataset.n);
    run.classList.toggle('cv-hl', !!span && run.dataset.a !== undefined && a >= span[0] && a + n <= span[1]);
  }
}

function stepEl(o: OpenLine, sid: string): HTMLElement {
  let el = o.steps.get(sid);
  if (el) return el;
  el = h('div', { class: 'cv-step', role: 'listitem', tabindex: '-1' }, h('div', { class: 'sm' }), h('div', { class: 'sv' }, h('span', { class: 'v' }), h('span', { class: 'd' })));
  const show = (on: boolean) => {
    el!.classList.toggle('full', on);
    const s = o.u.steps.find((x) => x.id === sid);
    markSpan(o.id, on && s ? s.span : null);
    paintStep(o, sid);
  };
  el.addEventListener('mouseenter', () => show(true));
  el.addEventListener('mouseleave', () => { if (document.activeElement !== el) show(false); });
  el.addEventListener('focus', () => show(true));
  el.addEventListener('blur', () => show(false));
  el.addEventListener('click', (e) => { e.stopPropagation(); show(!el!.classList.contains('full') || document.activeElement === el); });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('keydown', (e) => {
    const ids = o.tray.classList.contains('narrow') ? o.u.outline : o.u.steps.map((s) => s.id);
    const i = ids.indexOf(sid);
    const to = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : null;
    if (to === null) return;
    e.preventDefault();
    o.steps.get(ids[(to + ids.length) % ids.length])?.focus();
  });
  o.steps.set(sid, el);
  o.tray.append(el);
  return el;
}

function paintStep(o: OpenLine, sid: string): void {
  const s = o.u.steps.find((x) => x.id === sid), el = o.steps.get(sid);
  if (!s || !el) return;
  const v = el.querySelector<HTMLElement>('.v')!;
  v.textContent = el.classList.contains('full') && s.error && s.status === 'fails' ? s.error.text : stepAnswer(s, opts());
  v.classList.toggle('eq', s.status === 'ok');
  el.title = s.error && s.status === 'fails' ? s.error.text : '';
}

/**
 * Brings each line's Steps button and open tray (kept in `host`) up to date. Runs before the canvas is laid out;
 * returns the room each open tray needs under its line on a wide canvas.
 */
export function syncUnfold(host: HTMLElement, composerId: string, wide: boolean, drag: DragSession | null, sheetNames: SheetNames): Map<string, Size> {
  const room = new Map<string, Size>();
  const seen = new Set<string>();
  doc.rows.forEach((row, k) => {
    const v = views.get(row.id);
    if (!v || row.kind !== 'expr') return;
    const r = results[k];
    const can = row.id !== composerId && canUnfold(row.text, r);
    const b = can || buttons.has(row.id) ? button(row, v.el) : null;
    if (b) {
      b.hidden = !can;
      b.setAttribute('aria-expanded', String(!!row.open && can));
      b.title = row.open ? 'Hide the steps' : 'Show the steps';
      b.classList.toggle('bad', !!r?.error);
    }
    const u = can && row.open ? unfoldSteps(row.text, { rows: doc.rows, settings: doc.settings, id: row.id, results }) : null;
    if (!u) return;
    seen.add(row.id);
    let o = open.get(row.id);
    if (!o) {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'cv-tree');
      svg.setAttribute('aria-hidden', 'true');
      const tray = h('div', { class: 'cv-tray', role: 'list', 'aria-label': `Steps of line ${k + 1}` }, svg);
      o = { id: row.id, u, tray, svg, steps: new Map(), texts: new Map(), layout: null, prev: null, start: null, startOf: null };
      open.set(row.id, o);
      if (motionNow() === 'full') tray.classList.add('settle');
    }
    // On the page before its steps are measured.
    if (!o.tray.isConnected) host.append(o.tray);
    o.u = u;
    o.tray.classList.toggle('narrow', !wide);
    // Steps that left (the line changed) go; the rest are reused, in the order a narrow tray reads.
    const ids = wide ? u.steps.map((s) => s.id) : u.outline;
    for (const [sid, el] of o.steps) if (!ids.includes(sid)) { el.remove(); o.steps.delete(sid); o.texts.delete(sid); }
    if (drag && o.startOf !== drag.start) { o.start = o.prev ?? u; o.startOf = drag.start; }
    if (!drag) { o.start = null; o.startOf = null; }
    const changed = drag && o.prev ? changedSteps(o.prev, u) : new Set<string>();
    const reached = drag ? stepsReached(u, drag.names) : null;
    const moved = o.start ? stepDeltas(o.start, u) : new Map<string, string>();
    for (const sid of ids) {
      const s = u.steps.find((x) => x.id === sid)!;
      const el = stepEl(o, sid);
      if (o.texts.get(sid) !== s.text) {
        const boxes = typeset(s.text, { stack: true, names: sheetNames });
        el.querySelector('.sm')!.replaceChildren(boxes ? mathNode(boxes) : s.text);
        o.texts.set(sid, s.text);
      }
      paintStep(o, sid);
      el.querySelector('.d')!.textContent = moved.get(sid) ?? '';
      el.classList.toggle('bad', s.status === 'fails');
      el.classList.toggle('void', s.status === 'after');
      el.classList.toggle('same', !!reached && !reached.has(sid));
      el.style.setProperty('--depth', String(s.depth - 1));
      el.dataset.step = sid;
      if (changed.has(sid) && motionNow() === 'full') {
        el.classList.remove('hit');
        void el.offsetWidth;
        el.classList.add('hit');
      }
    }
    // The order a narrow tray reads in.
    if (!wide) ids.forEach((sid, i) => { const el = o!.steps.get(sid)!; if (o!.tray.children[i + 1] !== el) o!.tray.insertBefore(el, o!.tray.children[i + 1] ?? null); });
    const first = o.steps.get(ids[0]);
    if (first && ![...o.steps.values()].some((el) => el.tabIndex === 0)) first.tabIndex = 0;
    // The line's own change, under its Steps button.
    let dl = deltas.get(row.id);
    if (!dl || dl.parentElement !== v.el) { dl?.remove(); dl = h('span', { class: 'cv-dl' }); v.el.append(dl); deltas.set(row.id, dl); }
    dl.textContent = moved.get('line') ?? '';
    o.prev = u;
    if (wide) {
      const sizes = new Map<string, Size>();
      for (const sid of ids) { const el = o.steps.get(sid)!; sizes.set(sid, { w: el.offsetWidth, h: el.offsetHeight }); }
      o.layout = trayLayout(u, sizes);
      for (const [sid, r] of o.layout.rects) Object.assign(o.steps.get(sid)!.style, { left: `${r.x}px`, top: `${r.y}px` });
      Object.assign(o.tray.style, { width: `${o.layout.size.w}px`, height: `${o.layout.size.h}px` });
      room.set(row.id, o.layout.size);
    } else {
      o.layout = null;
      for (const el of o.steps.values()) el.style.left = el.style.top = '';
      Object.assign(o.tray.style, { width: '', height: '', left: '', top: '' });
    }
  });
  for (const [id, o] of open) if (!seen.has(id)) { o.tray.remove(); open.delete(id); markSpan(id, null); }
  for (const [id, dl] of deltas) if (!seen.has(id)) { dl.remove(); deltas.delete(id); }
  return room;
}

/** A step's box on a wide canvas, in world units, given where its tray sits. */
export function stepRect(o: OpenLine, sid: string, tray: Rect): Rect | null {
  const r = o.layout?.rects.get(sid);
  return r ? { ...r, x: tray.x + r.x, y: tray.y + r.y } : null;
}

/** A narrow tray's tree: from each step's parent (the line, for the top steps) down its left side and into the step. */
export function drawNarrowTree(o: OpenLine): void {
  const kids: SVGElement[] = [];
  const at = (el: HTMLElement) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  for (const s of o.u.steps) {
    const el = o.steps.get(s.id);
    const p = s.parent ? o.steps.get(s.parent) : null;
    if (!el) continue;
    const c = at(el);
    const x = p ? at(p).x + 14 : 14, y0 = p ? at(p).y + at(p).h : 0, y1 = c.y + c.h / 2;
    const d = `M${x},${y0} V${y1 - 5} Q${x},${y1} ${x + 5},${y1} H${c.x}`;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `w${s.status === 'ok' ? '' : ' err'}`);
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(c.x));
    dot.setAttribute('cy', String(y1));
    dot.setAttribute('r', '3');
    dot.setAttribute('class', `port-in${s.status === 'ok' ? '' : ' err'}`);
    kids.push(path, dot);
  }
  o.svg.replaceChildren(...kids);
}
