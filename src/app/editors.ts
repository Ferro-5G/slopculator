import { BUILDER_FLUIDS, dataListSummary, evaluateBuilderPreview, fieldUnit, FORM_BUILDERS, modeDefaults, type FormBuilderKind } from '../ui/builders';
import { isEmptyLine } from '../ui/document';
import { definedNames, EDITORS, freeName, MATRIX_SIZES, matrixIdentity, nameProblem, polygonPreviewPoints, SHAPE_PRESETS, stepSize, VECTOR_SIZES, vectorMagnitude, type EditorKind, type EditorText, type ListEditor } from '../ui/editors';
import { h } from './dom';
import { addRow } from './edits';
import { editText } from './lineeditor';
import { cancelButton, mountDialog } from './overlay';
import { focusRow, views } from './rowviews';
import { activeId, doc, opts, rowIndex } from './sheet';

function editorName(candidates: readonly string[], label: string, onUpdate: (problem: string) => void): { input: HTMLInputElement; problem: () => string } {
  const used = definedNames(doc.rows);
  const input = h('input', { class: 'mx-name', value: freeName(candidates, used), placeholder: 'Optional', 'aria-label': label, spellcheck: 'false' }) as HTMLInputElement;
  const problem = () => nameProblem(input.value, used);
  input.addEventListener('input', () => {
    const p = problem();
    input.setCustomValidity(p);
    onUpdate(p);
  });
  return { input, problem };
}

function editorCellKeys(inp: HTMLInputElement, move: (dr: number, dc: number) => void): void {
  inp.addEventListener('focus', () => inp.select());
  inp.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const from = inp.selectionStart ?? 0, to = inp.selectionEnd ?? 0, len = inp.value.length;
    const all = from === 0 && to === len;
    const dr = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    const dc = e.key === 'ArrowLeft' && (all || to === 0) ? -1 : e.key === 'ArrowRight' && (all || from === len) ? 1 : 0;
    if (!dr && !dc) return;
    e.preventDefault();
    move(dr, dc);
  });
}

function putEditorLine(text: string): void {
  const cur = activeId ? doc.rows[rowIndex(activeId)] : null;
  if (cur && isEmptyLine(cur)) {
    const inp = views.get(cur.id)!.input!;
    editText(inp, text, 0, inp.value.length);
    focusRow(cur.id);
  } else addRow(activeId, { kind: 'expr', text });
}

function cellInput(value: string, placeholder: string, r: number, c: number, label: string, onInput: (v: string) => void, move: (dr: number, dc: number) => void): HTMLInputElement {
  const inp = h('input', { value, placeholder, 'data-r': String(r), 'data-c': String(c), 'aria-label': label, spellcheck: 'false' }) as HTMLInputElement;
  inp.addEventListener('input', () => onInput(inp.value));
  editorCellKeys(inp, move);
  return inp;
}

interface SizeAxis {
  label: string;
  add: string;
  remove: string;
  value: () => number;
  min: number;
  max: number;
  step: (by: -1 | 1) => void;
}
interface EditorPreset { label: string; active?: () => boolean; apply: () => void }

/** Draws a live SVG mini-plot of a polygon's points on an auto-scaled coordinate frame. */
function drawPolygonSvg(pts: readonly { x: number; y: number }[]): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 160, H = 128, PAD = 20;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'mx-poly-svg');
  svg.setAttribute('aria-hidden', 'true');
  const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  };
  if (pts.length < 2) {
    svg.append(el('text', { x: W / 2, y: H / 2 + 4, 'text-anchor': 'middle', class: 'mx-poly-empty' }, 'Enter ≥ 2 points'));
    return svg;
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let x0 = Math.min(...xs, 0), x1 = Math.max(...xs, 0);
  let y0 = Math.min(...ys, 0), y1 = Math.max(...ys, 0);
  if (x1 - x0 < 1e-6) { x0 -= 1; x1 += 1; }
  if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; }
  const scale = Math.min((W - 2 * PAD) / (x1 - x0), (H - 2 * PAD) / (y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const px = (x: number) => W / 2 + (x - cx) * scale;
  const py = (y: number) => H / 2 - (y - cy) * scale;
  // Subtle origin axes when in view.
  const ox = px(0), oy = py(0);
  if (oy >= 4 && oy <= H - 4) svg.append(el('line', { x1: 6, y1: oy, x2: W - 6, y2: oy, class: 'mx-poly-axis' }));
  if (ox >= 4 && ox <= W - 4) svg.append(el('line', { x1: ox, y1: 6, x2: ox, y2: H - 6, class: 'mx-poly-axis' }));
  const polyPts = pts.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
  svg.append(el(pts.length >= 3 ? 'polygon' : 'polyline', { points: polyPts, class: 'mx-poly-shape' }));
  pts.forEach((p, i) => {
    const x = px(p.x), y = py(p.y);
    svg.append(el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.5, class: 'mx-poly-dot' }));
    svg.append(el('text', { x: (x + 6).toFixed(1), y: (y - 5).toFixed(1), class: 'mx-poly-lbl' }, `P${i + 1}`));
  });
  return svg;
}

