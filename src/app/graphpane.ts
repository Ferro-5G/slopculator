import { downloadBlob, fileDate } from './download';
import { plainNumber } from '../engine/format';
import { plotSVG } from '../ui/svg';
import type { Draggable } from './graph';
import { callsWave, draggablePoints, draggedLines, NOTHING_TO_FIT, slidersOnGraph, wantsPiTicks, ZOOM_STEP } from '../ui/plotmodel';
import { wholeAwareRange } from '../ui/slider';
import { h, roving, ICONS, iconLabel } from './dom';
import { dragEnds, dragLine } from './edits';
import { motionNow } from './feedback';
import { graph, graphHost, marksHint, graphPane, graphChips, graphSliders, graphTools, graphDock, modeBar, announcer, main, splitter } from './layout';
import { endDragOnRelease, fitRange, paintRange } from './lineoutput';
import { revealRow } from './listscroll';
import { store, KEYS } from './persistence';
import { coarse, narrow, kb } from './platform';
import { focusRow, views } from './rowviews';
import { activeId, doc, rowIndex, results, currentResults, sheetChanged } from './sheet';
import { setView, graphOn } from './shell';
import { curveColors, themeIsLight } from './theme';
import { showToast } from './toast';

let graphPointed = false;
export function syncMarksHint(): void {
  const on = !coarse.matches && graph.markCount > 0 && (graphPointed || graphHost.contains(document.activeElement));
  marksHint.classList.toggle('show', on);
}
export interface GraphChip { id: string; color: string; label: string; text: string }
let graphChipList: GraphChip[] = [];
let graphChipKey = '';
export function showGraphChips(chips: GraphChip[]): void {
  graphChipList = chips;
  syncGraphChips();
}
export function syncGraphChips(): void {
  const key = `${activeId}|${graphChipList.map((c) => `${c.id}:${c.color}:${c.label}:${c.text}`).join('|')}`;
  if (key === graphChipKey) return;
  graphChipKey = key;
  graphChips.hidden = !graphChipList.length;
  graphChips.replaceChildren(...graphChipList.map((c) => {
    const b = h('button', { type: 'button', class: c.id === activeId ? 'gchip active' : 'gchip', 'aria-label': `Line ${c.label}: ${c.text}. Edit it`, 'aria-current': c.id === activeId ? 'true' : undefined },
      h('span', { class: 'gc-dot', 'aria-hidden': 'true' }), h('b', { class: 'gc-name' }, c.label), h('span', { class: 'gc-text' }, c.text));
    b.style.setProperty('--c', c.color);
    b.addEventListener('click', () => {
      setView('calc');
      focusRow(c.id);
      const el = views.get(c.id)?.el;
      if (el) revealRow(el);
    });
    return b;
  }));
  refreshGraphChips();
}
const refreshGraphChips = roving(graphChips, '.gchip');
let graphSliderKey = '';
/** Rebuilt only when the set changes, so a drag in progress keeps its thumb. */
export function syncGraphSliders(): void {
  const items = slidersOnGraph(doc.rows, results);
  const key = items.map((i) => i.row.id).join('|');
  graphSliders.hidden = !items.length;
  if (key !== graphSliderKey) {
    graphSliderKey = key;
    graphSliders.replaceChildren(...items.map(({ row, name }) => {
      const range = h('input', { type: 'range', class: 'slider', 'aria-label': name, 'data-row': row.id });
      const out = h('output', { class: 'gs-value' });
      range.addEventListener('input', () => {
        const live = doc.rows[rowIndex(row.id)];
        if (live?.kind !== 'expr') return;
        dragLine(live, `${name} = ${Number(range.value)}`);
        sheetChanged();
      });
      endDragOnRelease(range);
      return h('label', { class: 'gs-row' }, h('span', { class: 'gs-name' }, name), range, out);
    }));
  }
  for (const { row, value } of items) {
    // Escaped: an id comes from whatever file was imported, and a quote in it made this throw on every render.
    const range = graphSliders.querySelector<HTMLInputElement>(`input[data-row="${CSS.escape(row.id)}"]`);
    if (!range) continue;
    (range.nextElementSibling as HTMLElement).textContent = String(Number(value.toPrecision(6)));
    // Hold the slider's ends and step while focused (dragged or moved with keys) so the track never shifts under the pointer.
    if (document.activeElement === range) {
      paintRange(range);
      continue;
    }
    const rg = wholeAwareRange(value, row.slider);
    fitRange(range, rg, value);
  }
}
let curvesSeen: Set<string> | null = null;
let curveFitTimer = 0;
const CURVE_FIT_MS = 600;
export function fitGraph(): void {
  if (!graph.fitAll(true)) showToast(NOTHING_TO_FIT);
}

