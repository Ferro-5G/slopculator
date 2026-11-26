// The canvas: every line but the one in the composer is a block. On a wide window blocks sit where they were put on a
// pannable, zoomable world, wired to what they use; on a narrow one they stack in the sheet's order as Cascade lays
// them out: pills as wide as their lines, dependents stepped right, wires straight down beside them.
// src/ui/canvas.ts and src/ui/cascade.ts decide the wires, placement and lanes; this draws them and takes the gestures.
import {
  BELOW_GAP, CLEAR_EXAMPLE, columnOrder, EXAMPLE_GRAPH, EXAMPLE_TITLE, exampleFrameRect, GRAPH_BLOCK, isExampleRow,
  PULSE_HOP_MS, pulseOrder, roundedPath, sheetWires, toWorld, wireKey, zoomAbout, type CanvasRow, type CanvasView, type Point, type Rect,
  type Size, type Wire,
} from '../ui/canvas';
import {
  DOT_PITCH, dragGraph, dragTo, DRAG_SLOP, FRAME_PAD, FRAME_TOP, GRAPH_MIN, GRAPH_SIZE, needsFreshFlow, viewRects, wideHomeView, wideScreen,
  wideLayout, wideWireRoute, ZOOM_STEP, type WideBlock, type WideScreen,
} from '../ui/canvaswide';
import { CASCADE_PHONE, cascadeColumn, cascadeGaps, cascadeWires, heldLit, heldTraces, type CascadeBlock, type CascadeOptions } from '../ui/cascade';
import { lineDefines, type RowResult } from '../engine/document';
import { portExpr, rowPorts } from '../ui/ports';
import { sheetNames, typeset } from '../ui/typeset';
import { beginDrag, dragHeld, focusedWire, focusWire, hasTag, initTags, keepTags, placeTags, releaseDrag, stateOf, syncTags, tagArrived, tagDrag, tagLayer, tagRun } from './wiretags';
import { drawNarrowTree, initUnfold, openLines, stepRect, syncUnfold, type OpenLine } from './unfold';
import { figurePorts, initFigures, syncFigures } from './figures';
import { initPsych, psychBlock, psychPorts, syncPsych } from './psych';
import { isPsychState, psychColumn, psychHosts, PSYCH_BLOCK } from '../ui/psych';
import { pairedRows } from '../ui/figures';
import { openLineEnds, tagSpot, trayRises } from '../ui/wireplace';
import { clearExample } from './example';
import { composerBox, composerRowId, editingId, editLine, finishEdit } from './composer';
import { h, icon } from './dom';
import { caretAt, mathNode } from './mathdom';
import { slotForEnd } from '../ui/slots';
import { copyableValue, selectedBlockActions, slotInfo } from '../ui/linestate';
import { deleteRow, pushStep, setDragListener } from './edits';
import { copy, motionNow } from './feedback';
import { app, composerDock, deskRail, exampleGraph, exampleGraphPane, graph, graphGrip, graphPane, graphResize, graphUnpin, listEl, tape, modeBar } from './layout';
import { insertText } from './lineeditor';
import { setRailReveal, syncRail } from './rail';
import { narrow, kb } from './platform';
import { focusRow, setHostedCheck, views } from './rowviews';
import { openLineMenu } from './rows';
import { doc, opts, results, rowIndex, saveSoon, sheetChanged } from './sheet';
import { CURVES, DURATIONS, STAGGER } from '../ui/motiontokens';
import { EMPTY_STARTERS, STARTERS } from '../ui/starters';
import { loadStarter } from './listtools';
import { cancelNodeDrag, initNodeGraph, nodeDragLayer, openNodeMenu, refreshNodeDrag, syncNodeSockets, unwireNodePin } from './nodegraph';
import { setNodesMode } from './shell';
import { nodeSheetWires } from '../ui/nodegraph';

const NS = 'http://www.w3.org/2000/svg';

let view: CanvasView = { scale: 1, dx: 0, dy: 0 };
/** True until the person pans or zooms: the view follows the sheet so all of it stays in sight. Fit all turns it back on. */
let autoView = true;
let wires: Wire[] = [];
/** Where each block was laid out last, in world units (wide) or in the column (narrow). */
let rects = new Map<string, Rect>();
let drawnWires = new Set<string>();
let wideTagRoutes: [string, Point[]][] = [];
const paths = new Map<string, SVGPathElement>();
/** Each block's last size, so a block lifted into the composer keeps its spot. */
const sizes = new Map<string, Size>();
let lift: { id: string; from: DOMRect } | null = null;
/** A block just dropped by a drag: it gives way to what it landed on, and keeps the spot it settles in. */
let dropped: string | null = null;
/** The room each open line's steps need under it (wide), and where its tray was laid out. */
let trayRoom = new Map<string, Size>();
/** The rows drawing a figure: they flow in the figures' column. */
let figureIds = new Set<string>();
const trayRects = new Map<string, Rect>();
/** The rows drawn inside the psychrometric chart's block, and the block each is in. */
let hostedIds = new Set<string>();
let hosts = new Map<string, string>();
/** Each readout port's height, in world units (wide) or in the column (narrow), by `row.port`. */
let portYs = new Map<string, number>();
const outPortYs = new Map<string, number>();
const inPortYs = new Map<string, number>();
/** A wire whose value tag was pinned by clicking it, or null. */
let pinnedWire: string | null = null;
/** The canvas block currently hovered on desktop, for highlighting its connected wires and peers. */
let hoveredBlock: string | null = null;
/** The canvas block tapped once on mobile, showing quick actions and highlighting its wires before editing. */
let selectedBlock: string | null = null;
let selectedCaret: number | undefined;

let blockSizes: ResizeObserver | null = null;
const watched = new WeakSet<Element>();

const svg = document.createElementNS(NS, 'svg');
svg.classList.add('cv-wires');
svg.setAttribute('aria-hidden', 'true');
const ghost = h('div', { class: 'blk-ghost', hidden: true, 'aria-hidden': 'true' });
/** On mobile, keeps the edited block anchored in the Cascade column while its field sits in the composer. */
const editPin = h('div', { class: 'blk blk-editing-pin', hidden: true, 'aria-hidden': 'true' });
const mobileActions = h('div', { class: 'mobile-actions', role: 'toolbar', 'aria-label': 'Selected line actions', hidden: true });
const clearBtn = h('button', { type: 'button', class: 'example-clear' }, CLEAR_EXAMPLE);
const exampleFrame = h('div', { class: 'example-frame', hidden: true, role: 'group', 'aria-label': EXAMPLE_TITLE }, clearBtn);

export const wide = (): boolean => !narrow.matches || doc.ui.nodes === true;
export function resetCanvasView(): void {
  autoView = true;
  cancelNodeDrag();
}
export const canvasWires = (): Wire[] => wires;
export const canvasView = (): CanvasView => view;
const motion = () => motionNow() === 'full';

function graphShown(): boolean {
  return doc.ui.graph !== false && (wires.some((w) => w.to === GRAPH_BLOCK) || !!doc.ui.graphPinned);
}
function blockEl(id: string): HTMLElement | undefined {
  if (!wide() && id === editingId && !hostedIds.has(id)) return editPin;
  return id === GRAPH_BLOCK ? graphPane : id === EXAMPLE_GRAPH ? exampleGraphPane : id === PSYCH_BLOCK ? psychBlock : views.get(id)?.el;
}
/** How much of the canvas's left edge the floating desktop sidebar takes, in viewport px. */
function railRoom(): number {
  if (!wide() || !deskRail.offsetParent) return 0;
  const r = deskRail.getBoundingClientRect(), t = tape.getBoundingClientRect();
  return Math.max(0, Math.round(r.right - t.left));
}
/** The part of the viewport the floating sidebar and top bar leave free, in viewport pixels. */
function freeArea(): Rect {
  const left = railRoom() ? railRoom() + 14 : 0;
  // Under the top bar, which floats over the canvas.
  const top = modeBar.parentElement === app ? modeBar.offsetHeight + 8 : 0;
  return { x: left, y: top, w: Math.max(200, tape.clientWidth - left), h: Math.max(160, tape.clientHeight - top - 16) };
}
function applyView(): void {
  listEl.style.transform = wide() ? `translate(${view.dx}px, ${view.dy}px) scale(${view.scale})` : '';
  tape.style.setProperty('--cv-scale', String(view.scale));
  tape.style.backgroundPosition = wide() ? `${view.dx}px ${view.dy}px` : '';
  tape.style.backgroundSize = wide() ? `${DOT_PITCH * view.scale}px ${DOT_PITCH * view.scale}px` : '';
  graph.setZoom(wide() ? view.scale : 1);
  exampleGraph.setZoom(wide() ? view.scale : 1);
  zoomOut.textContent = `${Math.round(view.scale * 100)}%`;
}
function setView(next: CanvasView, glide = false): void {
  if (glide && motion()) {
    listEl.classList.add('cv-glide');
    listEl.addEventListener('transitionend', (e) => { if (e.target === listEl) listEl.classList.remove('cv-glide'); }, { once: true });
  }
  view = next;
  applyView();
}

/** A row's block classes, from its result: the same for a block on the canvas and for measuring one in the composer. */
function blockKind(el: HTMLElement, row: CanvasRow, r: RowResult | undefined, on: boolean): void {
  el.classList.toggle('blk-slider', on && !!r?.slider);
  el.classList.toggle('blk-curve', on && !!r && r.graph.length > 0 && r.value === undefined && !r.slider);
  el.classList.toggle('blk-value', on && !!r && r.value !== undefined && !r.slider);
  el.classList.toggle('blk-example', on && isExampleRow(row));
}

/**
 * The size the line in the composer would have as a block, measured from a copy of its view laid out as one. Its
 * block is away while it's edited, so its last size goes stale as the line changes.
 */
function sizeAsBlock(id: string): Size | null {
  const v = views.get(id), k = rowIndex(id);
  if (!v || k < 0) return null;
  const copy = v.el.cloneNode(true) as HTMLElement;
  copy.classList.remove('in-composer', 'active', 'typing', 'calm-held', 'dragging');
  copy.classList.add('blk');
  blockKind(copy, doc.rows[k], results[k], true);
  for (const el of [copy, ...copy.querySelectorAll('[id]')]) el.removeAttribute('id');
  const tex = copy.querySelector<HTMLElement>('.tex');
  if (tex) tex.style.width = 'max-content';
  Object.assign(copy.style, { left: '0px', top: '0px', visibility: 'hidden', pointerEvents: 'none' });
  copy.setAttribute('aria-hidden', 'true');
  listEl.append(copy);
  const size = { w: copy.offsetWidth, h: copy.offsetHeight };
  copy.remove();
  return size.w > 0 && size.h > 0 ? size : null;
}

