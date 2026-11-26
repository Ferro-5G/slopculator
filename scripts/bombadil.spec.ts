// Property-based UI specification for Slopculator (Bombadil).
// Run via `npm run fuzz:ui` (or `npx bombadil browser test --headless --exit-on-violation --time-limit 30s <url> scripts/bombadil.spec.ts`).
import { always, eventually } from '@antithesishq/bombadil';
import { actions, extract, registerCustomAction, weighted } from '@antithesishq/bombadil/browser';
import { clicks, inputs, scroll, waitOnce } from '@antithesishq/bombadil/browser/defaults/actions';
export { noConsoleErrors, noUncaughtExceptions, noUnhandledPromiseRejections } from '@antithesishq/bombadil/browser/defaults/properties';

const VALID_PRESENCE = new Set(['closed', 'opening', 'open', 'closing']);
const VALID_SCROLL = new Set(['rest', 'touch', 'drag', 'user', 'code', 'settling']);

const uiState = extract((state) => {
  const doc = state.document;
  const win = state.window as unknown as { slopculator?: { lines?: () => unknown[] } };
  const booted = typeof win.slopculator?.lines === 'function';
  const composer = doc.querySelector('.composer .expr');
  const openModal = !!doc.querySelector('dialog[open], [role=dialog][aria-modal=true]:not([hidden])');
  const transitionModal = [...doc.querySelectorAll('[role=dialog][aria-modal=true][data-presence]')]
    .some((el) => el.getAttribute('data-presence') !== 'closed');
  const composerInert = !!composer?.closest('[inert]');
  const badPresence = [...doc.querySelectorAll('[data-presence]')].some((el) => {
    const p = el.getAttribute('data-presence') ?? '';
    if (!VALID_PRESENCE.has(p)) return true;
    const htmlEl = el as HTMLElement;
    return p === 'closed' && (!htmlEl.hidden || htmlEl.classList.contains('open'));
  });
  const list = doc.querySelector('#list, .rows');
  const scrollAttr = list?.getAttribute('data-scroll') ?? null;
  const badScroll = scrollAttr !== null && !VALID_SCROLL.has(scrollAttr);
  return {
    booted,
    hasComposer: !!composer,
    stuckInert: !openModal && !transitionModal && composerInert,
    badPresence,
    badScroll,
  };
});

/** Once the app boots, window.slopculator and the composer remain present. */
export const composer_stays_alive = eventually(() => uiState.current.booted)
  .and(always(() => !uiState.current.booted || uiState.current.hasComposer));

/** Closing every dialog/modal sheet must never leave the main composer inert. */
export const no_stuck_inert = always(() => !uiState.current.stuckInert);

/** Every [data-presence] surface stays in a valid phase, and closed surfaces stay hidden without .open. */
export const valid_presence_phases = always(() => !uiState.current.badPresence);

/** The notebook scroll machine stays in one of its six declared states. */
export const valid_scroll_state = always(() => !uiState.current.badScroll);

const SAMPLE_EXPRS = [
  '0.1 + 0.2',
  'sin(30)',
  'a = 2',
  'y = a x^2 - 1',
  'x^2 + y^2 = 9',
  'normalcdf(-1, 1)',
  '1/0',
  '2^64 + 1',
  'L = {1, 2, 3, 4}',
  'mean(L)',
];

const enterMath = registerCustomAction('enterMath', async (doc, _win, expr: string) => {
  const field = doc.querySelector<HTMLInputElement>('.composer .expr');
  if (!field || field.closest('[inert]')) return;
  field.focus();
  field.value = expr;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
});

const pressEscape = registerCustomAction('pressEscape', async (doc) => {
  const target = (doc.activeElement as HTMLElement | null) ?? doc.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
});

const triggerUndoRedo = registerCustomAction('triggerUndoRedo', async (doc, _win, redo: boolean) => {
  const target = (doc.activeElement as HTMLElement | null) ?? doc.body;
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'z',
    ctrlKey: true,
    shiftKey: redo,
    bubbles: true,
    cancelable: true,
  }));
});

const mathActions = actions(() => [
  ...SAMPLE_EXPRS.map((expr) => enterMath(expr)),
  pressEscape(),
  triggerUndoRedo(false),
  triggerUndoRedo(true),
]);

// Filter out external navigation links or file download triggers that leave the page.
const safeClicks = clicks.filter((action) => {
  if (typeof action !== 'object' || !('Click' in action)) return true;
  const fp = action.Click.fingerprint;
  if (fp.href) return false;
  const label = (fp.accessibleName ?? fp.textContent ?? '').toLowerCase();
  return !label.includes('export') && !label.includes('import') && !label.includes('png') && !label.includes('svg');
});

export const explore = weighted([
  [4, mathActions],
  [4, safeClicks],
  [2, inputs],
  [1, scroll],
  [1, waitOnce],
]);
