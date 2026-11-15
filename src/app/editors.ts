import { isEmptyLine } from '../ui/document';
import { definedNames, EDITORS, freeName, nameProblem, stepSize, type EditorText, type ListEditor } from '../ui/editors';
import { h } from './dom';
import { addRow } from './edits';
import { editText } from './lineeditor';
import { cancelButton, mountDialog } from './overlay';
import { focusRow, views } from './rowviews';
import { activeId, doc, rowIndex } from './sheet';

function editorName(candidates: readonly string[], label: string): HTMLInputElement {
  const used = definedNames(doc.rows);
  const input = h('input', { class: 'mx-name', value: freeName(candidates, used), 'aria-label': label, spellcheck: 'false' }) as HTMLInputElement;
  input.addEventListener('input', () => input.setCustomValidity(nameProblem(input.value, used)));
  return input;
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

interface SizeAxis { label: string; add: string; remove: string; step: (by: -1 | 1) => void }

/** `draw` lays out the grid and returns the text for the size. */
function editorDialog(spec: { names: readonly string[]; text: EditorText }, axes: SizeAxis[], grid: HTMLElement, draw: () => string, line: (name: string) => string): void {
  const nameInp = editorName(spec.names, spec.text.nameLabel);
  const dims = h('span', { class: 'mx-dims' });
  const redraw = () => { dims.textContent = draw(); };
  const step = (label: string, by: -1 | 1, axis: SizeAxis) => h('button', { type: 'button', 'aria-label': by < 0 ? axis.remove : axis.add, title: by < 0 ? axis.remove : axis.add, onclick: () => { axis.step(by); redraw(); } }, label);
  const dialog = h('dialog', { class: 'mx', 'aria-label': spec.text.title },
    h('form', { method: 'dialog' },
      h('h2', {}, spec.text.title),
      h('div', { class: 'mx-head' }, h('label', {}, h('span', {}, 'Name'), nameInp), h('span', { class: 'muted' }, spec.text.nameHint)),
      h('div', { class: 'mx-size' },
        ...axes.flatMap((axis) => [h('span', {}, axis.label), step('−', -1, axis), step('+', 1, axis)]),
        dims,
      ),
      grid,
      h('div', { class: 'mx-actions' },
        cancelButton(),
        h('button', { type: 'submit', value: 'ok', class: 'primary' }, spec.text.action),
      ),
    ),
  );
  redraw();
  mountDialog(dialog);
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'ok') putEditorLine(line(nameInp.value));
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
    grid.append(h('span', { class: 'mx-point' }, spec.heading(r, count)));
    for (let c = 0; c < spec.columns; c++) grid.append(box(r, c, (dr, dc) => [r + dr, c + dc]));
  }
};

const componentStrip: ListLayout = (grid, spec, count, box) => {
  grid.style.gridTemplateColumns = `repeat(${count}, 5.5rem)`;
  grid.replaceChildren();
  for (let r = 0; r < count; r++) grid.append(h('span', { class: 'mx-axis' }, spec.heading(r, count)));
  for (let r = 0; r < count; r++) grid.append(box(r, 0, (_dr, dc) => [r + dc, 0]));
};

function openListEditor(spec: ListEditor, layout: ListLayout): void {
  let count = spec.size.start;
  const cells: string[][] = [];
  const grid = h('div', { class: 'mx-grid' });
  const cell = (r: number, c: number) => grid.querySelector<HTMLInputElement>(`[data-r="${r}"][data-c="${c}"]`);
  const check = () => {
    grid.querySelectorAll<HTMLInputElement>('input').forEach((i) => i.setCustomValidity(''));
    for (const p of spec.problems(cells, count)) cell(p.r, p.c)?.setCustomValidity(p.message);
  };
  const box: Box = (r, c, to) => cellInput(cells[r][c], spec.placeholder(c), r, c, spec.cellLabel(r, c), (v) => { cells[r][c] = v; check(); }, (dr, dc) => cell(...to(dr, dc))?.focus());
  const draw = () => {
    for (let r = 0; r < count; r++) cells[r] ??= Array.from({ length: spec.columns }, () => '');
    layout(grid, spec, count, box);
    check();
    return spec.sizeText(count);
  };
  editorDialog(spec, [{ label: spec.text.sizeLabel, add: spec.text.add, remove: spec.text.remove, step: (by) => { count = stepSize(spec.size, count, by); } }], grid, draw, (name) => spec.line(name, cells, count));
}

export const openShapeEditor = (): void => openListEditor(EDITORS.shape, pointRows);
export const openVectorEditor = (): void => openListEditor(EDITORS.vector, componentStrip);

export function openMatrixEditor(): void {
  const spec = EDITORS.matrix;
  let rows = spec.size.start, cols = spec.size.start;
  const vals: string[][] = [];
  const grid = h('div', { class: 'mx-grid' });
  const cell = (r: number, c: number) => grid.querySelector<HTMLInputElement>(`[data-r="${r}"][data-c="${c}"]`);
  const draw = () => {
    for (let r = 0; r < rows; r++) { vals[r] ??= []; for (let c = 0; c < cols; c++) vals[r][c] ??= ''; }
    grid.style.gridTemplateColumns = `repeat(${cols}, 4.5rem)`;
    grid.replaceChildren();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) grid.append(cellInput(vals[r][c], spec.placeholder, r, c, spec.cellLabel(r, c), (v) => (vals[r][c] = v), (dr, dc) => cell(r + dr, c + dc)?.focus()));
    return spec.sizeText(rows, cols);
  };
  const axes: SizeAxis[] = [
    { label: spec.text.sizeLabel, add: spec.text.add, remove: spec.text.remove, step: (by) => { rows = stepSize(spec.size, rows, by); } },
    { label: spec.columnText.sizeLabel, add: spec.columnText.add, remove: spec.columnText.remove, step: (by) => { cols = stepSize(spec.size, cols, by); } },
  ];
  editorDialog(spec, axes, grid, draw, (name) => spec.line(name, vals, rows, cols));
}