export function scheduleCurveFit(): void {
  // The first render notes the curves a sheet opens with at once, so a line typed straight after loading still counts as new.
  if (!curvesSeen) { fitNewCurves(); return; }
  clearTimeout(curveFitTimer);
  curveFitTimer = window.setTimeout(fitNewCurves, CURVE_FIT_MS);
}
function fitNewCurves(): void {
  const res = currentResults();
  const live = new Set<string>();
  const fresh: ((x: number) => number)[] = [];
  doc.rows.forEach((row, k) => {
    const r = res[k];
    if (row.kind !== 'expr' || row.hidden || r?.id !== row.id) return;
    const fs = r.graph.flatMap((g) => (g.type === 'fx' && !g.ineq ? [g.f] : []));
    if (!fs.length) return;
    const key = `${row.id}\u0000${row.text}`;
    live.add(key);
    if (curvesSeen && !curvesSeen.has(key) && (fs.some((f) => !graph.fnInView(f)) || (graph.needsDegreeWaves && callsWave(row.text)))) fresh.push(...fs);
  });
  curvesSeen = live;
  // The desktop's graph is beside the lines, so a new curve has to come into view. A phone's Graph is its own screen, with its own view.
  if (fresh.length && graphOn() && !narrow.matches) graph.fitFunctions(fresh, motionNow() === 'full');
}
export function findDraggables(): Draggable[] {
  return draggablePoints(doc.rows, results).map((p) => ({
    x: p.x,
    y: p.y,
    onMove: (x, y) => {
      for (const { line, text } of draggedLines(p, x, y)) dragLine(line, text);
      sheetChanged();
    },
    onEnd: () => dragEnds(),
  }));
}
function gbtn(ic: keyof typeof ICONS | null, label: string, title: string, fn: () => void, cls?: string): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, title, 'aria-label': title }, ...(ic ? iconLabel(ic, label) : [h('span', { class: 'gl' }, label)]));
  b.addEventListener('click', fn);
  return b;
}
// 1:1 says equal axes better than any square glyph, so it's a word everywhere, and Fit is a word beside it.
const squareBtn = gbtn(null, '1:1', 'Square axes', () => graph.makeSquare(), 'gt-word gt-square');
const homeBtn = gbtn('home', 'Home', 'Reset view', () => graph.reset(true), 'gt-labeled');
let summaryTimer = 0;
export function exportSVG(): void {
  const r = graphHost.getBoundingClientRect();
  const v = graph.view;
  const visible = results.map((res, k) => (doc.rows[k]?.hidden ? { ...res, graph: [] } : res));
  const svg = plotSVG(visible, {
    // A hidden graph pane measures 0×0; fall back to a normal size.
    width: Math.round(r.width) || 720,
    height: Math.round(r.height) || 480,
    xmin: v.xmin, xmax: v.xmax, ymin: v.ymin, ymax: v.ymax,
    theme: themeIsLight() ? 'light' : 'dark',
    colors: doc.rows.map((row) => curveColors[row.color % curveColors.length]),
    piTicks: wantsPiTicks(doc.rows, results, doc.settings.deg),
  });
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `slopculator-graph-${fileDate(true)}.svg`);
}
export async function copyGraphImage(): Promise<void> {
  if (await graph.copyImage()) {
    showToast('Copied the graph image');
  } else showToast("Couldn't copy image. Save as PNG instead.");
}
export function graphSummary(): string {
  const parts: string[] = [];
  results.forEach((r, k) => {
    const row = doc.rows[k];
    // Right after Clear all the results still list the old lines for a moment.
    if (!row || row.id !== r.id || !r.graph.length || row.hidden) return;
    const name = r.lineName ?? `line ${k + 1}`;
    const what = row.kind === 'table' ? 'table points' : row.text.trim();
    let extra = '';
    if (r.distProb !== undefined) extra = `, shaded, probability ${plainNumber(r.distProb, 4)}`;
    parts.push(`${name}: ${what}${extra}`);
  });
  const v = graph.view;
  const span = `x from ${plainNumber(v.xmin, 3)} to ${plainNumber(v.xmax, 3)}`;
  return parts.length
    ? `Graph, ${span}. ${parts.join('; ')}. Arrow keys pan, plus and minus zoom, F fits, 0 resets. [ and ] step through the zeros, highs and lows and crossings; Enter pins one.`
    : `Graph, empty, ${span}. Arrow keys pan, plus and minus zoom.`;
}
/** NaN until the look's stylesheet is in, since that sheet defines --graph-min-w. */
const clampLeft = (w: number) => {
  const graphMin = parseFloat(getComputedStyle(main).getPropertyValue('--graph-min-w'));
  return Math.max(320, Math.min(main.clientWidth - splitter.getBoundingClientRect().width - graphMin, w));
};
/** A NaN width would void the grid's columns, stacking the graph under a full-width notebook, so it's never written. */
function setLeft(w: number): void {
  const left = clampLeft(w);
  if (Number.isFinite(left)) main.style.setProperty('--left', `${left}px`);
}
/** The width the splitter was last dragged to. Call after applyTheme, which puts in the stylesheet clampLeft reads. */
export function restoreLeft(): void {
  const saved = Number(store.get(KEYS.left));
  if (saved > 0) setLeft(saved);
}

