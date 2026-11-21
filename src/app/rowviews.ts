import type { Row } from './docmodel';
import { doc, activeId } from './sheet';

export interface RowView {
  row: Row;
  el: HTMLElement;
  input?: HTMLInputElement;
  idx: HTMLElement;
  chip: HTMLButtonElement;
  out: HTMLElement;
  extra: HTMLElement;
  warn?: HTMLElement;
  calm?: boolean;
  /** Avoid rebuilding controls the user is touching. */
  extraKey?: string;
  outKey?: string;
  tex?: HTMLElement;
  texKey?: string;
  refresh?: () => void;
}
export const views = new Map<string, RowView>();
/** Whether a row's view is drawn inside another block (a moist-air state in the psychrometric chart), not on the canvas. */
let hostedCheck: (id: string) => boolean = () => false;
export const isHostedRow = (id: string): boolean => hostedCheck(id);
export function setHostedCheck(fn: (id: string) => boolean): void {
  hostedCheck = fn;
}
export const viewOfInput = new WeakMap<HTMLInputElement, RowView>();
/** Runs before a line takes focus: the canvas loads it into the composer first, so focus lands where it's typed. */
let focusGuard: (id: string) => void = () => {};
export function setFocusGuard(fn: (id: string) => void): void {
  focusGuard = fn;
}
export function focusRow(id: string): void {
  focusGuard(id);
  const v = views.get(id);
  if (!v) return;
  const inp = v.input ?? v.el.querySelector<HTMLInputElement>('input');
  if (!inp) return;
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
}
export const isLineField = (el: Element | null | undefined): el is HTMLInputElement => el instanceof HTMLInputElement && el.classList.contains('expr');
export function focusLine(): void {
  if (activeId) focusRow(activeId);
  else focusRow(doc.rows[doc.rows.length - 1].id);
}
