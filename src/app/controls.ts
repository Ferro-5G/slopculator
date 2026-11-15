import { CHOICES, SWITCHES, type ChoiceMode, type SwitchMode } from '../ui/modes';
import { roundLabel, roundToSlider, sliderToRound } from '../ui/rounding';
import { sheetChanged, doc } from './sheet';
import { h } from './dom';
import { kb } from './platform';

export const syncers: (() => void)[] = [];
function live(sync: () => void): void {
  syncers.push(sync);
  sync();
}

export function seg(label: string, a: string, b: string, isA: () => boolean, set: (a: boolean) => void, key: string): HTMLElement {
  const btnA = h('button', { type: 'button', title: key ? kb(`${a} (Ctrl+Alt+${key})`) : a }, a);
  const btnB = h('button', { type: 'button', title: key ? kb(`${b} (Ctrl+Alt+${key})`) : b }, b);
  const sync = () => {
    btnA.setAttribute('aria-pressed', String(isA()));
    btnB.setAttribute('aria-pressed', String(!isA()));
  };
  btnA.addEventListener('click', () => { set(true); sync(); });
  btnB.addEventListener('click', () => { set(false); sync(); });
  live(sync);
  return h('div', { class: 'seg', role: 'group', 'aria-label': label }, btnA, btnB);
}
export function toggle(name: string, get: () => boolean, set: (v: boolean) => void, title: string): HTMLElement {
  const b = h('button', { type: 'button', class: 'tog mode', title: kb(title) }, name);
  const sync = () => b.setAttribute('aria-pressed', String(get()));
  b.addEventListener('click', () => { set(!get()); sync(); });
  live(sync);
  return b;
}
export function setSetting(fn: () => void): void {
  fn();
  sheetChanged();
  syncers.forEach((s) => s());
}

export interface Mode { on: () => boolean; set: (v: boolean) => void; key?: string }
const ALL_MODES: Record<string, ChoiceMode | SwitchMode> = { ...CHOICES, ...SWITCHES };
export const MODES = Object.fromEntries(Object.entries(ALL_MODES).map(([id, m]) => [id, {
  on: () => m.read(doc),
  set: (v: boolean) => { const p = m.patch(v); Object.assign(doc.settings, p.settings); Object.assign(doc.display, p.display); },
  key: m.key,
}])) as Record<keyof typeof CHOICES | keyof typeof SWITCHES, Mode>;
export const setMode = (m: Mode, v: boolean) => setSetting(() => m.set(v));
export const flipMode = (m: Mode) => setSetting(() => m.set(!m.on()));

export function bindRound(input: HTMLInputElement, show: (places: number | null) => void, onPick?: (next: number | null) => void): void {
  input.addEventListener('input', () => {
    const next = sliderToRound(Number(input.value));
    onPick?.(next);
    setSetting(() => { doc.display.places = next; });
  });
  live(() => {
    const pl = doc.display.places;
    input.value = String(roundToSlider(pl));
    input.setAttribute('aria-valuetext', roundLabel(pl));
    show(pl);
  });
}
