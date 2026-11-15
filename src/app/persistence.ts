import { CURRENT_SHEET_KEY, type KeyValueStorage, type SavedSheet as StoredSheet, restoreDoc, restoredSheetName, sheetStore } from '../ui/document';
import { type HistoryEntry, historyStore } from '../ui/history';
import { type Doc, normalizeDoc, blankDoc } from './docmodel';
import { showToast } from './toast';

/** Saved data depends on these spellings. */
export const KEYS = {
  document: 'slopculator:v1',
  sessions: 'slopculator:sessions',
  current: CURRENT_SHEET_KEY,
  pride: 'slopculator:pride',
  left: 'slopculator:left',
  recentFunctions: 'slopculator.recentFunctions',
};
/**
 * localStorage without its exceptions. It throws when site data is blocked (even on reading the property, in some
 * sandboxes) and when it's full. Reads then find nothing and writes return false, so the app runs without saving.
 */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing stored to remove.
    }
  },
};
const localKeys: KeyValueStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};
export const loadDoc = () => restoreDoc(() => store.get(KEYS.document), normalizeDoc, blankDoc);
export const restoredSheet = (restored: boolean) => restoredSheetName(localKeys, restored);
export type SavedSheet = StoredSheet<Doc>;
const sheets = sheetStore(localKeys, KEYS.sessions, normalizeDoc);
const wrote = (write: () => unknown): boolean => {
  try {
    write();
    return true;
  } catch {
    return false;
  }
};
export const loadSessions = sheets.load;
export const removeSession = (name: string): boolean => wrote(() => sheets.remove(name));

const history = historyStore(localKeys, showToast, undefined, true);
export const loadHistory = (): HistoryEntry[] => history.load() ?? [];
/** False if it couldn't be written (full storage, or damaged history that couldn't be set aside). */
export const changeHistory = (edit: (list: HistoryEntry[]) => HistoryEntry[]): boolean => history.change(edit) !== null;
export const writeSheet = (name: string, d: Doc, drop?: string): boolean => wrote(() => sheets.write(name, d, drop));
export const sheetExists = (name: string) => loadSessions().some((x) => x.name === name);
