import { LineWarning } from '../engine/diagnostics';
import type { RowResult } from '../engine/document';
import { isWarningNote } from '../engine/errors';
import { type DisplayOpts, type Precise, formatNumber, formatValue, recordCell, plainValue, groupDigits } from '../engine/format';
import { isUnit, otherUnit } from '../engine/units';
import { isDist, type UnitCircleFigure, Value } from '../engine/values';
import { isLongAnswer, matrixCells, matrixFitFont, UNIT_CIRCLE, unitCircleDrawing } from '../ui/answerlayout';
import { asList } from '../ui/complete';
import { DIST_OFF, type DistBounds, distPresets, distStatement } from '../ui/distview';
import { leadingOperator, errorFixes, UNFINISHED_HINT, isStrayComma, lineErrorText, shortLineError, thousandsFix } from '../ui/errortext';
import { warningFixes } from '../ui/linestate';
import { mathNode, mapSource } from './mathdom';
import { type SliderRange, wholeAwareRange } from '../ui/slider';
import { play } from './sound';
import { typeset, assignsLiteral, BLOCK_LIST_MAX, type SheetNames } from '../ui/typeset';
import type { Row } from './docmodel';
import { h } from './dom';
import { MODES, setMode } from './controls';
import { dragEnds, dragLine, applyFix, nextLine } from './edits';
import { copy } from './feedback';
import { listEl } from './layout';
import { enclosingCall } from './lineeditor';
import { syncListEdges } from './listscroll';
import { kb } from './platform';
import { setActive } from './rows';
import { type RowView, views } from './rowviews';
import { doc, renderNow, saveSoon, setKeepSelection, rowIndex, results, setTarget, sheetChanged } from './sheet';

/** `names` is what the sheet defines (and `namesKey` its key), so a word sets as letters where the engine splits it. */
export function renderTex(v: RowView, row: Extract<Row, { kind: 'expr' }>, r: RowResult, names?: SheetNames, namesKey = ''): void {
  if (!v.tex) return;
  const look = doc.ui.look ?? 'modern';
  const key = r.error ? '' : `${look}\n${namesKey}\n${row.text}`;
  if (key === v.texKey) return;
  v.texKey = key;
  const boxes = key ? typeset(row.text, { stack: look !== 'retro', names, listMax: BLOCK_LIST_MAX }) : null;
  v.el.classList.toggle('typeset', !!boxes);
  if (!boxes) {
    v.tex.replaceChildren();
    return;
  }
  const node = mathNode(boxes);
  mapSource(node, row.text);
  v.tex.replaceChildren(node);
  measureTex(v);
}
/**
 * Measuring a row writes a style, reads a width, and writes again, and each read after a write makes the browser lay out
 * the whole page. One row at a time, a sheet of 2,000 rows took over 7 seconds to load. Inside batchLayout the rows are
 * queued instead, and measured together: every write, then every read, then every write, for one layout in all.
 */
let queued: { tex: Set<RowView>; scopes: Set<ParentNode> } | null = null;
export function batchLayout(fn: () => void): void {
  if (queued) return fn();
  const batch = (queued = { tex: new Set(), scopes: new Set() });
  try {
    fn();
  } finally {
    queued = null;
    measureAll([...batch.tex], [...batch.scopes]);
  }
}
export function measureTex(v: RowView): void {
  if (queued) queued.tex.add(v);
  else measureAll([v], []);
}
function fitMatrices(scope: ParentNode): void {
  if (queued) queued.scopes.add(scope);
  else measureAll([], [scope]);
}
function measureAll(rows: RowView[], scopes: ParentNode[]): void {
  const tex = rows.filter((v) => v.tex && v.el.classList.contains('typeset') && !v.el.classList.contains('active')).map((v) => v.tex!);
  const wraps = [...new Set(scopes.flatMap((s) => [...s.querySelectorAll<HTMLElement>('.result .mat-wrap')]))];
  for (const t of tex) t.style.width = 'max-content';
  for (const w of wraps) w.style.fontSize = '';
  const widths = tex.map((t) => t.offsetWidth);
  const sized = wraps.map((w) => {
    const box = w.querySelector<HTMLElement>('.mat-scroll'), table = w.querySelector('table');
    return matrixFitFont(parseFloat(getComputedStyle(w).fontSize), box?.clientWidth ?? 0, table?.offsetWidth ?? 0);
  });
  tex.forEach((t, k) => {
    t.style.width = '';
    (t.parentElement as HTMLElement).style.setProperty('--nat', `${Math.ceil(widths[k])}px`);
  });
  wraps.forEach((w, k) => {
    const px = sized[k];
    if (px) w.style.fontSize = `${px}px`;
  });
}

