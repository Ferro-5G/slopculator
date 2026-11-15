import { Settings } from '../engine/evaluator';
import type { DisplayOpts } from '../engine/format';
import { type AppearancePrefs, type DocRow, type LookName, type SheetView, asObject, blankBody, cleanAppearance, cleanBody, cleanSheetView } from '../ui/document';
import { deskKeys } from './platform';

export type Row = DocRow;
export interface DocUI extends AppearancePrefs, SheetView { graph: boolean; keypad: boolean; /** Kept apart from the phone's, which older saves set to hidden on wide windows. */ deskKeypad?: boolean; sound?: boolean; sysKeyboard?: boolean }
export interface Doc {
  rows: Row[];
  settings: Required<Settings>;
  display: DisplayOpts;
  ui: DocUI;
}
export type { LookName };

let uid = 0;
export const newId = () => `r${Date.now().toString(36)}${(uid++).toString(36)}`;
export function blankRow(color = 0): Row {
  return { id: newId(), kind: 'expr', text: '', color };
}

export function blankDoc(): Doc {
  return { ...blankBody(blankRow()), ui: { graph: true, keypad: !deskKeys.matches } };
}
export function normalizeDoc(raw: unknown): Doc {
  const b = blankDoc();
  const d = asObject(raw), ui = asObject(d.ui);
  return {
    ...cleanBody<Row>(d, newId, blankRow),
    ui: {
      graph: b.ui.graph,
      keypad: b.ui.keypad,
      ...cleanSheetView(ui),
      ...(typeof ui.deskKeypad === 'boolean' ? { deskKeypad: ui.deskKeypad } : {}),
      ...(typeof ui.sound === 'boolean' ? { sound: ui.sound } : {}),
      ...cleanAppearance(ui),
      ...(typeof ui.sysKeyboard === 'boolean' ? { sysKeyboard: ui.sysKeyboard } : {}),
    },
  };
}