/** The drag whose curves the graphs trace, by its start (kept across a release and a quick press again). */
let tracedFrom: unknown = null;
/**
 * While a slider is held, and for the moment its changes linger: the blocks it reaches light up (heldLit), and each
 * graph traces, faint and dotted, where every curve it moves was when the drag began (heldTraces).
 */
function holdLook(): void {
  const d = tagDrag();
  const lit = heldLit(d);
  for (const [id, v] of views) v.el.classList.toggle('cv-lit', lit.has(id));
  graphPane.classList.toggle('cv-lit', lit.has(GRAPH_BLOCK));
  exampleGraphPane.classList.toggle('cv-lit', lit.has(EXAMPLE_GRAPH));
  if ((d?.start ?? null) === tracedFrom) return;
  tracedFrom = d?.start ?? null;
  for (const [g, id] of [[graph, GRAPH_BLOCK], [exampleGraph, EXAMPLE_GRAPH]] as const) {
    const moved = new Set(heldTraces(d, wires, id));
    g.setTraces(g.items.filter((it) => moved.has(it.rowId)));
  }
}

/** Lays the blocks out and draws the wires. Runs after every render. */
export function layoutCanvas(): void {
  wires = wide()
    ? nodeSheetWires(doc.rows, results, { lineNames: doc.settings.lineNames })
    : sheetWires(doc.rows, results, { lineNames: doc.settings.lineNames });
  const cid = composerRowId();
  doc.rows.forEach((row, k) => {
    const v = views.get(row.id);
    if (!v) return;
    const r = results[k];
    const inComposer = row.id === cid;
    const blank = row.kind === 'expr' && !row.text.trim() && !inComposer;
    v.el.classList.toggle('blk', !inComposer);
    v.el.classList.toggle('in-composer', inComposer);
    v.el.classList.toggle('blk-blank', blank);
    blockKind(v.el, row, r, !inComposer);
    v.el.classList.toggle('blk-editing', false);
    // A row moving into the composer drops the column's Cascade width, indent and gap with it.
    if (inComposer) { v.el.style.left = v.el.style.top = ''; Object.assign(v.el.style, { width: '', marginLeft: '', marginTop: '' }); }
  });
  const showGraph = graphShown();
  if (showGraph && graphPane.parentElement !== listEl) {
    listEl.append(graphPane);
    // The plot reads its colors from the page; it couldn't while the block was off it.
    graph.refreshTheme();
  }
  if (!showGraph && graphPane.isConnected) graphPane.remove();
  const showExampleGraph = doc.ui.graph !== false && wires.some((w) => w.to === EXAMPLE_GRAPH);
  if (showExampleGraph && exampleGraphPane.parentElement !== listEl) {
    listEl.append(exampleGraphPane);
    exampleGraph.refreshTheme();
  }
  if (!showExampleGraph && exampleGraphPane.isConnected) exampleGraphPane.remove();
  for (const el of [exampleFrame, ghost]) if (el.parentElement !== listEl) listEl.prepend(el);
  if (svg.parentNode !== listEl) listEl.prepend(svg);
  // The empty canvas centres in the open space right of the floating desktop sidebar.
  app.style.setProperty('--cv-rail-w', wide() ? `${railRoom()}px` : '0px');
  syncRail(cid, wide());
  for (const v of views.values()) if (!watched.has(v.el)) { watched.add(v.el); blockSizes?.observe(v.el); }
  if (tagLayer.parentElement !== listEl) listEl.append(tagLayer);
  // Tags and steps first: a narrow column keeps room above a block a tag rides into, and a wide line for its steps.
  syncTags(wires, motion(), !wide());
  holdLook();
  hostedIds = new Set(syncPsych(cid, wide()));
  hosts = psychHosts([...hostedIds].map((id) => ({ id })));
  if (psychBlock.isConnected && !watched.has(psychBlock)) { watched.add(psychBlock); blockSizes?.observe(psychBlock); }
  figureIds = syncFigures(cid, wide(), hostedIds);
  syncNodeSockets(wide(), hostedIds, figureIds);
  trayRoom = syncUnfold(listEl, cid, wide(), tagDrag(), sheetNames(doc.rows, results, doc.settings.lineNames), hostedIds);
  if (wide()) layoutWide(cid); else layoutNarrow(cid);
  measurePorts();
  drawWires();
  settleLift();
  syncEmpty();
}

/** On desktop the composer and keypad live inside the left sidebar, so nothing floats over the open canvas. */
function overlays(): Rect[] {
  return [];
}

function syncNarrowScrollEdges(): void {
  if (wide()) {
    listEl.classList.remove('fade-top', 'fade-bottom');
    return;
  }
  const top = listEl.scrollTop > 4;
  let bottom = false;
  if (listEl.clientHeight > 0 && listEl.scrollHeight - listEl.clientHeight > 4) {
    // Only show the bottom fade when a real block extends below the visible canvas, not just empty padding or overlays.
    const viewBottom = listEl.getBoundingClientRect().bottom;
    for (let i = listEl.children.length - 1; i >= 0; i--) {
      const el = listEl.children[i];
      if (el instanceof HTMLElement && !el.hidden && el.offsetHeight > 0 && getComputedStyle(el).position !== 'absolute') {
        bottom = el.getBoundingClientRect().bottom > viewBottom + 4;
        break;
      }
    }
  }
  listEl.classList.toggle('fade-top', top);
  listEl.classList.toggle('fade-bottom', bottom);
}

function layoutWide(cid: string): void {
  app.classList.toggle('narrow-nodes', narrow.matches);
  tape.classList.add('cv-wide');
  tape.classList.remove('cv-narrow');
  listEl.classList.remove('fade-top', 'fade-bottom');
  // The column's widths, steps and gaps (cascadeColumnLayout) don't carry over to the world.
  for (const el of [...[...views.values()].map((v) => v.el), psychBlock, exampleGraphPane, graphPane]) Object.assign(el.style, { marginLeft: '', marginTop: '' });
  for (const el of [...[...views.values()].map((v) => v.el), psychBlock, exampleGraphPane]) el.style.width = '';
  // Sheets from builds that stored every block's place are laid out afresh: only a dragged position is kept now.
  if (needsFreshFlow(doc.ui)) {
    for (const r of doc.rows) delete r.at;
    delete doc.ui.graphBlock;
    doc.ui.flow = 2;
    saveSoon();
  }
  const blocks: WideBlock[] = [];
  const paired = pairedRows(doc.rows, results);
  // The psychrometric chart flows where its first state would.
  const chart: WideBlock | null = psychBlock.isConnected ? { id: PSYCH_BLOCK, size: { w: psychBlock.offsetWidth, h: psychBlock.offsetHeight }, figure: true, at: doc.ui.psychAt } : null;
  for (const row of doc.rows) {
    const v = views.get(row.id);
    if (chart && hostedIds.has(row.id) && !blocks.includes(chart)) blocks.push(chart);
    // A state being changed in the composer keeps its place in the chart, not one of its own.
    if (!v || v.el.classList.contains('blk-blank') || hostedIds.has(row.id) || (chart && row.id === editingId && isPsychState(row, results[rowIndex(row.id)]))) continue;
    let size: Size;
    if (row.id === editingId) {
      // A block being edited keeps its place, so nothing lands on it while it's away in the composer, at the size it
      // will have: its ring grows and shrinks with the line being typed.
      size = sizeAsBlock(row.id) ?? sizes.get(row.id) ?? { w: 240, h: 52 };
    } else if (row.id === cid) continue;
    else {
      size = { w: v.el.offsetWidth, h: v.el.offsetHeight };
      sizes.set(row.id, size);
    }
    blocks.push({ id: row.id, size, example: isExampleRow(row), slider: !!results[rowIndex(row.id)]?.slider, figure: figureIds.has(row.id), feeds: paired.has(row.id), at: row.at, below: trayRoom.get(row.id) });
  }
  if (chart && !blocks.includes(chart)) blocks.push(chart);
  const covers = overlays();
  const laid = wideLayout({
    blocks,
    wires,
    graph: graphPane.isConnected ? { size: doc.ui.graphBlock ? { w: doc.ui.graphBlock.w, h: doc.ui.graphBlock.h } : GRAPH_SIZE, pinned: doc.ui.graphBlock ? { x: doc.ui.graphBlock.x, y: doc.ui.graphBlock.y } : undefined } : null,
    exampleGraph: exampleGraphPane.isConnected,
    bottom: (x, w) => Math.min(tape.clientHeight - 20, ...covers.filter((c) => x < c.x + c.w && c.x < x + w).map((c) => c.y - 20)),
    editingId,
    dropped,
    screen: homeScreen(),
    // While the pointer holds something (a slider, a point on the graph), nothing moves under it.
    keep: pointerDown ? rects : null,
    hosts,
  });
  // A block dropped by a drag keeps the spot it settled in.
  if (laid.dropped) {
    const { id, rect: r } = laid.dropped;
    if (id === GRAPH_BLOCK) doc.ui.graphBlock = { x: r.x, y: r.y, w: r.w, h: r.h };
    else if (id === PSYCH_BLOCK) doc.ui.psychAt = { x: r.x, y: r.y };
    else { const row = doc.rows[rowIndex(id)]; if (row) row.at = { x: r.x, y: r.y }; }
    saveSoon();
  }
  dropped = null;
  rects = laid.rects;
  frameRect = laid.frame;
  trayRects.clear();
  for (const [id, t] of laid.trays) trayRects.set(id, t);
  for (const [id, r] of rects) {
    const el = blockEl(id);
    if (!el || id === editingId || hostedIds.has(id)) continue;
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    if (id === GRAPH_BLOCK) { el.style.width = `${r.w}px`; el.style.height = `${r.h}px`; }
  }
  for (const [id, o] of openLines()) {
    const t = trayRects.get(id);
    if (t) Object.assign(o.tray.style, { left: `${t.x}px`, top: `${t.y}px` });
  }
  const er = editingId ? rects.get(editingId) : undefined;
  ghost.hidden = !er;
  if (er) Object.assign(ghost.style, { left: `${er.x}px`, top: `${er.y}px`, width: `${er.w}px`, height: `${er.h}px` });
  frameExample(FRAME_PAD, FRAME_TOP);
  editPin.hidden = true;
  if (editPin.parentElement === listEl) editPin.remove();
  syncNodeControls();
  syncMobileSelection();
  // Until the person pans or zooms, the view keeps the whole sheet in sight: at 100% while it fits, else zoomed out.
  // Never while the pointer is down (a slider held, a point dragged on the graph): the view would move what it holds.
  if (autoView && rects.size && !dragHeld() && !pointerDown && !holdView) setView(homeView());
  else if (holdView) {
    // If opening Steps/figure would have shrunk the canvas zoom, keep the user's current zoom rather than jolting on
    // the next unrelated click; Fit all brings auto-fit back.
    if (autoView && rects.size && homeView().scale < view.scale - 0.01) autoView = false;
    showTrays();
  } else {
    if (pointerDown) layoutDeferred = true;
    applyView();
  }
}
/** The example's frame on a wide canvas, as last laid out. */
let frameRect: Rect | null = null;