/** `draw` lays out the grid and returns the text for the size. */
function editorDialog(
  kind: 'matrix' | 'shape' | 'vector',
  spec: { names: readonly string[]; text: EditorText },
  axes: SizeAxis[],
  presets: EditorPreset[],
  grid: HTMLElement,
  draw: () => string,
  line: (name: string) => string,
  cellIssue: () => string,
  onSyncPreview: (fn: () => void) => void,
  extra: {
    inline?: boolean;
    onInsert?: (text: string) => void;
    meta?: () => string | null;
    visual?: HTMLElement;
    updateVisual?: () => void;
  } = {},
): void {
  const hint = h('span', { class: 'mx-hint' }, spec.text.nameHint);
  const preview = h('code', { class: 'mx-preview' });
  const metaEl = h('span', { class: 'mx-meta', hidden: true });
  const issueEl = h('span', { class: 'mx-issue', hidden: true });
  const presetBtns: { btn: HTMLButtonElement; p: EditorPreset }[] = [];
  const syncPreview = () => {
    const np = extra.inline ? '' : nameCtrl.problem();
    hint.textContent = np || spec.text.nameHint;
    hint.classList.toggle('bad', !!np);
    const ci = cellIssue();
    issueEl.textContent = ci;
    issueEl.hidden = !ci;
    const expr = line(extra.inline ? '' : nameCtrl.input.value);
    preview.textContent = expr;
    preview.classList.toggle('dim', !!ci || !!np);
    const meta = extra.meta?.() ?? null;
    metaEl.textContent = meta ?? '';
    metaEl.hidden = !meta;
    extra.updateVisual?.();
    for (const pb of presetBtns) pb.btn.classList.toggle('on', !!pb.p.active?.());
  };
  const nameCtrl = editorName(spec.names, spec.text.nameLabel, () => syncPreview());
  const dims = h('span', { class: 'mx-dims' });
  const stepControls: { axis: SizeAxis; dec: HTMLButtonElement; inc: HTMLButtonElement; val: HTMLElement }[] = [];
  const redraw = () => {
    dims.textContent = draw();
    for (const s of stepControls) {
      const v = s.axis.value();
      s.val.textContent = String(v);
      s.dec.disabled = v <= s.axis.min;
      s.inc.disabled = v >= s.axis.max;
    }
    syncPreview();
  };
  const makeAxis = (axis: SizeAxis) => {
    const dec = h('button', { type: 'button', 'aria-label': axis.remove, title: axis.remove, onclick: () => { axis.step(-1); redraw(); } }, '−') as HTMLButtonElement;
    const val = h('span', { class: 'mx-count', 'aria-hidden': 'true' }, String(axis.value()));
    const inc = h('button', { type: 'button', 'aria-label': axis.add, title: axis.add, onclick: () => { axis.step(1); redraw(); } }, '+') as HTMLButtonElement;
    stepControls.push({ axis, dec, inc, val });
    return h('div', { class: 'mx-axis-ctl' }, h('span', { class: 'mx-axis-lbl' }, axis.label), h('div', { class: 'mx-stepper' }, dec, val, inc));
  };
  const presetBar = presets.length
    ? h('div', { class: 'mx-presets' }, ...presets.map((p) => {
      const btn = h('button', { type: 'button', class: 'mx-preset', onclick: () => { p.apply(); redraw(); grid.querySelector('input')?.focus(); } }, p.label) as HTMLButtonElement;
      presetBtns.push({ btn, p });
      return btn;
    }))
    : null;
  const frame = h('div', { class: `mx-frame mx-kind-${kind}${extra.visual ? ' has-visual' : ''}` }, grid, extra.visual ?? null);
  const dialog = h('dialog', { class: `mx mx-${kind}`, 'aria-label': spec.text.title },
    h('form', { method: 'dialog' },
      h('h2', {}, spec.text.title),
      extra.inline ? null : spec.text.subtitle ? h('p', { class: 'mx-sub' }, spec.text.subtitle) : null,
      extra.inline ? null : h('div', { class: 'mx-head' },
        h('label', {}, h('span', {}, 'Name'), nameCtrl.input),
        hint,
      ),
      h('div', { class: 'mx-bar' },
        h('div', { class: 'mx-size' }, ...axes.map(makeAxis), dims),
        presetBar,
      ),
      frame,
      h('div', { class: 'mx-preview-box' },
        h('span', { class: 'mx-preview-lbl' }, 'Preview'),
        preview,
        metaEl,
      ),
      issueEl,
      h('div', { class: 'mx-actions' },
        cancelButton(),
        h('button', { type: 'submit', value: 'ok', class: 'primary' }, spec.text.action),
      ),
    ),
  );
  onSyncPreview(syncPreview);
  redraw();
  mountDialog(dialog);
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'ok') return;
    const out = line(extra.inline ? '' : nameCtrl.input.value);
    if (extra.onInsert) extra.onInsert(out);
    else putEditorLine(out);
  });
  dialog.showModal();
  grid.querySelector('input')?.focus();
}

