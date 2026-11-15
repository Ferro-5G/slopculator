import type { Node } from './parser';
import { NO_ROW, type Env } from './evaluator';
import { lettersOf, namesIn } from './ast';
import { Lru } from './memo';

/**
 * key is equal for two evaluations exactly when the expression and every definition it can reach are the same.
 * reachesAns is set when it reaches ans, whose meaning depends on how far the sheet has been evaluated, not only on
 * text: such a key is only good for this moment.
 */
export interface Fingerprint {
  key: string;
  reachesAns: boolean;
}

export class Fingerprints {
  private sigs = new Map<string, string>();

  /**
   * Names whose signature is being worked out, or is worked out but belongs to a cycle that isn't closed yet, by visit
   * order (Tarjan's strongly connected components). A name reached again while open reads as a placeholder, and a
   * signature that read one is only partial: kept as it is, g in f(x) = …g(x−1)…, g(x) = …f(x−1)… would never see
   * f's body change. So nothing in a cycle is kept until the cycle's first name finishes, and then every member gets
   * that name's signature, which covers every member's body.
   */
  private visiting = new Map<string, { index: number; sig?: Fingerprint }>();
  private visitOrder: string[] = [];
  private visitSeq = 0;
  /** Earliest open name the signature being worked out has reached. */
  private reached = Infinity;

  constructor(private env: Env) {}

  of(node: Node, row: number): Fingerprint {
    const d = this.depends(node, row);
    return { key: `${sig(node)}{${d.key}}`, reachesAns: d.reachesAns };
  }

  ofFunc(name: string): Fingerprint {
    return this.nameSig(name, NO_ROW);
  }

  private depends(node: Node, row: number): Fingerprint {
    const parts: string[] = [];
    let reachesAns = false;
    for (const name of namesIn(node)) {
      const d = this.nameSig(name, row);
      if (d.key) parts.push(d.key);
      reachesAns ||= d.reachesAns;
    }
    return { key: parts.join(';'), reachesAns };
  }

  private nameSig(name: string, row: number): Fingerprint {
    const key = name === 'ans' ? `ans@${row}` : name;
    const hit = this.sigs.get(key);
    if (hit !== undefined) return { key: hit, reachesAns: false };
    const open = this.visiting.get(key);
    if (open) {
      this.reached = Math.min(this.reached, open.index);
      // The placeholder for ans counts as ans itself: tan can reach a = ans by letter splitting while ans is still being
      // worked out, and that view must not be kept either.
      return open.sig ?? (name === 'ans' ? { key: `ans=cycle@${row}`, reachesAns: true } : { key: `${key}:cycle`, reachesAns: false });
    }
    const me: { index: number; sig?: Fingerprint } = { index: ++this.visitSeq };
    this.visiting.set(key, me);
    this.visitOrder.push(key);
    const outer = this.reached;
    this.reached = me.index;
    const out = this.signatureOf(name, row);
    const low = this.reached;
    this.reached = Math.min(outer, low);
    me.sig = out;
    if (low < me.index) return out;
    const members: string[] = [];
    let k: string;
    do {
      k = this.visitOrder.pop()!;
      this.visiting.delete(k);
      members.push(k);
    } while (k !== key);
    if (!out.reachesAns) {
      this.sigs.set(key, out.key);
      for (const m of members) if (m !== key) this.sigs.set(m, intern(`${m}@${out.key}`));
    }
    return out;
  }

  private signatureOf(name: string, row: number): Fingerprint {
    const env = this.env;
    const def = env.varDef(name);
    const fn = env.funcDef(name);
    let text = '';
    let reachesAns = false;
    const withDeps = (head: string, node: Node, r: number): string => {
      const d = this.depends(node, r);
      reachesAns ||= d.reachesAns;
      return `${head}${sig(node)}{${d.key}}`;
    };
    // A variable holding a ready value has no text to compare, so its key never repeats.
    if (def) text = def.node ? withDeps(`${name}=`, def.node, def.row) : `${name}=?${++uncached}`;
    else if (fn) text = withDeps(`${name}(${fn.params.join(',')})=`, fn.body, NO_ROW);
    else if (name === 'ans') {
      reachesAns = true;
      const src = env.answerBefore(row);
      text = src ? withDeps(`ans=${src.row}:`, src.node, src.row) : 'ans=none';
    } else {
      const letters = (lettersOf(name) ?? []).map((ch) => this.nameSig(ch, row));
      reachesAns = letters.some((l) => l.reachesAns);
      text = letters.map((l) => l.key).filter(Boolean).join(',');
    }
    return { key: intern(text), reachesAns };
  }
}

/**
 * Signatures by content, as short ids. Each one used to spell out every dependency's signature in full, so a diamond
 * of definitions (a₂ = a₁ + b₁, b₂ = a₁ − b₁, …) doubled the text at every level: 56 one-line definitions ran out of
 * memory. Equal text still gets an equal id, and ids are never reused, so forgetting one only costs cache hits.
 */
const interned = new Lru<string, string>(50_000);
let internSeq = 0;
function intern(signature: string): string {
  if (!signature) return signature;
  let id = interned.get(signature);
  if (id === undefined) {
    id = `#${(++internSeq).toString(36)}`;
    interned.set(signature, id);
  }
  return id;
}

let uncached = 0;

const sigs = new WeakMap<Node, string>();

/** A compact, unambiguous text form of a syntax tree. Parsed trees are shared and immutable, so it's computed once per tree. */
function sig(n: Node): string {
  let s = sigs.get(n);
  if (s === undefined) {
    s = sigOf(n);
    sigs.set(n, s);
  }
  return s;
}

function sigOf(n: Node): string {
  switch (n.k) {
    case 'num': return n.s ?? String(n.v);
    case 'str': return JSON.stringify(n.s);
    case 'id': return `$${n.name}`;
    case 'un': return `(-${sig(n.a)})`;
    case 'bin': return `(${sig(n.a)}${n.op}${sig(n.b)})`;
    case 'post': return `(${sig(n.a)}${n.op})`;
    case 'abs': return `|${sig(n.a)}|`;
    case 'call': return `${n.name}${n.base ? `_${sig(n.base)}` : ''}(${n.args.map(sig).join(',')})`;
    case 'point': case 'vec': case 'bracket': case 'list': return `${n.k}[${n.items.map(sig).join(',')}]`;
    case 'piece': return `piece[${n.branches.map((b) => `${b.cond ? sig(b.cond) : ''}:${b.val ? sig(b.val) : ''}`).join(',')}]`;
    case 'rel': return `rel[${n.items.map(sig).join(',')}|${n.ops.join(',')}]`;
  }
}
