import { CalcError, EMPTY_PARENS, ENDS_EARLY, unclosedText, unexpectedText, unmatchedText } from './errors';
import { PREFIX_FUNCS, tokenize, type Token } from './lexer';
import { Lru } from './memo';

export type Node =
  /** s is the literal as typed, so exact math can read 9007199254740993 or 0.1 without the double's rounding. */
  | { k: 'num'; v: number; s?: string }
  | { k: 'str'; s: string }
  | { k: 'id'; name: string; pos: number }
  | { k: 'un'; op: '-'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^' | 'nCr' | 'nPr'; a: Node; b: Node }
  | { k: 'post'; op: '!' | '%' | '°'; a: Node }
  | { k: 'call'; name: string; args: Node[]; base?: Node; pos: number }
  | { k: 'point'; items: Node[] }
  | { k: 'vec'; items: Node[] }
  | { k: 'bracket'; items: Node[] }
  | { k: 'list'; items: Node[] }
  | { k: 'piece'; branches: { cond?: Node; val?: Node }[] }
  | { k: 'rel'; ops: RelOp[]; items: Node[] }
  | { k: 'abs'; a: Node };

export type RelOp = '=' | '<' | '>' | '<=' | '>=';
const REL_OPS = new Set<string>(['=', '<', '>', '<=', '>=']);

export { PREFIX_FUNCS };

export const TRIG = new Set(['sin', 'cos', 'tan', 'csc', 'sec', 'cot']);
/** Words written between their inputs, like 8 nCr 3 and 7 mod 3. "choose" is nCr. */
export const INFIX_WORDS = new Set(['nCr', 'nPr', 'choose', 'mod']);

export const isHeading = (line: string): boolean => line.trimStart().startsWith('#');

/** Whether a product's last factor is a percent, so `of` can follow it: 10%, 2 × 10%, −10%. */
const endsInPercent = (n: Node): boolean =>
  (n.k === 'post' && n.op === '%') || (n.k === 'un' && endsInPercent(n.a)) || (n.k === 'bin' && n.op === '*' && endsInPercent(n.b));

class Parser {
  private i = 0;
  private absDepth = 0;
  constructor(private toks: Token[]) {}

  private peek(o = 0): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  private next(): Token {
    return this.toks[this.i++];
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
    const n = this.parseRelation();
    const t = this.peek();
    if (t.type !== 'eof') {
      if (t.type === 'op' && (t.value === ')' || t.value === ']' || t.value === '}' || t.value === '⟩'))
        throw new CalcError(unmatchedText(t.value), t.pos);
      throw new CalcError(unexpectedText(t.value), t.pos);
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
    if (t.type === 'ident') return !INFIX_WORDS.has(t.value);
    if (t.type !== 'op') return false;
    if (t.value === '|') return this.absDepth === 0;
    return t.value === '(' || t.value === '[' || t.value === '{' || t.value === '√' || t.value === '∛' || t.value === '⟨';
  }

  parseMul(): Node {
    let a = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && (t.value === '*' || t.value === '/')) {
        this.i++;
        a = { k: 'bin', op: t.value as '*' | '/', a, b: this.parseUnary() };
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
        a = { k: 'bin', op: '*', a, b: this.parsePower() };
      } else return a;
    }
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
      items.push(this.parseRelation());
      if (this.isOp(',')) {
        this.i++;
        continue;
      }
      this.absDepth = savedAbs;
      this.expectOp(close, what);
      return items;
    }
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
      if (TRIG.has(t.value) && this.isOp('^')) {
        const save = this.i;
        this.i++;
        let neg = false;
        if (this.isOp('-')) {
          neg = true;
          this.i++;
        }
        const n = this.peek();
        if (n.type === 'num') {
          this.i++;
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
          if (items.length === 1) return items[0];
          if (items.length > 3) throw new CalcError('Points can have 2 or 3 coordinates', t.pos);
          return { k: 'point', items };
        }
        case '[':
          return { k: 'bracket', items: this.parseList(']', '"["') };
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
      const first = this.parseRelation();
      if (this.isOp(':')) {
        this.i++;
        piecewise = true;
        branches.push({ cond: first, val: this.parseRelation() });
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
    if (!piecewise) return { k: 'list', items: branches.map((b) => b.val!) };
    branches.forEach((b, idx) => {
      if (!b.cond && idx !== branches.length - 1)
        throw new CalcError('In {condition: value, …} only the last part can skip its condition', pos);
    });
    return { k: 'piece', branches };
  }
}

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
