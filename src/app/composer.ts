// The composer: the one place to type. It holds the view of the line being written, a new line (the draft) or a block
// being edited, so every line editor (completion, slots, fixes, the keypad, the tabs) works there as it always has.
// Enter sends a draft to the canvas as a block, finishes an edit, or changes the line that already defines a name.
import { composerIntent, composerPlaceholder, GRAPH_PREVIEW_LABEL, updatePreviewRows } from '../ui/canvas';
import { composerAnswer, composerError, composerGlows, composerQuietFigure, composerSpark, composerState, sparkPath, type ComposerState } from '../ui/composerline';
import { mirrorField } from './composermirror';
import { isEmptyLine } from '../ui/document';
import { AC, ENTER } from '../ui/keypad';
import { flashBlock, liftFrom } from './canvas';
import { blankRow } from './docmodel';
import { h } from './dom';
import { addRow, dragEnds, pushStep, setEnterHandler, setLineText } from './edits';
import { motionNow, pulse } from './feedback';
import { slotForEnd } from '../ui/slots';
import { slotInfo } from '../ui/linestate';
import { keyButton } from './keypad';
import { composerDock } from './layout';
import { kb } from './platform';
import { views, focusRow, setFocusGuard } from './rowviews';
import { setTypingPauseListener } from './rows';
import { doc, opts, rowIndex, results, screen, renderNow, setEvalRows } from './sheet';
import { ti, closeThumb } from './thumb';
import { CURVES, DURATIONS } from '../ui/motiontokens';

/** The composer's sparkline, as the mockup draws it. */
const SPARK_W = 66, SPARK_H = 24;
/** The row a new line is typed into. It's always the sheet's last row, and empty until the person types. */
let draftRow: string | null = null;
/** A block loaded into the composer to edit, with its text from before, for Cancel. */
export let editingId: string | null = null;
let editStart = '';

// Also a .rows: like the canvas's list, it holds a line's view, so anything that finds every line (`.rows .row`) finds
// the one being written too, last, as the sheet's last line is.
export const composerSlot = h('div', { class: 'composer-slot rows' });
// The composer's enter is the keypad's enter key (ENTER): the same action, sound and offers as the Enter key.
const enterBtn = keyButton(ENTER);
enterBtn.classList.add('composer-enter');
const enterWord = (text: string) => { enterBtn.querySelector('.kl')!.textContent = text; };
const cancelBtn = h('button', { type: 'button', class: 'composer-cancel', title: 'Leave the line as it was (Esc)', hidden: true }, 'Cancel');
const preview = h('span', { class: 'composer-preview', hidden: true });
export const composerBox = h('div', { class: 'composer', 'data-state': 'idle' }, h('span', { class: 'composer-halo', 'aria-hidden': 'true' }), composerSlot, preview, cancelBtn, enterBtn);
export const composerTabs = h('div', { class: 'composer-tabs', role: 'group', 'aria-label': 'Function tabs' });
const acBtn = keyButton(AC);
acBtn.classList.add('composer-ac');
export const composerHead = h('div', { class: 'composer-head' }, h('span', { class: 'spacer' }), acBtn);

/** The state the composer showed last, so its answer rises in only when it first appears. */
let shownState: ComposerState = 'idle';
/** Set by a send: the cleared line takes a breath in on the next sync. */
let breathe = false;
/**
 * Aurora Glow's atmosphere drifts once and rests; a change (the line's state, the open deck) sets it drifting again.
 * Restarted by taking the class off and back on, with a reflow between.
 */
export function stirAurora(): void {
  if (motionNow() !== 'full') return;
  composerBox.classList.remove('stir');
  void composerBox.offsetWidth;
  composerBox.classList.add('stir');
}

