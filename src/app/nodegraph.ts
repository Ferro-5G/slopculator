import type { Point } from '../ui/canvas';
import { DRAG_SLOP } from '../ui/canvaswide';
import { nextColor } from '../ui/document';
import {
  bezierWirePath, canConnect, connectPin, createNodeInspector, disconnectPin, groupNodeTemplates, nodeRejectionText,
  planSpawnNode, setPinValue, type InputPin, type NodeChange,
} from '../ui/nodegraph';
import { draftId } from './composer';
import { newId, type Row } from './docmodel';
import { h } from './dom';
import { dragEnds, pushStep } from './edits';
import { app, listEl, tape } from './layout';
import { addPopover, closePopovers } from './overlay';
import { narrow } from './platform';
import { views } from './rowviews';
import { doc, renderNow, results, rowIndex, saveSoon, screen } from './sheet';
import { showToast } from './toast';

type Source = { rowId: string; fromPort?: string };
type Pin = { rowId: string; pinIndex: number };

interface CanvasActions {
  isWide: () => boolean;
  insert: (rowId: string, fromPort?: string) => void;
  flash: (id: string) => void;
  pulse: (id: string) => void;
  keepView: () => void;
}

let canvas: CanvasActions;
const args = () => [doc.rows, results, doc.settings] as const;

function editSheet(label: string, changes: readonly NodeChange[], added?: Extract<Row, { kind: 'expr' }>): boolean {
  const before = changes.flatMap(({ rowId }) => {
    const row = doc.rows[rowIndex(rowId)];
    return row?.kind === 'expr' ? [{ rowId, text: row.text }] : [];
  });
  if (!added && changes.every(({ rowId, text }) => before.some((old) => old.rowId === rowId && old.text === text))) return false;
  dragEnds();
  const index = added ? rowIndex(draftId()) : -1;
  const apply = (texts: readonly NodeChange[], forward: boolean) => {
    for (const { rowId, text } of texts) {
      const row = doc.rows[rowIndex(rowId)];
      if (row?.kind !== 'expr') continue;
      row.text = text;
      const input = views.get(rowId)?.input;
      if (input) input.value = text;
    }
    if (added) {
      const at = rowIndex(added.id);
      if (forward && at < 0) doc.rows.splice(index, 0, added);
      if (!forward && at >= 0) doc.rows.splice(at, 1);
      canvas.keepView();
      screen.rebuildRows();
    }
    renderNow();
    saveSoon();
  };
  apply(changes, true);
  pushStep({ label, undo: () => apply(before, false), redo: () => apply(changes, true) });
  return true;
}

function reject(message: string): void {
  showToast(message);
}

export function unwireNodePin(rowId: string, pinIndex: number): void {
  const result = disconnectPin(...args(), { rowId, pinIndex });
  if (!result.ok) return reject("Can't disconnect this input");
  if (editSheet('Disconnected input', result.changes)) canvas.flash(rowId);
}

function socket(kind: 'in' | 'out', rowId: string): HTMLButtonElement {
  return h('button', { type: 'button', class: `ng-sock ng-sock-${kind}`, 'data-row': rowId });
}

function makePinField(rowId: string, pinIndex: number): HTMLInputElement {
  const input = h('input', { type: 'text', class: 'ng-pin-val', 'data-row': rowId, 'data-pin': pinIndex, autocomplete: 'off', spellcheck: 'false' });
  let text = '';
  input.addEventListener('focus', () => { text = input.value; });
  input.addEventListener('blur', () => {
    if (!input.isConnected || input.hidden) return;
    if (input.value !== text) {
      const result = setPinValue(...args(), { rowId, pinIndex, value: input.value });
      if (result.ok) editSheet('Changed input value', result.changes);
      else reject('Enter a valid expression');
    }
    input.value = input.dataset.committed ?? '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || (e.key !== 'Enter' && e.key !== 'Escape')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') input.value = text;
    input.blur();
  });
  return input;
}

function makePinRow(rowId: string, pinIndex: number): HTMLElement {
  const button = socket('in', rowId);
  button.dataset.pin = String(pinIndex);
  return h('div', { class: 'ng-pin-row' }, button, h('span', { class: 'ng-pin-label' }),
    makePinField(rowId, pinIndex), h('span', { class: 'ng-pin-src' }),
    h('button', { type: 'button', class: 'ng-pin-unwire', onclick: () => unwireNodePin(rowId, pinIndex) }, '×'));
}

