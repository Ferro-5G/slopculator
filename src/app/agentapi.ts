import type { ThemeValue } from '../ui/appearance';
import { BUILTIN_NAMES, BUILTINS } from '../engine/builtins';
import { type RowInput, cleanSettings, evaluateDocument } from '../engine/document';
import { Settings } from '../engine/evaluator';
import { plainValue, type DisplayOpts } from '../engine/format';
import { USAGE } from '../ui/complete';
import { setSetting } from './controls';
import { clearAll, replaceLines, appendLine } from './edits';
import { sheetAsText } from './file';
import { graph } from './layout';
import { doc, results, opts } from './sheet';
import { setThemeValue } from './theme';

/**
 * window.slopculator lets scripts and AI agents use the calculator without clicking.
 * Every method works on the current sheet, so expressions can use its variables.
 */
interface LineInfo { line: number; letter?: string; text: string; result?: string; value?: unknown; error?: string; probability?: number }
function lineInfo(k: number): LineInfo {
  const row = doc.rows[k], r = results[k];
  const o = opts();
  return {
    line: k + 1,
    letter: r?.lineName,
    text: row.kind === 'expr' ? row.text : '[table]',
    result: r?.value !== undefined && !r.error ? plainValue(r.value, o, r.prob, r.precise) : undefined,
    value: r?.value,
    error: r?.error,
    probability: r?.distProb,
  };
}
const api = {
  /** The graph's readout for a pointer near the graph point (x, y), offset by (dx, dy) pixels: for checks. */
  graphReadout(x: number, y: number, dx = 0, dy = 0): string | null {
    const at = graph.pixelOf(x, y);
    return graph.readoutAt(at.px + dx, at.py + dy);
  },
  version: '0.3',
  help(): string {
    return [
      'Slopculator agent API (window.slopculator)',
      '  evaluate(expr)        -> { ok, result, value, error }  uses the sheet\'s variables, does not change the sheet',
      '  lines()               -> every line with its result or error',
      '  addLine(text)         -> the new line\'s info',
      '  setLines([texts])     -> replace the sheet (Undo is offered)',
      '  clear()               -> clear the sheet (Undo is offered)',
      '  settings() / setSettings({ deg, exact, sample, percent, percentOf, complex, lineNames, places })',
      '  functions()           -> names of every built-in function',
      '  usage(name)           -> how to call a function',
      '  graph.fit() / graph.reset() / graph.png() -> data URL of the graph / graph.names() -> curve names on the plot',
      '  text()                -> the sheet as plain text',
      'URL: add #q=expr&q=expr to open with those lines appended.',
    ].join('\n');
  },
  evaluate(expr: string) {
    const probe: RowInput[] = [...doc.rows, { id: '__probe', kind: 'expr', text: String(expr) }];
    const r = evaluateDocument(probe, doc.settings).at(-1)!;
    const o = opts();
    if (r.error) return { ok: false, error: r.error };
    if (r.value === undefined) return { ok: true, result: r.graph.length ? '[graph]' : '', value: undefined };
    return { ok: true, result: plainValue(r.value, o, r.prob, r.precise), value: r.value, notes: r.notes };
  },
  lines: () => doc.rows.map((_, k) => lineInfo(k)),
  addLine(text: string) {
    appendLine(text);
    return lineInfo(doc.rows.length - 1);
  },
  setLines(texts: string[]) {
    replaceLines(texts);
    return api.lines();
  },
  clear: () => clearAll(),
  settings: () => ({ ...doc.settings, ...doc.display, theme: doc.ui.theme ?? 'system' }),
  setSettings(patch: Partial<Settings & DisplayOpts & { theme: ThemeValue }>) {
    const { theme, exact, percent, places, ...rest } = patch;
    setSetting(() => {
      Object.assign(doc.settings, cleanSettings({ ...doc.settings, ...rest }));
      if (exact !== undefined) doc.display.exact = exact;
      if (percent !== undefined) doc.display.percent = percent;
      if (places !== undefined) doc.display.places = places;
    });
    if (theme) setThemeValue(theme);
    return api.settings();
  },
  functions: () => [...BUILTIN_NAMES].sort(),
  usage: (name: string) => USAGE.get(name) ?? (BUILTINS[name] ? `${name}(…)` : `No built-in named ${name}`),
  text: () => sheetAsText(),
  graph: {
    fit: () => graph.fitAll(),
    reset: () => graph.reset(),
    png: () => graph.toDataURL(),
    /** The curve names on the plot: each line's name tag text and its box in CSS pixels. Phones draw none. */
    names: () => graph.curveNames.map(({ text, box }) => ({ text, box: [...box] })),
    /** The plot's window in math units. */
    view: () => ({ ...graph.view }),
  },
};
/** #q=normalcdf(-inf,-2.5)&q=zscore(180,280,40) appends those lines on open. */
export function linesFromUrl(): void {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.search.slice(1);
  const qs = new URLSearchParams(raw).getAll('q').filter((q) => q.trim());
  if (!qs.length) return;
  for (const q of qs) appendLine(q);
  history.replaceState(null, '', location.pathname);
}

export function initAgentapi(): void {
  (window as unknown as { slopculator: typeof api }).slopculator = api;
}