/** A box, and where each arrow key takes it. */
type Box = (r: number, c: number, to: (dr: number, dc: number) => [number, number]) => HTMLInputElement;
type ListLayout = (grid: HTMLElement, spec: ListEditor, count: number, box: Box) => void;

const pointRows: ListLayout = (grid, spec, count, box) => {
  grid.classList.add('mx-points');
  grid.replaceChildren(h('span', {}), ...Array.from({ length: spec.columns }, (_, c) => h('span', { class: 'mx-axis' }, spec.placeholder(c))));
  for (let r = 0; r < count; r++) {
    grid.append(h('span', { class: 'mx-point' }, `P${spec.heading(r, count)}`));
    for (let c = 0; c < spec.columns; c++) grid.append(box(r, c, (dr, dc) => [r + dr, c + dc]));
  }
};

const componentStrip: ListLayout = (grid, spec, count, box) => {
  grid.style.gridTemplateColumns = `repeat(${count}, minmax(4rem, 5rem))`;
  grid.replaceChildren();
  for (let r = 0; r < count; r++) grid.append(h('span', { class: 'mx-axis' }, spec.heading(r, count)));
  for (let r = 0; r < count; r++) grid.append(box(r, 0, (_dr, dc) => [r + dc, 0]));
};

function openListEditor(kind: 'shape' | 'vector', spec: ListEditor, layout: ListLayout): void {
  let count = spec.size.start;
  const cells: string[][] = [];
  const grid = h('div', { class: 'mx-grid' });
  const visual = kind === 'shape' ? h('div', { class: 'mx-poly-wrap' }) : undefined;
  let sync = () => {};
  const cell = (r: number, c: number) => grid.querySelector<HTMLInputElement>(`[data-r="${r}"][data-c="${c}"]`);
  const check = () => {
    grid.querySelectorAll<HTMLInputElement>('input').forEach((i) => i.setCustomValidity(''));
    for (const p of spec.problems(cells, count)) cell(p.r, p.c)?.setCustomValidity(p.message);
  };
  const box: Box = (r, c, to) => cellInput(cells[r][c], spec.placeholder(c), r, c, spec.cellLabel(r, c), (v) => { cells[r][c] = v; check(); sync(); }, (dr, dc) => cell(...to(dr, dc))?.focus());
  const draw = () => {
    for (let r = 0; r < count; r++) cells[r] ??= Array.from({ length: spec.columns }, () => '');
    layout(grid, spec, count, box);
    check();
    return spec.sizeText(count);
  };
  const presets: EditorPreset[] = [
    ...(kind === 'shape' ? SHAPE_PRESETS.map((p) => ({
      label: p.label,
      apply: () => {
        count = p.points.length;
        for (let r = 0; r < count; r++) cells[r] = [...p.points[r]];
      },
    })) : VECTOR_SIZES.map((d) => ({
      label: `${d}D`,
      active: () => count === d,
      apply: () => { count = d; },
    }))),
    { label: 'Clear', apply: () => { for (let r = 0; r < cells.length; r++) cells[r] = Array.from({ length: spec.columns }, () => ''); } },
  ];
  const axes: SizeAxis[] = [{
    label: spec.text.sizeLabel, add: spec.text.add, remove: spec.text.remove,
    value: () => count, min: spec.size.min, max: spec.size.max,
    step: (by) => { count = stepSize(spec.size, count, by); },
  }];
  editorDialog(
    kind, spec, axes, presets, grid, draw,
    (name) => spec.line(name, cells, count),
    () => spec.problems(cells, count)[0]?.message ?? '',
    (fn) => { sync = fn; },
    {
      visual,
      updateVisual: visual ? () => visual.replaceChildren(drawPolygonSvg(polygonPreviewPoints(cells, count))) : undefined,
      meta: kind === 'vector' ? () => {
        const m = vectorMagnitude(cells, count);
        return m === null ? null : `‖v‖ = ${Number(m.toPrecision(6))}`;
      } : undefined,
    },
  );
}

