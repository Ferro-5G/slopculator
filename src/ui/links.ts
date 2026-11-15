import { BUILTINS } from '../engine/builtins';
import { lineDefines, lineName, type RowInput } from '../engine/document';
import { linesLabel } from './document';

/**
 * A link (#q=…) adds lines to whatever sheet is open, and those lines are someone else's text. Enough of them to share
 * a worked problem get in. Past these limits a link could freeze the tab: every line is evaluated, typeset and scanned
 * for hints, and the lines are saved, so the cost would come back on each load.
 */
export const LINK_LINES_MAX = 50;
export const LINK_LINE_LENGTH_MAX = 1000;

/** The names a sheet's lines and table columns define, and with line letters on, each line's letter. */
export function sheetNames(rows: readonly RowInput[], lineNames = false): Set<string> {
  const names = rows.flatMap((r) => (r.kind === 'table' ? r.columns.map((c) => c.header.trim()) : [lineDefines(r.text) ?? '']));
  // A definition of A takes the letter from line 1, so A + 1 on the sheet would read the link's A.
  if (lineNames) names.push(...rows.map((_, k) => lineName(k)));
  return new Set(names.filter(Boolean));
}

/**
 * The lines a link may add, in order; how many of its non-blank lines were too long or too many; and the names of the
 * ones left out because they define a built-in or a name the sheet already defines. Those would quietly change answers
 * already on the sheet: sqrt(t) = t*100 changes every sqrt, and a second rate = … makes both lines errors.
 */
export function linkLines(asked: string[], taken: ReadonlySet<string> = new Set()): { lines: string[]; dropped: number; clashes: string[] } {
  const wanted = asked.filter((q) => q.trim());
  const fit = wanted.filter((q) => q.length <= LINK_LINE_LENGTH_MAX).slice(0, LINK_LINES_MAX);
  const clashes: string[] = [];
  const lines = fit.filter((q) => {
    const name = lineDefines(q);
    const clash = name !== null && (taken.has(name) || Object.hasOwn(BUILTINS, name));
    if (clash) clashes.push(name);
    return !clash;
  });
  return { lines, dropped: wanted.length - fit.length, clashes };
}

const orList = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);

export function linkLinesLabel(added: number, dropped: number, clashes: readonly string[] = []): string {
  const out = dropped + clashes.length;
  const counts = added ? `Added ${linesLabel(added)} from the link${out ? ` and left out ${out}` : ''}` : `Left out ${linesLabel(out)} from the link`;
  return clashes.length ? `${counts}. A link can't redefine ${orList([...new Set(clashes)])}` : counts;
}
