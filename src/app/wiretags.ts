// Values on wires, drawn: each wire's tag (src/ui/wiretags.ts decides what it says and when it shows). On a wide
// canvas a tag sits on the run into the block it feeds; in a narrow column it rides on its wire in open canvas
// (cascadeTagSpots). Tags show while a slider is held and for a moment after, and on the wire pointed at or focused;
// at rest, none.
import { wireKey, type Point, type Rect, type Wire } from '../ui/canvas';
import { cascadeTagSpots } from '../ui/cascade';
import { spreadTags, tagRun as runFor, tagSpot, type TagBox } from '../ui/wireplace';
import { typeset } from '../ui/typeset';
import { DELTA_LINGER_MS, dragOver, endDrag, shownTags, startDrag, wireDelta, wireState, wireTags, type DragSession, type WireState, type WireTag } from '../ui/wiretags';
import { h } from './dom';
import { mathNode } from './mathdom';
import { doc, opts, results } from './sheet';

const NS = 'http://www.w3.org/2000/svg';

let drag: DragSession | null = null;
let held = false;
let focusKey: string | null = null;
let lingerTimer = 0;
let latest = new Map<string, WireTag>();
let visible = new Set<string>();
/** What each tag shows. During a drag a reached wire's tag keeps its old value until the pulse passes under it. */
const shown = new Map<string, WireTag>();
const els = new Map<string, HTMLButtonElement>();
let order: string[] = [];
let relayout: () => void = () => {};

/** The wide canvas's layer of tags, in world units like the blocks. */
export const tagLayer = h('div', { class: 'cv-tags', role: 'group', 'aria-label': 'Values on wires' });

/** `onChange` lays the canvas out again: a drag began or ended, a tag was focused. */
export function initTags(onChange: () => void): void {
  relayout = onChange;
}

const live = (): DragSession | null => (drag && !dragOver(drag, performance.now()) ? drag : null);
export const tagDrag = live;
export const stateOf = (key: string): WireState => wireState(key, live(), focusKey);
export const hasTag = (key: string): boolean => latest.has(key);
export const tagShown = (key: string): boolean => visible.has(key);

/** A slider was pressed (or a key moves it): its drag begins, or carries on if its changes still show. */
export function beginDrag(sliderId: string, wires: readonly Wire[]): void {
  clearTimeout(lingerTimer);
  drag = startDrag(sliderId, wires, doc.rows, results, drag, performance.now());
  held = true;
  relayout();
}
/** The slider was let go: every tag catches up, and the changes stay for DELTA_LINGER_MS. */
export function releaseDrag(): void {
  if (!drag || !held) return;
  held = false;
  drag = endDrag(drag, performance.now());
  for (const [k, t] of latest) shown.set(k, t);
  relayout();
  clearTimeout(lingerTimer);
  // How long the changes stay readable after release is a set time (DELTA_LINGER_MS); there is no event to wait for.
  lingerTimer = window.setTimeout(() => { drag = null; relayout(); }, DELTA_LINGER_MS);
}
export const dragHeld = (): boolean => held;

/** The pulse reached the end of a wire: its tag shows the value it carries now, with a tick. */
export function tagArrived(key: string, tick: boolean): void {
  const t = latest.get(key), el = els.get(key);
  if (!t || !el) return;
  shown.set(key, t);
  paint(key);
  // A longer value makes a longer tag: the tags take their places again.
  if (placed.some(([k]) => k === key)) placeTags(placed, placedIn);
  if (!tick) return;
  el.classList.add('tick');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('tick')));
}

const names = new Map<string, HTMLElement>();
function nameNode(name: string): Node {
  let n = names.get(name);
  if (!n) {
    const boxes = typeset(name);
    n = boxes ? mathNode(boxes) : h('span', {}, name);
    names.set(name, n);
  }
  return n.cloneNode(true);
}

function bars(list: number[]): SVGSVGElement {
  const w = list.length * 4 - 1;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'bars');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', `0 0 ${w} 12`);
  svg.setAttribute('aria-hidden', 'true');
  list.forEach((b, k) => {
    const r = document.createElementNS(NS, 'rect');
    const ht = 3 + b * 9;
    r.setAttribute('x', String(k * 4));
    r.setAttribute('y', String(12 - ht));
    r.setAttribute('width', '2.5');
    r.setAttribute('height', String(ht));
    r.setAttribute('rx', '0.8');
    svg.append(r);
  });
  return svg;
}

function make(key: string): HTMLButtonElement {
  const el = h('button', { type: 'button', class: 'cv-tag', tabindex: '-1' },
    h('span', { class: 'tn' }), h('span', { class: 'tv' }), h('span', { class: 'tu' }), h('span', { class: 'td' }));
  el.dataset.key = key;
  el.addEventListener('mouseenter', () => focusWire(key));
  el.addEventListener('mouseleave', () => { if (focusKey === key && document.activeElement !== el) focusWire(null); });
  el.addEventListener('focus', () => focusWire(key));
  el.addEventListener('blur', () => { if (focusKey === key) focusWire(null); });
  // A tap on a phone, where nothing hovers: the full value, or back.
  el.addEventListener('click', () => focusWire(focusKey === key && document.activeElement !== el ? null : key));
  el.addEventListener('keydown', (e) => {
    const i = order.indexOf(key);
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    els.get(order[(to + order.length) % order.length])?.focus();
  });
  return el;
}

/** Points at one wire (hover or focus), so its tag shows its full value, or at none. */
export function focusWire(key: string | null): void {
  if (focusKey === key) return;
  focusKey = key;
  relayout();
}
export const focusedWire = (): string | null => focusKey;