let holdView = false;
let pointerDown = false;
let layoutDeferred = false;
/** Pans just enough to bring an open tray that's mostly out of sight into the free part of the screen. */
function showTrays(): void {
  const a = freeArea();
  let dx = 0, dy = 0;
  for (const t of trayRects.values()) {
    const sx = t.x * view.scale + view.dx, sy = t.y * view.scale + view.dy, sw = t.w * view.scale, sh = t.h * view.scale;
    // Only when it's mostly out of sight: a tray that runs a little under the composer leaves its line be.
    if (sx > a.x + a.w - 120) dx = Math.min(dx, a.x + a.w - 24 - (sx + sw));
    if (sy > a.y + a.h - 80) dy = Math.min(dy, a.y + a.h - 24 - (sy + sh));
  }
  if (dx || dy) setView({ ...view, dx: view.dx + dx, dy: view.dy + dy }, true);
  else applyView();
}

/** Where the home view fits the sheet: the unobstructed canvas right of the floating sidebar and under the top bar. */
function homeScreen(): WideScreen {
  const t = tape.getBoundingClientRect();
  const top = modeBar.parentElement === app ? modeBar.offsetHeight + 8 : 0;
  const left = railRoom() ? railRoom() + 14 : 0;
  return wideScreen({ w: t.width, h: t.height }, top, null, null, left);
}
/** The view that shows the whole sheet (wideHomeView), with the composer and keys where they sit over the canvas. */
function homeView(): CanvasView {
  const s = homeScreen();
  return wideHomeView(viewRects({ rects, frame: frameRect, trays: trayRects }), s.area, s.composer, s.keys, s.free);
}

function layoutNarrow(cid: string): void {
  app.classList.remove('narrow-nodes');
  tape.classList.add('cv-narrow');
  tape.classList.remove('cv-wide');
  // The example's title takes room above the column; set it before anything is measured.
  listEl.classList.toggle('has-example', doc.rows.some((r) => isExampleRow(r) && r.id !== cid));
  for (const row of doc.rows) {
    const el = views.get(row.id)?.el;
    if (el) el.style.left = el.style.top = '';
  }
  Object.assign(graphPane.style, { left: '', top: '', width: '', height: '' });
  Object.assign(exampleGraphPane.style, { left: '', top: '', width: '', height: '' });
  Object.assign(psychBlock.style, { left: '', top: '' });
  ghost.hidden = true;
  const keepEditing = !!editingId && !hostedIds.has(editingId) && rowIndex(editingId) >= 0;
  if (keepEditing && editingId) {
    const k = rowIndex(editingId);
    const row = doc.rows[k];
    const names = sheetNames(doc.rows, results, doc.settings.lineNames);
    const expr = h('span', { class: 'edit-pin-expr' });
    if (row.kind === 'expr') {
      const boxes = typeset(row.text, { names, stack: false, listMax: 4 });
      if (boxes) expr.append(mathNode(boxes));
      else expr.textContent = row.text || '…';
    } else expr.textContent = 'Table';
    editPin.replaceChildren(expr, h('span', { class: 'edit-pin-tag' }, 'Editing'));
    editPin.hidden = false;
  } else {
    editPin.hidden = true;
    if (editPin.parentElement === listEl) editPin.remove();
  }
  let order = columnOrder(doc.rows.filter((r) => r.id !== cid || (keepEditing && r.id === editingId)), wires).filter((id) => (id !== GRAPH_BLOCK || graphPane.isConnected) && (id !== EXAMPLE_GRAPH || exampleGraphPane.isConnected));
  // The chart where its first state goes, its states (drawn inside it) after it.
  if (psychBlock.isConnected) {
    order = psychColumn(order, [...hostedIds]);
    if (!order.includes(PSYCH_BLOCK)) order.push(PSYCH_BLOCK);
  }
  const extras = 3; // svg, ghost and the example frame lead the list
  // Each open line's steps follow its block.
  const seq = order.filter((id) => !hostedIds.has(id)).flatMap((id) => [blockEl(id), openLines().get(id)?.tray].filter((el): el is HTMLElement => !!el));
  seq.forEach((el, i) => {
    if (listEl.children[i + extras] !== el) listEl.insertBefore(el, listEl.children[i + extras] ?? null);
  });
  trayRects.clear();
  cascadeColumnLayout(order.filter((id) => !hostedIds.has(id)));
  const lr = listEl.getBoundingClientRect();
  const chartBox = psychBlock.isConnected ? { x: psychBlock.offsetLeft, w: psychBlock.offsetWidth } : null;
  rects = new Map(order.flatMap((id) => {
    const el = blockEl(id);
    if (!el) return [];
    // A state inside the chart: its own height, at the chart's edges.
    if (hostedIds.has(id) && chartBox) {
      const r = el.getBoundingClientRect();
      return [[id, { x: chartBox.x, y: r.top - lr.top + listEl.scrollTop, w: chartBox.w, h: r.height }] as const];
    }
    return [[id, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }] as const];
  }));
  frameExample(8, tape.clientHeight > 0 && tape.clientHeight < 340 ? 28 : 34);
  syncNodeControls();
  syncMobileSelection();
  applyView();
  syncNarrowScrollEdges();
}

/** The column's Cascade options: its margin (the list's left padding) and the width between it and the right padding. */
function columnOptions(): CascadeOptions {
  const cs = getComputedStyle(listEl);
  const left = parseFloat(cs.paddingLeft) || CASCADE_PHONE.margin, right = parseFloat(cs.paddingRight) || 0;
  return { ...CASCADE_PHONE, margin: left, width: Math.max(CASCADE_PHONE.minW, listEl.clientWidth - left - right) };
}
/** The shortest a slider's track gets in the column, so it can still be dragged with a finger. */
const SLIDER_TRACK_MIN = 72;
/** Each block's left edge in the column as last laid out, kept while the pointer holds something. */
let keptX = new Map<string, number>();
/** What spans the column rather than sitting in it as a pill: the graphs, the chart, figures and tables. */
function spans(id: string): boolean {
  return id === GRAPH_BLOCK || id === EXAMPLE_GRAPH || id === PSYCH_BLOCK || figureIds.has(id) || doc.rows[rowIndex(id)]?.kind === 'table';
}
/**
 * Cascade's column (src/ui/cascade.ts): each block as wide as its line and stepped right by its depth, with room above
 * a block a tagged wire feeds. Blocks stay in the list's flow; this sets their widths, steps and gaps.
 */
function cascadeColumnLayout(ids: readonly string[]): void {
  const opts = columnOptions();
  const els = ids.map((id) => [id, blockEl(id)] as const).filter((e): e is readonly [string, HTMLElement] => !!e[1]);
  // Each line's own width first, unset.
  for (const [, el] of els) Object.assign(el.style, { width: '', marginLeft: '', marginTop: '' });
  // Rounded up: a pill a fraction of a pixel narrower than its line wraps it.
  const blocks: CascadeBlock[] = els.map(([id, el]) => {
    const w = Math.ceil(el.getBoundingClientRect().width);
    // A slider gives way by its track, down to SLIDER_TRACK_MIN, never by its label.
    const track = el.classList.contains('blk-slider') ? el.querySelector<HTMLElement>('input.slider') : null;
    return track ? { id, w, slider: true, least: w - track.offsetWidth + SLIDER_TRACK_MIN } : { id, w, span: spans(id) };
  });
  // While the pointer holds a slider or a point, nothing moves sideways under it.
  const holding = pointerDown || dragHeld();
  const across = cascadeColumn(blocks, wires, opts, holding ? keptX : null);
  keptX = new Map([...across].map(([id, c]) => [id, c.x]));
  const gaps = cascadeGaps(ids, wires, opts, (w) => hasTag(wireKey(w)));
  for (const [id, el] of els) {
    const c = across.get(id)!;
    Object.assign(el.style, { width: `${c.w}px`, marginLeft: `${c.x - opts.margin}px`, marginTop: `${gaps.get(id) ?? 0}px` });
  }
}

/** Each readout port's height, from where its readout row sits now. */
function measurePorts(): void {
  portYs = new Map();
  outPortYs.clear();
  inPortYs.clear();
  const lr = listEl.getBoundingClientRect();
  const scale = wide() ? view.scale : 1, scroll = wide() ? 0 : listEl.scrollTop;
  const transform = wide() ? svg.getScreenCTM() : null;
  if (transform) {
    for (const [id, v] of views) {
      const rect = rects.get(id);
      if (!rect) continue;
      const sockets = v.el.querySelectorAll<HTMLElement>('.ng-sock:not([hidden])');
      if (!sockets.length) continue;
      // Measure relative to the card so an entrance animation does not move the settled wire.
      const top = v.el.getBoundingClientRect().top;
      for (const socket of sockets) {
        const r = socket.getBoundingClientRect();
        if (!r.height) continue;
        const y = rect.y + (r.top + r.height / 2 - top) / transform.d;
        const pin = socket.dataset.pin;
        if (pin === undefined) outPortYs.set(id, y);
        else inPortYs.set(`${id}@${pin}`, y);
      }
    }
  }
  for (const map of [figurePorts(), psychPorts()]) for (const [id, ports] of map) {
    if (!rects.has(id) || id === editingId) continue;
    for (const [port, el] of ports) {
      const r = el.getBoundingClientRect();
      if (r.height) portYs.set(`${id}.${port}`, Math.round((r.top + r.height / 2 - lr.top) / scale + scroll));
    }
  }
}

