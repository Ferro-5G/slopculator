// The composer's line, shared by every front end: how what's being typed is set while it's typed (runs that keep
// their place in the source, so a caret can sit between any two characters, even in a line that doesn't parse yet),
// the state its edge shows and when it lights, the live answer it shows before enter, and the little curve of a line
// that draws. The placeholder is composerPlaceholder in src/ui/canvas.ts. No DOM here; the platforms draw it.
import { figureKind } from './figures';
import { isGraphVar, lettersOf } from '../engine/ast';
import { BUILTINS, CONSTANTS } from '../engine/builtins';
import type { RowResult } from '../engine/document';
import { formatValue, type DisplayOpts } from '../engine/format';
import { isDist } from '../engine/values';
import { isUnit, otherUnit } from '../engine/units';
import { lineErrorText, shortLineError } from './errortext';
import { assignsLiteral, NO_NAMES, type MathRole, type SheetNames } from './typeset';

/**
 * A piece of the line as it's set: `s` stands for the source from `from` to `to` (an empty `s` hides it, as ^ does).
 * `raised` sets it as an exponent.
 */
export interface InlineRun { from: number; to: number; s: string; role: MathRole; raised?: boolean }

const OPS: Record<string, string> = { '*': '×', '+': '+', '=': '=', '<': '<', '>': '>', '<=': '≤', '>=': '≥', '!=': '≠', '~': '~' };
const WORDS: Record<string, string> = { pi: 'π', inf: '∞', sqrt: '√', theta: 'θ' };
const isLetter = (c: string) => /[\p{L}_]/u.test(c);
const isWordChar = (c: string) => /[\p{L}\p{N}_]/u.test(c);

/**
 * The line as the composer sets it while it's typed, a run at a time: numbers upright, one-letter names italic (a
 * word the engine reads as letters, kx with k defined, is letters), functions and longer names upright, × for *, − for
 * a minus, operators spaced, and what follows ^ raised. Spaces in the source set nothing; every other character
 * belongs to exactly one run, so the caret's place maps to a place between runs (or inside one, which the caller
 * splits).
 */
