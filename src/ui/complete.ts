import { BUILTINS, BUILTIN_NAMES, CONSTANTS } from '../engine/builtins';
import { canonicalName } from '../engine/lexer';
import { isUnit } from '../engine/units';
import type { RowInput, RowResult } from '../engine/document';
import { callFunction, callNameBefore, nameStart, splitTop, TYPED_CLOSERS as CLOSERS, TYPED_OPENERS as OPENERS, usageForms } from './brackets';
import { isStrayComma } from './errortext';
import { keyCall, PANELS } from './keypad';
import { escapeRegExp } from './text';

export interface Candidate {
  name: string;
  call: boolean;
  own?: boolean;
}

export interface Completion {
  word: string;
  start: number;
  end: number;
  items: Candidate[];
}

export interface Edit {
  text: string;
  caret: number;
}

export function trayNames(tokens: readonly string[]): string[] {
  return tokens.filter((t) => t !== 'ans');
}

export const PRIORITY = ['normalcdf', 'invNorm', 'normaldist', 'zscore', 'binompdf', 'binomcdf', 'mean', 'sdp', 'nCr', 'nPr', 'sqrt', 'sin', 'cos', 'tan', 'det', 'inv'];

export const BUILTIN_CANDIDATES: Candidate[] = BUILTIN_NAMES.filter((n) => /^[A-Za-z]/.test(n) && n.length > 1).map((name) => ({ name, call: BUILTINS[name].max !== 0 }));

export const USAGE = new Map<string, string>();
for (const p of PANELS)
  for (const k of p.keys) {
    const name = keyCall(k);
    if (name && k.title && !USAGE.has(name)) USAGE.set(name, k.title);
  }
for (const name of BUILTIN_NAMES) {
  const u = BUILTINS[name].usage;
  if (u) USAGE.set(name, u);
}

function ownFunctionName(row: RowInput | undefined): string | null {
  const m = row?.kind === 'expr' ? /^\s*([A-Za-z][A-Za-z0-9_]*)\s*\([^)]*\)\s*=/.exec(row.text) : null;
  return m ? m[1] : null;
}

export function sheetCandidates(rows: readonly RowInput[], results: readonly RowResult[]): Candidate[] {
  const own: Candidate[] = [];
  // Functions first: a function's line also "defines" its name, and the first entry for a name wins.
  for (const row of rows) {
    const name = ownFunctionName(row);
    if (name && name.length > 1) own.push({ name, call: true, own: true });
  }
  for (const r of results) if (r.defines && r.defines.length > 1) own.push({ name: r.defines, call: false, own: true });
  return [...own, ...BUILTIN_CANDIDATES];
}

export function ownFunctionUsage(name: string, rows: readonly RowInput[]): string | null {
  const re = new RegExp(`^\\s*${escapeRegExp(name)}\\s*\\(([^()]*)\\)\\s*=(.*)$`);
  for (const r of rows) {
    if (r.kind !== 'expr') continue;
    const m = re.exec(r.text);
    if (m) return `${name}(${m[1].trim()}) = ${m[2].trim()}`;
  }
  return null;
}

function looseMatch(word: string, name: string): boolean {
  if (word[0] !== name[0]) return false;
  let i = 0;
  for (const ch of name) if (ch === word[i]) i++;
  return i === word.length;
}

