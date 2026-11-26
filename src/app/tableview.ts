import { cmdOrCtrl } from './platform';
import type { RowResult } from '../engine/document';
import { type DisplayOpts, formatNumber, plainValue } from '../engine/format';
import { friendlyError } from '../ui/errortext';
import type { Row } from './docmodel';
import { h } from './dom';
import { deleteRow, addRow } from './edits';
import { copy } from './feedback';
import { makeGutter, setActive } from './rows';
import { type RowView } from './rowviews';
import { setTarget, doc, rowIndex, sheetChanged } from './sheet';

export function makeTableView(row: Extract<Row, { kind: 'table' }>): RowView {
  const { gutter, idx, chip } = makeGutter(row);
  const out = h('div', { class: 'out' });
  const extra = h('div', { class: 'extra' });
  const grid = h('div', { class: 'table-wrap' });
  const del = h('button', { type: 'button', class: 'del', title: 'Delete table', 'aria-label': 'Delete table' }, '×');
  const el = h('div', { class: 'row table-row', role: 'listitem' }, gutter, h('div', { class: 'body' }, grid, out, extra), del);
  del.addEventListener('click', () => deleteRow(row.id, false));
  const view: RowView = { row, el, idx, chip, out, extra };
  const build = () => {
    const cols = row.columns;
    const nRows = Math.max(...cols.map((c) => c.cells.length));
    cols.forEach((c) => { while (c.cells.length < nRows) c.cells.push(''); });
    const table = h('table', { class: 'tbl' });
    const head = h('tr');
    cols.forEach((c, ci) => {
      const inp = h('input', { class: 'th', value: c.header, spellcheck: 'false', 'aria-label': `Column ${ci + 1} header`, placeholder: ci === 0 ? 'x' : 'name or x²' });
      inp.addEventListener('input', () => { c.header = inp.value; sheetChanged(); });
      inp.addEventListener('keydown', (e) => {
        if (!(e.key === 'Backspace' && cmdOrCtrl(e) && e.shiftKey) || cols.length <= 1) return;
        e.preventDefault();
        cols.splice(ci, 1);
        build();
        sheetChanged();
        grid.querySelector<HTMLInputElement>(`thead th:nth-child(${Math.max(1, ci)}) input`)?.focus();
      });
      inp.addEventListener('focus', () => { setTarget(inp); setActive(row.id); });
      head.append(h('th', {}, inp));
    });
    const addCol = h('button', { type: 'button', class: 'add-col', title: 'Add column' }, '+');
    addCol.addEventListener('click', () => {
      cols.push({ header: '', cells: new Array(nRows).fill('') });
      build();
      sheetChanged();
    });
    head.append(h('th', { class: 'add' }, addCol));
    table.append(h('thead', {}, head));
    const body = h('tbody');
    for (let r = 0; r < nRows; r++) {
      const tr = h('tr');
      cols.forEach((c, ci) => {
        const inp = h('input', { class: 'td', value: c.cells[r], spellcheck: 'false', 'aria-label': `Row ${r + 1}, column ${ci + 1}`, 'data-r': r, 'data-c': ci });
        inp.addEventListener('input', () => {
          c.cells[r] = inp.value;
          if (r === nRows - 1 && inp.value.trim()) {
            cols.forEach((cc) => cc.cells.push(''));
            const caret = inp.selectionStart;
            build();
            const again = grid.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${ci}"]`);
            again?.focus();
            if (again && caret !== null) again.setSelectionRange(caret, caret);
          }
          sheetChanged();
        });
        inp.addEventListener('focus', () => { setTarget(inp); setActive(row.id); });
        inp.addEventListener('keydown', (e) => {
          const move = (dr: number, dc: number) => {
            const n = grid.querySelector<HTMLInputElement>(`input[data-r="${r + dr}"][data-c="${ci + dc}"]`);
            if (n) { e.preventDefault(); n.focus(); n.select(); }
          };
          if (e.key === 'Enter' || e.key === 'ArrowDown') move(1, 0);
          else if (e.key === 'ArrowUp') move(-1, 0);
          else if (e.key === 'Tab' && !e.shiftKey && ci < cols.length - 1) move(0, 1);
          else if (e.key === 'Tab' && e.shiftKey && ci > 0) move(0, -1);
          else if (e.key === 'Backspace' && cmdOrCtrl(e) && e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            for (const col of cols) col.cells.splice(r, 1);
            if (!cols[0] || cols[0].cells.length === 0) cols.forEach((col) => col.cells.push(''));
            build();
            sheetChanged();
            const target = grid.querySelector<HTMLInputElement>(`input[data-r="${Math.max(0, r - 1)}"][data-c="${ci}"]`);
            target?.focus();
          }
        });
        const td = h('td', { class: 'cell' }, inp);
        tr.append(td);
      });
      tr.append(h('td'));
      body.append(tr);
    }
    table.append(body);
    const foot = h('tr', { class: 'foot' });
    cols.forEach(() => foot.append(h('td', { class: 'sum' })));
    foot.append(h('td'));
    table.append(h('tfoot', {}, foot));
    grid.replaceChildren(table);
  };
  build();
  return view;
}
function leastSquares(xsIn: (number | null)[], ysIn: (number | null)[]): { a: number; b: number; r2: number } | null {
  const pts: [number, number][] = [];
  for (let i = 0; i < Math.min(xsIn.length, ysIn.length); i++) {
    const x = xsIn[i], y = ysIn[i];
    if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
  }
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return null;
  const a = sxy / sxx, b = my - a * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { a, b, r2 };
}
export function renderTableFoot(v: RowView, r: RowResult, o: DisplayOpts): void {
  const t = r.table;
  const sums = v.el.querySelectorAll<HTMLElement>('tfoot .sum');
  const notes: (Node | string)[] = [];
  t?.columns.forEach((c, k) => {
    const cell = sums[k];
    if (!cell) return;
    cell.textContent = c.sum !== undefined ? `Σ ${formatNumber(c.sum, o)}` : '';
    cell.classList.toggle('warn', !!c.probWarning);
    if (c.probWarning) notes.push(h('span', { class: 'note warn' }, c.probWarning));
    if (c.error) notes.push(h('span', { class: 'err' }, c.error));
    const row = doc.rows[rowIndex(r.id)] as Extract<Row, { kind: 'table' }>;
    const computed = c.computed;
    v.el.querySelectorAll<HTMLInputElement>(`input[data-c="${k}"]`).forEach((inp, ri) => {
      const wasComputed = inp.classList.contains('computed');
      inp.readOnly = computed;
      inp.classList.toggle('computed', computed);
      if (computed) {
        const val = c.values[ri];
        inp.value = val === null || val === undefined ? '' : formatNumber(val, o);
      } else if (wasComputed) {
        inp.value = row.columns[k].cells[ri] ?? '';
      }
    });
  });
  if (t?.ev !== undefined) {
    const ev = t.ev;
    const b = h('button', { type: 'button', class: 'result', title: 'Copy' }, h('span', { class: 'eq' }, 'E(X) ='), h('span', { class: 'val' }, formatNumber(ev, o)));
    b.onclick = () => copy(plainValue(ev, o));
    notes.unshift(b);
  }
  const fit = t && t.ev === undefined && !t.columns[1]?.computed ? leastSquares(t.columns[0]?.values ?? [], t.columns[1]?.values ?? []) : null;
  if (fit) {
    const btn = h('button', { type: 'button', class: 'fix' }, `Fit line  (r² = ${fit.r2.toFixed(4)})`);
    btn.addEventListener('click', () => {
      const a = Number(fit.a.toPrecision(6)), b = Number(fit.b.toPrecision(6));
      addRow(r.id, { kind: 'expr', text: `y = ${a}x ${b < 0 ? '−' : '+'} ${Math.abs(b)}` });
    });
    notes.push(btn);
  }
  if (r.error) notes.push(h('span', { class: 'err', title: r.error }, friendlyError(r.error)));
  v.out.replaceChildren(...notes);
  v.out.hidden = notes.length === 0;
}