/** The dashed group round the example's blocks and its own graph. */
function frameExample(pad: number, top: number): void {
  const ids = doc.rows.filter((r) => isExampleRow(r) && rects.has(r.id)).map((r) => r.id);
  if (ids.length && rects.has(EXAMPLE_GRAPH)) ids.push(EXAMPLE_GRAPH);
  const f = exampleFrameRect(ids.map((id) => rects.get(id)!), pad, top);
  exampleFrame.hidden = !f;
  listEl.classList.toggle('has-example', !!f);
  if (!f) return;
  // In the phone's column the frame stays inside it: from the gutter to just short of the right edge.
  if (!wide()) f.w = Math.min(f.w, tape.getBoundingClientRect().right - 6 - listEl.getBoundingClientRect().left - f.x);
  Object.assign(exampleFrame.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
}

/** Every open line's steps, in world units, so wires go round them. */
function allSteps(): { id: string; r: Rect }[] {
  const out: { id: string; r: Rect }[] = [];
  for (const [id, o] of openLines()) {
    const t = trayRects.get(id);
    if (t && o.layout) for (const sid of o.layout.rects.keys()) out.push({ id: `${id}/${sid}`, r: stepRect(o, sid, t)! });
  }
  return out;
}

/** A wide wire's route (wideWireRoute), round every block and every open line's steps, into a step when `toStep`. */
function routed(w: Wire, opts: { minRun?: number; toStep?: string; to?: Rect; outY?: number; inY?: number; inSlot?: { index: number; count: number } } = {}): Point[] | null {
  const isEx = (id: string) => id === EXAMPLE_GRAPH || isExampleRow(doc.rows[rowIndex(id)] ?? {});
  const extra = allSteps().filter((s) => s.id !== opts.toStep).map((s) => s.r);
  // The strip between an open line and its tray is where its steps rise into it: other wires keep out.
  for (const [id, t] of trayRects) { const l = rects.get(id); if (l && id !== w.from) extra.push({ x: t.x, y: l.y + l.h + 2, w: Math.max(t.w, l.w), h: BELOW_GAP - 4 }); }
  return wideWireRoute(w, wires, rects, frameRect, isEx, { editingId, minRun: opts.minRun, extra, to: opts.to, outY: opts.outY, inY: opts.inY, inSlot: opts.inSlot, hosts });
}

/** Runnable reference token for a block or one of its readout ports, inserted when clicking its output dot. */
function refForPort(rowId: string, port?: string): string {
  const k = rowIndex(rowId);
  const row = k >= 0 ? doc.rows[k] : undefined;
  const r = k >= 0 ? results[k] : undefined;
  const name = r?.defines ?? r?.slider?.name ?? (row?.kind === 'expr' ? lineDefines(row.text) : null) ?? (doc.settings.lineNames ? r?.lineName : null) ?? '';
  if (port && row) return portExpr(name, rowPorts(row, r)?.kind ?? null, port) || name;
  return name;
}

/** Inserts a block's variable or readout port reference into the composer and focuses it. */
function insertPortRef(rowId: string, port?: string): void {
  const ref = refForPort(rowId, port);
  if (!ref) { flashBlock(rowId); return; }
  focusRow(composerRowId());
  insertText(ref);
  flashBlock(rowId);
}

/** Appends a native SVG tooltip title to a port or wire element. */
function svgTitle(el: SVGElement, text: string): void {
  if (!text) return;
  const t = document.createElementNS(NS, 'title');
  t.textContent = text;
  el.append(t);
}

/** Highlights wires and neighbor blocks connected to the hovered/selected block or focused wire, without re-laying out. */
function syncPeerGlow(): void {
  const fk = focusedWire();
  const peers = new Set<string>();
  const activeFrom = hoveredBlock ?? (!wide() ? selectedBlock : null);
  if (fk) {
    const w = wires.find((x) => wireKey(x) === fk);
    if (w) { peers.add(hosts.get(w.from) ?? w.from); peers.add(hosts.get(w.to) ?? w.to); }
  } else if (activeFrom) {
    for (const w of wires) {
      const from = hosts.get(w.from) ?? w.from, to = hosts.get(w.to) ?? w.to;
      if (from === activeFrom) peers.add(to);
      if (to === activeFrom) peers.add(from);
    }
  }
  for (const el of svg.querySelectorAll<SVGElement>('path.w, circle.port-out, circle.port-in')) {
    const f = el.dataset.from, t = el.dataset.to;
    el.classList.toggle('rel', !fk && !!activeFrom && (f === activeFrom || t === activeFrom));
  }
  for (const [id, v] of views) v.el.classList.toggle('cv-peer', peers.has(id));
  graphPane.classList.toggle('cv-peer', peers.has(GRAPH_BLOCK));
  exampleGraphPane.classList.toggle('cv-peer', peers.has(EXAMPLE_GRAPH));
  psychBlock.classList.toggle('cv-peer', peers.has(PSYCH_BLOCK));
}

function setSelectedBlock(id: string | null): void {
  if (selectedBlock === id) return;
  selectedBlock = id;
  if (!id) selectedCaret = undefined;
  syncMobileSelection();
}

function syncMobileSelection(): void {
  if (wide() || editingId) selectedBlock = null;
  const k = selectedBlock ? rowIndex(selectedBlock) : -1;
  if (selectedBlock && k < 0) selectedBlock = null;
  for (const [id, v] of views) v.el.classList.toggle('cv-selected', !wide() && id === selectedBlock);
  syncPeerGlow();
  if (wide() || !selectedBlock || k < 0) {
    mobileActions.hidden = true;
    mobileActions.replaceChildren();
    nodesPillBtn.hidden = !narrow.matches || wide();
    return;
  }
  const row = doc.rows[k];
  const r = results[k];
  const id = selectedBlock;
  const btns = selectedBlockActions(row, r, opts()).map((act) => {
    const cls = `mob-act mob-act-${act.id}${act.primary ? ' primary' : ''}${act.danger ? ' danger' : ''}`;
    const b = h('button', { type: 'button', class: cls, 'aria-label': act.id === 'more' ? 'More line actions' : act.label }, act.label);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (act.id === 'edit') {
        const caret = selectedCaret;
        setSelectedBlock(null);
        editLine(id, caret);
      } else if (act.id === 'copy') {
        const fn = copyableValue(r, opts());
        if (fn) void copy(fn(), views.get(id)?.el.querySelector('.out .result, .dist-prob'));
        setSelectedBlock(null);
      } else if (act.id === 'toggleGraph') {
        row.hidden = !row.hidden;
        sheetChanged();
      } else if (act.id === 'delete') {
        setSelectedBlock(null);
        deleteRow(id);
      } else if (act.id === 'more') {
        const br = b.getBoundingClientRect();
        openLineMenu(row, br.left, br.top - 10);
      }
    });
    return b;
  });
  mobileActions.replaceChildren(...btns);
  mobileActions.hidden = false;
  nodesPillBtn.hidden = true;
}

/** A wire's path and its two ports. `state` is lit, dim, focus or plain; err dashes it coral (after a failing step). */
function wireEls(d: string, from: Point, to: Point, cls: string[]): SVGElement[] {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.classList.add('w', ...cls);
  const out = document.createElementNS(NS, 'circle');
  out.setAttribute('cx', String(from.x));
  out.setAttribute('cy', String(from.y));
  out.setAttribute('r', '3');
  out.classList.add('port-out', ...cls);
  const inn = document.createElementNS(NS, 'circle');
  inn.setAttribute('cx', String(to.x));
  inn.setAttribute('cy', String(to.y));
  inn.setAttribute('r', '3.5');
  inn.classList.add('port-in', ...cls);
  return [p, out, inn];
}

/** Tags a wire's path, ports, and hit stroke with metadata so delegated handlers on `svg` work across redraws. */
function bindWireNodes(w: Wire, key: string, d: string, els: SVGElement[], hits: SVGElement[]): void {
  const [p, out, inn] = els;
  const fromHost = hosts.get(w.from) ?? w.from, toHost = hosts.get(w.to) ?? w.to;
  for (const el of els) {
    el.dataset.from = fromHost;
    el.dataset.to = toHost;
    el.dataset.row = w.from;
    el.dataset.key = key;
    if (w.fromPort) el.dataset.port = w.fromPort;
  }
  const outRef = refForPort(w.from, w.fromPort);
  if (outRef) svgTitle(out, `Insert ${outRef}`);
  if (w.name) svgTitle(inn, `Inspect ${w.name}`);
  const hit = document.createElementNS(NS, 'path');
  hit.setAttribute('d', d);
  hit.classList.add('hit');
  hit.dataset.from = fromHost;
  hit.dataset.to = toHost;
  hit.dataset.row = w.from;
  hit.dataset.key = key;
  if (w.toPin !== undefined) hit.dataset.toPin = String(w.toPin);
  hits.push(hit);
  p.dataset.from = fromHost;
  p.dataset.to = toHost;
}

/** An open line's tree on a wide canvas: each step into the step that reads it, and the top steps up into the line. */
function trayWires(o: OpenLine, line: Rect, tray: Rect): SVGElement[] {
  const kids: SVGElement[] = [];
  if (!o.layout) return kids;
  const ok = (sid: string) => o.u.steps.find((s) => s.id === sid)?.status === 'ok';
  const at = (p: Point) => ({ x: p.x + tray.x, y: p.y + tray.y });
  for (const l of o.layout.links) {
    const pts = l.points.map(at);
    kids.push(...wireEls(roundedPath(pts), pts[0], pts[pts.length - 1], ['step', ...(ok(l.from) ? [] : ['err'])]));
  }
  const tops = o.u.line.reads.map((id) => ({ id, rect: stepRect(o, id, tray)! }));
  for (const { id, points } of trayRises(tops, line)) kids.push(...wireEls(roundedPath(points), points[0], points[points.length - 1], ['step', ...(ok(id) ? [] : ['err'])]));
  return kids;
}

/** Socket routes can run down the side of a block. Use an earlier segment if the tag would cover the card. */
function clearTagRuns(entries: [string, Point[]][]): [string, Point[]][] {
  const tags = new Map([...tagLayer.querySelectorAll<HTMLElement>('.cv-tag.on')].map((tag) => [tag.dataset.key, tag]));
  if (!tags.size) return entries;
  const blocks = [...new Set(rects.values()), ...trayRects.values()];
  return entries.map(([key, points]) => {
    const tag = tags.get(key);
    if (!tag) return [key, points];
    const w = tag.offsetWidth, h = tag.offsetHeight;
    const clear = (run: Point[]) => {
      const { x, y, vert } = tagSpot(run, w, h);
      const pad = vert ? 4 : 0;
      return blocks.every((r) => x + w / 2 + pad <= r.x || x - w / 2 - pad >= r.x + r.w || y + h / 2 <= r.y || y - h / 2 >= r.y + r.h);
    };
    if (clear(points)) return [key, points];
    for (let i = points.length - 1; i > 0; i--) {
      const [a, b] = [points[i - 1], points[i]];
      const room = a.x === b.x ? Math.abs(a.y - b.y) >= h + 16 : Math.abs(a.x - b.x) >= w + 20;
      if (room && clear([a, b])) return [key, [a, b]];
    }
    return [key, points];
  });
}