/** Null when there's no word, or the caret is inside one. */
export function completions(text: string, caret: number, candidates: Candidate[], limit = 5): Completion | null {
  const at = nameStart(text, caret);
  const word = at < 0 ? '' : text.slice(at, caret);
  if (word.length < 2) return null;
  if (/[A-Za-z0-9_(]/.test(text[caret] ?? '')) return null;
  // Inside quotes it's a unit or text ("mi", "R410A"), never a name to complete: "mi" would turn into min.
  if ((text.slice(0, caret).match(/"/g)?.length ?? 0) % 2 === 1) return null;
  // A unit after a number ("5 mi", "10ft") is a unit, the same guard as the one-click fix, which offers convert():
  // Tab mustn't turn it into min or a look-alike.
  if (isUnit(word) && /\d\s*$/.test(text.slice(0, at))) return null;
  // A finished name offers nothing: Tab would otherwise swap it for a longer or looser match (mean for median, sd for sdp).
  if (candidates.some((c) => c.name === word) || Object.hasOwn(CONSTANTS, canonicalName(word))) return null;
  const lw = word.toLowerCase();
  const rank = (c: Candidate): [number, number, number, number] => {
    const p = PRIORITY.indexOf(c.name);
    return [c.name.toLowerCase().startsWith(lw) ? 0 : 1, c.own ? 0 : 1, p < 0 ? PRIORITY.length : p, c.name.length];
  };
  const seen = new Set<string>();
  const items = candidates
    .filter((c) => {
      if (seen.has(c.name)) return false;
      const lower = c.name.toLowerCase();
      if (!lower.startsWith(lw) && !looseMatch(lw, lower)) return false;
      seen.add(c.name);
      return true;
    })
    .sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
  return items.length ? { word, start: caret - word.length, end: caret, items } : null;
}

export function applyCompletion(text: string, c: Pick<Completion, 'start' | 'end'>, item: Candidate): Edit {
  const inserted = item.call ? `${item.name}()` : item.name;
  const caret = c.start + item.name.length + (item.call ? 1 : 0);
  return { text: text.slice(0, c.start) + inserted + text.slice(c.end), caret };
}

export function enclosingCall(text: string, caret: number): { name: string; arg: number } | null {
  let depth = 0, arg = 0;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (CLOSERS.includes(ch)) depth++;
    else if (OPENERS.includes(ch)) {
      if (depth === 0) {
        if (ch !== '(') return null;
        const name = callNameBefore(text, i);
        return name ? { name: callFunction(name), arg } : null;
      }
      depth--;
    } else if (ch === ',' && depth === 0) arg++;
  }
  return null;
}

export function nextSlot(text: string, caret: number): Edit | null {
  let depth = 0;
  for (let i = caret; i < text.length; i++) {
    const ch = text[i];
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) {
      if (depth > 0) {
        depth--;
        continue;
      }
      const call = ch === ')' ? enclosingCall(text, caret) : null;
      const fn = call ? BUILTINS[call.name] : undefined;
      if (call && fn) {
        const start = Math.max(text.lastIndexOf(',', caret - 1), text.lastIndexOf('(', caret - 1)) + 1;
        const filled = text.slice(start, i).trim().length > 0;
        const more = call.arg + 1 < fn.min || (Number.isFinite(fn.max) && call.arg + 1 < fn.max);
        if (filled && more) return { text: `${text.slice(0, i)}, ${text.slice(i)}`, caret: i + 2 };
        if (!filled && call.arg > 0 && call.arg >= fn.min) {
          const comma = start - 1;
          return { text: text.slice(0, comma) + text.slice(i), caret: comma + 1 };
        }
      }
      return { text, caret: i + 1 };
    } else if (ch === ',' && depth === 0) {
      return { text, caret: text[i + 1] === ' ' ? i + 2 : i + 1 };
    }
  }
  return null;
}

export interface SignatureParts {
  before: string;
  current: string;
  after: string;
}

/** Null for other usage text. */
export function signatureParts(usage: string, arg: number): SignatureParts | null {
  const m = /^([A-Za-z_]\w*\()([^()]*)\)([\s\S]*)$/.exec(usage);
  if (!m) return null;
  const params = splitTop(m[2]);
  if (arg >= params.length) return null;
  const leading = params.slice(0, arg).map((p) => `${p},`).join('');
  const current = params[arg];
  const spaces = current.length - current.trimStart().length;
  const trailing = params.slice(arg + 1).map((p) => `,${p}`).join('');
  return { before: m[1] + leading + current.slice(0, spaces), current: current.trim(), after: `${trailing})${m[3]}` };
}

export function asList(text: string): string | null {
  const t = text.trim().replace(/,\s*$/, '');
  if (t.includes('=')) return null;
  const parts = splitTop(t);
  return parts.length >= 2 && parts.every((p) => p.trim()) ? `{${t}}` : null;
}

export function signatureForArg(usage: string, arg: number): SignatureParts | null {
  const whole = signatureParts(usage, arg);
  if (whole) return whole;
  for (const form of usageForms(usage)) {
    const parts = signatureParts(form, arg);
    if (parts) return parts;
  }
  return null;
}

export function fitSignature(parts: SignatureParts, width: number): SignatureParts {
  const { before, current, after } = parts;
  if (before.length + current.length + after.length <= width) return parts;
  if (current.length + 2 >= width) return { before: '', current: `${current.slice(0, Math.max(1, width - 1))}…`, after: '' };
  const room = width - current.length - before.length;
  if (room >= 1) return { before, current, after: `${after.slice(0, room - 1)}…` };
  return { before: `…${before.slice(before.length - (width - current.length - 2))}`, current, after: '…' };
}

export function nextInBrackets(text: string, caret: number): Edit | null {
  const direct = nextSlot(text, caret);
  if (direct) return direct;
  const open: string[] = [];
  for (const ch of text) {
    if (OPENERS.includes(ch)) open.push(CLOSERS[OPENERS.indexOf(ch)]);
    else if (CLOSERS.includes(ch)) open.pop();
  }
  return open.length ? nextSlot(text + open.reverse().join(''), caret) : null;
}

export type TypingHelp =
  | { kind: 'suggest'; completion: Completion }
  | { kind: 'call'; usage: string; parts: SignatureParts | null; next: Edit | null }
  | { kind: 'wrap'; text: string }
  | { kind: 'insert'; tokens: string[]; next: Edit | null };

export interface TypingState {
  rows: readonly RowInput[];
  results: readonly RowResult[];
  activeId: string | null;
  start: number;
  end: number;
  settled: boolean;
  suggestions: number;
}

function earlierNames(rows: readonly RowInput[], results: readonly RowResult[], index: number): string[] {
  const named: string[] = [];
  const letters: string[] = [];
  let answers = false;
  for (let k = Math.min(index, results.length) - 1; k >= 0; k--) {
    const r = results[k], row = rows[k];
    if (!r || r.error || (row?.kind === 'expr' && !row.text.trim())) continue;
    if (r.value !== undefined) answers = true;
    if (r.defines) {
      const name = ownFunctionName(row) === r.defines ? `${r.defines}(` : r.defines;
      if (!named.includes(name)) named.push(name);
    } else if (r.lineName && !letters.includes(r.lineName)) letters.push(r.lineName);
  }
  return [...named, ...(answers ? ['ans'] : []), ...letters];
}

function usageFor(name: string, rows: readonly RowInput[]): string | null {
  return ownFunctionUsage(name, rows) ?? (BUILTINS[name] ? USAGE.get(name) ?? `${name}(…)` : null);
}

export function inEmptyArgument(text: string, caret: number): boolean {
  if (!enclosingCall(text, caret)) return false;
  return /[(,]\s*$/.test(text.slice(0, caret)) && /^\s*([,)]|$)/.test(text.slice(caret));
}

export function emptyArgumentHint(text: string, caret: number, rows: readonly RowInput[]): { usage: string; parts: SignatureParts | null } | null {
  if (!inEmptyArgument(text, caret)) return null;
  const call = enclosingCall(text, caret)!;
  const usage = usageFor(call.name, rows);
  return usage ? { usage, parts: signatureForArg(usage, call.arg) } : null;
}

export function typingHelp({ rows, results, activeId, start, end, settled, suggestions }: TypingState): TypingHelp {
  const index = rows.findIndex((r) => r.id === activeId);
  const row = rows[index];
  const editing = row?.kind === 'expr';
  const text = editing ? row.text : '';
  const from = Math.min(start, text.length);
  const collapsed = start === end;
  const next = collapsed ? nextInBrackets(text, from) : null;
  const completion = collapsed ? completions(text, from, sheetCandidates(rows, results), suggestions) : null;
  if (completion) return { kind: 'suggest', completion };
  const call = enclosingCall(text, from);
  const usage = call && usageFor(call.name, rows);
  if (call && usage) return { kind: 'call', usage, parts: signatureForArg(usage, call.arg), next };
  const list = settled && isStrayComma(results[index]?.error) ? asList(text) : null;
  if (list) return { kind: 'wrap', text: list };
  return { kind: 'insert', tokens: earlierNames(rows, results, editing ? index : rows.length), next };
}

export const tokenFunction = (token: string): string | null => (token.endsWith('(') ? token.slice(0, -1) : null);

export function fitTokens(tokens: string[], room: number, width: (name: string) => number = () => 1): string[] {
  const always = tokens[0] === 'ans' ? 2 : 1;
  const fit: string[] = [];
  let used = 0;
  for (const name of tokens) {
    used += width(name);
    if (fit.length >= always && used > room) break;
    fit.push(name);
  }
  return fit;
}