/** The draft row, kept as the sheet's last line: added when a sheet has none, which also covers one loaded or undone. */
export function draftId(): string {
  const last = doc.rows[doc.rows.length - 1];
  if (draftRow && last?.id === draftRow) return draftRow;
  if (last?.kind === 'expr' && isEmptyLine(last)) {
    draftRow = last.id;
    return draftRow;
  }
  const row = blankRow();
  doc.rows = [...doc.rows, row];
  draftRow = row.id;
  return draftRow;
}
/** The line whose view sits in the composer: the block being edited, or the draft. */
export function composerRowId(): string {
  if (editingId && rowIndex(editingId) >= 0) return editingId;
  editingId = null;
  return draftId();
}
export const isDraft = (id: string): boolean => id === draftRow;

/** Loads a line into the composer: a block to edit, or the draft. Its view moves here, so focus goes with it. */
export function editLine(id: string, caret?: number): void {
  const row = doc.rows[rowIndex(id)];
  if (!row || row.kind !== 'expr') return;
  if (id === composerRowId()) { focusRow(id); return; }
  dragEnds();
  closeThumb();
  editingId = id === draftId() ? null : id;
  editStart = row.text;
  screen.rebuildRows();
  renderNow();
  focusRow(id);
  if (caret !== undefined) views.get(id)?.input?.setSelectionRange(caret, caret);
}
/** Back to the draft, keeping what was changed. */
export function finishEdit(): void {
  if (!editingId) return;
  const id = editingId;
  editingId = null;
  screen.rebuildRows();
  renderNow();
  flashBlock(id);
  focusRow(draftId());
}
/** Back to the draft, putting the line back as it was. */
export function cancelEdit(): void {
  if (!editingId) return;
  const id = editingId;
  const row = doc.rows[rowIndex(id)];
  if (row?.kind === 'expr' && row.text !== editStart) setLineText(id, editStart);
  finishEdit();
}

function enter(id: string): boolean {
  if (editingId && id === editingId) {
    finishEdit();
    return true;
  }
  if (id !== draftRow) return false;
  const row = doc.rows[rowIndex(id)];
  if (row?.kind !== 'expr') return false;
  const text = row.text.trim();
  if (!text) {
    pulse(composerBox, 'shake');
    return true;
  }
  const intent = composerIntent(text, doc.rows, null, id);
  if (intent.kind === 'update') {
    const target = doc.rows[rowIndex(intent.id)];
    if (target?.kind !== 'expr') return false;
    const before = target.text, typed = row.text;
    const put = (targetText: string, draftText: string) => {
      setLineText(intent.id, targetText);
      setLineText(id, draftText);
    };
    put(typed, '');
    pushStep({ label: `Updated ${intent.name}`, undo: () => put(before, typed), redo: () => put(typed, '') });
    flashBlock(intent.id);
    return true;
  }
  // The typed line becomes a block where the composer is; it settles into its place on the canvas from there.
  liftFrom(id, views.get(id)?.el.getBoundingClientRect() ?? null);
  breathe = true;
  const next = addRow(id, { kind: 'expr', text: '' });
  draftRow = next;
  return true;
}

