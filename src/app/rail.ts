// Desktop sidebar outliner: shows the sheet's sent lines directly above the composer inside the floating Liquid Glass
// sidebar, so hitting Enter sends each line straight up into the list while its interactive block appears on the
// spatial canvas beside it. Clicking a line loads it into the composer; hovering highlights its block on the canvas.
import { isHeading } from '../engine/parser';
import { composerAnswer } from '../ui/composerline';
import { sheetNames, typeset } from '../ui/typeset';
import { editLine, editingId } from './composer';
import { h } from './dom';
import { deleteRow } from './edits';
import { railCount, railList } from './layout';
import { mathNode } from './mathdom';
import { openLineMenu } from './rows';
import { views } from './rowviews';
import { doc, opts, results } from './sheet';

let lastCount = 0;
let onReveal: (id: string) => void = () => {};

/** Registers a callback that brings a clicked sheet line's block into view on the canvas. */
export function setRailReveal(fn: (id: string) => void): void {
  onReveal = fn;
}

/** Syncs the desktop sidebar's ordered sheet list from the current document and results. */
export function syncRail(composerRowId: string, isWide: boolean): void {
  if (!isWide) return;
  const names = sheetNames(doc.rows, results, doc.settings.lineNames);
  const displayOpts = opts();
  const items: HTMLElement[] = [];

  doc.rows.forEach((row, k) => {
    // Only sent lines belong in the rail; the unsent composer draft stays in the composer until Enter sends it.
    if (row.id === composerRowId && !editingId) return;
    if (row.kind === 'expr' && !row.text.trim() && row.id !== editingId) return;
    const r = results[k];
    const hasCurve = !!r && r.graph.length > 0;
    const isSlider = !!r?.slider;
    const isEditing = row.id === editingId;
    const heading = row.kind === 'expr' && isHeading(row.text);
    const ans = row.kind === 'expr' && !heading ? composerAnswer(row.text, r, displayOpts) : null;

    const exprEl = h('span', { class: 'rail-expr' });
    if (heading) {
      exprEl.textContent = row.text.replace(/^#+\s*/, '').trim() || 'Section';
    } else if (row.kind === 'expr') {
      const boxes = typeset(row.text, { names, stack: false, listMax: 4 });
      if (boxes) exprEl.append(mathNode(boxes));
      else exprEl.textContent = row.text;
    } else {
      exprEl.textContent = `Table (${row.columns.map((c) => c.header).join(', ')})`;
    }

    const metaEl = h('span', { class: 'rail-meta' });
    if (r?.error) {
      metaEl.classList.add('err');
      metaEl.textContent = '!';
    } else if (ans !== null) {
      metaEl.textContent = ans;
    } else if (isSlider) {
      metaEl.classList.add('kind');
      metaEl.textContent = 'slider';
    } else if (hasCurve) {
      metaEl.classList.add('kind');
      metaEl.textContent = 'graph';
    }

    const delBtn = h('button', {
      type: 'button',
      class: 'rail-del',
      'aria-label': `Delete line ${k + 1}`,
      title: 'Delete line',
    }, '×');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteRow(row.id);
    });

    const item = h('div', {
      class: `rail-item${isEditing ? ' editing' : ''}${hasCurve ? ' has-curve' : ''}${heading ? ' is-heading' : ''}`,
      role: 'listitem',
      tabindex: '0',
    },
      h('span', { class: 'rail-dot', 'aria-hidden': 'true' }),
      exprEl,
      metaEl,
      delBtn,
    );
    if (hasCurve) item.style.setProperty('--c', `var(--curve-${(row.color % 8) + 1})`);

    const setLit = (on: boolean) => { views.get(row.id)?.el.classList.toggle('rail-lit', on); };
    item.addEventListener('mouseenter', () => setLit(true));
    item.addEventListener('mouseleave', () => setLit(false));
    item.addEventListener('click', () => {
      onReveal(row.id);
      if (row.kind === 'expr') editLine(row.id);
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openLineMenu(row, e.clientX, e.clientY);
    });
    item.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && row.kind === 'expr') {
        e.preventDefault();
        onReveal(row.id);
        editLine(row.id);
      }
    });
    items.push(item);
  });

  railCount.textContent = String(items.length);
  railCount.hidden = items.length === 0;
  if (!items.length) {
    railList.replaceChildren(h('div', { class: 'rail-empty' }, 'Sent calculations rise here and appear on the canvas.'));
  } else {
    railList.replaceChildren(...items);
  }

  if (items.length > lastCount) {
    railList.scrollTop = railList.scrollHeight;
  }
  lastCount = items.length;
}