function unitCircleSvg(figure: UnitCircleFigure): string {
  const n = (x: number) => x.toFixed(2);
  const { size, center, radius, arcRadius, axisFrom, axisTo, cosLabel, sinLabel } = UNIT_CIRCLE;
  const { tip, arc, label } = unitCircleDrawing(figure);
  const [px, py] = tip.map(n);
  const arcPath = arc ? `<path class="uc-arc" d="M${center + arcRadius} ${center}A${arcRadius} ${arcRadius} 0 ${arc.large ? 1 : 0} 0 ${n(arc.end[0])} ${n(arc.end[1])}"/>` : '';
  return `<svg class="uc" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}">`
    + `<line class="uc-axis" x1="${axisFrom}" y1="${center}" x2="${axisTo}" y2="${center}"/><line class="uc-axis" x1="${center}" y1="${axisFrom}" x2="${center}" y2="${axisTo}"/>`
    + `<circle class="uc-ring" cx="${center}" cy="${center}" r="${radius}"/>`
    + `<path class="uc-leg" d="M${center} ${center}H${px}V${py}"/>${arcPath}<line class="uc-arrow" x1="${center}" y1="${center}" x2="${px}" y2="${py}"/>`
    + `<circle class="uc-dot" cx="${px}" cy="${py}" r="3.5"/>`
    + `<text x="${cosLabel[0]}" y="${cosLabel[1]}" text-anchor="end">cos</text><text x="${sinLabel[0]}" y="${sinLabel[1]}">sin</text></svg>`;
}

