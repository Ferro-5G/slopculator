import { tokenize, type Token } from './lexer';
import { INFIX_WORDS, PREFIX_FUNCS, TRIG, isHeading } from './parser';
import { Lru } from './memo';
import { readError } from './errors';

export interface Span {
  start: number;
  end: number;
}

export interface LineWarning extends Span {
  message: string;
  /** The whole line, rewritten the way it probably should read. */
  fix?: string;
  /** The other likely reading, as a second fix (12 000: 12000 first, 12 × 000 second). */
  alt?: string;
  /** Shown at once rather than after typing pauses: the answer beside it (12 000 → 0) would mislead meanwhile. */
  instant?: boolean;
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
const POSTFIX = new Set(['!', '%', '°']);

function tokens(text: string): Token[] | null {
  try {
    return tokenize(text);
  } catch {
    return null;
  }
}

const isOp = (t: Token | undefined, ...values: string[]) => !!t && t.type === 'op' && values.includes(t.value);

class Line {
  constructor(readonly text: string, readonly toks: Token[]) {}

  end(i: number): number {
    let e = this.toks[i + 1]?.pos ?? this.text.length;
    while (e > this.toks[i].pos && this.text[e - 1] === ' ') e--;
    return e;
  }

  /** The token after the bracket group opening at i, or -1 if it never closes. */
  afterGroup(i: number): number {
    let depth = 0;
    for (let k = i; k < this.toks.length; k++) {
      const t = this.toks[k];
      if (t.type === 'op' && OPEN.has(t.value)) depth++;
      else if (t.type === 'op' && CLOSE.has(t.value) && --depth === 0) return k + 1;
    }
    return -1;
  }

  /** The token after the number, name, call, or bracket group at i, or -1 if there's none here. */
  afterAtom(i: number): number {
    const t = this.toks[i];
    if (!t) return -1;
    let k: number;
    if (t.type === 'num') k = i + 1;
    else if (t.type === 'ident') k = isOp(this.toks[i + 1], '(') ? this.afterGroup(i + 1) : i + 1;
    else if (t.type === 'op' && OPEN.has(t.value)) k = this.afterGroup(i);
    else return -1;
    while (k > 0 && isOp(this.toks[k], ...POSTFIX)) k++;
    return k;
  }

  afterPowered(i: number): number {
    let k = this.afterAtom(i);
    while (k > 0 && isOp(this.toks[k], '^')) {
      const next = isOp(this.toks[k + 1], '-') ? k + 2 : k + 1;
      const after = this.afterAtom(next);
      if (after < 0) return k;
      k = after;
    }
    return k;
  }

  implicit(i: number): boolean {
    const t = this.toks[i];
    if (!t) return false;
    if (t.type === 'ident') return !INFIX_WORDS.has(t.value);
    return isOp(t, '(');
  }

  source(i: number, j: number): string {
    return this.text.slice(this.toks[i].pos, this.end(j - 1));
  }

  wrapped(i: number, j: number): string {
    return `${this.text.slice(0, this.toks[i].pos)}(${this.source(i, j)})${this.text.slice(this.end(j - 1))}`;
  }

