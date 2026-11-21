// The engine's own message stays the record: show it as the title or accessibility text, and keep matching on it.

import { readError, varErrorText, type ErrorForm } from '../engine/errors';
import { lineDefines } from '../engine/document';
import { unitKind, unitPhrase } from '../engine/units';
import { CLOSERS, OPENERS, TYPED_CLOSERS, TYPED_OPENERS } from './brackets';
import { escapeRegExp } from './text';

const unknownName = (error: string): string | null => {
  const form = readError(error);
  return form.k === 'unknown' ? form.name : null;
};

export const isStrayComma = (error: string | undefined): boolean => {
  if (!error) return false;
  const form = readError(error);
  return form.k === 'unexpected' && form.token === ',';
};

function notDefinedText(form: ErrorForm): string | null {
  if (form.k === 'inVar') {
    const inner = notDefinedText(form.inner);
    return inner && varErrorText(form.name, inner);
  }
  if (form.k !== 'unknown' || form.example === null) return null;
  return `${form.name} isn't defined.${form.hint ? ` Did you mean ${form.hint}?` : ''} Define it on its own line, like ${form.example}`;
}

export function friendlyError(message: string): string {
  const form = readError(message);
  switch (form.k) {
    case 'unclosed': {
      const { close, what, got } = form;
      const before = got === null ? '' : ` before ${got}`;
      if (/^[^"\s|].*\($/.test(what)) return got === null ? `${what} is missing a ${close}` : `${what} needs a ${close}${before}`;
      if (what === '|…|') return `Missing closing |${before}`;
      return `Missing ${close}${before}`;
    }
    case 'unmatched':
      return `Extra ${form.token}`;
    case 'unexpected': {
      const t = form.token;
      if (CLOSERS.includes(t)) return `Something's missing before ${t}`;
      if (t !== ',' && !OPENERS.includes(t) && !/^[\p{L}\p{N}_.]/u.test(t)) return `${t} needs something before it`;
      return message;
    }
    case 'endsEarly':
      return UNFINISHED_HINT;
    case 'emptyParens':
      return 'Empty ( )';
    default:
      return notDefinedText(form) ?? message;
  }
}

export interface LineFix {
  label: string;
  title: string;
  text: string;
}

const SHORT_MAX = 14;
const short = (s: string) => (s.length > SHORT_MAX ? `${s.slice(0, SHORT_MAX - 1)}…` : s);

export function ansFix(text: string, error: string): LineFix | null {
  const m = /^\s*([*×·/÷^])\s*(\S.*)$/.exec(text);
  if (!m || readError(error).k !== 'unexpected') return null;
  const op = m[1], shown = '*×·'.includes(op) ? '×' : '/÷'.includes(op) ? '÷' : '^';
  const line = `ans${text.trim()}`;
  return { label: `Use ans ${shown} ${short(m[2].trim())}`, title: `Go on from the answer above: ${line}`, text: line };
}

export function percentileFix(text: string, error: string): LineFix | null {
  const form = readError(error);
  if (form.k !== 'arity' || form.name !== 'percentile' || form.inputs !== '2') return null;
  const m = /\bpercentile\(\s*(\d*\.?\d+)\s*\)/.exec(text);
  if (!m || !(Number(m[1]) > 0 && Number(m[1]) < 1)) return null;
  return { label: `Use invNorm(${m[1]})`, title: `The normal percentile: the z with ${m[1]} of the area below it`, text: text.replace(m[0], `invNorm(${m[1]})`) };
}

const plainNum = (s: string) => s.replace(/,/g, '');

export function unitFix(text: string, isUnit: (name: string) => boolean): LineFix | null {
  const line = unitPhrase(text, isUnit);
  return line === null ? null : { label: `Use ${line}`, title: `Units go in convert(): ${line}`, text: line };
}

export function thousandsFix(text: string, error: string): LineFix | null {
  if (!isStrayComma(error)) return null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { const j = text.indexOf('"', i + 1); i = j < 0 ? text.length : j; continue; }
    if (TYPED_OPENERS.includes(c)) depth++;
    else if (TYPED_CLOSERS.includes(c)) depth--;
    else if (depth === 0 && /\d/.test(c) && !/[\w.]/.test(text[i - 1] ?? '')) {
      const m = /^\d{1,3}(?:,\d{3})+(?![\d,])/.exec(text.slice(i));
      if (m) {
        const plain = m[0].replace(/,/g, '');
        return { label: `Use ${plain}`, title: `Commas don't group digits: ${m[0]} is ${plain}`, text: text.slice(0, i) + plain + text.slice(i + m[0].length) };
      }
      while (/\d/.test(text[i + 1] ?? '')) i++;
    }
  }
  return null;
}

function sameKindFix(text: string): LineFix | null {
  const m = /^\s*(-?(?:\d[\d,]*(?:\.\d*)?|\.\d+))\s*([A-Za-zµ°][\w/²³°]*)\s*([+\-−])\s*((?:\d[\d,]*(?:\.\d*)?|\.\d+))\s*([A-Za-zµ°][\w/²³°]*)\s*$/.exec(text);
  if (!m) return null;
  const [, a, ua, op, b, ub] = m;
  const k = unitKind(ua);
  if (!k || k !== unitKind(ub)) return null;
  const line = `${plainNum(a)} ${op === '+' ? '+' : '-'} convert(${plainNum(b)}, "${ub}", "${ua}")`;
  return { label: `Use ${line}`, title: `Put both in one unit (${ua}): ${line}`, text: line };
}

// Tried only where a number can start. A global regex retried at every digit of a run with no unit after it, and
// inQuotes counted quotes from the start for each match, so a long line took seconds.
const NUMBER_UNIT = /(\d[\d,]*(?:\.\d*)?|\.\d+)\s*([A-Za-zµ°][\w/²³°]*)/y;
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
// Inside a run like 1,250 a match from the run's first digit already covers every later start.
const midNumber = (text: string, i: number): boolean => isDigit(text[i - 1]) || (text[i - 1] === ',' && isDigit(text[i - 2]));

function mixedUnitKinds(text: string): { a: string; b: string; op: 'added' | 'subtracted' } | null {
  const found: { kind: string; end: number; start: number }[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    if (!(text[i] === '.' || (isDigit(text[i]) && !midNumber(text, i)))) continue;
    NUMBER_UNIT.lastIndex = i;
    const m = NUMBER_UNIT.exec(text);
    if (!m) continue;
    const k = unitKind(m[2]);
    if (k && !quoted) found.push({ kind: k, start: i, end: i + m[0].length });
    // Quotes inside the match count too, as the scan from the start used to count them.
    for (let j = i + 1; j < i + m[0].length; j++) if (text[j] === '"') quoted = !quoted;
    i += m[0].length - 1;
  }
  for (let i = 1; i < found.length; i++) {
    const between = text.slice(found[i - 1].end, found[i].start);
    const op = /^\s*([+\-−])\s*$/.exec(between)?.[1];
    if (op && found[i].kind !== found[i - 1].kind) return { a: found[i - 1].kind, b: found[i].kind, op: op === '+' ? 'added' : 'subtracted' };
  }
  return null;
}

function unitMessage(text: string, error: string, isUnit: (name: string) => boolean, other: (name: string) => string | null = () => null): string | null {
  const u = unknownName(error);
  if (!u || !isUnit(u)) return null;
  const mixed = mixedUnitKinds(text);
  if (mixed) return `${mixed.a[0].toUpperCase()}${mixed.a.slice(1)} and ${mixed.b} can't be ${mixed.op}`;
  const same = sameKindFix(text);
  if (same) return `Put both in one unit: ${same.text}`;
  const fix = unitFix(text, isUnit);
  if (fix) return `Units go in convert(): ${fix.text}`;
  const value = numberBeforeUnit(text, u);
  if (value === null) return null;
  const to = other(u);
  return to ? `${u} looks like a unit. Units go in convert(), like convert(${plainNum(value)}, "${u}", "${to}")` : `${u} looks like a unit. Units go in convert(value, "${u}", "unit")`;
}

/**
 * The number written before the first use of unit u that has one, as /(-?\d[\d,.]*)\s*u(?!\w)/ finds it. That regex
 * retried at every digit of a long run, so this finds u and reads back from it instead.
 */
function numberBeforeUnit(text: string, u: string): string | null {
  const after = new RegExp(`${escapeRegExp(u)}(?![\\w])`, 'g');
  for (let m; (m = after.exec(text)); ) {
    let end = m.index;
    while (end > 0 && /\s/.test(text[end - 1])) end--;
    let start = end;
    while (start > 0 && /[\d,.]/.test(text[start - 1])) start--;
    while (start < end && !isDigit(text[start])) start++;
    if (start < end) return text.slice(text[start - 1] === '-' ? start - 1 : start, end);
  }
  return null;
}

export function inQuotes(text: string, at: number): boolean {
  let open = false;
  for (let i = 0; i < at && i < text.length; i++) if (text[i] === '"') open = !open;
  return open;
}

export function errorFixes(text: string, error: string, isUnit: (name: string) => boolean): LineFix[] {
  const out: LineFix[] = [];
  const thousands = thousandsFix(text, error);
  if (thousands) return [thousands];
  const same = sameKindFix(text);
  if (same && unknownName(error)) return [same];
  const pct = percentileFix(text, error);
  if (pct) out.push(pct);
  const ans = ansFix(text, error);
  if (ans) out.push(ans);
  const unit = mixedUnitKinds(text) ? null : unitFix(text, isUnit);
  if (unit) out.push(unit);
  const form = readError(error);
  const hinted = form.k === 'unknown' && form.hint !== null ? /^([A-Za-z_]\w*)(?:\(…\))?$/.exec(form.hint) : null;
  if (form.k === 'unknown' && hinted && !unit && !unitMessage(text, error, isUnit)) {
    const typo = form.name;
    const fix = hinted[1];
    const re = new RegExp(`(^|[^A-Za-z0-9_"])${escapeRegExp(typo)}(?![A-Za-z0-9_])`);
    const hit = re.exec(text);
    if (hit && !inQuotes(text, hit.index + hit[1].length)) out.push({ label: `Use ${fix}`, title: `Replace ${typo} with ${fix}`, text: text.replace(re, `$1${fix}`) });
  }
  return out;
}

export function lineErrorText(text: string, error: string, isUnit: (name: string) => boolean, other?: (name: string) => string | null): string {
  const thousands = thousandsFix(text, error);
  if (thousands) return `Commas don't group digits here, so this reads as two numbers. ${thousands.title.split(': ')[1]}.`;
  return unitMessage(text, error, isUnit, other) ?? friendlyError(error);
}

const innermost = (form: ErrorForm): ErrorForm => (form.k === 'inVar' ? innermost(form.inner) : form);

export function isUnfinished(error: string): boolean {
  const form = readError(error);
  const cause = innermost(form);
  return form.k === 'endsEarly' || form.k === 'emptyParens' || (form.k === 'unclosed' && form.got === null) || (cause.k === 'arity' && cause.got === 0);
}

export function leadingOperator(text: string, error: string): boolean {
  const form = readError(error);
  return form.k === 'unexpected' && /^[*/^×÷+]$/.test(form.token) && /^\s*[*/^×÷+]/.test(text);
}

export function calmWhileTyping(text: string, error: string, caret?: number): boolean {
  if (isUnfinished(error)) return true;
  if (leadingOperator(text, error)) return true;
  const form = readError(error);
  return form.k === 'unexpected' && /^[)\]}]$/.test(form.token) && caret !== undefined && /^[\s)\]}]+$/.test(text.slice(caret)) && /[+\-*/^×÷(,=]\s*$/.test(text.slice(0, caret));
}

