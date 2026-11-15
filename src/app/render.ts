import { distFitKey, isDistribution, wantsDegreeWaves, wantsPiTicks } from '../ui/plotmodel';
import { curveColors } from './theme';
import { isBlankSheet, isEmptyLine } from '../ui/document';
import { lineLabel, spokenLine } from '../ui/linestate';
import type { Drawable } from './graph';
import { prettyText } from '../ui/typeset';
import { type GraphChip, findDraggables, showGraphChips, syncGraphSliders, graphSummary, syncMarksHint, scheduleCurveFit } from './graphpane';
import { graph, listEl, graphHost, keypadEl, announcer } from './layout';
import { lineCalm } from './lineeditor';
import { renderOut, renderTex, renderExtra } from './lineoutput';
import { syncListEdges } from './listscroll';
import { starter, syncListTools } from './listtools';
import { narrow } from './platform';
import { syncRowTabStops } from './rows';
import { views } from './rowviews';
import { opts, results, doc, activeId, rowIndex } from './sheet';
import { renderTableFoot } from './tableview';
import { placeThumbPage, ti } from './thumb';

let lastDistKey = '';
export function renderResults(): void {
  const o = opts();
  const pal = curveColors;
  const drawables: Drawable[] = [];
  const chips: GraphChip[] = [];
  results.forEach((r, k) => {
    const row = doc.rows[k];
    // A focus change can redraw between a sheet's lines changing and its results catching up.
    if (!row || row.id !== r.id) return;
    const v = views.get(row.id);
    if (!v) return;
    const color = pal[row.color % pal.length];
    v.el.style.setProperty('--c', color);
    const graphable = r.graph.length > 0;
    v.chip.hidden = !graphable;
    v.chip.setAttribute('aria-pressed', String(!row.hidden));
    const calm = row.kind === 'expr' && !!v.input && lineCalm(row, r, v.input);
    v.el.classList.toggle('has-error', !!r.error && !calm);
    v.calm = calm;
    v.el.classList.toggle('calm', calm);
    if (!calm) v.el.classList.remove('calm-held');
    const label = r.lineName ? `Line ${k + 1} (${r.lineName})` : `Line ${k + 1}`;
    if (v.input) v.input.setAttribute('aria-label', label);
    v.el.setAttribute('aria-label', label);
    v.el.classList.toggle('lone', doc.rows.length === 1 && isEmptyLine(row));
    // A failing line says ERR under it, so red isn't the only sign.
    const { label: shown, unlettered } = lineLabel(r, k, doc.settings.lineNames);
    v.idx.textContent = shown;
    v.idx.classList.toggle('letter', !!r.lineName || unlettered);
    v.idx.classList.toggle('dim', unlettered);
    v.el.classList.toggle('heading-row', r.heading !== undefined);
    if (r.heading !== undefined) v.idx.textContent = '#';
    v.idx.title = r.lineName ? `Line ${k + 1}: use ${r.lineName} for its answer` : '';
    if (graphable && !row.hidden) {
      const math = row.kind === 'expr' ? prettyText(row.text) : undefined;
      for (const item of r.graph) drawables.push({ rowId: row.id, color, item, label: shown, text: math });
      chips.push({ id: row.id, color, label: shown, text: math ?? 'table' });
    }
    renderOut(v, r, o);
    if (row.kind === 'expr') renderTex(v, row, r);
    if (row.kind === 'expr') renderExtra(v, row, r, o);
    else renderTableFoot(v, r, o);
  });
  const piTicks = wantsPiTicks(doc.rows, results, doc.settings.deg);
  showGraphChips(chips);
  syncGraphSliders();
  graph.update({ piTicks, degreeWaves: wantsDegreeWaves(doc.rows, results, doc.settings.deg), asymptotes: doc.settings.working, draggables: findDraggables(), items: drawables });
  const empty = isBlankSheet(doc.rows);
  if (empty && !starter.isConnected) listEl.append(starter);
  if (!empty && starter.isConnected) starter.remove();
  syncListTools(empty);
  graphHost.setAttribute('aria-label', graphSummary());
  syncMarksHint();
  syncRowTabStops();
  announceSoon();
  const distKey = distFitKey(drawables.map((d) => d.item));
  if (distKey && distKey !== lastDistKey && graph.distributionsNeedFit()) graph.fit((d) => isDistribution(d.item));
  lastDistKey = distKey;
  scheduleCurveFit();
  syncListEdges();
  placeThumbPage();
  keepErrorInView();
}
function keepErrorInView(): void {
  const v = activeId ? views.get(activeId) : undefined;
  if (narrow.matches || !v || !v.el.classList.contains('has-error') || document.activeElement !== v.input || ti.tab !== null) return;
  const err = v.el.querySelector<HTMLElement>('.out .err') ?? v.out;
  const foot = Math.min(listEl.getBoundingClientRect().bottom, keypadEl.offsetParent ? keypadEl.getBoundingClientRect().top : Infinity);
  const over = err.getBoundingClientRect().bottom + 6 - foot;
  if (over > 1) listEl.scrollTop += over;
}
let announceTimer = 0;
let lastAnnounced = '';
function announceSoon(): void {
  clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    const i = activeId ? rowIndex(activeId) : -1;
    const row = doc.rows[i];
    const v = row && views.get(row.id);
    const caret = v?.input ? { start: v.input.selectionStart ?? 0, end: v.input.selectionEnd ?? 0 } : undefined;
    // This timer is the typing pause.
    const text = spokenLine({ text: row?.kind === 'expr' ? row.text : '', r: results[i], index: i, held: !!v?.calm, caret, typing: false, rows: doc.rows, o: opts() });
    if (text && text !== lastAnnounced) {
      lastAnnounced = text;
      announcer.textContent = text;
    }
  }, 700);
}