  span(i: number, j: number): Span {
    return { start: this.toks[i].pos, end: this.end(j - 1) };
  }
}

/** A piece of the line, short enough to quote in a message that has to fit a phone's display. */
function brief(source: string): string {
  return source.length > 12 ? `${source.slice(0, 11)}…` : source;
}

function negativePower(l: Line): LineWarning | null {
  for (let i = 0; i < l.toks.length; i++) {
    const prev = l.toks[i - 1];
    const startsTerm = !prev || (prev.type === 'op' && !CLOSE.has(prev.value) && !POSTFIX.has(prev.value));
    if (!isOp(l.toks[i], '-') || !startsTerm || l.toks[i + 1]?.type !== 'num' || !isOp(l.toks[i + 2], '^')) continue;
    return {
      ...l.span(i, i + 2),
      message: `The power goes first, so this is −(${brief(l.source(i + 1, Math.max(l.afterPowered(i + 1), i + 2)))}). Use brackets for a negative base.`,
      fix: l.wrapped(i, i + 2),
    };
  }
  return null;
}

/**
 * Two numbers side by side multiply (2 3 is 6), which is rarely what was meant: a missing operator, or a digit group
 * typed with more than the one space the lexer reads as grouping (12  000). Valid as it stands, so it's a "Check this"
 * with both readings as fixes, the likelier first: a three-digit group after one to three digits reads as thousands.
 */
function numbersSideBySide(l: Line): LineWarning | null {
  for (let i = 0; i + 1 < l.toks.length; i++) {
    const a = l.toks[i], b = l.toks[i + 1];
    if (a.type !== 'num' || b.type !== 'num') continue;
    let j = i + 1;
    while (l.toks[j + 1]?.type === 'num') j++;
    const run = l.toks.slice(i, j + 1).map((t) => t.value);
    const head = l.text.slice(0, a.pos), tail = l.text.slice(l.end(j));
    const joined = head + run.join('') + tail, times = head + run.join(' * ') + tail;
    const grouping = /^\d{1,3}$/.test(a.value) && run.slice(1).every((v) => /^\d{3}$/.test(v));
    const said = run.join(' ');
    return {
      ...l.span(i, j + 1),
      message: `${said} multiplies: ${run.join(' × ')}. ${grouping ? `For ${run.join('')}, leave out the ${run.length > 2 ? 'spaces' : 'space'}.` : 'Put × between them to say so, or leave out the space.'}`,
      fix: grouping ? joined : times,
      alt: grouping ? times : joined,
      instant: true,
    };
  }
  return null;
}

function divisionRunsOn(l: Line): LineWarning | null {
  for (let i = 1; i < l.toks.length; i++) {
    if (!isOp(l.toks[i], '/')) continue;
    const atom = l.afterAtom(i + 1);
    if (atom < 0 || !l.implicit(atom)) continue;
    const rest = l.afterPowered(atom);
    if (rest < 0) continue;
    const below = brief(l.source(i + 1, atom));
    const after = brief(l.source(atom, rest));
    return {
      ...l.span(i + 1, rest),
      message: `Only ${below} is under the fraction, and ${after} multiplies the result. Use brackets if ${after} belongs below too.`,
      fix: l.wrapped(i + 1, rest),
    };
  }
  return null;
}

function powerRunsOn(l: Line): LineWarning | null {
  for (let i = 1; i < l.toks.length; i++) {
    if (!isOp(l.toks[i], '^')) continue;
    // "x^2y" is a normal way to write a term, so this is only for number and e bases.
    const base = l.toks[i - 1];
    if (base.type !== 'num' && !(base.type === 'ident' && base.value === 'e')) continue;
    const from = isOp(l.toks[i + 1], '-') ? i + 2 : i + 1;
    const atom = l.afterAtom(from);
    if (atom < 0 || !l.implicit(atom)) continue;
    const rest = l.afterAtom(atom);
    if (rest < 0) continue;
    const up = brief(l.source(i + 1, atom));
    const after = brief(l.source(atom, rest));
    return {
      ...l.span(i + 1, rest),
      message: `Only ${up} is in the exponent, and ${after} multiplies the result. Use brackets if ${after} belongs up there too.`,
      fix: l.wrapped(i + 1, rest),
    };
  }
  return null;
}

function functionWithoutBrackets(l: Line): LineWarning | null {
  for (let i = 0; i < l.toks.length; i++) {
    const t = l.toks[i];
    if (t.type !== 'ident' || !PREFIX_FUNCS.has(t.value) || isOp(l.toks[i + 1], '(')) continue;
    let k = l.afterPowered(i + 1);
    while (k > 0 && l.implicit(k)) {
      const next = l.afterPowered(k);
      if (next < 0) break;
      k = next;
    }
    if (k < 0 || !isOp(l.toks[k], '+', '-')) continue;
    const arg = brief(l.source(i + 1, k));
    return { ...l.span(i, k), message: `${t.value} only covers ${arg} here. Use brackets if it should cover more.` };
  }
  return null;
}

function fractionInASum(l: Line): LineWarning | null {
  for (let i = 1; i < l.toks.length; i++) {
    if (!isOp(l.toks[i], '/')) continue;
    if (i < 3 || !isOp(l.toks[i - 2], '+', '-')) continue;
    const below = l.afterAtom(i + 1);
    if (below < 0 || !isOp(l.toks[below], '+', '-')) continue;
    const last = l.afterAtom(below + 1);
    if (last < 0) continue;
    if (l.afterAtom(i - 3) !== i - 2 || l.afterAtom(i - 1) !== i) continue;
    const before = l.toks[i - 4];
    const after = l.toks[last];
    const bounded = (t: Token | undefined) => !t || t.type === 'eof' || (t.type === 'op' && (OPEN.has(t.value) || CLOSE.has(t.value) || t.value === ','));
    if (!bounded(before) || !bounded(after)) continue;
    const top = l.source(i - 3, i);
    const bottom = l.source(i + 1, last);
    return {
      ...l.span(i - 3, last),
      message: `Only ${brief(`${l.source(i - 1, i)}/${l.source(i + 1, below)}`)} is the fraction. Use brackets if everything belongs in it.`,
      fix: `${l.text.slice(0, l.toks[i - 3].pos)}(${top})/(${bottom})${l.text.slice(l.end(last - 1))}`,
    };
  }
  return null;
}

function angleMode(l: Line, deg: boolean): LineWarning | null {
  for (let i = 0; i < l.toks.length; i++) {
    const t = l.toks[i];
    if (t.type !== 'ident' || !TRIG.has(t.value)) continue;
    const bracketed = isOp(l.toks[i + 1], '(');
    const from = bracketed ? i + 2 : i + 1;
    const end = bracketed ? l.afterGroup(i + 1) - 1 : from + 1;
    if (end <= from) continue;
    if (deg) {
      for (let k = from; k < end; k++) {
        if (l.toks[k].type === 'ident' && l.toks[k].value === 'π') {
          return { ...l.span(i, bracketed ? end + 1 : end), message: 'Degrees are on, but π usually means radians. Check the Deg–Rad switch.' };
        }
      }
    } else {
      const n = l.toks[from];
      const degreesLike = end === from + 1 && n.type === 'num' && n.num !== undefined && n.num >= 15 && n.num <= 360 && n.num % 15 === 0;
      if (degreesLike) {
        return { ...l.span(i, bracketed ? end + 1 : end), message: `Radians are on, and ${l.source(from, end)} looks like degrees. Check the Deg–Rad switch.` };
      }
    }
  }
  return null;
}

const warned = new Lru<string, LineWarning[]>(2000);
const NONE: LineWarning[] = [];
Object.freeze(NONE);

/** Valid lines that may not mean what was intended. Positions are in `text` as given. The result is shared: don't mutate it. */
export function lineWarnings(text: string, settings: { deg: boolean }): LineWarning[] {
  const key = (settings.deg ? 'D' : 'R') + text;
  let hit = warned.get(key);
  if (hit === undefined) {
    hit = findWarnings(text, settings.deg);
    warned.set(key, hit.length ? hit : NONE);
  }
  return hit;
}

function findWarnings(text: string, deg: boolean): LineWarning[] {
  const trimmed = text.trim();
  if (!trimmed || isHeading(trimmed)) return [];
  const toks = tokens(trimmed);
  if (!toks) return [];
  const offset = text.length - text.trimStart().length;
  const lead = text.slice(0, offset);
  const trail = text.slice(offset + trimmed.length);
  const l = new Line(trimmed, toks);
  const found = [numbersSideBySide(l), negativePower(l), divisionRunsOn(l), powerRunsOn(l), functionWithoutBrackets(l), fractionInASum(l), angleMode(l, deg)];
  return found.filter((w): w is LineWarning => !!w).map((w) => ({
    ...w,
    start: w.start + offset,
    end: w.end + offset,
    fix: w.fix === undefined ? undefined : lead + w.fix + trail,
    alt: w.alt === undefined ? undefined : lead + w.alt + trail,
  }));
}

/** The part of the line an error is about. Null when it's about the whole line. */
export function errorSpan(text: string, error: string, pos?: number): Span | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const offset = text.length - text.trimStart().length;
  const shift = (s: Span): Span => ({ start: s.start + offset, end: s.end + offset });
  const toks = tokens(trimmed);
  if (!toks) return pos === undefined ? null : shift({ start: pos, end: Math.min(pos + 1, trimmed.length) });
  const l = new Line(trimmed, toks);
  const last = toks.length - 2;
  const byName = (name: string): Span | null => {
    const i = toks.findIndex((t) => t.type === 'ident' && t.value === name);
    return i < 0 ? null : shift(l.span(i, i + 1));
  };

  const form = readError(error);
  if (form.k === 'unknown' || form.k === 'emptyLine') return byName(form.name);

  if (form.k === 'unclosed' && form.got === null) {
    const stack: number[] = [];
    toks.forEach((t, i) => {
      if (t.type === 'op' && OPEN.has(t.value)) stack.push(i);
      else if (t.type === 'op' && CLOSE.has(t.value)) stack.pop();
    });
    const opener = stack.pop();
    if (opener !== undefined) return shift(l.span(opener, opener + 1));
  }

  if (pos !== undefined) {
    const i = toks.findIndex((t) => t.pos === pos);
    if (i >= 0 && toks[i].type !== 'eof') return shift(l.span(i, i + 1));
    if (last >= 0) return shift(l.span(last, last + 1));
  }

  const word = /^"?([A-Za-z_]\w*)/.exec(error);
  return word ? byName(word[1]) : null;
}
