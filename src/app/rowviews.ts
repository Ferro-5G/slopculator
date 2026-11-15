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
export const viewOfInput = new WeakMap<HTMLInputElement, RowView>();
export function focusRow(id: string): void {
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
