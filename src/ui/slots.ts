import { callFunction, callNameBefore, callsIn, CLOSERS, OPENERS, pieces, usageForms } from './brackets';
import { charBefore, escapeRegExp } from './text';

export type FnInfo = (name: string) => { usage?: string; min?: number } | undefined;

export interface SlotHint {
  at: number;
  text: string;
  current?: boolean;
}

export interface Slots {
  hints: SlotHint[];
  pending: number;
}

const OPTIONAL = new Set(['alt', 'μ', 'σ', 'guess', 'places', 'eff', 'sh', 'sc']);

function enclosing(text: string, at: number): number {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (CLOSERS.includes(text[i])) depth++;
    else if (OPENERS.includes(text[i])) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open + 1; i < text.length; i++) {
    if (OPENERS.includes(text[i])) depth++;
    else if (CLOSERS.includes(text[i])) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return text.length;
}

const blank = (text: string, [a, b]: [number, number]) => !text.slice(a, b).trim();
const slotAt = (text: string, [a, b]: [number, number]) => { let i = a; while (i < b && text[i] === ' ') i++; return i; };

function matrixAt(text: string, caret: number): { outer: number; close: number; rows: [number, number][] } | null {
  const row = enclosing(text, caret);
  if (row < 0 || text[row] !== '[') return null;
  const outer = enclosing(text, row);
  if (outer < 0 || text[outer] !== '[') return null;
  const close = closing(text, outer);
  const rows = pieces(text, outer + 1, close).map(([a, b]): [number, number] => {
    const o = text.indexOf('[', a);
    return o >= 0 && o < b ? [o + 1, closing(text, o)] : [a, b];
  });
  return { outer, close, rows };
}

export function matrixAddRow(text: string, caret: number): { text: string; caret: number } | null {
  const m = matrixAt(text, caret);
  if (!m || !m.rows.length) return null;
  const cols = pieces(text, m.rows[0][0], m.rows[0][1]).length;
  const row = `, [${Array.from({ length: cols }, () => '').join(', ')}]`;
  return { text: text.slice(0, m.close) + row + text.slice(m.close), caret: m.close + 3 };
}

/**
 * The form for n inputs: the first with enough. Past the first input, a form that only one longer form goes on from,
 * with nothing but optional inputs added, gives way to that one, so normalcdf(0, still offers [μ], [σ].
 */
function formFor(lists: string[][], n: number): string[] | undefined {
  const first = lists.find((ps) => ps.length >= n);
  if (!first || n < 2) return first;
  const longer = lists.filter((ps) => ps.length > first.length && first.every((p, i) => ps[i] === p));
  return longer.length === 1 && longer[0].slice(first.length).every((p) => OPTIONAL.has(p)) ? longer[0] : first;
}

function paramsFor(name: string, info: FnInfo, n: number): { params: string[]; needed: (i: number) => boolean } | null {
  const { usage, min } = info(name) ?? {};
  if (!usage) return null;
  const forms = usageForms(usage).map((f) => new RegExp(`^${escapeRegExp(name)}\\(([^()]*)\\)`).exec(f)?.[1]).filter((f): f is string => f !== undefined);
  const lists = forms.map((f) => f.split(',').map((x) => x.trim()).filter(Boolean));
  const params = formFor(lists, n);
  return params ? { params, needed: (i) => i < (min ?? params.length) || (lists.length === 1 && !OPTIONAL.has(params[i])) } : null;
}

