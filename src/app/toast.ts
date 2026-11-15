import { h } from './dom';
import { toast, keypadEl, leftPane, tape } from './layout';
import { narrow } from './platform';
import { TOAST_MS } from '../ui/feedback';

let toastTimer = 0;
/** Hidden, the toast's button can't be clicked or reached by Tab, so a tap where it was reaches what's under it. */
export function hideToast(): void {
  clearTimeout(toastTimer);
  toast.classList.remove('show');
  toast.inert = true;
  keypadEl.classList.remove('has-toast');
}
/**
 * Where the toast goes. On a phone, 8 px above the keys when they show, so it never covers = 0 . ⌫ or takes their
 * taps. On the desktop it takes the strip under the keys, where key help shows: clear of the lines, the toolbar, the
 * keys and the graph. With the keys hidden there is no strip, and it hangs from the top of the notebook column.
 * Returns whether it took the strip, which has room for the words an Undo-only pill leaves out.
 */
function placeToast(): boolean {
  const vh = window.innerHeight;
  const kp = keypadEl.getBoundingClientRect();
  const above = kp.height > 0 && kp.top < vh ? vh - kp.top + 8 : null;
  const strip = narrow.matches ? null : keypadEl.querySelector('.key-hint')?.getBoundingClientRect();
  const inFoot = !!strip && strip.width > 0 && strip.height > 0;
  toast.classList.toggle('in-foot', inFoot);
  toast.classList.toggle('at-top', !narrow.matches && !inFoot);
  keypadEl.classList.toggle('has-toast', inFoot);
  for (const k of ['left', 'top', 'bottom', 'width', 'height', 'maxWidth'] as const) toast.style[k] = '';
  if (narrow.matches) {
    toast.style.bottom = above !== null ? `${above}px` : '';
    return false;
  }
  toast.style.bottom = 'auto';
  if (inFoot) {
    Object.assign(toast.style, { left: `${strip.left}px`, top: `${strip.top}px`, width: `${strip.width}px`, height: `${strip.height}px`, maxWidth: 'none' });
    return true;
  }
  const col = leftPane.getBoundingClientRect(), bar = tape.getBoundingClientRect();
  toast.style.left = `${col.left + col.width / 2}px`;
  toast.style.maxWidth = `${Math.max(200, col.width - 24)}px`;
  toast.style.top = `${Math.round(bar.top + 4)}px`;
  return false;
}
export function showToast(msg: string, undo?: () => void, actionOnly = false): void {
  hideToast();
  const roomy = placeToast();
  // Live before its text changes, so a screen reader announces it.
  toast.inert = false;
  toast.replaceChildren(h('span', actionOnly && !roomy ? { class: 'sr-only' } : {}, msg));
  toast.classList.toggle('undo-only', actionOnly && !roomy);
  if (undo) toast.append(h('button', { type: 'button', onclick: undo }, 'Undo'));
  toast.classList.toggle('actionable', !!undo);
  toast.classList.add('show');
  toastTimer = window.setTimeout(hideToast, undo ? TOAST_MS.action : TOAST_MS.note);
}

