import { h } from './dom';
import { toast, composerDock, listEl, tape } from './layout';
import { narrow } from './platform';
import { TOAST_GAP, TOAST_MS } from '../ui/feedback';

let toastTimer = 0;
/** Hidden, the toast's button can't be clicked or reached by Tab, so a tap where it was reaches what's under it. */
export function hideToast(): void {
  clearTimeout(toastTimer);
  toast.classList.remove('show');
  toast.inert = true;
  tape.style.removeProperty('--toast-room');
}
/**
 * Where the toast goes, at every width: centred over the composer, TOAST_GAP above its tabs. That keeps it off the
 * composer (where the line being worked on is), off the keys beside or under it, and off the top bar, in the same
 * place every time. On a narrow window the column of blocks runs down to the composer, so the column gives up the
 * toast's height while it shows, and its foot stays in sight: the toast never covers a block.
 */
function placeToast(): void {
  const dock = composerDock.getBoundingClientRect();
  const box = (composerDock.querySelector('.composer') ?? composerDock).getBoundingClientRect();
  const shown = dock.height > 0 && dock.top < window.innerHeight;
  for (const k of ['left', 'top', 'bottom', 'width', 'height', 'maxWidth'] as const) toast.style[k] = '';
  toast.style.bottom = shown ? `${Math.round(window.innerHeight - dock.top + TOAST_GAP)}px` : '';
  if (box.width > 0) {
    toast.style.left = `${Math.round(box.left + box.width / 2)}px`;
    toast.style.maxWidth = `${Math.max(200, box.width - 24)}px`;
  }
  if (!narrow.matches || !shown) return;
  const before = listEl.clientHeight;
  tape.style.setProperty('--toast-room', `${Math.ceil(toast.offsetHeight + 2 * TOAST_GAP)}px`);
  // What was just above the composer stays in sight, above the toast.
  listEl.scrollTop += before - listEl.clientHeight;
}
export function showToast(msg: string, undo?: () => void, actionOnly = false): void {
  hideToast();
  // A phone's narrow column leaves no room for the words beside Undo.
  const roomy = !narrow.matches;
  // Live before its text changes, so a screen reader announces it.
  toast.inert = false;
  toast.replaceChildren(h('span', actionOnly && !roomy ? { class: 'sr-only' } : {}, msg));
  toast.classList.toggle('undo-only', actionOnly && !roomy);
  if (undo) toast.append(h('button', { type: 'button', onclick: undo }, 'Undo'));
  toast.classList.toggle('actionable', !!undo);
  placeToast();
  toast.classList.add('show');
  toastTimer = window.setTimeout(hideToast, undo ? TOAST_MS.action : TOAST_MS.note);
}
// Keep an open toast centred over the composer if the window resizes or crosses the phone breakpoint.
const replaceToast = () => { if (toast.classList.contains('show')) placeToast(); };
window.addEventListener('resize', replaceToast);
narrow.addEventListener('change', replaceToast);