export function spokenError(text: string, error: string, calm: boolean, isUnit: (name: string) => boolean, other?: (name: string) => string | null): string {
  if (calm) {
    const offer = leadingOperator(text, error) ? errorFixes(text, error, isUnit)[0] : undefined;
    return offer ? `going on from the line above? ${offer.label}` : UNFINISHED_HINT;
  }
  return `error. ${lineErrorText(text, error, isUnit, other)}`;
}

export const UNFINISHED_HINT = 'Unfinished: add what comes next';

/**
 * An error short enough for a step's box or a block's row, from its form (never its wording): "Not real" for a root
 * of a negative number, "÷ 0" for a division by zero, "q isn't defined", and the engine's own text for anything else.
 */
export function shortError(form: ErrorForm, text: string): string {
  switch (form.k) {
    case 'notReal': return 'Not real';
    case 'divZero': return '÷ 0';
    case 'logDomain': return `${form.name} of ≤ 0`;
    case 'inVar': return `${form.name}: ${shortError(form.inner, '')}`.replace(/: $/, ' fails');
    case 'unknown': return `${form.name} isn't defined`;
    default: return text;
  }
}

/**
 * What a line shows for its error, short and whole (never cut off): the short form where there is one (a line's
 * own definition unwrapped, so r = √−3 says "Not real", not "r has an error"), else the line's plain words
 * (lineErrorText). The engine's full text goes in its title, for hover, focus or a tap.
 */
export function shortLineError(text: string, error: string, isUnit: (name: string) => boolean, other?: (name: string) => string | null): string {
  const said = lineErrorText(text, error, isUnit, other);
  if (thousandsFix(text, error) || unitMessage(text, error, isUnit, other)) return said;
  let form = readError(error);
  if (form.k === 'inVar' && form.name === lineDefines(text)) form = form.inner;
  return form.k === 'notReal' || form.k === 'divZero' || form.k === 'logDomain' || form.k === 'unknown' || form.k === 'inVar' ? shortError(form, said) : said;
}