function syncPin(pinRow: HTMLElement, pin: InputPin): void {
  const button = pinRow.querySelector<HTMLButtonElement>('.ng-sock-in')!;
  const value = pinRow.querySelector<HTMLInputElement>('.ng-pin-val')!;
  const source = pinRow.querySelector<HTMLElement>('.ng-pin-src')!;
  const disconnect = pinRow.querySelector<HTMLButtonElement>('.ng-pin-unwire')!;
  const wired = pin.wiredFrom;
  button.classList.toggle('wired', !!wired);
  if (wired && pin.editable) button.title = 'Alt+click to disconnect';
  else button.removeAttribute('title');
  button.dataset.editable = String(pin.editable);
  button.setAttribute('aria-label', wired ? `Connected input ${pin.label}` : `Input ${pin.label}`);
  pinRow.querySelector('.ng-pin-label')!.textContent = pin.label;
  value.hidden = !!wired || !pin.editable;
  value.setAttribute('aria-label', `Value for ${pin.label}`);
  // Keep the latest committed text separately while the user has a draft in this field.
  value.dataset.committed = pin.text;
  if (document.activeElement !== value) value.value = pin.text;
  source.hidden = disconnect.hidden = !wired;
  source.textContent = wired ? (wired.fromPort ? `${wired.name}.${wired.fromPort}` : wired.name) : '';
  source.title = source.textContent;
  disconnect.disabled = !pin.editable;
  disconnect.setAttribute('aria-label', `Disconnect ${pin.label}`);
}

/** Update the controls beside the expression without replacing the row or a pin field as it is edited. */
export function syncNodeSockets(wide: boolean, hosted: ReadonlySet<string>, figures: ReadonlySet<string> = new Set()): void {
  const inspect = wide ? createNodeInspector(doc.rows, results, { lineNames: doc.settings.lineNames }) : null;
  doc.rows.forEach((row, i) => {
    const block = views.get(row.id)?.el;
    if (!block) return;
    let chrome = block.querySelector<HTMLElement>(':scope > .ng-chrome');
    const model = inspect && block.matches('.blk:not(.blk-blank)') && !hosted.has(row.id) ? inspect(row, results[i]) : null;
    const isFigure = figures.has(row.id);
    const card = !!model?.isNodeCard && !isFigure;
    const inputs = model && !isFigure ? model.inputs : [];
    block.classList.toggle('blk-node', card);
    if (!model || !(card || model.canOutput || inputs.length)) {
      chrome?.remove();
      return;
    }
    if (!chrome) {
      const out = socket('out', row.id);
      out.setAttribute('aria-label', 'Connect output');
      chrome = h('div', { class: 'ng-chrome' },
        h('div', { class: 'ng-head' }, h('span', { class: 'ng-symbol' }), h('span', { class: 'ng-title' }), h('span', { class: 'ng-name' })),
        out, h('div', { class: 'ng-pins' }));
      block.append(chrome);
    }
    const head = chrome.querySelector<HTMLElement>('.ng-head')!;
    head.hidden = !card;
    head.querySelector('.ng-symbol')!.textContent = model.symbol;
    head.querySelector('.ng-title')!.textContent = model.title;
    const name = head.querySelector<HTMLElement>('.ng-name')!;
    name.textContent = model.name;
    name.hidden = !model.name;
    chrome.querySelector<HTMLElement>('.ng-sock-out')!.hidden = !model.canOutput;
    const rack = chrome.querySelector<HTMLElement>('.ng-pins')!;
    rack.hidden = !inputs.length;
    while (rack.children.length > inputs.length) rack.lastElementChild?.remove();
    for (const pin of inputs) {
      const pinRow = rack.children[pin.index] as HTMLElement | undefined ?? makePinRow(row.id, pin.index);
      if (!pinRow.parentElement) rack.append(pinRow);
      syncPin(pinRow, pin);
    }
  });
}