function paint(key: string): void {
  const el = els.get(key), t = shown.get(key) ?? latest.get(key);
  if (!el || !t) return;
  const focus = focusKey === key;
  const [tn, tv, tu, td] = el.children as unknown as HTMLElement[];
  if (tn.dataset.name !== t.name) { tn.replaceChildren(nameNode(t.name)); tn.dataset.name = t.name; }
  const text = focus && t.full ? t.full : t.text;
  if (t.kind === 'list' && !focus) tv.replaceChildren(bars(t.list.bars), h('span', {}, t.text));
  else tv.textContent = text;
  tu.textContent = t.unit ?? '';
  const d = live();
  const delta = d ? wireDelta(d, t) : null;
  td.textContent = delta ?? '';
  const state = stateOf(key);
  el.classList.toggle('on', visible.has(key));
  for (const s of ['lit', 'dim', 'focus'] as const) el.classList.toggle(s, state === s);
  el.classList.toggle('err', t.kind === 'error');
  el.setAttribute('aria-label', `${t.name}: ${t.full || t.text}${t.unit ? ` ${t.unit}` : ''}${delta ? `, ${delta}` : ''}`);
}

/**
 * Works out every tag and fills it in. Runs before the canvas is laid out, so a narrow column knows which wires carry
 * a tag (hasTag) and keeps room for them. `column`: a phone's column, which shows only the tags a drag reaches. `lag` holds a dragged value back until its pulse arrives (only while pulses
 * run).
 */
export function syncTags(wires: readonly Wire[], lag: boolean, column = false): void {
  latest = wireTags(wires, doc.rows, results, opts());
  if (drag && dragOver(drag, performance.now())) drag = null;
  visible = shownTags(latest, live(), focusKey, performance.now(), { reachedOnly: column });
  order = wires.map(wireKey).filter((k) => latest.has(k));
  for (const [k, el] of els) if (!latest.has(k)) { el.remove(); els.delete(k); shown.delete(k); }
  if (focusKey && !latest.has(focusKey)) focusKey = null;
  for (const k of order) {
    let el = els.get(k);
    if (!el) { el = make(k); els.set(k, el); }
    if (!(lag && held && drag?.reach.has(k) && shown.has(k))) shown.set(k, latest.get(k)!);
    paint(k);
    if (el.parentElement !== tagLayer) tagLayer.append(el);
  }
  // One Tab stop for every tag: the focused one, else the first.
  const current = focusKey && els.has(focusKey) ? focusKey : order[0];
  for (const [k, el] of els) el.tabIndex = k === current ? 0 : -1;
}


/** How long the run into a block must be for a wire's tag to sit on it, or 0 when it has none. */
const widest = new Map<string, number>();
export function tagRun(key: string): number {
  const el = els.get(key);
  if (!el || el.parentElement !== tagLayer) return 0;
  // The widest it has been, so a value growing a digit mid-drag never sends its wire another way.
  const w = Math.max(widest.get(key) ?? 0, el.offsetWidth);
  widest.set(key, w);
  return runFor(w);
}

/**
 * Puts a wide wire's tag on the run into its block, clear of the bends: on the last straight segment long enough to
 * hold it (the last one, unless it's too short), nearest the block.
 */
let placed: [string, readonly Point[]][] = [];
/** A narrow column's blocks and bounds, when the tags last placed were in one. */
let placedIn: { blocks: readonly Rect[]; bounds: Rect } | undefined;
/**
 * Puts each wire's tag on its wire. On a wide canvas: on the run into its block, clear of the bends (tagSpot), then
 * tags that would overlap move apart along their runs (spreadTags). In a narrow column (`column`): in open canvas on
 * its wire, clear of the blocks and of each other (cascadeTagSpots). Only tags that show take part, so a hidden one
 * never pushes another.
 */
export function placeTags(entries: [string, readonly Point[]][], column?: { blocks: readonly Rect[]; bounds: Rect }): void {
  placed = entries;
  placedIn = column;
  const shown = (key: string) => visible.has(key) && !els.get(key)!.classList.contains('gone');
  const live = entries.filter(([key]) => els.get(key)?.parentElement === tagLayer);
  if (column) {
    const tags = live.filter(([key]) => shown(key)).map(([key, points]) => ({ key, points, w: els.get(key)!.offsetWidth, h: els.get(key)!.offsetHeight }));
    const spots = cascadeTagSpots(tags, column.blocks, column.bounds);
    for (const [key, pts] of live) {
      const el = els.get(key)!, w = el.offsetWidth, h = el.offsetHeight;
      const at = spots.get(key) ?? pts[pts.length - 1];
      el.classList.remove('vert');
      el.style.transform = `translate(${Math.round(at.x - w / 2)}px, ${Math.round(at.y - h / 2)}px)`;
    }
    return;
  }
  const boxes: TagBox[] = [];
  for (const [key, pts] of live) {
    const el = els.get(key)!;
    const w = el.offsetWidth, h = el.offsetHeight;
    const spot = tagSpot(pts, w, h);
    boxes.push({ key, x: spot.x, y: spot.y, w, h, vert: spot.vert });
  }
  const spread = new Map(spreadTags(boxes.filter((b) => shown(b.key))).map((b) => [b.key, b]));
  for (const b of boxes) {
    const at = spread.get(b.key) ?? b, el = els.get(b.key)!;
    el.classList.toggle('vert', at.vert);
    el.style.transform = `translate(${Math.round(at.x - at.w / 2)}px, ${Math.round(at.y - at.h / 2)}px)`;
  }
}

/** Tags of wires that aren't drawn (into an open line's steps, or off the column) don't show. */
export function keepTags(drawn: ReadonlySet<string>): void {
  for (const [k, el] of els) el.classList.toggle('gone', !drawn.has(k));
}