function valueNode(v: Value, o: DisplayOpts, prob: boolean, ex?: Precise): HTMLElement {
  if (typeof v === 'object' && v.t === 'matrix') {
    const t = h('table', { class: 'mat' });
    const exm = ex && 't' in ex && ex.t === 'matrix' ? ex.m : undefined;
    const { cells, more } = matrixCells(v.m, (c, i, j) => formatNumber(c, o, false, exm?.[i]?.[j]));
    for (const r of cells) t.append(h('tr', {}, ...r.map((c) => h('td', {}, c))));
    const wrap = h('span', { class: 'mat-wrap' }, h('span', { class: 'mat-scroll' }, t));
    return more ? h('span', { class: 'mat-cut' }, wrap, h('span', { class: 'mat-more' }, more)) : wrap;
  }
  if (typeof v === 'object' && v.t === 'record') {
    const t = h('table', { class: 'rec' }, h('caption', {}, v.title));
    for (const r of v.rows) t.append(h('tr', {}, h('th', {}, r.label), h('td', {}, recordCell(v, r.value, o, prob && typeof r.value === 'number' && r.value <= 1))));
    if (!v.figure) return t;
    const wrap = h('div', { class: 'rec-fig' }, t);
    wrap.insertAdjacentHTML('afterbegin', unitCircleSvg(v.figure));
    return wrap;
  }
  const text = formatValue(v, o, prob, ex);
  return h('span', { class: text.length > 36 ? 'val long' : 'val' }, text);
}
function selectSpan(row: Row, span: { start: number; end: number }): void {
  const input = views.get(row.id)?.input;
  if (!input) return;
  // Focusing from a button looks like tabbing in, which puts the caret at the end. A span across the whole line
  // selects 0..n, the same range tabbing in selects, so the focus handler is told to leave the selection alone.
  setKeepSelection(true);
  input.focus();
  setKeepSelection(false);
  input.setSelectionRange(span.start, span.end);
}
export function renderOut(v: RowView, r: RowResult, o: DisplayOpts): void {
  const rowOf = doc.rows[rowIndex(r.id)];
  const literal = !r.error && rowOf?.kind === 'expr' && assignsLiteral(rowOf.text);
  const calm = !!v.calm;
  const outKey = JSON.stringify([calm, literal, r.error, r.error && rowOf?.kind === 'expr' ? rowOf.text : null, r.errorSpan, r.truth, r.value !== undefined && !r.error ? plainValue(r.value, o, r.prob, r.precise) : null, r.notes, o, r.prob, r.warnings?.[0], rowOf?.note]);
  if (outKey === v.outKey) return;
  v.outKey = outKey;
  let longAnswer = false;
  const parts: (Node | string)[] = [];
  const check = r.warnings?.[0];
  if (check) {
    const dot = h('button', { type: 'button', class: 'warn-dot', title: `Check this: ${check.message}`, 'aria-label': `Check this: ${check.message}` }, '!');
    dot.addEventListener('pointerdown', (e) => e.stopPropagation());
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (v.el.classList.contains('blk')) {
        const opened = v.el.classList.toggle('warn-open');
        play('toggle');
        if (opened) v.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (rowOf?.kind === 'expr') {
        selectSpan(rowOf, check);
      }
    });
    parts.push(dot);
  }
  if (v.warn) renderWarning(v, rowOf, check);
  if (calm) {
    const caret = v.input?.selectionStart ?? 0;
    const lead = r.error && rowOf?.kind === 'expr' && leadingOperator(rowOf.text, r.error) ? { row: rowOf, error: r.error } : null;
    if (lead) {
      for (const fix of errorFixes(lead.row.text, lead.error, isUnit)) {
        const btn = h('button', { type: 'button', class: 'fix calm-fix', title: fix.title }, fix.label);
        btn.addEventListener('click', () => applyFix(lead.row, fix.text));
        parts.push(btn);
      }
    } else if (!(rowOf?.kind === 'expr' && enclosingCall(rowOf.text, caret))) {
      parts.push(h('span', { class: 'calm-hint', title: r.error }, UNFINISHED_HINT));
      if (!v.el.classList.contains('typing')) v.el.classList.add('calm-held');
    }
  } else if (r.error) {
    const span = r.errorSpan;
    const lineText = rowOf?.kind === 'expr' ? rowOf.text : '';
    // Short and whole on the line; its plain words in full on hover, focus or a tap, the engine's in the title.
    const said = shortLineError(lineText, r.error, isUnit, otherUnit);
    const full = lineErrorText(lineText, r.error, isUnit, otherUnit);
    const more = full !== said ? { 'data-full': full } : {};
    if (span && rowOf?.kind === 'expr') {
      const err = h('button', { type: 'button', class: 'err marked', title: `${r.error}\nClick to show this in the line`, ...more }, said);
      err.addEventListener('click', () => { err.classList.toggle('full'); selectSpan(rowOf, span); });
      parts.push(err);
    } else {
      const err = h('span', { class: 'err', title: r.error, ...more }, said);
      if (full !== said) { err.tabIndex = 0; err.addEventListener('click', () => err.classList.toggle('full')); }
      parts.push(err);
    }
    // Never for a number with thousands commas (1,250): wrapping it in { } gives a wrong value; it gets "Use 1250".
    const list = rowOf?.kind === 'expr' && isStrayComma(r.error) && !thousandsFix(rowOf.text, r.error) ? asList(rowOf.text) : null;
    if (list && rowOf?.kind === 'expr') {
      const btn = h('button', { type: 'button', class: 'fix', title: `Make this the list ${list}` }, 'Wrap in { }');
      btn.addEventListener('click', () => applyFix(rowOf, list, false));
      parts.push(btn);
    }
    if (rowOf?.kind === 'expr') for (const fix of errorFixes(rowOf.text, r.error, isUnit)) {
      const btn = h('button', { type: 'button', class: 'fix', title: fix.title }, fix.label);
      btn.addEventListener('click', () => applyFix(rowOf, fix.text));
      parts.push(btn);
    }
  } else if (r.truth !== undefined) {
    parts.push(h('span', { class: `truth ${r.truth ? 'yes' : 'no'}` }, r.truth ? 'true' : 'false'));
  } else if (r.value !== undefined && !literal && !isDist(r.value)) {
    const val = r.value;
    const btn = h('button', { type: 'button', class: 'result', title: 'Copy' }, valueNode(val, o, r.prob, r.precise));
    btn.addEventListener('click', () => copy(plainValue(val, o, r.prob, r.precise), btn));
    parts.push(btn);
    const box = btn.querySelector<HTMLElement>('.val');
    if (box && isLongAnswer(box.textContent, o)) {
      longAnswer = true;
      box.tabIndex = 0;
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', 'Every digit of the answer');
      const raw = box.textContent ?? '';
      const digits = raw.replace(/[^0-9]/g, '').length;
      box.textContent = groupDigits(raw);
      const cue = h('span', { class: 'long-cue', hidden: true }, `Scroll this answer · ${digits.toLocaleString('en-US')} digits`);
      parts.push(cue);
      const more = () => box.classList.toggle('more', box.scrollTop + box.clientHeight < box.scrollHeight - 1);
      box.addEventListener('scroll', more, { passive: true });
      requestAnimationFrame(() => { more(); cue.hidden = box.scrollHeight <= box.clientHeight + 1; });
    }
  }
  for (const n of r.notes) parts.push(h('span', { class: isWarningNote(n) ? 'note warn' : 'note' }, n));
  const lineNote = rowOf?.note;
  if (lineNote) parts.push(h('span', { class: 'note' }, lineNote));
  // A fix that had focus (Tab from the line onto the calm chip blurs the line, which rebuilds this) hands it to the new
  // one, so focus never falls to the page.
  const focusedFix = document.activeElement instanceof HTMLElement && v.out.contains(document.activeElement) && document.activeElement.classList.contains('fix') ? document.activeElement.textContent : null;
  v.out.replaceChildren(...parts);
  v.out.hidden = parts.length === 0;
  v.out.classList.toggle('long-answer', longAnswer);
  fitMatrices(v.out);
  if (focusedFix !== null) {
    const fixes = [...v.out.querySelectorAll<HTMLButtonElement>('button.fix')];
    (fixes.find((b) => b.textContent === focusedFix) ?? fixes[0])?.focus();
  }
  const fixes = lineFixes(v);
  if (fixes.length === 1) fixes[0].title = `${fixes[0].title} (${kb('Ctrl+Enter')})`;
}
/** `shown`: only those on screen now (the stylesheet holds a warning back while typing), which are the ones Tab and Ctrl/⌘+Enter can reach. */
export function lineFixes(v: RowView, shown = false): HTMLButtonElement[] {
  return [...v.el.querySelectorAll<HTMLButtonElement>('button.fix')].filter((b) => !b.closest('[hidden]') && (!shown || b.offsetParent !== null));
}
function renderWarning(v: RowView, row: Row | undefined, warning: LineWarning | undefined): void {
  if (!warning || row?.kind !== 'expr') {
    v.el.classList.remove('warn-open');
    v.warn!.replaceChildren();
    v.warn!.hidden = true;
    return;
  }
  const ico = h('span', { class: 'warn-ico', 'aria-hidden': 'true' }, '!');
  const text = h('button', { type: 'button', class: 'warn-text', title: 'Show this in the line' }, warning.message);
  text.addEventListener('pointerdown', (e) => e.stopPropagation());
  text.addEventListener('click', (e) => { e.stopPropagation(); selectSpan(row, warning); });
  const fixButton = (fix: string) => {
    const btn = h('button', { type: 'button', class: 'fix', title: `Change the line to ${fix}` }, `Use ${fix.trim()}`);
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      v.el.classList.remove('warn-open');
      applyFix(row, fix, false, v.el.classList.contains('active'));
    });
    return btn;
  };
  const fixes = warningFixes(warning).map(fixButton);
  if (warning.switchAngle) {
    const toDeg = warning.switchAngle === 'deg';
    const sw = h('button', { type: 'button', class: 'fix', title: toDeg ? 'Switch angle mode to Degrees' : 'Switch angle mode to Radians' }, toDeg ? 'Switch to Deg' : 'Switch to Rad');
    sw.addEventListener('pointerdown', (e) => e.stopPropagation());
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      v.el.classList.remove('warn-open');
      play('toggle');
      setMode(MODES.angle, toDeg);
    });
    fixes.push(sw);
  }
  v.warn!.replaceChildren(ico, text, ...fixes);
  v.warn!.hidden = false;
  v.warn!.classList.toggle('now', !!warning.instant);
}
export function renderExtra(v: RowView, row: Extract<Row, { kind: 'expr' }>, r: RowResult, o: DisplayOpts): void {
  const dist = !r.error && r.value !== undefined && isDist(r.value);
  const key = r.slider && !r.error ? `slider:${r.slider.name}` : dist ? `dist:${(r.value as { t: string }).t}` : '';
  if (key !== v.extraKey) {
    v.extraKey = key;
    if (key.startsWith('slider')) v.extra.replaceChildren(buildSlider(row));
    else if (key.startsWith('dist')) v.extra.replaceChildren(buildDist(row));
    else v.extra.replaceChildren();
  }
  if (key.startsWith('slider')) syncSlider(v, row, r);
  if (key.startsWith('dist')) syncDist(v, row, r, o);
}
const sliderName = (text: string) => /^\s*([^=]+?)\s*=/.exec(text)?.[1] ?? '';
export function endDragOnRelease(range: HTMLInputElement): void {
  let pointer = false;
  range.addEventListener('pointerdown', () => { pointer = true; });
  range.addEventListener('change', () => { dragEnds(pointer ? 0 : 700); pointer = false; });
  range.addEventListener('blur', () => dragEnds());
}
export function fitRange(range: HTMLInputElement, rg: SliderRange, value: number): void {
  range.min = String(Math.min(rg.min, value));
  range.max = String(Math.max(rg.max, value));
  range.step = String(rg.step);
  if (document.activeElement !== range) range.value = String(value);
  paintRange(range);
}
/** The filled part of a slider's track, as --p, for a track drawn in the stylesheet. */
export function paintRange(range: HTMLInputElement): void {
  const min = Number(range.min), max = Number(range.max), v = Number(range.value);
  range.style.setProperty('--p', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
}

function buildSlider(row: Extract<Row, { kind: 'expr' }>): HTMLElement {
  const range = h('input', { type: 'range', class: 'slider', 'aria-label': 'Slider' });
  const mk = (cls: string, label: string) => h('input', { class: `lim ${cls}`, inputmode: 'decimal', 'aria-label': label, spellcheck: 'false' });
  const lo = mk('lo', 'Slider minimum'), hi = mk('hi', 'Slider maximum'), step = mk('step', 'Slider step');
  range.addEventListener('input', () => {
    paintRange(range);
    const name = sliderName(row.text);
    dragLine(row, `${name} = ${Number(range.value)}`);
    sheetChanged();
  });
  endDragOnRelease(range);
  const commit = () => {
    const min = Number(lo.value), max = Number(hi.value), st = Number(step.value);
    if (Number.isFinite(min) && Number.isFinite(max) && min < max && st > 0) {
      row.slider = { min, max, step: st };
      sheetChanged();
    }
  };
  [lo, hi, step].forEach((i) => i.addEventListener('change', commit));
  [lo, hi].forEach((i) => i.addEventListener('input', () => { i.style.width = `${Math.max(2.5, i.value.length + 0.5)}ch`; }));
  return h('div', { class: 'slider-row' }, lo, range, hi, h('span', { class: 'step-label' }, 'step'), step);
}
function syncSlider(v: RowView, row: Extract<Row, { kind: 'expr' }>, r: RowResult): void {
  const val = r.slider!.value;
  const [lo, range, hi] = v.extra.querySelectorAll('input');
  // While it has focus (dragged, or moved with the keys) its ends and step stay put, so the thumb never runs off under
  // the pointer as the value grows.
  if (document.activeElement === range) return;
  const rg = wholeAwareRange(val, row.slider);
  const step = v.extra.querySelector<HTMLInputElement>('.step')!;
  fitRange(range, rg, val);
  // Named after its variable, so a screen reader says "a, slider", not just "slider".
  const name = sliderName(row.text);
  if (name) {
    range.setAttribute('aria-label', name);
    lo.setAttribute('aria-label', `${name} minimum`);
    hi.setAttribute('aria-label', `${name} maximum`);
    step.setAttribute('aria-label', `${name} step`);
  }
  for (const [inp, n] of [[lo, Math.min(rg.min, val)], [hi, Math.max(rg.max, val)], [step, rg.step]] as const) {
    if (document.activeElement !== inp) inp.value = String(Number(n.toPrecision(6)));
  }
  for (const inp of [lo, hi]) inp.style.width = `${Math.max(2.5, inp.value.length + 0.5)}ch`;
}
function buildDist(row: Extract<Row, { kind: 'expr' }>): HTMLElement {
  if (!row.dist) row.dist = { ...DIST_OFF };
  const d = row.dist;
  const cb = h('input', { type: 'checkbox', class: 'cdf' });
  cb.checked = d.cdf;
  const min = h('input', { class: 'bound min', value: d.min, spellcheck: 'false', 'aria-label': 'Min', placeholder: '−inf' });
  const max = h('input', { class: 'bound max', value: d.max, spellcheck: 'false', 'aria-label': 'Max', placeholder: 'inf' });
  const prob = h('button', { type: 'button', class: 'dist-prob', title: 'Copy' });
  const err = h('div', { class: 'dist-err' });
  const bounds = h('div', { class: 'bounds' },
    h('label', {}, h('span', {}, 'Min'), min),
    h('label', {}, h('span', {}, 'Max'), max),
  );
  cb.addEventListener('change', () => {
    d.cdf = cb.checked;
    if (d.cdf && !d.max.trim() && !d.min.trim()) d.min = '-inf';
    saveSoon();
    renderNow();
  });
  for (const [inp, k] of [[min, 'min'], [max, 'max']] as const) {
    inp.addEventListener('input', () => { d[k] = inp.value; sheetChanged(); });
    inp.addEventListener('focus', () => { setTarget(inp); setActive(row.id); });
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (k === 'min') { max.focus(); max.select(); return; }
      nextLine(row.id);
    });
  }
  const shade = ({ min: lo, max: hi }: DistBounds) => {
    d.cdf = true; d.min = lo; d.max = hi; cb.checked = true; min.value = lo; max.value = hi;
    sheetChanged();
  };
  const presets = () => distPresets(d, results[rowIndex(row.id)]?.value);
  const preset = (label: string, title: string, bounds: () => DistBounds) =>
    h('button', { type: 'button', class: 'preset', title, onclick: () => shade(bounds()) }, label);
  return h('div', { class: 'dist' },
    h('label', { class: 'cdf-label' }, cb, h('span', {}, 'Cumulative probability')),
    bounds,
    h('div', { class: 'presets' },
      preset('left', 'P(X < b)', () => presets().left),
      preset('right', 'P(X > a)', () => presets().right),
      preset('clear', 'No shading', () => DIST_OFF),
      ...[1, 2, 3].map((k) =>
        h('button', { type: 'button', class: 'preset sigma', title: `Shade μ − ${k}σ to μ + ${k}σ (${k === 1 ? '68' : k === 2 ? '95' : '99.7'}% by the empirical rule)`, onclick: () => {
          const band = presets().bands[k - 1];
          if (!band) return;
          play('fn');
          shade(band);
        } }, `±${k}σ`),
      ),
      prob,
    ),
    err,
  );
}
function syncDist(v: RowView, row: Extract<Row, { kind: 'expr' }>, r: RowResult, o: DisplayOpts): void {
  const d = row.dist!;
  const box = v.extra.querySelector<HTMLElement>('.dist')!;
  box.classList.toggle('on', d.cdf);
  const isNormal = typeof r.value === 'object' && r.value.t === 'normal';
  box.querySelectorAll<HTMLButtonElement>('.sigma').forEach((b) => (b.hidden = !isNormal));
  const cb = box.querySelector<HTMLInputElement>('.cdf')!;
  cb.checked = d.cdf;
  const minI = box.querySelector<HTMLInputElement>('.min')!, maxI = box.querySelector<HTMLInputElement>('.max')!;
  if (document.activeElement !== minI) minI.value = d.min;
  if (document.activeElement !== maxI) maxI.value = d.max;
  const prob = box.querySelector<HTMLButtonElement>('.dist-prob')!;
  const err = box.querySelector<HTMLElement>('.dist-err')!;
  err.textContent = r.distError ?? '';
  err.hidden = !r.distError;
  if (r.distProb !== undefined) {
    const p = r.distProb;
    const { stmt, zText } = distStatement(d, r.value, o);
    prob.replaceChildren(
      h('span', { class: 'stmt' }, stmt),
      h('span', { class: 'eq' }, '='),
      h('span', { class: 'pv' }, formatNumber(p, o, true)),
      zText ? h('span', { class: 'zs' }, zText) : '',
    );
    prob.onclick = () => copy(plainValue(p, o, true));
    prob.hidden = false;
  } else prob.hidden = true;
}

export function initLineoutput(): void {
  let matrixFitWidth = 0;
  new ResizeObserver(() => {
    if (listEl.clientWidth === matrixFitWidth) return;
    matrixFitWidth = listEl.clientWidth;
    fitMatrices(listEl);
  }).observe(listEl);
  document.fonts?.addEventListener('loadingdone', () => { batchLayout(() => { for (const v of views.values()) measureTex(v); }); syncListEdges(); });
}
