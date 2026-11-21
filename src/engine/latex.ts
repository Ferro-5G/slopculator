// Math copied out of Desmos, a textbook page or a chat arrives as LaTeX: \frac{1}{2}, \sqrt{x}, \left( \right), x_{1}.
// This rewrites it as the plain text the lexer reads. It only runs for a line that holds a backslash.

/** Commands that are a symbol or an operator in plain text. */
const SYMBOLS: Record<string, string> = {
  cdot: '*', times: '*', ast: '*', div: '/',
  le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=', lt: '<', gt: '>', ne: '≠', neq: '≠',
  sim: '~', to: '→', rightarrow: '→', pm: '±', infty: '∞', degree: '°',
  pi: 'π', mu: 'μ', sigma: 'σ', theta: 'θ', phi: 'φ', varphi: 'φ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', varepsilon: 'ε', lambda: 'λ', tau: 'τ', rho: 'ρ', omega: 'ω', eta: 'η', kappa: 'κ', nu: 'ν', xi: 'ξ', chi: 'χ', psi: 'ψ', zeta: 'ζ',
  Sigma: 'Σ', Pi: 'Π', Delta: 'Δ', Omega: 'Ω', Theta: 'Θ', Phi: 'Φ', Lambda: 'Λ', Gamma: 'Γ',
  sum: 'sum', prod: 'prod', int: 'int',
  lfloor: 'floor(', rfloor: ')', lceil: 'ceil(', rceil: ')', langle: '⟨', rangle: '⟩', lvert: '|', rvert: '|', vert: '|', mid: '|',
  lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']',
};

/** Commands that only space or size what follows, and say nothing. */
const SILENT = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'displaystyle', 'textstyle', 'quad', 'qquad', 'limits', 'nolimits', 'cdots', 'dots', 'ldots']);

/** Commands whose one group is plain text or a name: \operatorname{mean} is mean. */
const NAMING = new Set(['operatorname', 'mathrm', 'mathit', 'mathbf', 'mathsf', 'text', 'textrm', 'textbf', 'textit', 'mbox']);

class Reader {
  private i = 0;
  constructor(private src: string) {}

  /** The group at i, without its braces: {…} whole, or one command, or one character. */
  private group(): string {
    while (this.src[this.i] === ' ') this.i++;
    if (this.src[this.i] !== '{') {
      if (this.src[this.i] === '\\') return this.command();
      return this.src[this.i++] ?? '';
    }
    this.i++;
    return this.run(true);
  }

  /** Text up to the end, or inside a group up to the } that closes it. Read once, left to right. */
  private run(inGroup: boolean): string {
    let out = '';
    while (this.i < this.src.length) {
      const ch = this.src[this.i];
      if (ch === '\\') out += this.command();
      else if (inGroup && ch === '}') {
        this.i++;
        return out;
      } else if (inGroup && ch === '{') {
        // Braces that are the math's own, a list or a piecewise, stay as they are.
        this.i++;
        out += `{${this.run(true)}}`;
      } else {
        out += ch;
        this.i++;
      }
    }
    return out;
  }

  /** A [..] right after a command, as in \\sqrt[3]{8}, or null. */
  private option(): string | null {
    if (this.src[this.i] !== '[') return null;
    const end = this.src.indexOf(']', this.i);
    // An index is a number or a letter, so a long way to the ] means this [ opens something else.
    if (end < 0 || end - this.i > 40) return null;
    const inner = this.src.slice(this.i + 1, end);
    this.i = end + 1;
    return new Reader(inner).all();
  }

  /** The command whose backslash is at i. */
  private command(): string {
    this.i++;
    const ch = this.src[this.i];
    if (ch === undefined) return '';
    if (!/[A-Za-z]/.test(ch)) {
      this.i++;
      // \{ \} \% \| are the characters themselves; \, \; \! \: and "\ " are spaces.
      return '{}%|#&$_'.includes(ch) ? ch : ' ';
    }
    let j = this.i;
    while (j < this.src.length && /[A-Za-z]/.test(this.src[j])) j++;
    const name = this.src.slice(this.i, j);
    this.i = j;
    if (SILENT.has(name)) return name.endsWith('dots') ? '...' : '';
    if (NAMING.has(name)) return ` ${this.group()}`;
    switch (name) {
      case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': {
        const num = this.group(), den = this.group();
        // \frac{d}{dx} is the derivative sign, which the parser reads as d/dx.
        if (num.trim() === 'd' && /^d\p{L}$/u.test(den.trim())) return ` d/${den.trim()} `;
        return `((${num})/(${den}))`;
      }
      case 'binom': case 'dbinom': case 'tbinom': {
        const n = this.group(), k = this.group();
        return `nCr(${n},${k})`;
      }
      case 'sqrt': {
        const index = this.option();
        const body = this.group();
        return index === null ? `sqrt(${body})` : `nthroot(${body},${index})`;
      }
    }
    if (Object.hasOwn(SYMBOLS, name)) return SYMBOLS[name];
    // \sin, \ln, \log and any other word are the word: the lexer and the function list decide what it means.
    return ` ${name}`;
  }

  all(): string {
    return this.run(false);
  }
}

export function fromLatex(src: string): string {
  return new Reader(src).all();
}
