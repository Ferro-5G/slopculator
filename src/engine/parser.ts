import { CalcError, EMPTY_PARENS, ENDS_EARLY, unclosedText, unexpectedText, unmatchedText } from './errors';
import { lexedText, PREFIX_FUNCS, tokenize, type Token } from './lexer';
import { Lru } from './memo';

export type Node =
  /** s is the literal as typed, so exact math can read 9007199254740993 or 0.1 without the double's rounding. */
  | { k: 'num'; v: number; s?: string }
  | { k: 'str'; s: string }
  | { k: 'id'; name: string; pos: number }
  | { k: 'un'; op: '-'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^' | 'nCr' | 'nPr'; a: Node; b: Node }
  | { k: 'post'; op: '!' | '%' | '°'; a: Node }
  /** `dot`: written after a dot (P.x, A.h, d.cdf(1)), so the name may be a field of what it hangs off. */
  | { k: 'call'; name: string; args: Node[]; base?: Node; pos: number; dot?: boolean }
  | { k: 'point'; items: Node[] }
  | { k: 'vec'; items: Node[] }
  | { k: 'bracket'; items: Node[] }
  | { k: 'list'; items: Node[] }
  | { k: 'piece'; branches: { cond?: Node; val?: Node }[] }
  | { k: 'rel'; ops: RelOp[]; items: Node[] }
  | { k: 'abs'; a: Node };

/** ~ is a regression: y1 ~ m x1 + b fits m and b to the data. It stands alone on its line. */
export type RelOp = '=' | '<' | '>' | '<=' | '>=' | '!=' | '~';
const REL_OPS = new Set<string>(['=', '<', '>', '<=', '>=', '!=', '~']);

export { PREFIX_FUNCS };

export const TRIG = new Set(['sin', 'cos', 'tan', 'csc', 'sec', 'cot']);
/** Words written between their inputs, like 8 nCr 3 and 7 mod 3. "choose" is nCr. */
export const INFIX_WORDS = new Set(['nCr', 'nPr', 'choose', 'mod']);
/** Words that end an expression and start a clause: x^2 with x = 3, [n^2 for n = [1...5]]. */
const CLAUSE_WORDS = new Set(['with', 'where', 'for', 'and', 'or', 'xor']);
/** The logic words from loosest to tightest. */
const LOGIC_LEVELS = [['or'], ['xor'], ['and']];
/** The big operators written with bounds, sum_{n=1}^{10}, by the function each one is. */
const SERIES: Record<string, string> = { sum: 'sum', Σ: 'sum', prod: 'prod', Π: 'prod' };
/** dx, dt, dθ: the end of an integral, and the foot of d/dx. */
const DIFFERENTIAL = /^d(\p{L}(?:_[\p{L}\p{N}]+)?)$/u;
/** The name the derivative of f'(a) is taken along. It is bound inside the call, so it can't meet a name of the sheet's. */
const PRIME_VAR = 'x';

export const isHeading = (line: string): boolean => line.trimStart().startsWith('#');

/** Whether a product's last factor is a percent, so `of` can follow it: 10%, 2 × 10%, −10%. */
const endsInPercent = (n: Node): boolean =>
  (n.k === 'post' && n.op === '%') || (n.k === 'un' && endsInPercent(n.a)) || (n.k === 'bin' && n.op === '*' && endsInPercent(n.b));

class Parser {
  private i = 0;
  private absDepth = 0;
  /** How many [ ] the parser is inside. */
  private rows = 0;
  /** Tokens from here on read as the end of the line: an integral's body stops at its dx. */
  private limit: number;
  /** For each integral sign, by its token, the dx that closes it. Worked out once, the first time one is met. */
  private closers: Map<number, { at: number; head?: string; d: string }> | undefined;
  constructor(private toks: Token[], spans?: Map<Node, [number, number]>) {
    this.limit = toks.length - 1;
    if (!spans) return;
    // Each part's place in the text: the tokens its rule took, from the first one's start to where the next one starts.
    for (const rule of SPANNED) {
      const parse = this[rule].bind(this);
      this[rule] = () => {
        const from = this.i;
        const n = parse();
        if (!spans.has(n) && this.i > from) spans.set(n, [this.toks[from].pos, this.peek().pos]);
        return n;
      };
    }
  }

  private peek(o = 0): Token {
    const at = this.i + o;
    return at >= this.limit ? { type: 'eof', value: '', pos: this.toks[this.limit].pos } : this.toks[at];
  }
  private next(): Token {
    const t = this.peek();
    this.i++;
    return t;
  }

  /**
   * Pairs every integral sign with the dx that closes it, in one pass: a dx closes the nearest sign before it that is
   * still open inside the same brackets and the same argument. A sign left open takes a name whose tail is a dx (the
   * xdx of ∫ xdx), when one follows it.
   */
  private integralClosers(): Map<number, { at: number; head?: string; d: string }> {
    const out = new Map<number, { at: number; head?: string; d: string }>();
    const tail = new Map<number, { at: number; head: string; d: string }>();
    let open: number[] = [];
    const outer: number[][] = [];
    const settle = (signs: number[]): void => {
      for (const sign of signs) {
        const t = tail.get(sign);
        if (t) out.set(sign, t);
      }
    };
    for (let j = 0; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.type === 'op' && '([{'.includes(t.value)) {
        outer.push(open);
        open = [];
      } else if (t.type === 'op' && ')]}'.includes(t.value)) {
        settle(open);
        open = outer.pop() ?? [];
      } else if (t.type === 'op' && t.value === ',') {
        settle(open);
        open = [];
      } else if (t.type === 'ident') {
        if (t.value === 'int' || /^int_/.test(t.value)) open.push(j);
        else if (!open.length) continue;
        else if (DIFFERENTIAL.test(t.value)) out.set(open.pop()!, { at: j, d: DIFFERENTIAL.exec(t.value)![1] });
        else {
          const sign = open[open.length - 1];
          const m = tail.has(sign) ? null : /^(.+)d(\p{L})$/u.exec(t.value);
          const called = this.toks[j + 1]?.type === 'op' && this.toks[j + 1].value === '(';
          if (m && !called) tail.set(sign, { at: j, head: m[1], d: m[2] });
        }
      }
    }
    settle(open);
    return out;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.type === 'op' && t.value === v;
  }
  private expectOp(v: string, what: string): void {
    const t = this.peek();
    if (t.type === 'op' && t.value === v) {
      this.i++;
      return;
    }
    throw new CalcError(unclosedText(v, what, t.type === 'eof' ? null : t.value), t.pos);
  }

  parseAll(): Node {
    if (this.peek().type === 'eof') throw new CalcError('Empty expression', 0);
    let n = this.parseClause();
    // 5 → A stores 5 in A, as a TI does: it is A = 5.
    if (this.isOp('->')) {
      const arrow = this.next();
      const target = this.peek();
      if (target.type !== 'ident') throw new CalcError('→ needs a name to store into, like 5 → a', arrow.pos);
      this.i++;
      n = { k: 'rel', ops: ['='], items: [{ k: 'id', name: target.value, pos: target.pos }, n] };
    }
    const t = this.peek();
    if (t.type !== 'eof') {
      if (t.type === 'op' && (t.value === ')' || t.value === ']' || t.value === '}' || t.value === '⟩'))
        throw new CalcError(unmatchedText(t.value), t.pos);
      throw new CalcError(unexpectedText(t.value), t.pos);
    }
    return n;
  }

  /** Relations joined by and, or and xor: 1 < x and x < 3. and binds tightest and or loosest, so 1 or 0 and 0 is 1. */
  private parseLogic(level = 0): Node {
    const words = LOGIC_LEVELS[level];
    if (!words) return this.parseRelation();
    let n = this.parseLogic(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.type !== 'ident' || !words.includes(t.value)) return n;
      this.i++;
      n = { k: 'call', name: `_${t.value}`, args: [n, this.parseLogic(level + 1)], pos: t.pos };
    }
  }

  /** A relation and any with clause after it: a^2 with a = 5 works a^2 out with a as 5, whatever a is elsewhere. */
  private parseClause(): Node {
    let n = this.parseLogic();
    const t = this.peek();
    if (t.type === 'ident' && (t.value === 'with' || t.value === 'where')) {
      this.i++;
      const binds: [Node, Node][] = [];
      for (;;) {
        const name = this.next();
        if (name.type !== 'ident' || !this.isOp('=')) throw new CalcError(`${t.value} needs a name and a value, like ${t.value} a = 5`, name.pos);
        this.i++;
        binds.push([{ k: 'id', name: name.value, pos: name.pos }, this.parseAdditive()]);
        if (!this.isOp(',')) break;
        this.i++;
      }
      for (const [name, value] of binds.reverse()) n = { k: 'call', name: '_with', args: [n, name, value], pos: t.pos };
    }
    return n;
  }

  parseRelation(): Node {
    const first = this.parseAdditive();
    const ops: RelOp[] = [];
    const items: Node[] = [first];
    while (this.peek().type === 'op' && REL_OPS.has(this.peek().value)) {
      ops.push(this.next().value as RelOp);
      items.push(this.parseAdditive());
    }
    return ops.length ? { k: 'rel', ops, items } : first;
  }

  parseAdditive(): Node {
    let a = this.parseMul();
    for (;;) {
      if (this.isOp('+')) {
        this.i++;
        a = { k: 'bin', op: '+', a, b: this.parseMul() };
      } else if (this.isOp('-')) {
        this.i++;
        a = { k: 'bin', op: '-', a, b: this.parseMul() };
      } else return a;
    }
  }

  private startsImplicit(): boolean {
    const t = this.peek();
    if (t.type === 'num') return true;
    if (t.type === 'ident') return !INFIX_WORDS.has(t.value) && !CLAUSE_WORDS.has(t.value);
    if (t.type !== 'op') return false;
    if (t.value === '|') return this.absDepth === 0;
    return t.value === '(' || t.value === '[' || t.value === '{' || t.value === '√' || t.value === '∛' || t.value === '⟨';
  }

  parseMul(): Node {
    let a = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && t.value === '*') {
        this.i++;
        a = { k: 'bin', op: '*', a, b: this.parseUnary() };
      } else if (t.type === 'op' && t.value === '/') {
        this.i++;
        a = { k: 'bin', op: '/', a, b: this.parseBelow() };
      } else if (t.type === 'ident' && INFIX_WORDS.has(t.value)) {
        this.i++;
        const b = this.parseUnary();
        if (t.value === 'mod') a = { k: 'call', name: 'mod', args: [a, b], pos: t.pos };
        else a = { k: 'bin', op: t.value === 'choose' ? 'nCr' : (t.value as 'nCr' | 'nPr'), a, b };
      } else if (t.type === 'ident' && t.value === 'of' && endsInPercent(a)) {
        // 10% of 50 is 10% × 50, and so are 2 × 10% of 50 and −10% of 50 with their factor.
        this.i++;
        a = { k: 'bin', op: '*', a, b: this.parseUnary() };
      } else if (this.startsImplicit()) {
        // [[1, 2][3, 4]] is a matrix as a TI writes it: inside a bracket, a row follows a row. Rows of numbers never
        // multiply, while [[1, 2], [3, 4]][[5, 6], [7, 8]] is still a product of matrices.
        if (this.rows > 0 && a.k === 'bracket' && a.items.every((r) => r.k !== 'bracket') && this.isOp('[') && !(this.peek(1).type === 'op' && this.peek(1).value === '[')) return a;
        a = { k: 'bin', op: '*', a, b: this.parsePower() };
      } else return a;
    }
  }

  /**
   * What sits under a / : a product written without a sign stays together, as Desmos reads it, so 1/2x is 1/(2x) and
   * (−b + √d)/2a is over 2a. A written * or another / ends it: 1/2*x is x/2.
   */
  private parseBelow(): Node {
    let b = this.parseUnary();
    while (this.startsImplicit()) {
      if (this.rows > 0 && b.k === 'bracket' && b.items.every((r) => r.k !== 'bracket') && this.isOp('[') && !(this.peek(1).type === 'op' && this.peek(1).value === '[')) break;
      b = { k: 'bin', op: '*', a: b, b: this.parsePower() };
    }
    return b;
  }

  parseUnary(): Node {
    if (this.isOp('-')) {
      this.i++;
      return { k: 'un', op: '-', a: this.parseUnary() };
    }
    if (this.isOp('+')) {
      this.i++;
      return this.parseUnary();
    }
    return this.parsePower();
  }

  parsePower(): Node {
    const base = this.parsePostfix();
    if (this.isOp('^')) {
      this.i++;
      const exp = this.parseUnary();
      return { k: 'bin', op: '^', a: base, b: exp };
    }
    return base;
  }

  parsePostfix(): Node {
    let a = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && (t.value === '!' || t.value === '%' || t.value === '°')) {
        this.i++;
        a = { k: 'post', op: t.value as '!' | '%' | '°', a };
      } else if (t.type === 'op' && t.value === 'ᵀ') {
        this.i++;
        a = { k: 'call', name: 'transpose', args: [a], pos: t.pos };
      } else if (t.type === 'op' && t.value === '.') {
        // P.x is the point's x, and d.cdf(1) is cdf(d, 1): the part's name is a function of what it hangs off.
        this.i++;
        const part = this.next();
        if (part.type !== 'ident') throw new CalcError(unexpectedText('.'), t.pos);
        const name = part.value === 'x' || part.value === 'y' || part.value === 'z' ? `_${part.value}` : part.value;
        const rest = this.isOp('(') ? (this.i++, this.parseList(')', `${part.value}(`)) : [];
        a = { k: 'call', name, args: [a, ...rest], pos: part.pos, dot: true };
      } else if (t.type === 'op' && t.value === '[' && t.glued && (a.k === 'id' || a.k === 'call')) {
        // L[2] is the second item of L. A number against a bracket, 2[3, 4], still multiplies.
        this.i++;
        a = { k: 'call', name: '_item', args: [a, ...this.parseItems(']', '"["')], pos: t.pos };
      } else return a;
    }
  }

  private parseList(close: string, what: string): Node[] {
    const items: Node[] = [];
    if (this.isOp(close)) {
      this.i++;
      return items;
    }
    const savedAbs = this.absDepth;
    this.absDepth = 0;
    for (;;) {
      items.push(this.rangeFrom(this.parseClause()));
      if (this.isOp(',')) {
        this.i++;
        continue;
      }
      this.absDepth = savedAbs;
      this.expectOp(close, what);
      return items;
    }
  }

  /** first...last where one value could stand, as in sum(1...10) and {1...5}: the list from first to last. */
  private rangeFrom(first: Node): Node {
    if (!this.isOp('...')) return first;
    const dots = this.next();
    return { k: 'call', name: '_span', args: [first, this.parseAdditive()], pos: dots.pos };
  }

  /**
   * The inside of [ ] up to its close, where a range can stand: [1...5] counts by ones, [1, 3, ..., 9] by the step its
   * first two give, and [n^2 for n = [1...5]] works the expression out for each n. Each comes back as one item.
   */
  private parseItems(close: string, what: string): Node[] {
    const items: Node[] = [];
    if (this.isOp(close)) {
      this.i++;
      return items;
    }
    const savedAbs = this.absDepth;
    this.absDepth = 0;
    this.rows++;
    const finish = (out: Node[]): Node[] => {
      this.rows--;
      this.absDepth = savedAbs;
      this.expectOp(close, what);
      return out;
    };
    for (;;) {
      if (this.isOp('...')) {
        const dots = this.next();
        if (this.isOp(',')) this.i++;
        if (items.length < 1 || items.length > 2) throw new CalcError('A range needs a start, like [1...10] or [1, 3, ..., 9]', dots.pos);
        return finish([{ k: 'call', name: '_span', args: [...items, this.parseAdditive()], pos: dots.pos }]);
      }
      items.push(this.parseClause());
      if (items[items.length - 1].k === 'bracket' && this.isOp('[')) continue;
      const t = this.peek();
      if (t.type === 'ident' && t.value === 'for' && items.length === 1) {
        this.i++;
        const name = this.next();
        if (name.type !== 'ident' || !this.isOp('=')) throw new CalcError('for needs a name and a list, like [n^2 for n = [1...5]]', name.pos);
        this.i++;
        return finish([{ k: 'call', name: '_each', args: [items[0], { k: 'id', name: name.value, pos: name.pos }, this.parseAdditive()], pos: t.pos }]);
      }
      if (this.isOp(',')) {
        this.i++;
        continue;
      }
      if (this.isOp('...')) continue;
      return finish(items);
    }
  }

  /** A bound of a big operator: {…} or (…) as a group, or one term. */
  private parseBound(): Node {
    if (this.isOp('{')) {
      this.i++;
      const n = this.parseAdditive();
      this.expectOp('}', '"{"');
      return n;
    }
    if (this.isOp('-')) {
      this.i++;
      return { k: 'un', op: '-', a: this.parseBound() };
    }
    return this.parsePostfix();
  }

  /** sum_{n=1}^{10} n^2, after the _: the bounds, then the term they cover. */
  private parseSeries(fn: string, pos: number): Node {
    const open = this.next();
    const close = open.value === '{' ? '}' : ')';
    if (open.type !== 'op' || (open.value !== '{' && open.value !== '(')) throw new CalcError(`${fn} needs its start below it, like ${fn}_{n=1}^{10} n`, pos);
    const name = this.next();
    if (name.type !== 'ident' || !this.isOp('=')) throw new CalcError(`${fn} needs a name and a start, like ${fn}_{n=1}^{10} n`, name.pos);
    this.i++;
    const from = this.parseAdditive();
    this.expectOp(close, `"${open.value}"`);
    this.expectOp('^', `${fn}_{n=1}`);
    const to = this.parseBound();
    return { k: 'call', name: fn, args: [this.parseTerm(), { k: 'id', name: name.value, pos: name.pos }, from, to], pos };
  }

  /** What a prefix operator like d/dx or a sum covers: one product, with its sign. */
  private parseTerm(): Node {
    return this.parseMul();
  }

  /**
   * int_a^b … dx, after the lower bound: the upper bound, then everything up to the dx that closes it. Null, with
   * nothing read, when no dx closes it: int_rate^2 is then an ordinary name to a power.
   * @param sign the integral sign's token
   */
  private parseIntegral(sign: number, lo: Node, pos: number): Node | null {
    const closer = (this.closers ??= this.integralClosers()).get(sign);
    if (!closer || !this.isOp('^')) return null;
    const save = this.i;
    this.i++;
    const hi = this.parseBound();
    if (closer.at < this.i || closer.at >= this.limit || (closer.at === this.i && closer.head === undefined)) {
      this.i = save;
      return null;
    }
    // The body reads up to its dx as if the line ended there. A name that held the dx (xdx) is left as its head.
    const last = this.toks[closer.at];
    const end = closer.head === undefined ? closer.at : closer.at + 1;
    if (closer.head !== undefined) this.toks[closer.at] = { type: 'ident', value: closer.head, pos: last.pos };
    const outerLimit = this.limit;
    this.limit = end;
    const expr = this.parseAdditive();
    const stray = this.peek();
    this.limit = outerLimit;
    if (this.i !== end) throw new CalcError(unexpectedText(this.toks[this.i].value), stray.pos);
    this.i = closer.at + 1;
    return { k: 'call', name: 'integral', args: [expr, { k: 'id', name: closer.d, pos: last.pos }, lo, hi], pos };
  }

  /** Argument of a function written without parentheses: "sin 2x" is sin(2x), "sin x cos x" is sin(x)·cos(x). */
  private parseBareArg(): Node {
    // sin -30 is sin(−30): a minus right after a function name can only be the input's sign.
    if (this.isOp('-')) {
      this.i++;
      return { k: 'un', op: '-', a: this.parseBareArg() };
    }
    let a = this.parsePower();
    while (this.startsImplicit()) {
      const t = this.peek();
      if (t.type === 'ident' && PREFIX_FUNCS.has(t.value)) break;
      a = { k: 'bin', op: '*', a, b: this.parsePower() };
    }
    return a;
  }

  private parseCallArgs(name: string, pos: number, base?: Node): Node {
    if (this.isOp('(')) {
      this.i++;
      const args = this.parseList(')', `${name}(`);
      // int( is the whole-number part on a TI and an integral everywhere else: its inputs say which.
      if (name === 'int' && !base) {
        if (args.length === 1) return { k: 'call', name: 'floor', args, pos };
        if (args.length === 3) return { k: 'call', name: 'integral', args: [args[0], { k: 'id', name: 'x', pos }, args[1], args[2]], pos };
        if (args.length === 4) return { k: 'call', name: 'integral', args, pos };
      }
      return { k: 'call', name, args, base, pos };
    }
    if (PREFIX_FUNCS.has(name) && (this.startsImplicit() || this.isOp('-'))) {
      return { k: 'call', name, args: [this.parseBareArg()], base, pos };
    }
    if (base) throw new CalcError(`${name}_ needs an argument in parentheses`, pos);
    return { k: 'id', name, pos };
  }

  parsePrimary(): Node {
    const t = this.next();
    if (t.type === 'num') return { k: 'num', v: t.num!, s: t.value };
    if (t.type === 'str') return { k: 'str', s: t.value };
    if (t.type === 'ident') {
      const logBase = /^log_(.+)$/.exec(t.value);
      if (logBase) {
        const b = logBase[1];
        const base: Node = /^[0-9.]+$/.test(b) ? { k: 'num', v: Number(b), s: b } : { k: 'id', name: b, pos: t.pos + 4 };
        return this.parseCallArgs('log', t.pos, base);
      }
      if (Object.hasOwn(SERIES, t.value) && this.isOp('_')) {
        this.i++;
        return this.parseSeries(SERIES[t.value], t.pos);
      }
      // ∫_0^1 and int_{0}^{1} arrive as int and its bound; int_0^1 arrives as one name.
      const sign = this.i - 1;
      if (t.value === 'int' && this.isOp('_')) {
        const save = this.i;
        this.i++;
        const integral = this.parseIntegral(sign, this.parseBound(), t.pos);
        if (integral) return integral;
        this.i = save;
      }
      const intLow = /^int_(.+)$/.exec(t.value);
      if (intLow && this.isOp('^')) {
        const low = intLow[1];
        const lo: Node = /^[0-9.]+$/.test(low) ? { k: 'num', v: Number(low), s: low } : { k: 'id', name: low, pos: t.pos + 4 };
        const integral = this.parseIntegral(sign, lo, t.pos);
        if (integral) return integral;
      }
      // d/dx x^2: the derivative along x of the term after it.
      if (t.value === 'd' && this.isOp('/')) {
        const foot = this.peek(1);
        const along = foot.type === 'ident' ? DIFFERENTIAL.exec(foot.value) : null;
        if (along) {
          const save = this.i;
          this.i += 2;
          if (this.startsImplicit() || this.isOp('-')) {
            const v: Node = { k: 'id', name: along[1], pos: foot.pos };
            return { k: 'call', name: 'deriv', args: [this.parseTerm(), v, v], pos: t.pos };
          }
          this.i = save;
        }
      }
      // f'(2) is the slope of f at 2, and f''(2) the second derivative.
      if (this.isOp("'")) {
        let order = 0;
        while (this.isOp("'")) {
          this.i++;
          order++;
        }
        if (order > 2) throw new CalcError(`Only ${t.value}' and ${t.value}'' are worked out. For more, nest deriv(…)`, t.pos);
        if (!this.isOp('(')) throw new CalcError(`${t.value}' needs a point, like ${t.value}'(2)`, t.pos);
        this.i++;
        const at = this.parseList(')', `${t.value}'(`);
        if (at.length !== 1) throw new CalcError(`${t.value}' takes one input, like ${t.value}'(2)`, t.pos);
        const v: Node = { k: 'id', name: PRIME_VAR, pos: t.pos };
        return { k: 'call', name: order === 1 ? 'deriv' : 'deriv2', args: [{ k: 'call', name: t.value, args: [v], pos: t.pos }, v, at[0]], pos: t.pos };
      }
      if (TRIG.has(t.value) && this.isOp('^')) {
        const save = this.i;
        this.i++;
        let neg = false;
        if (this.isOp('-')) {
          neg = true;
          this.i++;
        }
        // sin^{-1}(x) and sin^{2}(x), whose braces the lexer turned into brackets.
        const grouped = !neg && this.isOp('(') && (this.peek(1).type === 'num' ? this.peek(2) : this.peek(1).type === 'op' && this.peek(1).value === '-' && this.peek(2).type === 'num' ? this.peek(3) : null);
        if (grouped && grouped.type === 'op' && grouped.value === ')') {
          this.i++;
          if (this.isOp('-')) {
            neg = true;
            this.i++;
          }
        }
        const n = this.peek();
        if (n.type === 'num') {
          this.i++;
          if (grouped) this.i++;
          const p = neg ? -n.num! : n.num!;
          if (p === -1) return this.parseCallArgs('a' + t.value, t.pos);
          const call = this.parseCallArgs(t.value, t.pos);
          if (call.k === 'call') return { k: 'bin', op: '^', a: call, b: { k: 'num', v: p } };
        }
        this.i = save;
      }
      return this.parseCallArgs(t.value, t.pos);
    }
    if (t.type === 'op') {
      switch (t.value) {
        case '(': {
          const items = this.parseList(')', '"("');
          if (items.length === 0) throw new CalcError(EMPTY_PARENS, t.pos);
          if (items.length === 1) {
            grouped.add(items[0]);
            return items[0];
          }
          if (items.length > 3) throw new CalcError('Points can have 2 or 3 coordinates', t.pos);
          return { k: 'point', items };
        }
        case '[': {
          const items = this.parseItems(']', '"["');
          // A range or a for is a list already, not a vector holding one.
          if (items.length === 1 && items[0].k === 'call' && (items[0].name === '_span' || items[0].name === '_each')) return items[0];
          return { k: 'bracket', items };
        }
        case '⟨':
          return { k: 'vec', items: this.parseList('⟩', '"⟨"') };
        case '{':
          return this.parseBrace(t.pos);
        case '|': {
          this.absDepth++;
          const a = this.parseAdditive();
          this.absDepth--;
          this.expectOp('|', '|…|');
          return { k: 'abs', a };
        }
        case '√':
        case '∛': {
          if (t.num !== undefined) return { k: 'call', name: 'nthroot', args: [this.rootArg(), { k: 'num', v: t.num }], pos: t.pos };
          return { k: 'call', name: t.value === '√' ? 'sqrt' : 'cbrt', args: [this.rootArg()], pos: t.pos };
        }
      }
    }
    if (t.type === 'eof') throw new CalcError(ENDS_EARLY, t.pos);
    throw new CalcError(unexpectedText(t.value), t.pos);
  }

  /** What √ or ∛ covers: a bracket group, or one term with its postfixes, after any minus signs (∛-8 is −2). */
  private rootArg(): Node {
    if (this.isOp('-')) {
      this.i++;
      return { k: 'un', op: '-', a: this.rootArg() };
    }
    return this.isOp('(') ? this.parsePrimary() : this.parsePostfix();
  }

  private parseBrace(pos: number): Node {
    const savedAbs = this.absDepth;
    this.absDepth = 0;
    const branches: { cond?: Node; val?: Node }[] = [];
    let piecewise = false;
    if (this.isOp('}')) {
      this.i++;
      this.absDepth = savedAbs;
      return { k: 'list', items: [] };
    }
    for (;;) {
      const first = this.rangeFrom(this.parseLogic());
      if (this.isOp(':')) {
        this.i++;
        piecewise = true;
        branches.push({ cond: first, val: this.parseLogic() });
      } else if (first.k === 'rel' && first.ops.every((o) => o !== '=')) {
        piecewise = true;
        branches.push({ cond: first });
      } else {
        branches.push({ val: first });
      }
      if (this.isOp(',')) {
        this.i++;
        continue;
      }
      break;
    }
    this.absDepth = savedAbs;
    this.expectOp('}', '"{"');
    // {1...5} is the list 1 to 5 itself, not a list holding it.
    if (!piecewise && branches.length === 1 && branches[0].val!.k === 'call' && branches[0].val!.name === '_span') return branches[0].val!;
    if (!piecewise) return { k: 'list', items: branches.map((b) => b.val!) };
    branches.forEach((b, idx) => {
      if (!b.cond && idx !== branches.length - 1)
        throw new CalcError('In {condition: value, …} only the last part can skip its condition', pos);
    });
    return { k: 'piece', branches };
  }
}

