// The decisions compile() and precise.ts must make the same way: what a name means, what a call means, what [ ] builds.
// Each evaluator does its own arithmetic, in doubles or exactly; it takes these answers and switches on them.
import type { Node } from './parser';
import type { Env, FuncDef } from './evaluator';
import type { Builtin } from './builtin-types';
import { BUILTINS, CONSTANTS, readsAsValue } from './builtins';
import { lettersOf } from './ast';

export const MAX_CALL_DEPTH = 200;

function isKnownName(name: string, env: Env, locals: readonly string[]): boolean {
  return locals.includes(name) || env.hasVar(name) || name in CONSTANTS || (name === 'i' && env.settings.complex);
}

/**
 * Whether name(…) multiplies a value, as in a(b + c), rather than calling a function. A line letter that is also a
 * built-in's name is the built-in: C(5, 2) is nCr, while C + 1 and 2C still read line C.
 */
export function callsValue(name: string, env: Env, locals: readonly string[]): boolean {
  if (locals.includes(name) || name in CONSTANTS) return true;
  const def = env.varDef(name);
  return def !== undefined && !(def.letter && name in BUILTINS);
}

function splitName(name: string, env: Env, locals: readonly string[]): string[] | null {
  return lettersOf(name, (p) => isKnownName(p, env, locals));
}

/** What a bare name means, tried in this order: the order is the rule. */
type NameUse =
  | { k: 'local'; index: number }
  | { k: 'var' }
  | { k: 'ans' }
  | { k: 'i' }
  | { k: 'constant' }
  | { k: 'zeroInput' }
  | { k: 'function' }
  | { k: 'letters'; parts: string[] }
  | { k: 'builtin' }
  | { k: 'unknown' };

export function resolveId(name: string, env: Env, locals: readonly string[]): NameUse {
  const index = locals.lastIndexOf(name);
  if (index >= 0) return { k: 'local', index };
  if (env.hasVar(name)) return { k: 'var' };
  if (name === 'ans') return { k: 'ans' };
  if (name === 'i') return { k: 'i' };
  if (name in CONSTANTS) return { k: 'constant' };
  if (readsAsValue(name)) return { k: 'zeroInput' };
  if (env.hasFunc(name)) return { k: 'function' };
  const parts = splitName(name, env, locals);
  if (parts) return { k: 'letters', parts };
  return name in BUILTINS ? { k: 'builtin' } : { k: 'unknown' };
}

/** What name(…) means, tried in this order: a value times a bracket, a user function, a built-in, letters times a bracket. */
type CallUse =
  | { k: 'value' }
  | { k: 'user'; def: FuncDef }
  | { k: 'builtin'; b: Builtin }
  | { k: 'letters' }
  | { k: 'unknown' };

export function resolveCall(name: string, argCount: number, env: Env, locals: readonly string[]): CallUse {
  if (callsValue(name, env, locals)) return { k: 'value' };
  const def = env.funcDef(name);
  if (def) return { k: 'user', def };
  const b = BUILTINS[name];
  if (b) return { k: 'builtin', b };
  return splitName(name, env, locals) && argCount === 1 ? { k: 'letters' } : { k: 'unknown' };
}

/**
 * Textbook reading of powers after implicit products the parser can't see:
 * P(1 + r)^t is P·(1 + r)^t when P is a value, and Pe^(rt) or ax^2 split as P·e^(rt) and a·x^2.
 */
export function rewritePower(base: Node, exp: Node, env: Env, locals: readonly string[]): Node | null {
  const isValue = (name: string) => callsValue(name, env, locals) && !env.hasFunc(name);
  if (base.k === 'call' && !base.base && base.args.length === 1 && isValue(base.name)) {
    return { k: 'bin', op: '*', a: { k: 'id', name: base.name, pos: base.pos }, b: { k: 'bin', op: '^', a: base.args[0], b: exp } };
  }
  if (base.k === 'id' && !isKnownName(base.name, env, locals) && !readsAsValue(base.name)) {
    const parts = splitName(base.name, env, locals);
    if (parts) {
      const head = parts.slice(0, -1).map((p): Node => ({ k: 'id', name: p, pos: base.pos }));
      const last: Node = { k: 'bin', op: '^', a: { k: 'id', name: parts[parts.length - 1], pos: base.pos }, b: exp };
      return head.reduceRight<Node>((acc, h) => ({ k: 'bin', op: '*', a: h, b: acc }), last);
    }
  }
  return null;
}

export function isConstantE(n: Node, env: Env, locals: readonly string[]): boolean {
  return n.k === 'id' && n.name === 'e' && !locals.includes('e') && !env.hasVar('e');
}

/** The whole number 1/y is near, when that makes x^y an odd root of a negative x: (−8)^(1/3) = −2. Null otherwise. */
export function oddRootOf(y: number): number | null {
  const inv = 1 / y;
  const r = Math.round(inv);
  return Number.isInteger(r) && Math.abs(inv - r) < 1e-9 && r % 2 !== 0 ? r : null;
}

export function bracketKind(kinds: readonly string[]): 'empty' | 'vector' | 'matrix' | 'points' | 'mixed' {
  if (kinds.length === 0) return 'empty';
  if (kinds.every((k) => k === 'number')) return 'vector';
  if (kinds.every((k) => k === 'vector')) return 'matrix';
  if (kinds.every((k) => k === 'point')) return 'points';
  return 'mixed';
}