export const openShapeEditor = (): void => openListEditor('shape', EDITORS.shape, pointRows);
export const openVectorEditor = (): void => openListEditor('vector', EDITORS.vector, componentStrip);

export function openMatrixEditor(options: { inline?: boolean; onInsert?: (text: string) => void } = {}): void {
  const spec = EDITORS.matrix;
  let rows = spec.size.start, cols = spec.size.start;
  const vals: string[][] = [];
  const grid = h('div', { class: 'mx-grid' });
  let sync = () => {};
  const cell = (r: number, c: number) => grid.querySelector<HTMLInputElement>(`[data-r="${r}"][data-c="${c}"]`);
  const draw = () => {
    for (let r = 0; r < rows; r++) { vals[r] ??= []; for (let c = 0; c < cols; c++) vals[r][c] ??= ''; }
    grid.style.gridTemplateColumns = `repeat(${cols}, 4.5rem)`;
    grid.replaceChildren();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) grid.append(cellInput(vals[r][c], spec.placeholder, r, c, spec.cellLabel(r, c), (v) => { vals[r][c] = v; sync(); }, (dr, dc) => cell(r + dr, c + dc)?.focus()));
    return spec.sizeText(rows, cols);
  };
  const axes: SizeAxis[] = [
    { label: spec.text.sizeLabel, add: spec.text.add, remove: spec.text.remove, value: () => rows, min: spec.size.min, max: spec.size.max, step: (by) => { rows = stepSize(spec.size, rows, by); } },
    { label: spec.columnText.sizeLabel, add: spec.columnText.add, remove: spec.columnText.remove, value: () => cols, min: spec.size.min, max: spec.size.max, step: (by) => { cols = stepSize(spec.size, cols, by); } },
  ];
  const presets: EditorPreset[] = [
    ...MATRIX_SIZES.map((n) => ({
      label: `${n} × ${n}`,
      active: () => rows === n && cols === n,
      apply: () => { rows = n; cols = n; },
    })),
    {
      label: 'Identity',
      apply: () => {
        const id = matrixIdentity(rows, cols);
        for (let r = 0; r < rows; r++) { vals[r] ??= []; for (let c = 0; c < cols; c++) vals[r][c] = id[r][c]; }
      },
    },
    {
      label: 'Clear',
      apply: () => { for (let r = 0; r < vals.length; r++) for (let c = 0; c < vals[r].length; c++) vals[r][c] = ''; },
    },
  ];
  editorDialog('matrix', spec, axes, presets, grid, draw, (name) => spec.line(name, vals, rows, cols), () => '', (fn) => { sync = fn; }, options);
}