/** The rules whose parts get a span. Together they make every operation, call and bracket. */
const SPANNED = ['parseRelation', 'parseAdditive', 'parseMul', 'parseBelow', 'parseUnary', 'parsePower', 'parsePostfix', 'parsePrimary'] as const;

/** A line's tree with where each part was typed. */
export interface Spanned {
  tree: Node;
  /** The text the lexer read (a LaTeX line's plain rewrite), which the spans index. */
  text: string;
  /**
   * Where a part was typed: from its first character to where the next token starts (so it can end in spaces).
   * Parentheses round a part aren't in its span. Undefined for parts the parser made up, such as the fraction ½ is.
   */
  spanOf(n: Node): readonly [number, number] | undefined;
}

/**
 * A fresh tree for a line, with every part's place in the text, for whoever shows parts of a line on their own (a
 * line's steps). Tracking places costs time, so parse() doesn't, and this isn't memoized. Throws as parse() does.
 */
export function parseSpanned(src: string): Spanned {
  const spans = new Map<Node, [number, number]>();
  const tree = new Parser(tokenize(src), spans).parseAll();
  return {
    tree,
    text: lexedText(src),
    spanOf: (n) => {
      const s = spans.get(n);
      return s && s[1] > s[0] ? s : undefined;
    },
  };
}

const grouped = new WeakSet<Node>();
/**
 * Whether a part was typed inside its own parentheses. They change nothing a line works out, so the tree doesn't
 * carry them. A regression asks, because (mx1)^2 squares the whole product and mx1^2 only x1.
 */
export const inParens = (n: Node): boolean => grouped.has(n);

const parsed = new Lru<string, Node | CalcError>(2000);

/**
 * Syntax tree for a line. Trees are never mutated after parsing, so the same text shares one tree (and one
 * error) across evaluations; that also lets later stages cache by node.
 */
export function parse(src: string): Node {
  let hit = parsed.get(src);
  if (hit === undefined) {
    try {
      hit = new Parser(tokenize(src)).parseAll();
    } catch (e) {
      if (!(e instanceof CalcError)) throw e;
      hit = e;
    }
    parsed.set(src, hit);
  }
  if (hit instanceof CalcError) throw new CalcError(hit.message, hit.pos);
  return hit;
}
