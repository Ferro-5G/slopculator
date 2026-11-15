import type { Node } from './parser';

export function children(n: Node): Node[] {
  switch (n.k) {
    case 'num': case 'str': case 'id': return [];
    case 'un': case 'post': case 'abs': return [n.a];
    case 'bin': return [n.a, n.b];
    case 'call': return n.base ? [n.base, ...n.args] : n.args;
    case 'point': case 'vec': case 'bracket': case 'list': case 'rel': return n.items;
    case 'piece': return n.branches.flatMap((b) => [...(b.cond ? [b.cond] : []), ...(b.val ? [b.val] : [])]);
  }
}

const names = new WeakMap<Node, string[]>();

/** Every name a tree mentions, sorted. Parsed trees are shared and immutable, so it's computed once per tree. */
export function namesIn(n: Node): string[] {
  let out = names.get(n);
  if (out === undefined) {
    const set = new Set<string>();
    collectNames(n, set);
    out = [...set].sort();
    names.set(n, out);
  }
  return out;
}

function collectNames(n: Node, out: Set<string>): void {
  if (n.k === 'id' || n.k === 'call') out.add(n.name);
  for (const c of children(n)) collectNames(c, out);
}

export const isGraphVar = (name: string): boolean => name === 'x' || name === 'y';

export function lettersOf(name: string, isKnown: (letter: string) => boolean = () => true): string[] | null {
  if (name.length < 2 || name.includes('_')) return null;
  const parts = [...name];
  return parts.every(isKnown) ? parts : null;
}
