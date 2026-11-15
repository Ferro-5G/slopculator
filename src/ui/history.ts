import { evaluateDocument, type RowInput, type RowResult } from '../engine/document';
import type { Settings } from '../engine/evaluator';
import { plainValue, type DisplayOpts } from '../engine/format';

export const HISTORY_KEY = 'slopculator:history:v1';

export const HISTORY_FULL = 'History is full. Clear some of it to keep recording.';

export interface HistoryEntry {
  text: string;
  /** The full-precision answer, whatever the rounding setting was. Empty for graphs. */
  result: string;
  at: number;
  sheet?: string;
}

export function shouldRecord(text: string, line: { error?: string; heading?: string } | undefined): boolean {
  const t = text.trim();
  if (!t || !line || line.error || line.heading !== undefined) return false;
  return !/^[-+]?[\d.,\s]+%?$/.test(t);
}

export function fullAnswer(line: RowResult | undefined): string {
  const full: DisplayOpts = { places: null, exact: false, percent: false };
  if (line?.distProb !== undefined) return plainValue(line.distProb, full, true);
  return line?.value !== undefined ? plainValue(line.value, full, line.prob, line.precise) : '';
}

/** Evaluated fresh, since results on screen can lag the last keystroke. */
function finishedEntry(rows: RowInput[], settings: Settings, id: string, text: string, sheet: string | null): HistoryEntry | null {
  const r = evaluateDocument(rows, settings).find((x) => x.id === id);
  return shouldRecord(text, r) ? { text, result: fullAnswer(r), at: Date.now(), sheet: sheet ?? undefined } : null;
}

export function commitLine(committed: Map<string, string>, rows: RowInput[], settings: Settings, id: string | null, sheet: string | null, record: (entry: HistoryEntry) => boolean): void {
  const row = id ? rows.find((r) => r.id === id) : undefined;
  if (row?.kind !== 'expr') return;
  const text = row.text.trim();
  if (committed.get(row.id) === text) return;
  committed.set(row.id, text);
  const entry = finishedEntry(rows, settings, row.id, text, sheet);
  if (entry && !record(entry)) committed.delete(row.id);
}

export function addEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const top = list[0];
  if (top && top.text === entry.text && top.result === entry.result) return list;
  return [entry, ...list];
}

export function removeEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const i = list.findIndex((e) => e.at === entry.at && e.text === entry.text && e.result === entry.result && e.sheet === entry.sheet);
  return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
}

/** Null means the stored text is damaged, so the caller must keep it rather than overwrite it. */
export function parseHistory(raw: string | null): HistoryEntry[] | null {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    const valid = v.every((e) => !!e && typeof e === 'object' && typeof e.text === 'string' && typeof e.result === 'string'
      && typeof e.at === 'number' && Number.isFinite(e.at) && Number.isFinite(new Date(e.at).getTime())
      && (e.sheet === undefined || typeof e.sheet === 'string'));
    // Dropping one bad entry here would destroy it on the next write without setting the original aside.
    return valid ? v as HistoryEntry[] : null;
  } catch {
    return null;
  }
}

export function searchHistory(list: HistoryEntry[], query: string): HistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((e) => {
    const hay = `${e.text} ${e.result} ${e.sheet ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function dayLabel(at: number, now = Date.now()): string {
  const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** The time of day an entry was made, as its row shows it. */
export const entryTime = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** A history row's accessibility label. */
export const entryLabel = ({ text, result, at }: HistoryEntry) => result ? `${text}, equals ${result}, at ${entryTime(at)}` : `${text}, at ${entryTime(at)}`;

/** The phones' Clear History confirmation. */
export function clearHistoryWords(total: number): { message: string; confirm: string } {
  const count = total.toLocaleString(), noun = total === 1 ? 'Entry' : 'Entries';
  return { message: `This deletes all ${count} ${noun.toLowerCase()} and can't be undone.`, confirm: `Delete ${count} ${noun}` };
}

export function groupByDay(list: HistoryEntry[], now = Date.now()): { day: string; entries: HistoryEntry[] }[] {
  const groups: { day: string; entries: HistoryEntry[] }[] = [];
  // Labels only when the day changes: formatting a date for every entry takes seconds on a long history.
  let midnight = NaN;
  for (const e of list) {
    const m = new Date(e.at).setHours(0, 0, 0, 0);
    if (m === midnight) groups[groups.length - 1].entries.push(e);
    else {
      midnight = m;
      groups.push({ day: dayLabel(e.at, now), entries: [e] });
    }
  }
  return groups;
}

function historyBackupKey(read: (key: string) => string | null, at = Date.now()): string {
  const base = `${HISTORY_KEY}:damaged:${at}`;
  let key = base;
  for (let i = 1; read(key) !== null; i++) key = `${base}:${i}`;
  return key;
}

export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function historyStore(storage: HistoryStorage, onFail: (message: string) => void, now = () => Date.now(), keepParsed = false) {
  // History only grows, so parsing all of it on every finished line and every search keystroke gets slower forever.
  // Comparing the stored text with the last one is far cheaper than parsing it, and still sees another window's writes.
  let parsed: { raw: string | null; list: HistoryEntry[] } | null = null;
  const load = (): HistoryEntry[] | null => {
    try {
      const raw = storage.getItem(HISTORY_KEY);
      if (parsed?.raw === raw) return parsed.list;
      const list = parseHistory(raw);
      if (list) {
        if (keepParsed) parsed = { raw, list };
        return list;
      }
      storage.setItem(historyBackupKey((key) => storage.getItem(key), now()), raw ?? '');
      storage.removeItem(HISTORY_KEY);
      return [];
    } catch {
      return null;
    }
  };
  return {
    load,
    /** The list as stored afterward, or null when the change couldn't be saved. */
    change(edit: (list: HistoryEntry[]) => HistoryEntry[]): HistoryEntry[] | null {
      const list = load();
      if (list) {
        try {
          const next = edit(list);
          if (next !== list) {
            const raw = JSON.stringify(next);
            storage.setItem(HISTORY_KEY, raw);
            if (keepParsed) parsed = { raw, list: next };
          }
          return next;
        } catch {
          // Reported below.
        }
      }
      onFail(HISTORY_FULL);
      return null;
    },
  };
}