/** Called after each render: the edge light, the enter button's word and the placeholder. */
export function syncComposer(): void {
  const id = composerRowId();
  const k = rowIndex(id);
  const row = doc.rows[k], r = results[k];
  const v = views.get(id);
  const text = row?.kind === 'expr' ? row.text.trim() : '';
  const calm = !!v?.calm;
  const intent = !editingId && text ? composerIntent(text, doc.rows, null, id) : null;
  const state = composerState(text, r, { calm, update: intent?.kind === 'update' });
  const was = shownState;
  shownState = state;
  composerBox.dataset.state = state;
  composerBox.classList.toggle('lit', composerGlows(state));
  // An error only once typing pauses, short and whole on the row (composerError).
  composerBox.classList.toggle('shows-error', !!composerError(text, r, { calm, typing: !!v?.el.classList.contains('typing') }));
  // No answer on the right for a bare number or a name set to one: it would only say what was typed.
  composerBox.classList.toggle('no-answer', composerAnswer(text, r, opts()) === null);
  // A figure line's table (the unit circle's, the tangent's) takes no room at all: it would wrap the line.
  composerBox.classList.toggle('quiet-figure', composerQuietFigure(text, r));
  composerBox.classList.toggle('editing', !!editingId);
  enterWord(editingId ? 'Update' : intent?.kind === 'update' ? `Update ${intent.name}` : 'ENTER');
  enterBtn.title = editingId ? kb('Keep the change (Enter)') : intent?.kind === 'update' ? `Change the line that defines ${intent.name} (Enter)` : kb('Send the line (Enter)');
  cancelBtn.hidden = !editingId;
  // A line that draws shows a sparkline of its curve in its color, where a value shows its answer.
  const draws = !!r && r.graph.length > 0 && r.value === undefined && !r.error;
  preview.hidden = !draws;
  if (draws && row) {
    const heights = composerSpark(r);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(SPARK_W));
    svg.setAttribute('height', String(SPARK_H));
    svg.setAttribute('viewBox', `0 0 ${SPARK_W} ${SPARK_H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', GRAPH_PREVIEW_LABEL);
    if (heights) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', sparkPath(heights, SPARK_W, SPARK_H));
      svg.append(path);
    }
    preview.replaceChildren(heights ? svg : h('span', { class: 'swatch', role: 'img', 'aria-label': GRAPH_PREVIEW_LABEL }));
    preview.style.setProperty('--c', `var(--curve-${(row.color % 8) + 1})`);
  }
  if (v?.input) v.input.placeholder = editingId ? '' : composerPlaceholder(doc.rows.filter((x) => x.id !== draftRow));
  mirrorField(v?.input);
  settleMotion(v?.el, was, state);
}

/**
 * The composer's small moments, all on a change and never per keystroke: the live answer rises in when the line first
 * works out (DURATIONS.answerAppear), the line cleared by a send breathes in (DURATIONS.clearBreath), and the
 * atmosphere stirs when the state changes. Reduced motion keeps the fades and drops the travel.
 */
function settleMotion(el: HTMLElement | undefined, was: ComposerState, state: ComposerState): void {
  const m = motionNow();
  const fresh = breathe;
  breathe = false;
  if (was !== state) stirAurora();
  if (!el || m === 'off') return;
  const still = m !== 'full';
  if (fresh) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATIONS.clearBreath, easing: CURVES.fade });
    return;
  }
  const out = el.querySelector<HTMLElement>('.out');
  if (state === 'ok' && was !== 'ok' && out && !composerBox.classList.contains('no-answer')) {
    out.animate(still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: DURATIONS.answerAppear, easing: CURVES.settle });
  }
}

export function initComposer(): void {
  composerDock.append(composerHead, composerBox);
  setEnterHandler(enter);
  setTypingPauseListener((id) => { if (id === composerRowId()) syncComposer(); });
  // While the draft would update a line, the sheet is worked out with the change in place and the draft left out.
  setEvalRows((rows) => updatePreviewRows(rows, draftRow, editingId) as typeof rows);
  // A line focused anywhere (Up and Down from the composer, a fix, an undo) is edited in the composer.
  setFocusGuard((id) => {
    const row = doc.rows[rowIndex(id)];
    if (row?.kind === 'expr' && id !== composerRowId()) editLine(id);
  });
  cancelBtn.addEventListener('mousedown', (e) => e.preventDefault());
  cancelBtn.addEventListener('click', () => cancelEdit());
  composerBox.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editingId && ti.tab === null && !e.defaultPrevented) {
      e.preventDefault();
      cancelEdit();
    }
  });
  // A click on the composer's empty part puts the caret back in its line.
  composerBox.addEventListener('mousedown', (e) => {
    if (e.target === composerBox || e.target === composerSlot) {
      e.preventDefault();
      const id = composerRowId();
      focusRow(id);
      // As a click past a line's end always did: into an unfinished call's next slot, else the end.
      const input = views.get(id)?.input;
      const slot = input ? slotForEnd(input.value, slotInfo) : null;
      if (input && slot !== null) input.setSelectionRange(slot, slot);
    }
  });
}
