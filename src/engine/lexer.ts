import { CalcError } from './errors';

type TokType = 'num' | 'ident' | 'op' | 'str' | 'eof';

export interface Token {
  type: TokType;
  value: string;
  num?: number;
  pos: number;
}

const NAME_ALIASES: Record<string, string> = {
  pi: 'π',
  mu: 'μ',
  sigma: 'σ',
  theta: 'θ',
  phi: 'φ',
  alpha: 'α',
  beta: 'β',
  lambda: 'λ',
  tau: 'τ',
  infinity: 'inf',
  Infinity: 'inf',
  '∞': 'inf',
};

const CHAR_MAP: Record<string, string> = {
  '−': '-',
  '–': '-',
  '×': '*',
  '·': '*',
  '⋅': '*',
  '÷': '/',
  '≤': '<=',
  '≥': '>=',
};

/**
 * Functions that take one input without brackets: "sin 30" is sin(30), and so is "sin30". The parser reads the bare
 * input; the lexer needs the names to split "sin30" into sin and 30.
 */
export const PREFIX_FUNCS = new Set([
  'sin', 'cos', 'tan', 'csc', 'sec', 'cot',
  'asin', 'acos', 'atan', 'acsc', 'asec', 'acot',
  'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh',
  'ln', 'log', 'exp',
  'sqrt', 'cbrt', 'abs', 'floor', 'ceil', 'round', 'sign',
]);

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

/** Spaces that group digits: 1 000 000, also with the no-break and thin spaces that copied numbers carry. */
const GROUP_SPACES = new Set([' ', '\u00a0', '\u2009', '\u202f']);

/** The end of a run of space-separated three-digit groups starting at i (i itself when there's none). */
function digitGroups(src: string, i: number): number {
  while (GROUP_SPACES.has(src[i]) && /^\d{3}(?!\d)/.test(src.slice(i + 1, i + 5))) i += 4;
  return i;
}

const MULTI_OPS = ['<=', '>=', '**'];
const SINGLE_OPS = new Set('+-*/^!%°,()[]{}|=<>:⟨⟩√∛'.split(''));

const SUPERSCRIPTS: Record<string, string> = {
  '²': '2',
  '³': '3',
  '⁻': '-',
  '¹': '1',
  '⁰': '0',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
};

const TO_SUPERSCRIPT: Record<string, string> = {};
for (const [sup, plain] of Object.entries(SUPERSCRIPTS)) TO_SUPERSCRIPT[plain] = sup;

export function superscript(s: string): string {
  return [...s].map((c) => TO_SUPERSCRIPT[c] ?? c).join('');
}

function isIdentStart(ch: string): boolean {
  return /\p{L}/u.test(ch) && ch !== '√' && ch !== '∛';
}

export const isIdentifier = (s: string): boolean => /^[\p{L}][\p{L}\p{N}_]*$/u.test(s);

function isIdentPart(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch) && !(ch in SUPERSCRIPTS);
}

export function canonicalName(name: string): string {
  return Object.hasOwn(NAME_ALIASES, name) ? NAME_ALIASES[name] : name;
}

const isDigit = (c: number) => c >= 48 && c <= 57;
const isAsciiLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isGreek = (c: number) => c >= 0x370 && c <= 0x3ff;

function isSpace(src: string, i: number, c: number): boolean {
  if (c === 32 || (c >= 9 && c <= 13)) return true;
  return c > 127 && /\s/.test(src[i]);
}