const NS = 'http://www.w3.org/2000/svg';
export const nodeDragLayer = document.createElementNS(NS, 'g');
nodeDragLayer.classList.add('ng-drag-layer');
const preview = document.createElementNS(NS, 'path');
const dots = [document.createElementNS(NS, 'circle'), document.createElementNS(NS, 'circle')];
for (const dot of dots) dot.setAttribute('r', '3.5');
const note = h('div', { class: 'ng-drag-note', hidden: true, 'aria-hidden': 'true' });

const OUT = '.ng-sock-out:not([hidden]), circle.port-out[data-row], circle.port-free[data-row]';
const IN = '.ng-sock-in';
type Drag = {
  pointer: number;
  start: Point;
  origin: Element;
  originWorld: Point;
  end: Point;
  moved: boolean;
} & ({ source: Source; pin?: never } | { pin: Pin; source?: never });

let drag: Drag | null = null;
let pending: { from: Drag; at: Point } | null = null;
let snapped: Element | null = null;
let skipClick = false;
const clientPoint = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });
const center = (el: Element): Point => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
function world(point: Point): Point {
  const matrix = nodeDragLayer.getScreenCTM();
  if (!matrix) return point;
  const { x, y } = new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse());
  return { x, y };
}
function pinOf(el: HTMLElement): Pin {
  return { rowId: el.dataset.row!, pinIndex: Number(el.dataset.pin) };
}
function sourceOf(el: HTMLElement | SVGElement): Source {
  return { rowId: el.dataset.row!, fromPort: el.dataset.port };
}
const isBackground = (el: Element | null): boolean => el === tape || el === listEl || el === nodeDragLayer.ownerSVGElement;

function clearPreview(): void {
  snapped?.classList.remove('ng-snap', 'invalid');
  snapped = null;
  nodeDragLayer.replaceChildren();
  nodeDragLayer.classList.remove('invalid');
  listEl.classList.remove('ng-wiring-in', 'ng-wiring-out');
  note.hidden = true;
}

function paintWire(from: Point, to: Point): void {
  if (!preview.parentNode) nodeDragLayer.append(preview, ...dots);
  preview.setAttribute('d', bezierWirePath(from, to));
  [from, to].forEach(({ x, y }, i) => {
    dots[i].setAttribute('cx', String(x));
    dots[i].setAttribute('cy', String(y));
  });
}

function nearestSocket(point: Point, selector: string, over: Element | null): HTMLElement | SVGElement | null {
  // A direct hit wins. Otherwise snap in screen pixels, so zoom does not change how close the pointer must get.
  const direct = over?.closest<HTMLElement | SVGElement>(selector);
  if (direct) return direct;
  if (!over || !tape.contains(over)) return null;
  let best: HTMLElement | SVGElement | null = null;
  let distance = 24;
  for (const el of listEl.querySelectorAll<HTMLElement | SVGElement>(selector)) {
    if (!el.getClientRects().length) continue;
    const at = center(el), d = Math.hypot(at.x - point.x, at.y - point.y);
    if (d > distance) continue;
    const face = document.elementFromPoint(at.x, at.y);
    if (face !== el && !el.contains(face)) continue;
    best = el;
    distance = d;
  }
  return best;
}

function targetOf(d: Drag) {
  const over = document.elementFromPoint(d.end.x, d.end.y);
  const target = nearestSocket(d.end, d.source ? IN : OUT, over);
  const source = d.source ?? (target ? sourceOf(target) : null);
  const pin = d.pin ?? (target instanceof HTMLElement ? pinOf(target) : null);
  const connection = source && pin ? { fromId: source.rowId, fromPort: source.fromPort, toId: pin.rowId, toPin: pin.pinIndex } : null;
  return { target, connection, empty: isBackground(over) };
}

function originOf(d: Drag): Point {
  if (d.origin.isConnected && d.origin.getClientRects().length) return world(center(d.origin));
  // An SVG readout dot can be replaced while the preview is still in flight.
  if (d.origin instanceof SVGElement) {
    const port = [...listEl.querySelectorAll<SVGElement>('circle.port-out[data-row], circle.port-free[data-row]')]
      .find((el) => el.dataset.row === d.source?.rowId && el.dataset.port === d.source?.fromPort &&
        (el.dataset.key === d.origin.getAttribute('data-key') || !!d.source?.fromPort));
    if (port) return world(center(port));
  }
  return d.originWorld;
}