function drawWires(): void {
  const isWide = wide();
  // A narrow column's wires: straight down through open lanes, the margin only when none is open (cascadeWires).
  const trays = isWide ? [] : [...openLines().values()].map((o) => ({ x: o.tray.offsetLeft, y: o.tray.offsetTop, w: o.tray.offsetWidth, h: o.tray.offsetHeight })).filter((r) => r.w > 0);
  const routes = isWide ? null : cascadeWires(rects, wires, {
    ...columnOptions(), side: hostedIds, obstacles: trays, outY: (w) => (w.fromPort ? portYs.get(`${w.from}.${w.fromPort}`) : undefined),
  });
  const kids: SVGElement[] = [];
  const hits: SVGElement[] = [];
  const now = new Set<string>();
  const tagged: [string, Point[]][] = [];
  paths.clear();
  const animate = motion() && drawnWires.size + (lift ? 0 : 1) > 0;
  const open = isWide ? openLines() : new Map<string, OpenLine>();
  // Count incoming wires per open step so several wires into one step spread cleanly along its edge.
  const stepIncoming = new Map<string, Wire[]>();
  if (isWide) {
    for (const w of wires) {
      if (w.from === editingId || w.to === editingId || !w.name) continue;
      const o = open.get(w.to);
      if (!o || !trayRects.has(w.to)) continue;
      for (const sid of openLineEnds(o.u, w.name).steps) {
        const sk = `${w.to}/${sid}`;
        const list = stepIncoming.get(sk) ?? [];
        list.push(w);
        stepIncoming.set(sk, list);
      }
    }
    for (const list of stepIncoming.values()) list.sort((p, q) => (rects.get(p.from)?.y ?? 0) - (rects.get(q.from)?.y ?? 0));
  }
  for (const w of wires) {
    const a = rects.get(w.from), b = rects.get(w.to);
    if (!a || !b || (isWide && (w.from === editingId || w.to === editingId))) continue;
    const key = wireKey(w);
    const state = stateOf(key);
    const o = open.get(w.to), tray = trayRects.get(w.to);
    const outY = w.fromPort ? portYs.get(`${w.from}.${w.fromPort}`) : outPortYs.get(w.from);
    const inY = w.toPin === undefined ? undefined : inPortYs.get(`${w.to}@${w.toPin}`);
    if (o && tray && w.name) {
      // Into an open line: to each step that reads the name itself, and to the line only if it reads it itself.
      const ends = openLineEnds(o.u, w.name);
      let firstPts: Point[] | null = null;
      for (const sid of ends.steps) {
        const sr = stepRect(o, sid, tray);
        if (!sr) continue;
        const sk = `${w.to}/${sid}`;
        const group = stepIncoming.get(sk) ?? [w];
        const pts = routed(w, { toStep: sk, to: sr, outY, inSlot: { index: Math.max(0, group.indexOf(w)), count: group.length } });
        if (!pts) continue;
        const sd = roundedPath(pts);
        const els = wireEls(sd, pts[0], pts[pts.length - 1], [state]);
        if (!w.fromPort && outY !== undefined) els[1].classList.add('ng-routed');
        bindWireNodes(w, key, sd, els, hits);
        if (!firstPts && inY === undefined) {
          firstPts = pts;
          paths.set(key, els[0] as SVGPathElement);
          tagged.push([key, pts]);
          now.add(key);
        }
        kids.push(...els);
      }
      if (!ends.line && inY === undefined) continue;
    }
    let d: string, from: Point, to: Point;
    if (routes) {
      const r = routes.get(key);
      if (!r) continue;
      d = roundedPath(r.points, 6); from = r.points[0]; to = r.points[r.points.length - 1];
      tagged.push([key, r.points]);
    } else {
      const pts = routed(w, { minRun: tagRun(key), outY, inY });
      if (!pts) continue;
      d = roundedPath(pts); from = pts[0]; to = pts[pts.length - 1];
      tagged.push([key, pts]);
    }
    const els = wireEls(d, from, to, [state]);
    const p = els[0] as SVGPathElement;
    if (!w.fromPort && outY !== undefined) els[1].classList.add('ng-routed');
    if (inY !== undefined) els[2].classList.add('ng-routed');
    bindWireNodes(w, key, d, els, hits);
    if (animate && !drawnWires.has(key) && drawnWires.size > 0) p.classList.add('draw-in');
    paths.set(key, p);
    now.add(key);
    kids.push(...els);
  }
  for (const [id, o] of open) {
    const line = rects.get(id), tray = trayRects.get(id);
    if (line && tray) kids.push(...trayWires(o, line, tray));
  }
  // A port no wire leaves from: a small hollow dot on the block's edge; clicking it inserts that readout into the composer.
  const usedPorts = new Set(wires.filter((w) => w.fromPort && now.has(wireKey(w))).map((w) => `${w.from}.${w.fromPort}`));
  for (const [key, y] of portYs) {
    if (usedPorts.has(key)) continue;
    const sep = key.indexOf('.');
    const rowId = key.slice(0, sep), port = key.slice(sep + 1);
    const r = rects.get(rowId);
    if (!r) continue;
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(isWide ? r.x + r.w : r.x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', '2.8');
    dot.classList.add('port-free');
    dot.dataset.row = rowId;
    dot.dataset.port = port;
    const ref = refForPort(rowId, port);
    svgTitle(dot, ref ? `Insert ${ref}` : port);
    kids.push(dot);
  }
  // A pulse in flight keeps running over the redrawn wires (a slider drag redraws them on every step).
  const flying = [...svg.querySelectorAll('path.pulse')];
  svg.replaceChildren(...hits, ...kids, ...flying, nodeDragLayer);
  refreshNodeDrag();
  if (pinnedWire && !now.has(pinnedWire)) pinnedWire = null;
  syncPeerGlow();
  for (const p of svg.querySelectorAll<SVGPathElement>('path.draw-in')) {
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 420, delay: lift ? 260 : 0, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' })
      .finished.then(() => { p.style.strokeDasharray = ''; }, () => {});
  }
  drawnWires = now;
  keepTags(now);
  wideTagRoutes = isWide ? tagged : [];
  if (isWide) placeTags(clearTagRuns(wideTagRoutes));
  else placeTags(tagged, { blocks: [...rects.values(), ...trays], bounds: { x: 2, y: 0, w: listEl.clientWidth - 4, h: Math.max(listEl.scrollHeight, listEl.clientHeight) } });
  if (!isWide) for (const o of openLines().values()) drawNarrowTree(o);
}

/** A sent line glides from where it was in the composer to its block; a block placed out of view brings the canvas to it. */
export function liftFrom(id: string, from: DOMRect | null): void {
  if (from) lift = { id, from };
}
function settleLift(): void {
  const l = lift;
  lift = null;
  if (!l) return;
  const el = views.get(l.id)?.el;
  const r = rects.get(l.id);
  if (!el || !r || !el.isConnected) return;
  if (!wide()) {
    const target = el.offsetTop + el.offsetHeight - listEl.clientHeight + 18;
    if (target > listEl.scrollTop) listEl.scrollTo({ top: target, behavior: motion() ? 'smooth' : 'auto' });
    syncNarrowScrollEdges();
  }
  if (wide() && !autoView) {
    const a = freeArea();
    const sx = r.x * view.scale + view.dx, sy = r.y * view.scale + view.dy;
    const sw = r.w * view.scale, sh = r.h * view.scale;
    if (sx < a.x + 16 || sy < a.y + 16 || sx + sw > a.x + a.w - 16 || sy + sh > a.y + a.h - 16) {
      setView({ ...view, dx: view.dx + Math.min(0, a.x + a.w - 40 - (sx + sw)) + Math.max(0, a.x + 40 - sx), dy: view.dy + Math.min(0, a.y + a.h - 40 - (sy + sh)) + Math.max(0, a.y + 40 - sy) });
    }
  }
  const m = motionNow();
  if (m === 'off') return;
  // The live answer was the accent while it was typed; once sent it cools into the block's own ink.
  const ans = el.querySelector<HTMLElement>('.out .result');
  if (ans) ans.animate([{ color: 'var(--cv-accent)' }, { color: getComputedStyle(ans).color }], { duration: DURATIONS.answerCool, easing: CURVES.cool });
  if (m !== 'full') return;
  const to = el.getBoundingClientRect();
  const s = wide() ? view.scale : 1;
  el.animate([
    { transform: `translate(${(l.from.left - to.left) / s}px, ${(l.from.top - to.top) / s}px)`, opacity: 0.55 },
    { transform: 'none', opacity: 1 },
  ], { duration: DURATIONS.launch, easing: CURVES.launch });
  // Aurora Glow: only the block that just landed glows, briefly (its look's animation takes the class off).
  if (document.documentElement.hasAttribute('data-glow')) {
    el.classList.remove('landed');
    void el.offsetWidth;
    el.classList.add('landed');
    const off = (e: AnimationEvent) => {
      if (e.animationName !== 'au-land') return;
      el.classList.remove('landed');
      el.removeEventListener('animationend', off);
    };
    el.addEventListener('animationend', off);
  }
}

/** A gentle bell curve over its baseline, in a 64-unit square: the empty canvas's mark. */
function bellPath(): { line: string; fill: string } {
  const at = (x: number) => 52 - 38 * Math.exp(-(((x - 32) / 9.5) ** 2) / 2);
  const pts: string[] = [];
  for (let x = 6; x <= 58; x += 2) pts.push(`${x} ${at(x).toFixed(2)}`);
  const under: string[] = [];
  for (let x = 24; x <= 40; x += 2) under.push(`${x} ${at(x).toFixed(2)}`);
  return { line: `M${pts.join(' L')}`, fill: `M24 52 L${under.join(' L')} L40 52 Z` };
}
let emptyEl: HTMLElement | null = null;
/**
 * The open canvas before anything is on it: a bell curve that draws itself once, and a few starters to begin from.
 * It sits beside the list of lines, never in it, and gives way as soon as a line exists or anything is typed.
 */
function emptyCanvas(): HTMLElement {
  if (emptyEl) return emptyEl;
  const { line, fill } = bellPath();
  const mark = document.createElementNS(NS, 'svg');
  mark.setAttribute('class', 'cv-empty-mark');
  mark.setAttribute('viewBox', '0 0 64 64');
  mark.setAttribute('width', '64');
  mark.setAttribute('height', '64');
  mark.setAttribute('aria-hidden', 'true');
  for (const [cls, d] of [['area', fill], ['base', 'M4 52 H60'], ['curve', line]] as const) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('class', cls);
    p.setAttribute('d', d);
    if (cls !== 'area') p.setAttribute('pathLength', '1');
    mark.append(p);
  }
  const chips = EMPTY_STARTERS.flatMap((id) => STARTERS.filter((x) => x.id === id)).map((ex, i) => {
    const b = h('button', { type: 'button', class: 'cv-empty-chip', title: ex.subtitle ?? ex.title }, ex.title);
    b.style.setProperty('--i', String(i));
    b.style.setProperty('--stagger', `${STAGGER.starterMs}ms`);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => loadStarter(ex));
    return b;
  });
  emptyEl = h('div', { class: 'cv-empty', hidden: true },
    h('div', { class: 'cv-empty-badge', 'aria-hidden': 'true' }, mark),
    h('div', { class: 'cv-empty-starters', role: 'group', 'aria-label': 'Start with an example' }, ...chips));
  return emptyEl;
}
/** Shows the empty canvas while the sheet has no blocks, graphs, or active edit; fades it out otherwise. */
function syncEmpty(): void {
  const empty = !editingId
    && !graphPane.isConnected
    && !exampleGraphPane.isConnected
    && !psychBlock.isConnected
    && doc.rows.every((r) => r.kind === 'expr' && !r.text.trim());
  if (!empty && !emptyEl) return;
  const el = emptyCanvas();
  if (el.parentElement !== tape) tape.append(el);
  if (empty) el.hidden = false;
  el.classList.toggle('gone', !empty);
}