export function composerRuns(text: string, names: SheetNames = NO_NAMES): InlineRun[] {
  const out: InlineRun[] = [];
  const known = (c: string) => isGraphVar(c) || names.vars.has(c) || c in CONSTANTS;
  let raise = 0; // 1: the next atom is an exponent. Inside a raised group, the depth of its brackets plus one.
  let depth = 0;
  const push = (r: InlineRun) => {
    const raised = raise > 0 && (raise > 1 || r.role !== 'op');
    out.push(raised ? { ...r, raised: true } : r);
  };
  const atomDone = () => { if (raise === 1) raise = 0; };
  const prevRole = () => {
    for (let k = out.length - 1; k >= 0; k--) if (out[k].s !== '') return out[k];
    return null;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      push({ from: i, to: j, s: text.slice(i, j), role: 'num' });
      i = j;
      atomDone();
      continue;
    }
    if (isLetter(c)) {
      let j = i + 1;
      while (j < text.length && isWordChar(text[j])) j++;
      const word = text.slice(i, j);
      let k = j;
      while (k < text.length && text[k] === ' ') k++;
      const call = text[k] === '(';
      if (WORDS[word]) push({ from: i, to: j, s: WORDS[word], role: word === 'sqrt' ? 'fn' : 'name' });
      else if (call && (word in BUILTINS || names.funcs.has(word)) && word.length > 1) push({ from: i, to: j, s: word, role: 'fn' });
      else if ([...word].length === 1) push({ from: i, to: j, s: word, role: 'var' });
      else if (names.vars.has(word) || word in CONSTANTS || word === 'ans' || names.funcs.has(word)) push({ from: i, to: j, s: word, role: 'name' });
      else {
        const letters = lettersOf(word, known);
        if (letters) {
          let at = i;
          for (const l of letters) { push({ from: at, to: at + l.length, s: l, role: 'var' }); at += l.length; }
        } else push({ from: i, to: j, s: word, role: 'name' });
      }
      i = j;
      // A function's name isn't the whole exponent: its brackets follow.
      if (!(call && raise === 1)) atomDone();
      continue;
    }
    const two = text.slice(i, i + 2);
    if (OPS[two] && two.length === 2) { push({ from: i, to: i + 2, s: OPS[two], role: 'op' }); i += 2; continue; }
    if (c === '^') { out.push({ from: i, to: i + 1, s: '', role: 'text' }); raise = raise > 1 ? raise : 1; i++; continue; }
    if (c === '-') {
      const before = prevRole();
      const sign = !before || before.role === 'op' || before.role === 'punct' || before.role === 'sign' || /[([{]$/.test(before.s) || (raise === 1 && !before.raised);
      push({ from: i, to: i + 1, s: '−', role: sign ? 'sign' : 'op' });
      i++;
      continue;
    }
    if (OPS[c]) { push({ from: i, to: i + 1, s: OPS[c], role: 'op' }); i++; continue; }
    if (c === ',') { push({ from: i, to: i + 1, s: ',', role: 'punct' }); i++; continue; }
    if (c === '"') {
      let j = text.indexOf('"', i + 1);
      j = j < 0 ? text.length : j + 1;
      push({ from: i, to: j, s: text.slice(i, j), role: 'text' });
      i = j;
      atomDone();
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      if (raise === 1) raise = 2;
      else if (raise > 1) raise++;
      depth++;
      push({ from: i, to: i + 1, s: c, role: 'text' });
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      push({ from: i, to: i + 1, s: c, role: 'text' });
      depth = Math.max(0, depth - 1);
      if (raise > 1) raise = raise === 2 ? 0 : raise - 1;
      i++;
      continue;
    }
    push({ from: i, to: i + 1, s: c, role: 'text' });
    i++;
  }
  return out;
}

/** Splits the runs at a source position, so a caret there sits between two runs. */
export function splitRuns(runs: readonly InlineRun[], at: number): { before: InlineRun[]; after: InlineRun[] } {
  const before: InlineRun[] = [], after: InlineRun[] = [];
  for (const r of runs) {
    if (r.to <= at) before.push(r);
    else if (r.from >= at) after.push(r);
    else if (r.role === 'num' || r.role === 'name' || r.role === 'fn' || r.role === 'text') {
      const cut = at - r.from;
      before.push({ ...r, to: at, s: r.s.slice(0, cut) });
      after.push({ ...r, from: at, s: r.s.slice(cut) });
    } else (at - r.from < r.to - at ? after : before).push(r);
  }
  return { before, after };
}

/** Whether the caret, sitting between `before` and the rest, is in an exponent. */
export const caretRaised = (before: readonly InlineRun[]): boolean => {
  const last = before[before.length - 1];
  return !!last && (last.raised === true || (last.s === '' && last.role === 'text' && last.to > last.from));
};

/** What the composer's edge shows: idle (nothing typed), typing, ok (the line works out: the edge lights), or err. */
export type ComposerState = 'idle' | 'typing' | 'ok' | 'err';

/**
 * @param update the line would change another line that defines the same name.
 * @param calm the error is one typing hasn't finished with yet (an unfinished line), so it doesn't count.
 */
export function composerState(text: string, r: RowResult | undefined, opts: { update?: boolean; calm?: boolean } = {}): ComposerState {
  if (!text.trim()) return 'idle';
  if (opts.update) return 'ok';
  if (r?.error) return opts.calm ? 'typing' : 'err';
  return r && (r.value !== undefined || r.graph.length > 0 || !!r.slider || !!r.defines || !!r.table) ? 'ok' : 'typing';
}

/** Whether the edge light runs round the composer: once the line works out. */
export const composerGlows = (s: ComposerState): boolean => s === 'ok';

/**
 * Whether the line is a figure whose block draws what its answer would say as a table or a grid (the unit circle,
 * the tangent, a 2×2 matrix): the composer shows no answer for it, not even a hidden one taking room. A figure with a
 * number for its answer (normalcdf's area, riemann's sum) shows the number as any line does.
 */
export function composerQuietFigure(text: string, r: RowResult | undefined): boolean {
  const fig = !r || r.error ? null : figureKind(text, r);
  return fig === 'unit-circle' || fig === 'tangent' || fig === 'matrix';
}

/**
 * The live answer the composer shows on its right before enter, or null: a line that sets a name to a number (the
 * block shows it), a distribution, an error (the composer stays calm while typing) and a line with no value show none.
 */
export function composerAnswer(text: string, r: RowResult | undefined, display: DisplayOpts): string | null {
  if (!r || r.error || !text.trim()) return null;
  if (composerQuietFigure(text, r)) return null;
  if (r.truth !== undefined) return r.truth ? 'true' : 'false';
  const v = r.value;
  // A bare number is its own answer; = 12 under 12 says nothing.
  if (v === undefined || isDist(v) || assignsLiteral(text) || /^\s*[\d.]+\s*$/.test(text)) return null;
  return formatValue(v, display, r.prob, r.precise);
}

/**
 * The error the composer shows on its row, or null. Never while typing: only once typing pauses (TYPING_PAUSE_MS in
 * src/ui/text.ts, the pause the warnings wait for too), and not while the line is held back as unfinished (`calm`).
 * Then `short` sits on the row, whole (shortLineError), and `full` shows on hover, focus or a tap.
 */
export function composerError(text: string, r: RowResult | undefined, o: { typing?: boolean; calm?: boolean } = {}): { short: string; full: string } | null {
  if (!r?.error || !text.trim() || o.typing || o.calm) return null;
  return { short: shortLineError(text, r.error, isUnit, otherUnit), full: lineErrorText(text, r.error, isUnit, otherUnit) };
}

/** How far a sparkline's heights reach either way: a curve that runs off (tan x, 1/x) is cut there, not squashed flat. */
export const SPARK_CLIP = 10;

/**
 * The composer's little curve for a line that draws: `n` heights from 0 to 1 across −10 to 10 (NaN where it has no
 * value), its values cut to ±SPARK_CLIP, or null.
 */
export function composerSpark(r: RowResult | undefined, n = 24): number[] | null {
  const item = r && !r.error && r.value === undefined ? r.graph.find((g) => g.type === 'fx') : undefined;
  if (!item || item.type !== 'fx') return null;
  const ys = Array.from({ length: n }, (_, k) => item.f(-10 + (20 * k) / (n - 1)));
  const ok = ys.filter(Number.isFinite);
  if (ok.length < 2) return null;
  const lo = Math.max(-SPARK_CLIP, Math.min(...ok)), hi = Math.min(SPARK_CLIP, Math.max(...ok)), span = hi - lo || 1;
  return ys.map((y) => (Number.isFinite(y) ? (Math.max(lo, Math.min(hi, y)) - lo) / span : NaN));
}

/** A sparkline's heights as an SVG path in a w × h box, 2 px in from top and foot, broken where a height is NaN. */
export function sparkPath(heights: readonly number[], w: number, h: number): string {
  let d = '', pen = false;
  heights.forEach((y, k) => {
    if (!Number.isFinite(y)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${((w * k) / Math.max(1, heights.length - 1)).toFixed(1)},${(h - 2 - y * (h - 4)).toFixed(1)}`;
    pen = true;
  });
  return d;
}