function continuesName(src: string, i: number): boolean {
  const c = src.charCodeAt(i);
  if (c < 128) return isAsciiLetter(c) || isDigit(c) || c === 95;
  return !isGreek(c) && isIdentPart(src[i]);
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (isSpace(src, i, c)) {
      i++;
      continue;
    }
    let ch = src[i];
    if (c === 34 || ch === '“' || ch === '”') {
      const start = i;
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== '”' && src[j] !== '“') j++;
      if (j >= n) throw new CalcError('Text needs a closing quote, like "km"', start);
      out.push({ type: 'str', value: src.slice(i + 1, j), pos: start });
      i = j + 1;
      continue;
    }
    if (c > 127) {
      if (ch in CHAR_MAP) {
        out.push({ type: 'op', value: CHAR_MAP[ch], pos: i });
        i++;
        continue;
      }
      if (ch === '∞') {
        out.push({ type: 'ident', value: 'inf', pos: i });
        i++;
        continue;
      }
      if (ch in SUPERSCRIPTS) {
        let j = i;
        let exp = '';
        while (j < n && src[j] in SUPERSCRIPTS) {
          exp += SUPERSCRIPTS[src[j]];
          j++;
        }
        out.push({ type: 'op', value: '^', pos: i });
        if (exp.startsWith('-')) {
          out.push({ type: 'op', value: '-', pos: i });
          exp = exp.slice(1);
        }
        if (exp === '') throw new CalcError('Superscript minus needs a number after it', i);
        out.push({ type: 'num', value: exp, num: Number(exp), pos: i });
        i = j;
        continue;
      }
    }
    if (isDigit(c) || c === 46) {
      const start = i;
      let dot = false;
      while (i < n) {
        const d = src.charCodeAt(i);
        if (d === 46) {
          if (dot) break;
          dot = true;
        } else if (!isDigit(d)) break;
        i++;
      }
      // 1 000 000 is a million: a space before each group of exactly three digits groups them. 12 3 still multiplies.
      if (!dot && i - start <= 3) {
        const grouped = digitGroups(src, i);
        if (grouped > i) {
          i = grouped;
          if (src.charCodeAt(i) === 46) {
            dot = true;
            i++;
            while (i < n && isDigit(src.charCodeAt(i))) i++;
          }
        }
      }
      let s = src.slice(start, i).replace(/[ \u00a0\u2009\u202f]/g, '');
      if (s === '.') throw new CalcError('A lone "." is not a number', start);
      const e = src.charCodeAt(i);
      if (e === 101 || e === 69) {
        let j = i + 1;
        const sign = src.charCodeAt(j);
        if (sign === 43 || sign === 45) j++;
        if (isDigit(src.charCodeAt(j))) {
          while (j < n && isDigit(src.charCodeAt(j))) j++;
          s += 'e' + src.slice(i + 1, j);
          i = j;
        }
      }
      out.push({ type: 'num', value: s, num: Number(s), pos: start });
      // 5C2 and 5P2, as calculators print them: nCr and nPr between two whole numbers.
      const cp = src[i];
      if ((cp === 'C' || cp === 'P') && /^\d+$/.test(s) && isDigit(src.charCodeAt(i + 1))) {
        out.push({ type: 'ident', value: cp === 'C' ? 'nCr' : 'nPr', pos: i });
        i++;
      }
      continue;
    }
    if (c < 128 ? isAsciiLetter(c) : isIdentStart(ch)) {
      const start = i;
      i++;
      if (!isGreek(c)) {
        while (i < n && continuesName(src, i)) i++;
      } else {
        while (i < n && (src[i] === '_' || (src[i - 1] === '_' && /[\p{L}\p{N}]/u.test(src[i])))) i++;
      }
      let name = src.slice(start, i);
      // A one-input function typed against its number, or against x, reads as the spaced form: sin30 is sin 30, sqrt16
      // is sqrt 16, sinx is sin x. Digits right before a bracket stay in the name (atan2(y, x)), except after log:
      // log2(8) is log base 2, as log_2(8) is.
      const glued = /^([a-z]+)(?:\d|x$)/.exec(name);
      if (glued && PREFIX_FUNCS.has(glued[1])) {
        const fn = glued[1];
        let j = start + fn.length;
        while (isDigit(src.charCodeAt(j))) j++;
        let k = i;
        while (src[k] === ' ') k++;
        const call = j === i && src[k] === '(';
        if (call && fn === 'log') name = `log_${src.slice(start + fn.length, i)}`;
        else if (!call) {
          name = fn;
          i = start + fn.length;
        }
      }
      const sub = /^log([₀-₉]+)$/.exec(name);
      if (sub) name = `log_${[...sub[1]].map((d) => SUBSCRIPT_DIGITS.indexOf(d)).join('')}`;
      // log_0.5(4): the base can be a decimal.
      if (/^log_\d+$/.test(name) && src[i] === '.' && isDigit(src.charCodeAt(i + 1))) {
        const from = i;
        i++;
        while (isDigit(src.charCodeAt(i))) i++;
        name += src.slice(from, i);
      }
      out.push({ type: 'ident', value: canonicalName(name), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) {
      out.push({ type: 'op', value: two === '**' ? '^' : two, pos: i });
      i += 2;
      continue;
    }
    if (SINGLE_OPS.has(ch)) {
      out.push({ type: 'op', value: ch, pos: i });
      i++;
      continue;
    }
    ch = JSON.stringify(ch);
    throw new CalcError(`Unexpected character ${ch}`, i);
  }
  out.push({ type: 'eof', value: '', pos: n });
  return out;
}