/** A ring that comes and goes on a block: where an edit or an update landed. */
export function flashBlock(id: string): void {
  const el = blockEl(id);
  if (!el || !motion()) return;
  el.animate([{ boxShadow: '0 0 0 2px var(--cv-accent), 0 0 0 8px var(--cv-accent-soft)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 650, easing: 'ease-out' });
}

let lastPulse = 0;
/** A slider moved: a pulse runs down its wires, and each block it reaches lights as it arrives. */
function sendPulse(fromId: string): void {
  // A value dragged with nothing held (a point on the graph): its tags show while it moves, and linger after.
  if (!dragHeld()) steady(fromId, () => { beginDrag(fromId, wires); releaseDrag(); });
  if (!motion()) return;
  const now = performance.now();
  if (now - lastPulse < 260) return;
  lastPulse = now;
  const order = pulseOrder(wires, fromId);
  const hopOf = new Map([[fromId, 0], ...order.map((o) => [o.id, o.hop] as const)]);
  for (const w of wires) {
    const hop = hopOf.get(w.from);
    if (hop === undefined || !hopOf.has(w.to)) continue;
    const p = paths.get(wireKey(w));
    if (!p) continue;
    const len = p.getTotalLength();
    const glow = p.cloneNode() as SVGPathElement;
    glow.classList.remove('w', 'draw-in');
    glow.classList.add('pulse');
    glow.style.strokeDasharray = `18 ${len + 18}`;
    svg.append(glow);
    const key = wireKey(w);
    // The wire's tag shows the new value as the pulse reaches its end.
    glow.animate([{ strokeDashoffset: 18 }, { strokeDashoffset: -len }], { duration: PULSE_HOP_MS * 2, delay: hop * PULSE_HOP_MS, easing: 'linear', fill: 'both' })
      .finished.then(() => {
        glow.remove();
        tagArrived(key, true);
        // Its new value may be wide enough to need a different segment.
        if (wide() && wideTagRoutes.length) placeTags(clearTagRuns(wideTagRoutes));
      }, () => glow.remove());
  }
  for (const { id, hop } of order) {
    const el = blockEl(id);
    el?.animate([{ boxShadow: '0 0 0 1.5px var(--cv-accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 420, delay: hop * PULSE_HOP_MS * 1.6, easing: 'ease-out' });
  }
}

// Zoom and fit, in the top bar on a wide window.
const zoomBtn = (label: string, title: string, run: () => void, cls = 'cv-btn') => h('button', { type: 'button', class: cls, ...(title ? { title: kb(title) } : {}), onclick: run }, label);
const zoomOut = h('output', { class: 'cv-zoom', 'aria-live': 'off' }, '100%');
const addNodeBtn = zoomBtn('+ Node', 'Add math node', () => addMathNode(addNodeBtn));
addNodeBtn.setAttribute('aria-haspopup', 'dialog');
const nodesBackBtn = zoomBtn('← List', 'Back to list view', () => setNodesMode(false), 'cv-btn cv-nodes-back');
nodesBackBtn.hidden = true;
const nodesPillBtn = h('button', { type: 'button', class: 'cv-nodes-pill', 'aria-label': 'Switch to node canvas', title: 'Switch to node canvas', hidden: true, onclick: () => setNodesMode(true) });
nodesPillBtn.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><path d="M5.4 5.2H8.5C9.4 5.2 9.4 10.8 10.6 10.8M5.4 10.8H7.2" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/><circle cx="3.6" cy="5.2" r="1.6" fill="currentColor"/><circle cx="3.6" cy="10.8" r="1.6" fill="currentColor"/><circle cx="12.2" cy="10.8" r="1.6" fill="currentColor"/></svg>';
const tidyBtn = zoomBtn('Reset layout', '', () => resetAllLayout(), 'cv-btn cv-reset');
tidyBtn.setAttribute('aria-label', 'Reset layout');
tidyBtn.replaceChildren(icon('home'), h('span', { class: 'cv-reset-label' }, 'Reset layout'));
tidyBtn.hidden = true;
function hasPinnedNodes(): boolean {
  return !!doc.ui.graphBlock || !!doc.ui.psychAt || doc.rows.some((r) => !!r.at);
}
function syncNodeControls(): void {
  const wideNow = wide();
  const compactWide = narrow.matches && wideNow;
  graphUnpin.hidden = !wideNow || !doc.ui.graphBlock;
  tidyBtn.hidden = !wideNow || !hasPinnedNodes();
  addNodeBtn.hidden = !wideNow;
  nodesBackBtn.hidden = !compactWide;
  nodesPillBtn.hidden = !narrow.matches || wideNow || !mobileActions.hidden;
}
function glideBlocks(): void {
  if (!motion()) return;
  listEl.classList.add('cv-settle');
  const off = (e: TransitionEvent) => {
    if ((e.target as Element)?.parentElement !== listEl) return;
    listEl.classList.remove('cv-settle');
    listEl.removeEventListener('transitionend', off);
  };
  listEl.addEventListener('transitionend', off);
}
function resetGraphLayout(): void {
  if (!doc.ui.graphBlock) return;
  const before = { ...doc.ui.graphBlock };
  const apply = (next: typeof before | undefined) => {
    glideBlocks();
    if (next) doc.ui.graphBlock = { ...next };
    else delete doc.ui.graphBlock;
    autoView = true;
    saveSoon();
    layoutCanvas();
  };
  apply(undefined);
  pushStep({ label: 'Graph back to auto layout', undo: () => apply(before), redo: () => apply(undefined) });
}
function resetGraphSize(): void {
  const cur = doc.ui.graphBlock;
  if (!cur || (cur.w === GRAPH_SIZE.w && cur.h === GRAPH_SIZE.h)) return;
  const before = { ...cur };
  const after = { x: cur.x, y: cur.y, w: GRAPH_SIZE.w, h: GRAPH_SIZE.h };
  const apply = (next: typeof before) => {
    glideBlocks();
    doc.ui.graphBlock = { ...next };
    saveSoon();
    layoutCanvas();
  };
  apply(after);
  pushStep({ label: 'Reset graph size', undo: () => apply(before), redo: () => apply(after) });
}
function resetAllLayout(): void {
  if (!hasPinnedNodes()) return;
  const prevRows = new Map(doc.rows.filter((r) => r.at).map((r) => [r.id, { ...r.at! }]));
  const prevGraph = doc.ui.graphBlock ? { ...doc.ui.graphBlock } : undefined;
  const prevPsych = doc.ui.psychAt ? { ...doc.ui.psychAt } : undefined;
  const clearAll = () => {
    glideBlocks();
    for (const r of doc.rows) delete r.at;
    delete doc.ui.graphBlock;
    delete doc.ui.psychAt;
    autoView = true;
    saveSoon();
    layoutCanvas();
  };
  const restoreAll = () => {
    glideBlocks();
    for (const r of doc.rows) {
      const p = prevRows.get(r.id);
      if (p) r.at = { ...p };
      else delete r.at;
    }
    if (prevGraph) doc.ui.graphBlock = { ...prevGraph };
    else delete doc.ui.graphBlock;
    if (prevPsych) doc.ui.psychAt = { ...prevPsych };
    else delete doc.ui.psychAt;
    saveSoon();
    layoutCanvas();
  };
  clearAll();
  pushStep({ label: 'Reset canvas layout', undo: restoreAll, redo: clearAll });
}
export function zoomBy(factor: number): void {
  autoView = false;
  const a = freeArea();
  setView(zoomAbout(view, factor, { x: a.x + a.w / 2, y: a.y + a.h / 2 }), true);
}
export function fitCanvas(): void {
  if (!rects.size) return;
  autoView = true;
  setView(homeView(), true);
}
/** Smoothly pans the wide canvas so a block (or its host psychrometric card) sits inside the unobstructed viewport. */
export function revealBlock(id: string): void {
  if (!wide()) return;
  const targetId = hosts.get(id) ?? id;
  const r = rects.get(targetId);
  if (!r) return;
  const a = freeArea();
  const pad = 24;
  const sx1 = view.dx + r.x * view.scale;
  const sy1 = view.dy + r.y * view.scale;
  const sx2 = sx1 + r.w * view.scale;
  const sy2 = sy1 + r.h * view.scale;
  let dx = 0, dy = 0;
  if (sx1 < a.x + pad) dx = a.x + pad - sx1;
  else if (sx2 > a.x + a.w - pad) dx = a.x + a.w - pad - sx2;
  if (sy1 < a.y + pad) dy = a.y + pad - sy1;
  else if (sy2 > a.y + a.h - pad) dy = a.y + a.h - pad - sy2;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    autoView = false;
    setView({ scale: view.scale, dx: view.dx + dx, dy: view.dy + dy }, true);
  }
}
/** Give a node spawned from the toolbar or Find a clear spot in the part of the canvas in view. */
export function addMathNode(trigger?: HTMLElement): void {
  if (!wide()) return;
  const bounds = freeArea(), frame = tape.getBoundingClientRect();
  const blocks = [...rects.values(), ...trayRects.values()];
  const w = 340 * view.scale, h = 200 * view.scale;
  const first = { x: bounds.x + 18, y: bounds.y + 32 };
  let at = first;
  findSpot: for (let y = first.y; y <= Math.max(first.y, bounds.y + bounds.h - h); y += 32) {
    for (let x = first.x; x <= Math.max(first.x, bounds.x + bounds.w - w); x += 32) {
      const p = toWorld(view, { x, y });
      const room = { x: p.x - 18, y: p.y - 18, w: 358, h: 218 };
      if (blocks.some((r) => room.x < r.x + r.w && r.x < room.x + room.w && room.y < r.y + r.h && r.y < room.y + room.h)) continue;
      at = { x, y };
      break findSpot;
    }
  }
  const r = trigger?.getBoundingClientRect();
  openNodeMenu(r ? { x: r.left, y: r.bottom + 6 } : { x: frame.left + at.x, y: frame.top + at.y }, toWorld(view, at), trigger);
}

export const canvasTools = h('div', { class: 'cv-tools', role: 'group', 'aria-label': 'Canvas' },
  nodesBackBtn,
  zoomBtn('−', 'Zoom out (Ctrl+Alt+−)', () => zoomBy(1 / ZOOM_STEP), 'cv-btn cv-zoom-btn'),
  zoomOut,
  zoomBtn('+', 'Zoom in (Ctrl+Alt+=)', () => zoomBy(ZOOM_STEP), 'cv-btn cv-zoom-btn'),
  zoomBtn('Fit all', 'Fit all (Ctrl+Alt+0)', () => fitCanvas(), 'cv-btn cv-sep'),
  addNodeBtn,
  tidyBtn,
);

/** What a press on the canvas takes no notice of: controls inside blocks keep their own. A value block's answer button
 * (.result) still lets a drag move the block, while a plain click on it copies as always. */
const ownsPointer = (t: Element) => !!t.closest('.ng-sock, .ng-pin-val, .ng-pin-unwire, .ng-menu, input:not(.expr), button:not(.result), select, textarea, a, label, .extra, .tbl, .graph-host, .graph-dock, .blk-resize, .example-frame, .blk-example-graph, .fh:not(.fixed), .cv-seg');

/** The block a drag holds, kept still on a narrow canvas while tags come and go above it. */
let held: string | null = null;
function steady(id: string | null, fn: () => void): void {
  const el = !wide() && id ? views.get(id)?.el : undefined;
  const before = el?.getBoundingClientRect().top;
  fn();
  if (el && before !== undefined) listEl.scrollTop += el.getBoundingClientRect().top - before;
}

export function initCanvas(): void {
  setRailReveal(revealBlock);
  initTags(() => steady(held, layoutCanvas));
  // Opening or closing a line's steps never moves the line: the view stays, and pans only to bring the steps in sight.
  initUnfold(() => { holdView = true; layoutCanvas(); holdView = false; });
  // Switching a block between its figure and its numbers never moves the view either.
  initFigures(() => { holdView = true; layoutCanvas(); holdView = false; });
  initPsych(() => { holdView = true; layoutCanvas(); holdView = false; });
  setHostedCheck((id) => hostedIds.has(id));
  // A slider held (by the pointer or the keys): its drag shows the values on the wires until it's let go.
  const sliderRow = (t: EventTarget | null) => {
    const el = t instanceof HTMLInputElement && t.classList.contains('slider') ? t.closest<HTMLElement>('.row.blk') : null;
    return el ? [...views].find(([, v]) => v.el === el)?.[0] ?? null : null;
  };
  // While held, the slider's label keeps its width (a longer value runs into the gap after it), so a value gaining
  // digits never moves the track under the pointer.
  let label: HTMLElement | null = null;
  const press = (id: string) => {
    held = id;
    label = views.get(id)?.el.querySelector<HTMLElement>('.line') ?? null;
    if (label) {
      Object.assign(label.style, { width: `${label.offsetWidth}px`, maxWidth: `${label.offsetWidth}px`, overflow: 'visible' });
      for (const el of label.querySelectorAll<HTMLElement>('.src, .tex')) Object.assign(el.style, { flexWrap: 'nowrap', whiteSpace: 'nowrap', minWidth: 'max-content' });
    }
    beginDrag(id, wires);
  };
  const release = () => {
    if (label) {
      Object.assign(label.style, { width: '', maxWidth: '', overflow: '' });
      for (const el of label.querySelectorAll<HTMLElement>('.src, .tex')) Object.assign(el.style, { flexWrap: '', whiteSpace: '', minWidth: '' });
    }
    label = null;
    releaseDrag();
  };
  listEl.addEventListener('pointerdown', (e) => { const id = sliderRow(e.target); if (id) press(id); }, true);
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  // Only pointers on the canvas itself defer layout (sliders, graph/figure handles); clicks on the composer, tabs or
  // top bar never trigger an extra layout pass on release.
  listEl.addEventListener('pointerdown', () => { pointerDown = true; layoutDeferred = false; }, true);
  for (const type of ['pointerup', 'pointercancel', 'blur'] as const) window.addEventListener(type, () => {
    if (!pointerDown) return;
    pointerDown = false;
    if (layoutDeferred) { layoutDeferred = false; layoutCanvas(); }
  });
  listEl.addEventListener('keydown', (e) => {
    const id = sliderRow(e.target);
    if (id && !dragHeld() && /^(Arrow|Page|Home|End)/.test(e.key)) press(id);
  });
  listEl.addEventListener('keyup', (e) => { if (sliderRow(e.target)) release(); });
  const head = modeBar.querySelector('.head-pill');
  const brand = modeBar.querySelector('.brand');
  modeBar.insertBefore(canvasTools, head);
  if (brand?.nextSibling) modeBar.insertBefore(nodesPillBtn, brand.nextSibling);
  else modeBar.insertBefore(nodesPillBtn, head);
  initNodeGraph({ isWide: wide, insert: insertPortRef, flash: flashBlock, pulse: sendPulse, keepView: () => { autoView = false; } });
  composerDock.insertBefore(mobileActions, composerBox);
  composerBox.addEventListener('pointerdown', () => { if (selectedBlock) setSelectedBlock(null); }, true);
  clearBtn.addEventListener('click', () => clearExample());
  setDragListener(sendPulse);
  // A block that changes size (a font arriving, an answer getting longer) moves the wires and the blocks under it.
  let pending = 0;
  blockSizes = new ResizeObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; layoutCanvas(); });
  });
  new ResizeObserver(() => {
    if (wide()) layoutCanvas();
    else syncNarrowScrollEdges();
  }).observe(tape);
  listEl.addEventListener('scroll', syncNarrowScrollEdges, { passive: true });
  narrow.addEventListener('change', () => { autoView = true; layoutCanvas(); });

  // Wheel: pan; with Ctrl or ⌘ (and a trackpad's pinch), zoom about the pointer. The graph takes its own wheel.
  tape.addEventListener('wheel', (e) => {
    if (!wide() || !rects.size || e.defaultPrevented) return;
    e.preventDefault();
    const r = tape.getBoundingClientRect();
    autoView = false;
    if (e.ctrlKey || e.metaKey) setView(zoomAbout(view, Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top }));
    else setView({ ...view, dx: view.dx - e.deltaX, dy: view.dy - e.deltaY });
    refreshNodeDrag();
  }, { passive: false });

  // A press on a block: a click edits it in the composer, a drag (wide) moves it. A press on the background pans.
  let dropClick = false;
  listEl.addEventListener('click', (e) => {
    if (!dropClick) return;
    dropClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  listEl.addEventListener('pointerdown', (e) => {
    dropClick = false;
    const t = e.target as Element;
    const block = t.closest<HTMLElement>('.row.blk, .row.blk-pstate');
    if (!block || e.button !== 0 || ownsPointer(t)) return;
    const id = [...views].find(([, v]) => v.el === block)?.[0];
    if (!id) return;
    const onResult = wide() && !!t.closest('.result');
    // On desktop, let a plain click on a value block's answer button reach its copy handler; on mobile, tapping anywhere
    // on the block selects it so Copy, Edit, Hide and Delete sit together in the quick-action bar.
    if (!onResult) {
      e.preventDefault();
      e.stopPropagation();
    }
    const start = { x: e.clientX, y: e.clientY };
    const row = doc.rows[rowIndex(id)];
    // Where it is now, laid out or dragged before: a drag pins it there.
    const laid = rects.get(id);
    const at0 = row?.at ? { ...row.at } : laid ? { x: laid.x, y: laid.y } : null;
    let moved = false;
    let scrolled = false;
    let lastDx = 0, lastDy = 0;
    if (!onResult && wide()) try { block.setPointerCapture(e.pointerId); } catch { /* a pointer the browser doesn't track (a synthetic one) */ }
    // A long press on a touch screen opens the line's menu, as a right-click does.
    let held = false;
    const hold = e.pointerType === 'mouse' ? 0 : window.setTimeout(() => { held = true; if (row) openLineMenu(row, start.x, start.y); }, 420); // The long-press threshold the line menu has always used.
    const move = (m: PointerEvent) => {
      const dist = Math.hypot(m.clientX - start.x, m.clientY - start.y);
      if (dist > 6) clearTimeout(hold);
      if (!wide()) {
        if (dist > 8) scrolled = true;
        return;
      }
      // A state inside the chart doesn't leave it: the chart moves as one block.
      if (!at0 || !row || hostedIds.has(id)) return;
      const dx = (m.clientX - start.x) / view.scale, dy = (m.clientY - start.y) / view.scale;
      if (!moved && Math.hypot(dx, dy) * view.scale < DRAG_SLOP) return;
      if (!moved && onResult) try { block.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      moved = true;
      lastDx = dx;
      lastDy = dy;
      autoView = false;
      block.classList.add('dragging');
      row.at = { x: Math.round(at0.x + dx), y: Math.round(at0.y + dy) };
      block.style.left = `${row.at.x}px`;
      block.style.top = `${row.at.y}px`;
      rects.set(id, { ...row.at, w: block.offsetWidth, h: block.offsetHeight });
      // Its open steps come with it.
      const tray = trayRects.get(id), o = openLines().get(id);
      if (tray && o) {
        const t = { ...tray, x: row.at.x, y: row.at.y + block.offsetHeight + BELOW_GAP };
        trayRects.set(id, t);
        Object.assign(o.tray.style, { left: `${t.x}px`, top: `${t.y}px` });
      }
      measurePorts();
      drawWires();
    };
    const up = () => {
      clearTimeout(hold);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      block.classList.remove('dragging');
      if (held || scrolled) return;
      if (moved) {
        if (onResult) dropClick = true;
        if (at0 && row) row.at = dragTo(at0, lastDx, lastDy);
        dropped = id;
        saveSoon();
        layoutCanvas();
        return;
      }
      if (onResult || row?.kind !== 'expr') return;
      // The caret goes where the line was clicked, as it did when lines were edited in place.
      const v = views.get(id);
      let caret = v?.tex && v.el.classList.contains('typeset') && v.tex.offsetParent ? caretAt(v.tex, start.x, start.y, row.text.length) : undefined;
      // A click at the end of an unfinished call goes inside it, to its next slot.
      if (caret === undefined || caret === row.text.length) caret = slotForEnd(row.text, slotInfo) ?? caret;
      if (!wide()) {
        if (t.closest('.result')) dropClick = true;
        // First tap on mobile selects the block and shows quick actions; tapping again opens it to edit.
        if (selectedBlock === id) {
          setSelectedBlock(null);
          editLine(id, caret);
        } else {
          selectedCaret = caret;
          setSelectedBlock(id);
        }
        return;
      }
      editLine(id, caret);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, true);

  editPin.addEventListener('click', () => {
    if (editingId) focusRow(editingId);
  });

  // A right-click on a block opens its line's menu: copy, duplicate, show or hide on the graph, move, delete.
  listEl.addEventListener('contextmenu', (e) => {
    const t = e.target as Element;
    const block = t.closest<HTMLElement>('.row.blk');
    const id = block
      ? [...views].find(([, v]) => v.el === block)?.[0]
      : t.closest('.blk-editing-pin') && editingId ? editingId : undefined;
    const row = id ? doc.rows[rowIndex(id)] : undefined;
    if (!row || t.closest('input:not(.expr), select, textarea')) return;
    e.preventDefault();
    openLineMenu(row, e.clientX, e.clientY);
  });

  // Delegated wire and port interaction on `svg` so redrawing wires mid-hover never drops a click.
  svg.addEventListener('pointerover', (e) => {
    const el = (e.target as Element)?.closest<SVGElement>('path.hit, circle.port-out, circle.port-in');
    const key = el?.dataset.key;
    if (key) focusWire(key);
  });
  svg.addEventListener('pointerout', (e) => {
    const from = (e.target as Element)?.closest<SVGElement>('path.hit, circle.port-out, circle.port-in');
    const to = (e.relatedTarget as Element | null)?.closest<SVGElement>('path.hit, circle.port-out, circle.port-in');
    const key = from?.dataset.key;
    if (key && to?.dataset.key !== key && focusedWire() === key && pinnedWire !== key) focusWire(null);
  });
  svg.addEventListener('pointerdown', (e) => {
    const el = (e.target as Element)?.closest<SVGElement>('path.hit, circle.port-out, circle.port-in, circle.port-free');
    if (el) e.stopPropagation();
  });
  svg.addEventListener('click', (e) => {
    const el = (e.target as Element)?.closest<SVGElement>('path.hit, circle.port-out, circle.port-in, circle.port-free');
    if (!el) return;
    e.stopPropagation();
    if (el.classList.contains('port-out') || el.classList.contains('port-free')) {
      if (el.dataset.row) insertPortRef(el.dataset.row, el.dataset.port);
      return;
    }
    const key = el.dataset.key;
    if (!key) return;
    if (e.altKey && el.matches('path.hit[data-to-pin]')) {
      const wire = wires.find((w) => wireKey(w) === key);
      if (wire?.toPin !== undefined) unwireNodePin(wire.to, wire.toPin);
      return;
    }
    pinnedWire = pinnedWire === key ? null : key;
    focusWire(pinnedWire);
    if (el.dataset.from) flashBlock(el.dataset.from);
  });
  svg.addEventListener('dblclick', (e) => {
    const el = (e.target as Element)?.closest<SVGElement>('path.hit, circle.port-in');
    const rowId = el?.dataset.row;
    if (!rowId) return;
    e.stopPropagation();
    if (doc.rows[rowIndex(rowId)]?.kind === 'expr') editLine(rowId);
  });

  // Hovering a canvas block softly highlights its connected wires and direct peers.
  const blockIdFor = (el: Element | null): string | null => {
    const b = el?.closest<HTMLElement>('.row.blk, .blk-graph, .blk-example-graph, .blk-psych');
    if (!b) return null;
    if (b === graphPane) return GRAPH_BLOCK;
    if (b === exampleGraphPane) return EXAMPLE_GRAPH;
    if (b === psychBlock) return PSYCH_BLOCK;
    return [...views].find(([, v]) => v.el === b)?.[0] ?? null;
  };
  listEl.addEventListener('mouseover', (e) => {
    if (!wide()) return;
    const id = blockIdFor(e.target as Element);
    if (id !== hoveredBlock) { hoveredBlock = id; syncPeerGlow(); }
  });
  listEl.addEventListener('mouseleave', () => {
    if (hoveredBlock) { hoveredBlock = null; syncPeerGlow(); }
  });

  tape.addEventListener('pointerdown', (e) => {
    const t = e.target as Element;
    if (e.button !== 0 || (t !== tape && t !== listEl && t !== svg && !t.closest('svg.cv-wires'))) return;
    if (pinnedWire) { pinnedWire = null; focusWire(null); }
    if (selectedBlock) setSelectedBlock(null);
    if (!rects.size) {
      if (editingId) finishEdit();
      return;
    }
    const start = { x: e.clientX, y: e.clientY, dx: view.dx, dy: view.dy };
    let moved = false;
    try { tape.setPointerCapture(e.pointerId); } catch { /* a pointer the browser doesn't track */ }
    const move = (m: PointerEvent) => {
      if (!wide()) return;
      if (!moved && Math.hypot(m.clientX - start.x, m.clientY - start.y) < DRAG_SLOP) return;
      moved = true;
      autoView = false;
      tape.classList.add('panning');
      setView({ ...view, dx: start.dx + m.clientX - start.x, dy: start.dy + m.clientY - start.y });
    };
    const up = () => {
      tape.removeEventListener('pointermove', move);
      tape.removeEventListener('pointerup', up);
      tape.removeEventListener('pointercancel', up);
      tape.classList.remove('panning');
      if (!moved && editingId) finishEdit();
    };
    tape.addEventListener('pointermove', move);
    tape.addEventListener('pointerup', up);
    tape.addEventListener('pointercancel', up);
  });

  // The graph block moves by its header bar and resizes by its corner; neither pins it until dragged past DRAG_SLOP.
  graphGrip.title = 'Drag to move · Double-click for auto layout';
  graphResize.title = 'Drag to resize · Double-click to reset size';
  graphUnpin.addEventListener('pointerdown', (e) => e.stopPropagation());
  graphUnpin.addEventListener('click', (e) => {
    e.stopPropagation();
    resetGraphLayout();
  });
  graphGrip.addEventListener('dblclick', (e) => {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    resetGraphLayout();
  });
  graphResize.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    resetGraphSize();
  });
  const moveGraph = (resize: boolean) => (e: PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    const laid = doc.ui.graphBlock ?? rects.get(GRAPH_BLOCK);
    if (!wide() || !laid || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    // Where it is now, laid out or put there before: dragging past DRAG_SLOP pins it there.
    const g0 = { x: laid.x, y: laid.y, w: laid.w, h: laid.h }, start = { x: e.clientX, y: e.clientY };
    let moved = false;
    let lastDx = 0, lastDy = 0;
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - start.x) / view.scale, dy = (m.clientY - start.y) / view.scale;
      if (!moved && Math.hypot(dx, dy) * view.scale < DRAG_SLOP) return;
      moved = true;
      lastDx = dx;
      lastDy = dy;
      autoView = false;
      graphPane.classList.add('dragging');
      const g = resize
        ? { x: g0.x, y: g0.y, w: Math.max(GRAPH_MIN.w, Math.round(g0.w + dx)), h: Math.max(GRAPH_MIN.h, Math.round(g0.h + dy)) }
        : { x: Math.round(g0.x + dx), y: Math.round(g0.y + dy), w: g0.w, h: g0.h };
      doc.ui.graphBlock = g;
      Object.assign(graphPane.style, { left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: `${g.h}px` });
      rects.set(GRAPH_BLOCK, g);
      drawWires();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      graphPane.classList.remove('dragging');
      if (!moved) return;
      doc.ui.graphBlock = dragGraph(g0, lastDx, lastDy, resize);
      // Resized, it stays put and the rest flows round it; dropped, it gives way to what it landed on.
      if (!resize) dropped = GRAPH_BLOCK;
      saveSoon();
      layoutCanvas();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  graphGrip.addEventListener('pointerdown', moveGraph(false));
  // The psychrometric chart moves by its frame, as a block does; its states, points and switch keep their own presses.
  psychBlock.addEventListener('pointerdown', (e) => {
    const t = e.target as Element;
    if (!wide() || e.button !== 0 || t.closest('.row, .fh:not(.fixed), .cv-seg, button')) return;
    const laid = rects.get(PSYCH_BLOCK);
    if (!laid) return;
    e.preventDefault();
    e.stopPropagation();
    const at0 = doc.ui.psychAt ?? { x: laid.x, y: laid.y }, start = { x: e.clientX, y: e.clientY };
    let moved = false;
    let lastDx = 0, lastDy = 0;
    try { psychBlock.setPointerCapture(e.pointerId); } catch { /* a pointer the browser doesn't track */ }
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - start.x) / view.scale, dy = (m.clientY - start.y) / view.scale;
      if (!moved && Math.hypot(dx, dy) * view.scale < DRAG_SLOP) return;
      moved = true;
      lastDx = dx;
      lastDy = dy;
      autoView = false;
      psychBlock.classList.add('dragging');
      const at = { x: Math.round(at0.x + dx), y: Math.round(at0.y + dy) };
      doc.ui.psychAt = at;
      Object.assign(psychBlock.style, { left: `${at.x}px`, top: `${at.y}px` });
      const r = { ...at, w: psychBlock.offsetWidth, h: psychBlock.offsetHeight };
      rects.set(PSYCH_BLOCK, r);
      for (const id of hostedIds) rects.set(id, r);
      measurePorts();
      drawWires();
    };
    const up = () => {
      psychBlock.removeEventListener('pointermove', move);
      psychBlock.removeEventListener('pointerup', up);
      psychBlock.removeEventListener('pointercancel', up);
      psychBlock.classList.remove('dragging');
      if (moved) {
        doc.ui.psychAt = dragTo(at0, lastDx, lastDy);
        dropped = PSYCH_BLOCK;
        saveSoon();
        layoutCanvas();
      }
    };
    psychBlock.addEventListener('pointermove', move);
    psychBlock.addEventListener('pointerup', up);
    psychBlock.addEventListener('pointercancel', up);
  });
  graphResize.addEventListener('pointerdown', moveGraph(true));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedBlock) { setSelectedBlock(null); return; }
    if (!wide() || !(e.ctrlKey && e.altKey) || e.metaKey || e.shiftKey) return;
    if (e.code === 'Digit0') { e.preventDefault(); fitCanvas(); }
    else if (e.code === 'Equal') { e.preventDefault(); zoomBy(ZOOM_STEP); }
    else if (e.code === 'Minus') { e.preventDefault(); zoomBy(1 / ZOOM_STEP); }
  });
}
