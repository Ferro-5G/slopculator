import { tokenize, type Token } from './lexer';
import { INFIX_WORDS, PREFIX_FUNCS, TRIG, inParens, isHeading, parseSpanned, type Node, type Spanned } from './parser';
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
  /** When the warning is an angle-mode mismatch, the mode to switch to with one tap. */
  switchAngle?: 'deg' | 'rad';
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
const POSTFIX = new Set(['!', '%', '°', 'ᵀ']);
const ANGLE_FUNCS = new Set(['deg', 'todeg', 'rad', 'torad']);
const NON_CALL_WORDS = new Set([...INFIX_WORDS, 'with', 'where', 'for', 'and', 'or', 'xor', 'of']);

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

  private _spanned?: Spanned | null;

  spanned(): Spanned | null {
    if (this._spanned === undefined) {
      try {
        this._spanned = parseSpanned(this.text);
      } catch {
        this._spanned = null;
      }
    }
    return this._spanned;
  }

  hasOpBetween(fromPos: number, toPos: number, op: string): boolean {
    return this.toks.some((t) => t.pos >= fromPos && t.pos < toPos && isOp(t, op));
  }

  prevTokenBefore(pos: number): Token | undefined {
    let prev: Token | undefined;
    for (const t of this.toks) {
      if (t.type === 'eof' || t.pos >= pos) break;
      prev = t;
    }
    return prev;
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
    // d/dx x^2 is a derivative, not a fraction that runs on.
    const over = l.toks[i - 1], under = l.toks[i + 1];
    if (over.type === 'ident' && over.value === 'd' && under?.type === 'ident' && /^d\p{L}/u.test(under.value)) continue;
    // 1/2x is 1/(2x), as Desmos reads it, while a TI reads x/2: say so and offer 1/2*x.
    const atom = l.afterPowered(i + 1);
    if (atom < 0 || !l.implicit(atom)) continue;
    let rest = atom;
    while (rest > 0 && l.implicit(rest)) rest = l.afterPowered(rest);
    if (rest < 0) continue;
    const below = brief(l.source(i + 1, atom));
    const after = brief(l.source(atom, rest));
    return {
      ...l.span(i + 1, rest),
      message: `${after} is under the fraction too. Put * before ${after} if only ${below} belongs below.`,
      fix: `${l.text.slice(0, l.end(atom - 1))}*${l.text.slice(l.toks[atom].pos)}`,
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
    // ∫_0^1 x dx: the 1 is the top of the integral, and x is what it covers.
    if (isOp(l.toks[i - 2], '_')) continue;
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

function walk(n: Node, visit: (node: Node) => boolean | void): boolean {
  if (visit(n)) return true;
  switch (n.k) {
    case 'un':
    case 'post':
    case 'abs':
      return walk(n.a, visit);
    case 'bin':
      return walk(n.a, visit) || walk(n.b, visit);
    case 'call':
      if (n.base && walk(n.base, visit)) return true;
      return n.args.some((a) => walk(a, visit));
    case 'point':
    case 'vec':
    case 'bracket':
    case 'list':
    case 'rel':
      return n.items.some((a) => walk(a, visit));
    case 'piece':
      return n.branches.some((b) => (b.cond ? walk(b.cond, visit) : false) || (b.val ? walk(b.val, visit) : false));
    default:
      return false;
  }
}

function nodeSpan(sp: Spanned, n: Node, expand = true): [number, number] | null {
  const raw = sp.spanOf(n);
  if (!raw) return null;
  let [s, e] = raw;
  const text = sp.text;
  while (e > s && text[e - 1] === ' ') e--;
  if (expand && inParens(n)) {
    for (;;) {
      let ls = s;
      while (ls > 0 && text[ls - 1] === ' ') ls--;
      let re = e;
      while (re < text.length && text[re] === ' ') re++;
      if (ls > 0 && text[ls - 1] === '(' && re < text.length && text[re] === ')') {
        s = ls - 1;
        e = re + 1;
      } else break;
    }
  }
  return e > s ? [s, e] : null;
}

function hasUnmarkedPi(n: Node): boolean {
  if (n.k === 'post' && n.op === '°') return false;
  if (n.k === 'call' && ANGLE_FUNCS.has(n.name)) return false;
  if (n.k === 'id' && n.name === 'π') return true;
  switch (n.k) {
    case 'un':
    case 'post':
    case 'abs':
      return hasUnmarkedPi(n.a);
    case 'bin':
      return hasUnmarkedPi(n.a) || hasUnmarkedPi(n.b);
    case 'call':
      return (n.base ? hasUnmarkedPi(n.base) : false) || n.args.some(hasUnmarkedPi);
    case 'point':
    case 'vec':
    case 'bracket':
    case 'list':
    case 'rel':
      return n.items.some(hasUnmarkedPi);
    case 'piece':
      return n.branches.some((b) => (b.cond ? hasUnmarkedPi(b.cond) : false) || (b.val ? hasUnmarkedPi(b.val) : false));
    default:
      return false;
  }
}

function fractionalPower(l: Line): LineWarning | null {
  if (!l.toks.some((t) => isOp(t, '^')) || !l.toks.some((t) => isOp(t, '/'))) return null;
  const sp = l.spanned();
  if (!sp) return null;
  const text = sp.text;
  let found: LineWarning | null = null;
  walk(sp.tree, (n) => {
    if (n.k !== 'bin' || n.op !== '/') return;
    if (n.a.k !== 'bin' || n.a.op !== '^' || inParens(n.a)) return;
    // Only offer the rewrite when the parsed denominator is a standalone integer (not 2^1/3^2, 2^1/3x, 2^1/3√4, etc.).
    if (n.b.k !== 'num' || inParens(n.b) || !Number.isInteger(n.b.v) || n.b.v <= 1) return;
    const expNode = n.a.b;
    const expAtom = expNode.k === 'un' && expNode.op === '-' && !inParens(expNode) ? expNode.a : expNode;
    if (inParens(expNode) || expAtom.k !== 'num' || inParens(expAtom) || !Number.isInteger(expAtom.v)) return;
    // Avoid false positives on ordinary algebraic terms like x^2/2 or v^2/2: warn for any ^1/n (nobody writes ^1 on
    // purpose) and for numeric bases with a non-integer fraction (9^1/2, 8^2/3, 4^3/2).
    const numBase = n.a.a.k === 'num' && !inParens(n.a.a);
    const unitExp = expAtom.v === 1;
    if (!unitExp && (!numBase || expAtom.v % n.b.v === 0)) return;
    const baseSpan = nodeSpan(sp, n.a.a);
    const expSpan = nodeSpan(sp, expNode);
    const denSpan = nodeSpan(sp, n.b);
    if (!baseSpan || !expSpan || !denSpan) return;
    if (!l.hasOpBetween(baseSpan[1], expSpan[0], '^') || !l.hasOpBetween(expSpan[1], denSpan[0], '/')) return;
    const baseSrc = brief(text.slice(baseSpan[0], baseSpan[1]));
    const expSrc = text.slice(expSpan[0], expSpan[1]);
    const denSrc = text.slice(denSpan[0], denSpan[1]);
    const divGlyph = text.slice(expSpan[1], denSpan[0]).trim() || '/';
    found = {
      start: expSpan[0],
      end: denSpan[1],
      message: `Only ${expSrc} is in the exponent, so this is (${baseSrc}^${expSrc})${divGlyph}${denSrc}. Use brackets for a fractional power.`,
      fix: `${text.slice(0, expSpan[0])}(${text.slice(expSpan[0], denSpan[1])})${text.slice(denSpan[1])}`,
    };
    return true;
  });
  return found;
}

function findBarePrefixArg(tree: Node, sp: Spanned, targetStart: number): [number, number] | null {
  let found: [number, number] | null = null;
  walk(tree, (n) => {
    if (n.k !== 'call' || !PREFIX_FUNCS.has(n.name) || n.args.length !== 1) return;
    const callSpan = nodeSpan(sp, n, false);
    const argSpan = nodeSpan(sp, n.args[0]);
    if (!callSpan || !argSpan) return;
    if (argSpan[0] === targetStart && !sp.text.slice(callSpan[0], argSpan[0]).includes('(')) {
      found = argSpan;
      return true;
    }
  });
  return found;
}

function stackedPower(l: Line): LineWarning | null {
  if (l.toks.filter((t) => isOp(t, '^')).length < 2) return null;
  const sp = l.spanned();
  if (!sp) return null;
  const text = sp.text;
  let found: LineWarning | null = null;
  walk(sp.tree, (n) => {
    if (n.k !== 'bin' || n.op !== '^') return;
    const midPow = n.b.k === 'un' && n.b.op === '-' && !inParens(n.b) ? n.b.a : n.b;
    if (midPow.k !== 'bin' || midPow.op !== '^' || inParens(midPow)) return;
    const baseSpan = nodeSpan(sp, n.a);
    const midStartSpan = nodeSpan(sp, n.b);
    const midAtomSpan = nodeSpan(sp, midPow.a);
    const topSpan = nodeSpan(sp, midPow.b);
    if (!baseSpan || !midStartSpan || !midAtomSpan || !topSpan) return;
    const midStart = midStartSpan[0];
    const midEnd = midAtomSpan[1];
    if (!l.hasOpBetween(baseSpan[1], midStart, '^') || !l.hasOpBetween(midEnd, topSpan[0], '^')) return;
    const baseSrc = brief(text.slice(baseSpan[0], baseSpan[1]));
    const midSrc = brief(text.slice(midStart, midEnd));
    const topSrc = brief(text.slice(topSpan[0], topSpan[1]));
    const bareArg = findBarePrefixArg(sp.tree, sp, baseSpan[0]);
    let fix: string;
    if (bareArg) {
      const inner = `(${text.slice(baseSpan[0], midEnd)})${text.slice(midEnd, bareArg[1])}`;
      fix = `${text.slice(0, bareArg[0])}(${inner})${text.slice(bareArg[1])}`;
    } else {
      const prev = l.prevTokenBefore(baseSpan[0]);
      const needsMul = prev?.type === 'ident' && !NON_CALL_WORDS.has(prev.value);
      if (needsMul) {
        const before = text.slice(0, baseSpan[0]).trimEnd();
        fix = `${before} * (${text.slice(baseSpan[0], midEnd)})${text.slice(midEnd)}`;
      } else {
        fix = `${text.slice(0, baseSpan[0])}(${text.slice(baseSpan[0], midEnd)})${text.slice(midEnd)}`;
      }
    }
    found = {
      start: baseSpan[0],
      end: topSpan[1],
      message: `Powers group from the right, so this is ${baseSrc}^(${midSrc}^${topSrc}). Use brackets for (${baseSrc}^${midSrc})^${topSrc}.`,
      fix,
    };
    return true;
  });
  return found;
}

function angleMode(l: Line, deg: boolean): LineWarning | null {
  if (!l.toks.some((t) => t.type === 'ident' && TRIG.has(t.value))) return null;
  const sp = l.spanned();
  if (!sp) return null;
  const text = sp.text;
  let found: LineWarning | null = null;
  walk(sp.tree, (n) => {
    if (n.k !== 'call' || !TRIG.has(n.name) || n.args.length !== 1) return;
    const arg = n.args[0];
    const callSpan = nodeSpan(sp, n, false);
    if (!callSpan) return;
    if (deg) {
      if (hasUnmarkedPi(arg)) {
        found = {
          start: callSpan[0],
          end: callSpan[1],
          message: 'Degrees are on, but π usually means radians. Check the Deg–Rad switch.',
          switchAngle: 'rad',
        };
        return true;
      }
    } else {
      const numNode = arg.k === 'un' && arg.op === '-' && !inParens(arg) ? arg.a : arg;
      if (numNode.k === 'num' && numNode.v >= 15 && numNode.v <= 360 && numNode.v % 15 === 0) {
        const argSpan = nodeSpan(sp, arg, false);
        if (!argSpan) return;
        found = {
          start: callSpan[0],
          end: callSpan[1],
          message: `Radians are on, and ${text.slice(argSpan[0], argSpan[1])} looks like degrees. Check the Deg–Rad switch.`,
          switchAngle: 'deg',
        };
        return true;
      }
    }
  });
  return found;
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
  // A LaTeX line is rewritten before it is read, so nothing here knows where on the typed line a token sits.
  if (!trimmed || isHeading(trimmed) || trimmed.includes('\\')) return [];
  const toks = tokens(trimmed);
  if (!toks) return [];
  const offset = text.length - text.trimStart().length;
  const lead = text.slice(0, offset);
  const trail = text.slice(offset + trimmed.length);
  const l = new Line(trimmed, toks);
  const found = [numbersSideBySide(l), negativePower(l), fractionalPower(l), stackedPower(l), divisionRunsOn(l), powerRunsOn(l), fractionInASum(l), angleMode(l, deg), functionWithoutBrackets(l)];
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
  if (!trimmed || trimmed.includes('\\')) return null;
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
