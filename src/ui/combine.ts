import { lineName, type RowInput, type RowResult } from '../engine/document';
import { isEmptyLine } from './document';

export type CombineOp = '+' | '-' | '*' | '/';

/** Each operation, its symbol and its name, for the controls that offer them. */
export const COMBINE_OPS: [CombineOp, string, string][] = [['+', '+', 'Add'], ['-', '−', 'Subtract'], ['*', '×', 'Multiply'], ['/', '/', 'Divide']];
/** What the operations do, in a sentence, for the controls with room to say. */
export const COMBINE_HELP = 'Combines all numeric lines into a new line';
export const COMBINE_TOO_FEW = 'Needs at least two lines with a number';

export interface CombineLine {
  id: string;
  index: number;
  kind: 'expr' | 'table';
  text: string;
  value?: unknown;
  error?: string;
  defines?: string;
  lineName?: string;
  label?: string;
  heading?: string;
}

/** Where the result goes when that line is empty: the active line, else the last. Undefined means a new line. */
export function combineTarget<R extends RowInput>(rows: readonly R[], activeId: string | null): R | undefined {
  const active = rows.find((r) => r.id === activeId);
  return [active, rows[rows.length - 1]].find((r) => r && isEmptyLine(r));
}

export function combineLines(rows: readonly RowInput[], results: readonly RowResult[], letters: boolean | undefined): CombineLine[] {
  return rows.map((row, index) => {
    const r = results[index];
    return { id: row.id, index, kind: row.kind, text: row.kind === 'expr' ? row.text : '', value: r?.value, error: r?.error, defines: r?.defines, lineName: r?.lineName, label: letters ? lineName(index) : undefined, heading: r?.heading };
  });
}

export interface CombinePlan {
  /** The expression, or '' when fewer than two lines have a number. */
  text: string;
  used: number;
  empty: string[];
  noNumber: string[];
  /** What to tell the user, or '' when nothing was left out. */
  note: string;
}

const SIMPLE = /^(?:\d+\.?\d*|\.\d+|[A-Za-z_]\w*)$/;

function lineList(labels: string[]): string {
  return `${labels.length === 1 ? 'line' : 'lines'} ${labels.join(', ')}`;
}

export function planCombine(lines: CombineLine[], op: CombineOp, targetId?: string): CombinePlan {
  const parts: string[] = [];
  const empty: string[] = [];
  const noNumber: string[] = [];
  for (const line of lines) {
    if (line.id === targetId || line.heading !== undefined || line.kind !== 'expr') continue;
    const text = line.text.trim();
    const label = line.label ?? String(line.index + 1);
    if (!text) {
      empty.push(label);
      continue;
    }
    if (line.error || typeof line.value !== 'number') {
      noNumber.push(label);
      continue;
    }
    if (line.defines) parts.push(line.defines);
    else if (line.lineName) parts.push(line.lineName);
    else parts.push(SIMPLE.test(text) ? text : `(${text})`);
  }
  const notes: string[] = [];
  if (empty.length) notes.push(`Left out empty ${lineList(empty)}`);
  if (noNumber.length) notes.push(`${notes.length ? 'and' : 'Left out'} ${lineList(noNumber)}, with no single number`);
  return {
    text: parts.length >= 2 ? parts.join(` ${op} `) : '',
    used: parts.length,
    empty,
    noNumber,
    note: notes.length ? `${notes.join(' ')}.` : '',
  };
}