export function slots(text: string, caret: number, info: FnInfo): Slots {
  const hints: SlotHint[] = [];
  let pending = 0;
  const m = matrixAt(text, caret);
  if (m) {
    let n = 0;
    for (const r of m.rows)
      for (const cell of pieces(text, r[0], r[1])) {
        const name = String.fromCharCode(97 + (n++ % 26));
        if (!blank(text, cell)) continue;
        pending++;
        const at = slotAt(text, cell);
        const current = caret >= cell[0] && caret <= cell[1];
        if (at >= caret || current) hints.push({ at: Math.max(at, current ? caret : at), text: name, ...(current ? { current } : {}) });
      }
  }
  let open = enclosing(text, caret);
  while (open >= 0 && text[open] !== '(') open = enclosing(text, open);
  const name = open >= 0 ? callNameBefore(text, open) : undefined;
  if (name) {
    const fn = callFunction(name);
    const close = closing(text, open);
    const args = pieces(text, open + 1, close);
    const got = paramsFor(fn, info, args.length);
    if (got) {
      const { params, needed } = got;
      args.forEach((span, i) => {
        if (!blank(text, span) || i >= params.length) return;
        if (args.length > 1 || needed(i)) pending++;
        const inSpan = caret >= span[0] && caret <= span[1];
        const at = inSpan ? caret : slotAt(text, span);
        if (at >= caret) hints.push({ at, text: params[i] });
      });
      const last = args[args.length - 1];
      const more = params.slice(args.length);
      for (let i = args.length; i < params.length; i++) if (needed(i)) pending++;
      if (more.length && caret >= last[0] && caret <= last[1]) {
        const shown = more.map((x, i) => (needed(args.length + i) ? x : `[${x}]`)).join(', ');
        if (blank(text, last)) hints.push({ at: caret, text: shown });
        else hints.push({ at: last[1], text: `, ${shown}` });
      }
    }
  }
  hints.sort((a, b) => a.at - b.at);
  const merged: SlotHint[] = [];
  for (const h of hints) {
    const prev = merged[merged.length - 1];
    if (prev && prev.at === h.at) prev.text += h.text.startsWith(', ') ? h.text : `, ${h.text}`;
    else merged.push({ ...h });
  }
  return { hints: merged, pending };
}

export function unfilled(text: string, info: FnInfo): number {
  let n = 0;
  for (const call of callsIn(text)) {
    const name = callFunction(call.name);
    const open = call.index + call.name.length;
    const args = pieces(text, open + 1, closing(text, open));
    const got = paramsFor(name, info, args.length);
    if (!got) continue;
    args.forEach((span, i) => { if (blank(text, span) && i < got.params.length && (args.length > 1 || got.needed(i))) n++; });
    for (let i = args.length; i < got.params.length; i++) if (got.needed(i)) n++;
  }
  for (const m of text.matchAll(/\[\[[^]*?\]\]/g)) n += (m[0].match(/[[,]\s*(?=[,\]])/g) ?? []).length;
  return n;
}

function matrixGrid(text: string, caret: number): { outer: number; close: number; cells: [number, number][][]; row: number; col: number } | null {
  const m = matrixAt(text, caret);
  if (!m || !m.rows.length) return null;
  const cells = m.rows.map((r) => pieces(text, r[0], r[1]));
  for (let row = 0; row < cells.length; row++) {
    const col = cells[row].findIndex(([a, b]) => caret >= a && caret <= b);
    if (col >= 0) return { outer: m.outer, close: m.close, cells, row, col };
  }
  return null;
}

function cellCaret(text: string, cell: [number, number]): number {
  if (blank(text, cell)) return slotAt(text, cell);
  let end = cell[1];
  while (end > cell[0] && text[end - 1] === ' ') end--;
  return end;
}

export function matrixRowStep(text: string, caret: number, dir: -1 | 1): number | null {
  const g = matrixGrid(text, caret);
  const to = g?.cells[g.row + dir]?.[g.col];
  return to ? cellCaret(text, to) : null;
}

export function matrixPrevCell(text: string, caret: number): number | null {
  const g = matrixGrid(text, caret);
  if (!g) return null;
  const to = g.col > 0 ? g.cells[g.row][g.col - 1] : g.cells[g.row - 1]?.at(-1);
  return to ? cellCaret(text, to) : null;
}

export function matrixNextEmpty(text: string, caret: number): number | null {
  const g = matrixGrid(text, caret);
  if (!g) return null;
  const flat = g.cells.flat();
  const at = g.cells.slice(0, g.row).reduce((n, r) => n + r.length, 0) + g.col;
  const to = [...flat.slice(at + 1), ...flat.slice(0, at)].find((c) => blank(text, c));
  return to ? slotAt(text, to) : null;
}

export function matrixBackspace(text: string, caret: number): { text: string; caret: number } | null {
  const g = matrixGrid(text, caret);
  if (!g || g.cells.length < 2 || g.cells.some((r) => r.length !== g.cells[0].length) || !blank(text, g.cells[g.row][g.col])) return null;
  const flat = g.cells.flat();
  if (flat.every((c) => blank(text, c))) return { text: text.slice(0, g.outer) + text.slice(g.close + 1), caret: g.outer };
  const to = matrixPrevCell(text, caret);
  return { text, caret: to ?? caret };
}

/** What ⌫ does to a line. `matrix` says the grid's rule decided it, so a browser field mustn't run its own Backspace too. */
export function backspaceEdit(text: string, start: number, end: number): { text: string; caret: number; matrix: boolean } {
  const cell = start === end ? matrixBackspace(text, start) : null;
  if (cell) return { ...cell, matrix: true };
  const caret = start === end ? Math.max(0, start - charBefore(text, start)) : start;
  return { text: text.slice(0, caret) + text.slice(end), caret, matrix: false };
}

