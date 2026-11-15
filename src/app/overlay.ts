import { h } from './dom';
import { narrow } from './platform';

/**
 * On the desktop File and Appearance drop from the top bar into the window's own layer, as Modes does, so the bar's
 * overflow (it folds modes rather than wrap) never clips them: fixed under their button, right edges aligned.
 */
export function placePopover(pop: HTMLElement, anchor: HTMLElement): void {
  if (narrow.matches || pop.hidden) {
    for (const k of ['position', 'top', 'right', 'left', 'maxHeight'] as const) pop.style[k] = '';
    return;
  }
  const r = anchor.getBoundingClientRect();
  Object.assign(pop.style, { position: 'fixed', left: 'auto', top: `${r.bottom + 6}px`, right: `${Math.max(8, window.innerWidth - r.right)}px`, maxHeight: `${window.innerHeight - r.bottom - 14}px` });
}
export function dialogShell(title: string, ...body: Node[]): HTMLDialogElement {
  return mountDialog(h('dialog', { class: 'sheet-dialog' }, h('form', { method: 'dialog' }, h('h2', {}, title), ...body)));
}
/** Not a submit button: Enter in a form goes to its first submit button, and that has to be the one that does the work. */
export function cancelButton(): HTMLElement {
  const button = h('button', { type: 'button', onclick: () => button.closest('dialog')?.close('cancel') }, 'Cancel');
  return button;
}

/** A popover, once. `exclusive`: opening another closes it. `outside`: a click elsewhere on the page closes it. */
export interface Popover { close: () => void; exclusive?: boolean; outside?: boolean }
const popovers: Popover[] = [];
export function addPopover(p: Popover): void {
  popovers.push(p);
}
export function closePopovers(): void {
  for (const p of popovers) if (p.exclusive) p.close();
}
export function initOverlay(): void {
  document.addEventListener('click', () => { for (const p of popovers) if (p.outside) p.close(); });
  window.addEventListener('resize', closePopovers);
}
export const dialogOpen = () => !!document.querySelector('dialog[open]');
export const modalOpen = () => !!document.querySelector('dialog[open], [role=dialog][aria-modal=true]:not([hidden])');
export function mountDialog<T extends HTMLDialogElement>(dialog: T): T {
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  return dialog;
}
/** Returns whether it used the key. */
export function arrowsMove(items: HTMLElement[], e: KeyboardEvent, at: number): boolean {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
  e.preventDefault();
  items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  return true;
}