export function cancelNodeDrag(): void {
  if (drag) skipClick = true;
  drag = null;
  closeNodeMenu();
}

export function refreshNodeDrag(): void {
  // An undo, a sheet switch or Clear can remove the row a wire is being dragged from.
  const from = pending?.from ?? drag;
  if (from && rowIndex(from.source?.rowId ?? from.pin!.rowId) < 0) return cancelNodeDrag();
  if (pending) {
    paintWire(originOf(pending.from), pending.at);
    return;
  }
  if (!drag?.moved) return;
  const { target, connection } = targetOf(drag);
  const verdict = connection ? canConnect(...args(), connection) : null;
  const message = verdict && !verdict.ok ? nodeRejectionText(verdict.reason) : '';
  if (snapped !== target) snapped?.classList.remove('ng-snap', 'invalid');
  snapped = target;
  target?.classList.add('ng-snap');
  target?.classList.toggle('invalid', !!message);
  nodeDragLayer.classList.toggle('invalid', !!message);
  note.hidden = !message;
  if (message) {
    note.textContent = message;
    note.style.left = `${Math.max(8, Math.min(drag.end.x + 14, innerWidth - note.offsetWidth - 8))}px`;
    note.style.top = `${Math.max(8, Math.min(drag.end.y + 14, innerHeight - note.offsetHeight - 8))}px`;
  }
  const origin = originOf(drag), end = world(target ? center(target) : drag.end);
  paintWire(drag.source ? origin : end, drag.source ? end : origin);
}

let menu: HTMLElement | null = null;
let returnTo: HTMLElement | null = null;
function closeNodeMenu(): void {
  menu?.remove();
  menu = null;
  pending = null;
  clearPreview();
}

function spawnNode(templateId: string, at: Point, source?: Source): void {
  const plan = planSpawnNode(...args(), { templateId, connectFrom: source });
  if (!plan) return reject("Couldn't add that node");
  const row = { id: newId(), kind: 'expr' as const, color: nextColor(doc.rows), text: plan.text, at };
  editSheet('Added math node', plan.changes, row);
  canvas.flash(row.id);
  if (source) canvas.pulse(source.rowId);
}

export function openNodeMenu(point: Point, at: Point, trigger?: HTMLElement, from?: Drag): void {
  if (!canvas.isWide()) return;
  closePopovers();
  returnTo = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const source = from?.source;
  if (source && from) {
    pending = { from, at };
    refreshNodeDrag();
  }
  const search = h('input', { type: 'text', class: 'ng-search', role: 'combobox', 'aria-label': 'Search math nodes',
    'aria-autocomplete': 'list', 'aria-expanded': 'true', 'aria-controls': 'ng-options', placeholder: 'Search math nodes', autocomplete: 'off' });
  const list = h('div', { class: 'ng-options', id: 'ng-options', role: 'listbox', 'aria-label': 'Math nodes' });
  menu = h('div', { class: 'ng-menu', role: 'dialog', 'aria-label': 'Add math node' }, search, list);
  const choose = (id: string) => {
    closeNodeMenu();
    returnTo?.focus({ preventScroll: true });
    spawnNode(id, at, source);
  };
  let options: HTMLButtonElement[] = [];
  let selected = 0;
  const mark = () => {
    options.forEach((option, i) => option.setAttribute('aria-selected', String(i === selected)));
    const option = options[selected];
    if (option) {
      search.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  };
  const draw = () => {
    options = [];
    list.replaceChildren();
    for (const { label, templates } of groupNodeTemplates(search.value, { hasInput: !!source })) {
      const section = h('div', { role: 'group', 'aria-label': label }, h('div', { class: 'ng-category', 'aria-hidden': 'true' }, label));
      for (const { id, title, symbol, summary } of templates) {
        const option = h('button', { class: 'ng-option', id: `ng-template-${id}`, type: 'button', role: 'option',
          'aria-label': title, 'aria-description': summary, tabindex: -1, onclick: () => choose(id) },
          h('span', { class: 'ng-symbol', 'aria-hidden': 'true' }, symbol),
          h('span', {}, h('strong', {}, title), h('small', {}, summary)));
        options.push(option);
        section.append(option);
      }
      list.append(section);
    }
    if (!options.length) list.append(h('p', { class: 'ng-category', role: 'status' }, 'No matching nodes'));
    selected = 0;
    mark();
  };
  search.addEventListener('input', draw);
  search.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      options[selected]?.click();
    }
  });
  app.append(menu);
  draw();
  menu.style.left = `${Math.max(8, Math.min(point.x, innerWidth - menu.offsetWidth - 8))}px`;
  // Keep the anchor fixed as search results change.
  menu.style.top = `${Math.max(8, Math.min(point.y, innerHeight - menu.offsetHeight - 8))}px`;
  menu.style.maxHeight = `${innerHeight - menu.offsetTop - 8}px`;
  search.focus({ preventScroll: true });
}