/** Opens any of the declarative guided GUI builders (Calculus, Normal, Data list, Chance, HVAC). */
export function openFormBuilder(kind: FormBuilderKind, startMode?: string): void {
  const spec = FORM_BUILDERS[kind];
  let modeIdx = Math.max(0, startMode ? spec.modes.findIndex((m) => m.id === startMode) : 0);
  const used = definedNames(doc.rows);
  // Each mode keeps its own values, so switching mode shows that mode's defaults and switching back keeps the edits.
  const byMode: Record<string, Record<string, string>> = {};
  let values: Record<string, string> = {};
  const seedDefaults = () => {
    const mode = spec.modes[modeIdx];
    values = byMode[mode.id] ??= modeDefaults(mode);
  };
  seedDefaults();
  const initialNames = spec.modes[modeIdx].names;
  let nameVal = initialNames ? freeName(initialNames, used) : '';

  const modeBar = spec.modes.length > 1 ? h('div', { class: 'fb-modes', role: 'tablist', 'aria-label': `${spec.title} mode` }) : null;
  const noteEl = h('p', { class: 'fb-note' });
  const presetBar = spec.presets?.length ? h('div', { class: 'mx-presets fb-presets' }) : null;
  const fieldsEl = h('div', { class: 'fb-fields' });
  const previewCode = h('code', { class: 'mx-preview' });
  const answerBadge = h('span', { class: 'mx-meta', hidden: true });
  const issueEl = h('span', { class: 'mx-issue', hidden: true });
  const submitBtn = h('button', { type: 'submit', value: 'ok', class: 'primary' }, spec.action) as HTMLButtonElement;

  const sync = () => {
    const mode = spec.modes[modeIdx];
    const nErr = mode.names ? nameProblem(nameVal, used) : '';
    const fErr = mode.validate?.(values) ?? '';
    const err = nErr || fErr;
    const expr = mode.build(values, nameVal);
    previewCode.textContent = expr;
    previewCode.classList.toggle('dim', !!err);
    issueEl.textContent = err;
    issueEl.hidden = !err;
    submitBtn.disabled = !!err;
    if (err) {
      answerBadge.hidden = true;
    } else if (kind === 'data') {
      const summary = dataListSummary(values.items ?? '', doc.rows, doc.settings, opts(), activeId);
      answerBadge.textContent = summary ?? '';
      answerBadge.hidden = !summary;
    } else {
      const ev = evaluateBuilderPreview(expr, doc.rows, doc.settings, opts(), activeId);
      if (ev.answer !== null) {
        answerBadge.textContent = `= ${ev.answer}`;
        answerBadge.classList.remove('bad');
        answerBadge.hidden = false;
      } else if (ev.error) {
        answerBadge.textContent = ev.error;
        answerBadge.classList.add('bad');
        answerBadge.hidden = false;
      } else {
        answerBadge.hidden = true;
      }
    }
  };

  const renderBody = () => {
    seedDefaults();
    const mode = spec.modes[modeIdx];
    noteEl.textContent = mode.note;
    noteEl.hidden = !mode.note;
    if (modeBar) {
      modeBar.replaceChildren(...spec.modes.map((m, i) => {
        const b = h('button', {
          type: 'button', role: 'tab', class: 'fb-mode',
          'aria-selected': String(i === modeIdx),
          onclick: () => { modeIdx = i; renderBody(); fieldsEl.querySelector<HTMLElement>('input, textarea')?.focus(); },
        }, m.label);
        return b;
      }));
    }
    if (presetBar && spec.presets) {
      presetBar.replaceChildren(...spec.presets.map((pr) =>
        h('button', {
          type: 'button', class: 'mx-preset',
          onclick: () => {
            if (pr.mode) {
              const j = spec.modes.findIndex((m) => m.id === pr.mode);
              if (j >= 0) modeIdx = j;
            }
            seedDefaults();
            Object.assign(values, pr.values);
            renderBody();
          },
        }, pr.label)));
    }
    const nodes: HTMLElement[] = [];
    if (mode.names) {
      const inp = h('input', { class: 'mx-name', value: nameVal, placeholder: 'Optional', 'aria-label': 'List name', spellcheck: 'false' }) as HTMLInputElement;
      inp.addEventListener('input', () => { nameVal = inp.value; sync(); });
      nodes.push(h('div', { class: 'mx-head fb-full' }, h('label', {}, h('span', {}, 'Name'), inp), h('span', { class: 'mx-hint' }, mode.nameHint ?? '')));
    }
    for (const f of mode.fields) {
      if (f.kind === 'fluid') {
        const group = h('div', { class: 'fb-field fb-full' },
          h('span', { class: 'fb-label' }, f.label),
          h('div', { class: 'fb-chips', role: 'radiogroup', 'aria-label': f.label }, ...BUILDER_FLUIDS.map((fl) => {
            const on = (values[f.id] || f.defaultValue) === fl;
            return h('button', {
              type: 'button', role: 'radio', class: 'fb-chip', 'aria-checked': String(on),
              onclick: () => { values[f.id] = fl; renderBody(); },
            }, fl.replace(/^R-/, ''));
          })),
        );
        nodes.push(group);
      } else if (f.kind === 'toggle') {
        const on = values[f.id] === 'true';
        const cb = h('input', { type: 'checkbox', checked: on, 'data-field': f.id }) as HTMLInputElement;
        // The SI switch changes the units the other fields show, so it redraws them and keeps the focus on itself.
        cb.addEventListener('change', () => {
          values[f.id] = String(cb.checked);
          if (f.id !== 'si') { sync(); return; }
          const focused = document.activeElement === cb;
          renderBody();
          if (focused) fieldsEl.querySelector<HTMLInputElement>('input[data-field="si"]')?.focus();
        });
        nodes.push(h('label', { class: 'fb-toggle fb-full' }, cb, h('span', {}, f.label)));
      } else if (f.kind === 'list') {
        const ta = h('textarea', { class: 'fb-textarea', rows: 3, placeholder: f.placeholder, 'aria-label': f.label, spellcheck: 'false' }, values[f.id] ?? '') as HTMLTextAreaElement;
        ta.addEventListener('input', () => { values[f.id] = ta.value; sync(); });
        nodes.push(h('label', { class: 'fb-field fb-full' }, h('span', { class: 'fb-label' }, f.label), ta));
      } else {
        const inp = h('input', { class: 'fb-input', value: values[f.id] ?? '', placeholder: f.placeholder, 'aria-label': f.label, spellcheck: 'false' }) as HTMLInputElement;
        inp.addEventListener('input', () => { values[f.id] = inp.value; sync(); });
        inp.addEventListener('focus', () => inp.select());
        const span = f.third ? ' fb-third' : f.half ? ' fb-half' : ' fb-full';
        nodes.push(h('label', { class: `fb-field${span}` },
          h('span', { class: 'fb-label' }, f.label, fieldUnit(f, values) ? h('span', { class: 'fb-unit' }, fieldUnit(f, values)) : null),
          inp,
        ));
      }
    }
    fieldsEl.replaceChildren(...nodes);
    sync();
  };

  const dialog = h('dialog', { class: `mx fb-dialog fb-${kind}`, 'aria-label': spec.title },
    h('form', { method: 'dialog' },
      h('h2', {}, spec.title),
      spec.subtitle ? h('p', { class: 'mx-sub' }, spec.subtitle) : null,
      modeBar,
      noteEl,
      presetBar,
      fieldsEl,
      h('div', { class: 'mx-preview-box' },
        h('span', { class: 'mx-preview-lbl' }, 'Preview'),
        previewCode,
        answerBadge,
      ),
      issueEl,
      h('div', { class: 'mx-actions' }, cancelButton(), submitBtn),
    ),
  );
  renderBody();
  mountDialog(dialog);
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'ok') return;
    const mode = spec.modes[modeIdx];
    putEditorLine(mode.build(values, nameVal));
  });
  dialog.showModal();
  fieldsEl.querySelector<HTMLElement>('input, textarea')?.focus();
}

export function openBuilder(kind: EditorKind, mode?: string): void {
  if (kind === 'matrix') openMatrixEditor();
  else if (kind === 'shape') openShapeEditor();
  else if (kind === 'vector') openVectorEditor();
  else openFormBuilder(kind, mode);
}
