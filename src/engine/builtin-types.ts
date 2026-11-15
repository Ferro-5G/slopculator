import type { Node } from './parser';
import type { Env, Fn } from './evaluator';
import type { Value } from './values';

export type Compile = (n: Node, locals: string[]) => Fn;

export interface Builtin {
  min: number;
  max: number;
  fn?: (a: Value[], env: Env) => Value;
  lazy?: (args: Node[], locals: string[], env: Env, compile: Compile) => Fn;
  /** Same as fn for a single number, without the argument array. Graphs call it once per pixel. */
  fast1?: (x: number, env: Env) => Value;
  usage?: string;
  /** The result is a probability, so the % toggle shows it as a percent. */
  prob?: boolean;
  /** The second input names a variable bound inside the first, like n in sum(n^2, n, 1, 10). */
  binds?: boolean;
  /** With only two inputs it works at the bound name's current value: deriv(x^3, x) reads x as well as binding it. */
  readsBound?: boolean;
}

export type Def = (names: string | string[], b: Builtin) => void;