export function initGraphpane(): void {
  graphPane.addEventListener('pointerenter', () => { graphPointed = true; syncMarksHint(); });
  graphPane.addEventListener('pointerleave', () => { graphPointed = false; syncMarksHint(); });
  graphHost.addEventListener('focusin', () => syncMarksHint());
  graphHost.addEventListener('focusout', () => setTimeout(syncMarksHint, 0));
  graphTools.append(
    h('div', { class: 'gt-group gt-zoom' },
      gbtn('plus', '+', 'Zoom in', () => graph.zoomStep(1 / ZOOM_STEP)),
      gbtn('minus', '−', 'Zoom out', () => graph.zoomStep(ZOOM_STEP)),
    ),
    h('div', { class: 'gt-group' },
      gbtn(null, 'fit', kb('Fit (Ctrl+Alt+F)'), () => fitGraph(), 'gt-word gt-fit'),
      squareBtn,
      homeBtn,
    ),
    h('div', { class: 'gt-group' },
      gbtn('download', 'Save', 'Save graph as PNG', () => graph.exportPNG(), 'gt-labeled'),
    ),
  );
  // Each dims when pressing it would change nothing.
  const syncViewButtons = () => {
    squareBtn.setAttribute('aria-pressed', String(graph.squareAxes));
    squareBtn.disabled = graph.squareAxes;
    homeBtn.disabled = graph.isHome;
  };
  syncViewButtons();
  graph.onViewChange = () => {
    syncViewButtons();
    clearTimeout(summaryTimer);
    summaryTimer = window.setTimeout(() => graphHost.setAttribute('aria-label', graphSummary()), 120);
  };
  graphTools.querySelectorAll('button').forEach((b) => (b.tabIndex = -1));
  graphHost.tabIndex = 0;
  graphHost.setAttribute('role', 'application');
  graphHost.setAttribute('aria-roledescription', 'graph');
  graphHost.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight + - 0 F S P C Delete [ ] Enter');
  graphHost.addEventListener('blur', () => graph.blurMarks());
  graphHost.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const first = modeBar.querySelector<HTMLElement>('[tabindex="0"]');
      if (first && first.offsetParent !== null) {
        e.preventDefault();
        first.focus();
        return;
      }
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      const text = graph.stepMark(e.key === ']' ? 1 : -1);
      announcer.textContent = text ?? 'No marks in view';
      return;
    }
    if (e.key === 'Enter' && graph.pinFocusedMark()) {
      e.preventDefault();
      announcer.textContent = 'Pinned';
      return;
    }
    const step = e.shiftKey ? 0.25 : 0.08;
    const act: Record<string, () => void> = {
      ArrowLeft: () => graph.pan(-step, 0),
      ArrowRight: () => graph.pan(step, 0),
      ArrowUp: () => graph.pan(0, step),
      ArrowDown: () => graph.pan(0, -step),
      '+': () => graph.zoomStep(1 / ZOOM_STEP),
      '=': () => graph.zoomStep(1 / ZOOM_STEP),
      '-': () => graph.zoomStep(ZOOM_STEP),
      '0': () => graph.reset(true),
      f: () => fitGraph(),
      s: () => graph.makeSquare(),
      p: () => graph.exportPNG(),
      c: () => copyGraphImage(),
      Delete: () => graph.clearPins(),
    };
    const fn = act[e.key] ?? act[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
  // On the canvas the graph block's tools float in its corner over the plot, so nothing is held back from it.
  const syncCover = () => graph.setCover({ top: 0, bottom: 0 });
  new ResizeObserver(syncCover).observe(graphDock);
  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('dragging');
    const startX = e.clientX;
    const startWidth = splitter.getBoundingClientRect().left - main.getBoundingClientRect().left;
    const move = (ev: PointerEvent) => {
      // Preserve the grab point across looks and gutter widths.
      const w = startWidth + ev.clientX - startX;
      setLeft(w);
      const left = clampLeft(w);
      if (Number.isFinite(left)) store.set(KEYS.left, String(left));
    };
    const up = () => {
      splitter.classList.remove('dragging');
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      splitter.removeEventListener('pointercancel', up);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
    splitter.addEventListener('pointercancel', up);
  });
  splitter.addEventListener('dblclick', () => { main.style.removeProperty('--left'); store.remove(KEYS.left); });
  window.addEventListener('resize', () => { if (main.style.getPropertyValue('--left')) setLeft(parseFloat(main.style.getPropertyValue('--left'))); });
}