export function slotStep(text: string, caret: number, next = false): number | null {
  const after = text.slice(caret);
  const atEnd = /^\s*[,\]]/.test(after);
  const m = matrixAt(text, caret);
  if (m && (atEnd || next)) {
    const cells = m.rows.flatMap((r) => pieces(text, r[0], r[1]));
    const i = cells.findIndex(([a, b]) => caret >= a && caret <= b);
    if (i < 0) return null;
    const ahead = cells.slice(i + 1).find((c) => blank(text, c));
    if (ahead) return slotAt(text, ahead);
    if (i === cells.length - 1) return m.close + 1;
    return cellCaret(text, cells[i + 1]);
  }
  let open = enclosing(text, caret);
  while (open >= 0 && text[open] !== '(') open = enclosing(text, open);
  if (open < 0 || !/[A-Za-z0-9_]$/.test(text.slice(0, open))) return null;
  if (!(atEnd || next) || !/^\s*,/.test(after)) return null;
  const args = pieces(text, open + 1, closing(text, open));
  const i = args.findIndex(([a, b]) => caret >= a && caret <= b);
  const ahead = args.slice(i + 1).find((c) => blank(text, c));
  return ahead ? slotAt(text, ahead) : null;
}

export function stripSignature(parts: { before: string; current: string; after: string }, text: string, caret: number): { before: string; current: string; after: string } {
  const close = parts.after.indexOf(')');
  let after = close >= 0 ? parts.after.slice(0, close + 1) : parts.after;
  let { before, current } = parts;
  const mark = (s: string) => s.replace(/([(,]\s*)([^,()]+?)(?=\s*[,)]|$)/g, (m, lead: string, name: string) => (OPTIONAL.has(name.trim()) ? `${lead}[${name.trim()}]` : m));
  before = mark(before);
  after = mark(after);
  if (OPTIONAL.has(current)) current = `[${current}]`;
  const open = enclosing(text, caret);
  const literal = open >= 0 ? /^\s*("[^"]*")/.exec(text.slice(open + 1))?.[1] : undefined;
  if (literal) {
    const swap = (s: string) => s.replace(/^([A-Za-z_]\w*\(\s*)"[^"]*"/, `$1${literal}`);
    before = swap(before);
    if (/^"[^"]*"$/.test(current)) current = literal;
  }
  return { before, current, after };
}

const TAKES_MATRIX = new Set(['det', 'inv', 'transpose', 'rref', 'trace', 'rank', 'eigen', 'linsolve', 'apply']);

export const MATRIX_SKELETONS: { label: string; ins: string }[] = [
  { label: '2 × 2', ins: '[[¦, ], [, ]]' },
  { label: '3 × 3', ins: '[[¦, , ], [, , ], [, , ]]' },
];

export function wantsMatrix(text: string, caret: number): boolean {
  const open = enclosing(text, caret);
  if (open < 0 || text[open] !== '(') return false;
  const name = callNameBefore(text, open);
  if (!name || !TAKES_MATRIX.has(name)) return false;
  const first = pieces(text, open + 1, closing(text, open))[0];
  return caret >= first[0] && caret <= first[1] && blank(text, first);
}

export function matrixCell(text: string, caret: number): { row: number; col: number; rows: number; cols: number } | null {
  const m = matrixAt(text, caret);
  if (!m) return null;
  for (let r = 0; r < m.rows.length; r++) {
    const cells = pieces(text, m.rows[r][0], m.rows[r][1]);
    const c = cells.findIndex(([a, b]) => caret >= a && caret <= b);
    if (c >= 0) return { row: r + 1, col: c + 1, rows: m.rows.length, cols: cells.length };
  }
  return null;
}

export function slotForEnd(text: string, info: FnInfo): number | null {
  const end = text.trimEnd();
  if (!end.endsWith(')')) return null;
  const close = end.length - 1;
  const open = enclosing(text, close);
  if (open < 0 || text[open] !== '(') return null;
  const name = callNameBefore(text, open);
  if (!name) return null;
  const fn = callFunction(name);
  const args = pieces(text, open + 1, close);
  const got = paramsFor(fn, info, args.length);
  if (!got) return null;
  const missing = args.some((a, i) => blank(text, a) && got.needed(i)) || got.params.some((_, i) => i >= args.length && got.needed(i));
  return missing ? close : null;
}
