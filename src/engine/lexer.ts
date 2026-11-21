import { CalcError } from './errors';
import { fromLatex } from './latex';

type TokType = 'num' | 'ident' | 'op' | 'str' | 'eof';

export interface Token {
  type: TokType;
  value: string;
  num?: number;
  pos: number;
  /** On a [: nothing but the bracket separates it from what came before, as in L[2]. */
  glued?: boolean;
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
  infty: 'inf',
  // A TI's Ans key. One name everywhere, so whatever asks whether a line reads the answer above sees that it does.
  Ans: 'ans',
  ANS: 'ans',
  '∞': 'inf',
};

const CHAR_MAP: Record<string, string> = {
  '−': '-',
  '–': '-',
  '×': '*',
  '·': '*',
  '⋅': '*',
  '∙': '*',
  '•': '*',
  '∗': '*',
  '÷': '/',
  '⁄': '/',
  '∕': '/',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '→': '->',
  '∼': '~',
  '′': "'",
  '’': "'",
  '…': '...',
  'ᵀ': 'ᵀ',
};

/** The big operators, by the function each one is. */
const BIG_OPS: Record<string, string> = { '∑': 'sum', '∏': 'prod', '∫': 'int' };

/** One-character fractions, as [numerator, denominator]. */
const VULGAR: Record<string, [number, number]> = {
  '½': [1, 2], '⅓': [1, 3], '⅔': [2, 3], '¼': [1, 4], '¾': [3, 4], '⅕': [1, 5], '⅖': [2, 5], '⅗': [3, 5], '⅘': [4, 5],
  '⅙': [1, 6], '⅚': [5, 6], '⅐': [1, 7], '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8], '⅑': [1, 9], '⅒': [1, 10],
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

const MULTI_OPS = ['<=', '>=', '**', '==', '->', '..', ':=', '<>', '=<', '=>'];
/** Other spellings of an operator. */
const SAME_OP: Record<string, string> = { '**': '^', '==': '=', '..': '...', ':=': '=', '<>': '!=', '=<': '<=', '=>': '>=' };
const SINGLE_OPS = new Set('+-*/^!%°,()[]{}|=<>:⟨⟩√∛~\'ᵀ'.split(''));

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

/** For each { in the text, the index of the } that closes it. One pass, whatever the nesting. */
function matchBraces(src: string): Map<number, number> {
  const out = new Map<number, number>();
  const open: number[] = [];
  for (let j = 0; j < src.length; j++) {
    if (src[j] === '{') open.push(j);
    else if (src[j] === '}' && open.length) out.set(open.pop()!, j);
  }
  return out;
}

/** The text the lexer reads for a line: a line that holds a backslash is LaTeX, read as its plain rewrite. */
export const lexedText = (src: string): string => (src.includes('\\') ? fromLatex(src) : src);

export function tokenize(src: string): Token[] {
  src = lexedText(src);
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  let braces: Map<number, number> | undefined;
  while (i < n) {
    const c = src.charCodeAt(i);
    // $ is money's sign or LaTeX's wrapper, and neither changes the math: $5 + $3, $x^2$.
    if (isSpace(src, i, c) || c === 36) {
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
      if (ch in BIG_OPS) {
        out.push({ type: 'ident', value: BIG_OPS[ch], pos: i });
        i++;
        if (src[i] === '_') {
          out.push({ type: 'op', value: '_', pos: i });
          i++;
        }
        continue;
      }
      if (ch in VULGAR) {
        const [top, bottom] = VULGAR[ch];
        // 1½ is one and a half: a whole number right against the fraction adds to it.
        const whole = out[out.length - 1];
        const mixed = whole?.type === 'num' && /^\d+$/.test(whole.value) && src[i - 1] !== ' ' ? out.pop()! : null;
        const op = (value: string): Token => ({ type: 'op', value, pos: i });
        const numTok = (v: number): Token => ({ type: 'num', value: String(v), num: v, pos: i });
        out.push(op('('), ...(mixed ? [mixed, op('+')] : []), numTok(top), op('/'), numTok(bottom), op(')'));
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
        // ⁻5 is negative five on a TI, whose negative sign sits high.
        if (exp === '-' && j < n && (isDigit(src.charCodeAt(j)) || src[j] === '.')) {
          out.push({ type: 'op', value: '-', pos: i });
          i = j;
          continue;
        }
        // ³√8 is a cube root: the raised number is the root's index.
        if (src[j] === '√' && /^\d+$/.test(exp)) {
          out.push({ type: 'op', value: '√', num: Number(exp), pos: i });
          i = j + 1;
          continue;
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
    if (c === 46) {
      // 1...5 and 1..5 are ranges, and so is the … character.
      if (src[i + 1] === '.') {
        const len = src[i + 2] === '.' ? 3 : 2;
        out.push({ type: 'op', value: '...', pos: i });
        i += len;
        continue;
      }
      // P.x and normaldist(0, 1).cdf(1): a dot between a value and a name reads a part of it.
      const before = out[out.length - 1];
      const afterValue = i > 0 && !isSpace(src, i - 1, src.charCodeAt(i - 1)) && before !== undefined && (before.type === 'ident' || (before.type === 'op' && (before.value === ')' || before.value === ']' || before.value === '}')));
      if (afterValue && i + 1 < n && isIdentStart(src[i + 1])) {
        out.push({ type: 'op', value: '.', pos: i });
        i++;
        continue;
      }
    }
    // 0x1F and 0b101, as code writes sixteen's and two's digits.
    if (c === 48) {
      const based = /^0(?:[xX]([0-9a-fA-F]+)|[bB]([01]+))(?![\p{L}\p{N}_.])/u.exec(src.slice(i, i + 60));
      if (based) {
        // The token's text is the exact whole number, so exact math reads 0x20000000000001 past the double's 2^53.
        const v = BigInt(based[1] ? `0x${based[1]}` : `0b${based[2]}`);
        out.push({ type: 'num', value: v.toString(), num: Number(v), pos: i });
        i += based[0].length;
        continue;
      }
    }
    if (isDigit(c) || c === 46) {
      const start = i;
      let dot = false;
      while (i < n) {
        const d = src.charCodeAt(i);
        if (d === 46) {
          if (dot || src[i + 1] === '.') break;
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
      // 3ᴇ5 is how a TI prints 3 × 10⁵.
      if (e === 101 || e === 69 || src[i] === 'ᴇ') {
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
    // χ²cdf( is how a TI names the chi-square functions.
    if ((ch === 'χ' || ch === 'X') && src[i + 1] === '²') {
      const kind = /^(cdf|pdf)/.exec(src.slice(i + 2, i + 5));
      if (kind) {
        out.push({ type: 'ident', value: `chi2${kind[1]}`, pos: i });
        i += 5;
        continue;
      }
    }
    // unit circle(θ) is unitcircle(θ): the two words before a bracket name the one function.
    if (ch === 'u' && src.startsWith('unit', i) && !continuesName(src, i + 4) && (i === 0 || !continuesName(src, i - 1))) {
      const m = /^unit[ \t]+circle(?=\s*\()/.exec(src.slice(i, i + 40));
      if (m) {
        out.push({ type: 'ident', value: 'unitcircle', pos: i });
        i += m[0].length;
        continue;
      }
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
      // x_{1} is x_1 and a_{max} is a_max, as LaTeX writes a subscript. A subscript that isn't a plain name or number
      // belongs to a big operator, sum_{n=1}^{10}: the name ends before it, and the parser reads the bounds.
      let bound = false;
      if (name.endsWith('_') && (src[i] === '{' || src[i] === '(')) {
        const close = src[i] === '{' ? (braces ??= matchBraces(src)).get(i) ?? -1 : -1;
        const inner = close < 0 ? '' : src.slice(i + 1, close).trim();
        if (/^[\p{L}\p{N}]+(\.\d+)?$/u.test(inner) && (name.startsWith('log') || !inner.includes('.'))) {
          name += inner;
          i = close + 1;
        } else {
          name = name.slice(0, -1);
          bound = name.length > 0;
        }
      }
      if (name) out.push({ type: 'ident', value: canonicalName(name), pos: start });
      if (bound) out.push({ type: 'op', value: '_', pos: i - 1 });
      continue;
    }
    // 1 != 2 is "not equal". Against its number, 5!=120 is still five factorial, equal to 120.
    if (ch === '!' && src[i + 1] === '=' && src[i + 2] !== '=' && i > 0 && isSpace(src, i - 1, src.charCodeAt(i - 1))) {
      out.push({ type: 'op', value: '!=', pos: i });
      i += 2;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) {
      out.push({ type: 'op', value: SAME_OP[two] ?? two, pos: i });
      i += 2;
      continue;
    }
    if (SINGLE_OPS.has(ch)) {
      const tok: Token = { type: 'op', value: ch, pos: i };
      if (ch === '[' && i > 0 && !isSpace(src, i - 1, src.charCodeAt(i - 1))) tok.glued = true;
      out.push(tok);
      i++;
      continue;
    }
    ch = JSON.stringify(ch);
    throw new CalcError(`Unexpected character ${ch}`, i);
  }
  out.push({ type: 'eof', value: '', pos: n });
  groupExponents(out);
  return out;
}

/** 2^{10} is 2^(10): braces right after ^ group the exponent, as LaTeX writes it. One pass, whatever the nesting. */
function groupExponents(toks: Token[]): void {
  const open: { at: number; exponent: boolean }[] = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type !== 'op') continue;
    if (t.value === '{') open.push({ at: k, exponent: k > 0 && toks[k - 1].type === 'op' && toks[k - 1].value === '^' });
    else if (t.value === '}') {
      const o = open.pop();
      if (o?.exponent) {
        toks[o.at] = { ...toks[o.at], value: '(' };
        toks[k] = { ...t, value: ')' };
      }
    }
  }
}
