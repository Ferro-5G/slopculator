import { COMBINE_OPS } from '../ui/combine';
import { EXAMPLE_LINES, WELCOME_EXAMPLE } from '../ui/canvas';
import { STARTERS, starterRows, type Starter, type StarterId } from '../ui/starters';
import { play } from './sound';
import { hasExample, showExample } from './example';
import { roving, h, icon, iconLabel, ICONS } from './dom';
import { combineAll, clearAll, addRow, addTable, addNormalCurve, appendLine } from './edits';
import { listTools } from './layout';
import { cancelButton, dialogShell } from './overlay';
import { kb } from './platform';
import { activeId, doc } from './sheet';
import { setKeypad, keypadOn } from './shell';

const refreshListTools = roving(listTools, 'button');
const combineGroup = h('span', { class: 'combine', role: 'group', 'aria-label': 'Combine every line with a number into a new line' },
  h('span', { class: 'combine-label', 'aria-hidden': 'true' }, icon('sigma'), h('span', { class: 'gl' }, 'All:')),
  ...COMBINE_OPS.map(([op, label, word]) => h('button', { type: 'button', title: `${word} every line with a number, in a new line`, 'aria-label': `${word} all lines`, onclick: () => combineAll(op) }, label)),
);
const clearAllBtn = h('button', { type: 'button', class: 'clear-all', 'aria-label': 'Clear all', title: kb('Clear every line (Ctrl+Alt+Backspace). Ctrl+Z brings them back.'), onclick: () => clearAll() }, icon('clear'), h('span', { class: 'gl' }, 'Clear all'));
export const keysToggle = h('button', { type: 'button', class: 'keys-toggle', 'aria-controls': 'keypad', title: kb('Show or hide the keypad (Ctrl+Alt+Shift+K)'), onclick: () => { play('toggle'); setKeypad(!keypadOn()); } }, ...iconLabel('keys', 'Keys'));
export function syncListTools(empty: boolean): void {
  if (clearAllBtn.hidden === empty) return;
  combineGroup.hidden = empty;
  clearAllBtn.hidden = empty;
  refreshListTools();
}
const STARTER_ICONS: Partial<Record<StarterId, keyof typeof ICONS>> = { normal: 'curve', zscore: 'func', binomial: 'bars', sliders: 'sliders', moistAir: 'curve', charge: 'func', coil: 'sliders' };
/** Puts a starter's lines on the sheet, ready to edit, with a fresh line after them. */
export function loadStarter(ex: Starter): void {
  play('enter');
  for (const { text, dist } of starterRows(ex)) {
    if (dist) addRow(doc.rows[doc.rows.length - 1].id, { kind: 'expr', text, dist }, false);
    else appendLine(text);
  }
  addRow(doc.rows[doc.rows.length - 1].id, { kind: 'expr', text: '' });
}
function starterCard(ex: Starter): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'starter-card' },
    h('span', { class: 'sc-title' }, icon(STARTER_ICONS[ex.id] ?? 'func'), h('span', {}, ex.title)),
    ex.subtitle ? h('span', { class: 'sc-sub' }, ex.subtitle) : null,
    h('span', { class: 'sc-lines' }, ex.lines.join('\n')),
  ) as HTMLButtonElement;
  b.addEventListener('click', () => {
    b.closest('dialog')?.close('ok');
    loadStarter(ex);
  });
  return b;
}
/** The first run's example, first in the list while it's off the sheet. */
const welcomeCard = h('button', { type: 'button', class: 'starter-card' },
  h('span', { class: 'sc-title' }, icon('sliders'), h('span', {}, WELCOME_EXAMPLE.title)),
  h('span', { class: 'sc-sub' }, WELCOME_EXAMPLE.subtitle),
  h('span', { class: 'sc-lines' }, EXAMPLE_LINES.map((l) => l.text).join('\n')),
) as HTMLButtonElement;
welcomeCard.addEventListener('click', () => {
  welcomeCard.closest('dialog')?.close('ok');
  play('enter');
  showExample();
});
export const starter = h('div', { class: 'starter', role: 'group', 'aria-label': 'Start with an example' },
  h('div', { class: 'starter-section' }, 'Math & Statistics'),
  h('div', { class: 'starter-grid' }, welcomeCard, ...STARTERS.filter((ex) => !ex.hvac).map(starterCard)),
  h('div', { class: 'starter-section' }, 'HVAC Engineering'),
  h('div', { class: 'starter-grid' }, ...STARTERS.filter((ex) => ex.hvac).map(starterCard)),
);

export function initListtools(): void {
  listTools.setAttribute('role', 'toolbar');
  listTools.setAttribute('aria-label', 'Add or clear lines');
  listTools.append(
    h('button', { type: 'button', class: 'add-line', title: 'Add a line below this one', 'aria-label': 'Add a line', onclick: () => addRow(activeId, { kind: 'expr', text: '' }) }, ...iconLabel('plus', 'Line')),
    h('button', { type: 'button', class: 'add-table', title: 'Add a table for outcomes and probabilities, or data columns', 'aria-label': 'Add a table', onclick: () => addTable() }, ...iconLabel('table', 'Table')),
    h('button', { type: 'button', class: 'add-normal', title: 'Add a shaded normal curve', 'aria-label': 'Add a normal curve', onclick: () => addNormalCurve() }, ...iconLabel('bell', 'Normal curve')),
    combineGroup,
    h('span', { class: 'spacer' }),
    keysToggle,
    clearAllBtn,
  );
  roving(starter, '.starter-card');
}

/** The starters, from File: each puts its lines on the canvas, ready to edit. */
export function openExamples(): void {
  welcomeCard.hidden = hasExample();
  const dialog = dialogShell('Start with an example', starter, h('div', { class: 'mx-actions' }, cancelButton()));
  dialog.classList.add('examples-dialog');
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('.starter-card:not([hidden])')?.focus();
}
