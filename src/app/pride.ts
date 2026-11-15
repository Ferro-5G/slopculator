import { appearanceChanged } from './theme';
import { dialogOpen } from './overlay';
import { play } from './sound';
import { h } from './dom';
import { motionNow } from './feedback';
import { buildMenu } from './file';
import { store, KEYS } from './persistence';
import { doc, activeInput } from './sheet';
import { showToast } from './toast';

export const prideUnlocked = () => store.get(KEYS.pride) === 'unlocked';
export const prideOn = () => !!doc.ui.pride && prideUnlocked();
const KONAMI = 'UUDDLRLRBA';
export const KONAMI_KEYS: Record<string, string> = { ArrowUp: 'U', 8: 'U', ArrowDown: 'D', 2: 'D', ArrowLeft: 'L', 4: 'L', ArrowRight: 'R', 6: 'R', b: 'B', a: 'A' };
let konami = '';
export function konamiStep(token: string | undefined): void {
  if (!token) {
    konami = '';
    return;
  }
  konami = (konami + token).slice(-KONAMI.length);
  if (konami !== KONAMI) return;
  konami = '';
  unlockPride();
}
export function setPride(on: boolean): void {
  doc.ui.pride = on;
  appearanceChanged();
  buildMenu();
  play('toggle');
}
function unlockPride(): void {
  const first = !prideUnlocked();
  store.set(KEYS.pride, 'unlocked');
  // Next tick, because this runs on the keydown of the last letter, before the browser has typed it.
  setTimeout(() => {
    const inp = activeInput();
    if (!inp || !/(?:88224646)?ba$/i.test(inp.value)) return;
    inp.value = inp.value.replace(/(?:88224646)?ba$/i, '');
    inp.dispatchEvent(new Event('input'));
  });
  setPride(first || !doc.ui.pride);
  if (doc.ui.pride && motionNow() === 'full') {
    const burst = h('div', { class: 'pride-burst', 'aria-hidden': 'true' });
    document.body.append(burst);
    burst.addEventListener('animationend', () => burst.remove(), { once: true });
    setTimeout(() => burst.remove(), 1500);
  }
  showToast(first ? '🏳️‍🌈 Pride unlocked. It lives in Appearance from now on' : doc.ui.pride ? '🏳️‍🌈 Pride colors on' : 'Pride colors off');
}

export function initPride(): void {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.key.length > 1 && !e.key.startsWith('Arrow') || dialogOpen()) return;
    konamiStep(KONAMI_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]);
  }, true);
}