export function initNodeGraph(actions: CanvasActions): void {
  canvas = actions;
  app.append(note);
  addPopover({ close: closeNodeMenu, exclusive: true, isOpen: () => !!menu, returnFocus: () => returnTo?.focus({ preventScroll: true }) });
  document.addEventListener('pointerdown', (e) => {
    if (menu && !menu.contains(e.target as Node)) closeNodeMenu();
  }, true);
  tape.addEventListener('contextmenu', (e) => {
    if (!canvas.isWide() || e.defaultPrevented || !isBackground(e.target as Element)) return;
    e.preventDefault();
    const point = clientPoint(e);
    openNodeMenu(point, world(point));
  });
  window.addEventListener('blur', cancelNodeDrag);
  narrow.addEventListener('change', cancelNodeDrag);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || (!menu && !drag)) return;
    e.preventDefault();
    if (menu) returnTo?.focus({ preventScroll: true });
    cancelNodeDrag();
  }, true);
  listEl.addEventListener('pointerdown', (e) => {
    skipClick = false;
    if (!canvas.isWide() || e.button !== 0 || !e.isPrimary) return;
    const hit = e.target as Element;
    const out = hit.closest<HTMLElement | SVGElement>(OUT);
    const input = hit.closest<HTMLElement>('.ng-sock-in.wired[data-editable="true"]');
    const origin = out ?? input;
    if (!origin) return;
    closePopovers();
    const start = clientPoint(e);
    const base = { pointer: e.pointerId, start, origin, originWorld: world(center(origin)), end: start, moved: false };
    drag = out ? { ...base, source: sourceOf(out) } : { ...base, pin: pinOf(input!) };
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const end = clientPoint(e);
    if (!drag.moved) {
      if (Math.hypot(end.x - drag.start.x, end.y - drag.start.y) < DRAG_SLOP) return;
      drag.moved = true;
      skipClick = true;
      // Capture on the stable world element because an SVG output dot can be redrawn mid-drag.
      if (e.isTrusted) listEl.setPointerCapture(e.pointerId);
      listEl.classList.add(drag.source ? 'ng-wiring-out' : 'ng-wiring-in');
    }
    drag.end = end;
    refreshNodeDrag();
  }, { capture: true });
  window.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    d.end = clientPoint(e);
    const { connection, empty } = targetOf(d);
    clearPreview();
    if (connection) {
      const result = connectPin(...args(), connection);
      if (!result.ok) return reject(nodeRejectionText(result.reason));
      if (editSheet('Connected input', result.changes)) {
        canvas.flash(connection.toId);
        canvas.pulse(connection.fromId);
      }
    } else if (empty && d.source) {
      openNodeMenu(d.end, world(d.end), d.origin instanceof HTMLElement ? d.origin : undefined, d);
    } else if (empty && d.pin) {
      unwireNodePin(d.pin.rowId, d.pin.pinIndex);
    }
  }, true);
  window.addEventListener('pointercancel', (e) => { if (e.pointerId === drag?.pointer) cancelNodeDrag(); });
  listEl.addEventListener('click', (e) => {
    if (skipClick && e.detail > 0) {
      skipClick = false;
      e.stopImmediatePropagation();
      return;
    }
    const target = e.target as Element;
    const out = target.closest<HTMLElement>('.ng-sock-out');
    if (out) canvas.insert(sourceOf(out).rowId);
    const input = target.closest<HTMLElement>('.ng-sock-in.wired');
    if (e.altKey && input) {
      const { rowId, pinIndex } = pinOf(input);
      unwireNodePin(rowId, pinIndex);
    }
  }, true);
}
