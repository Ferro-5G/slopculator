import { errorSpan, lineWarnings, type LineWarning, type Span } from './diagnostics';
import { BudgetError, CalcError, EdgeError, OrderError, OverflowError, drawDeadline, errorText, isDrawing, quietSample, varErrorText, withLineBudget } from './errors';
import { isHeading, parse, type Node, type RelOp } from './parser';
import { isIdentifier } from './lexer';
import { Env, RESERVED, SETTINGS, compile, settingsKey, type Fn, type Settings } from './evaluator';
import { callsValue } from './resolve';
import { BUILTINS, CONSTANTS, readsAsValue, soleUnknown } from './builtins';
import { normBetween, binomRange } from './numeric';
import { type Value, type NormalDist, type BinomDist, isDist, num, tidy, weightedTotal } from './values';
import { PreciseState, sameShape, toValue, type Precise } from './precise';
import { children, isGraphVar, lettersOf, namesIn } from './ast';
import { Lru } from './memo';
import { Fingerprints, type Fingerprint } from './fingerprint';
import { unitPhrase } from './units';

interface DistState {
  cdf: boolean;
  min: string;
  max: string;
}

export interface TableColumn {
  header: string;
  cells: string[];
}

export type RowInput =
  | { id: string; kind: 'expr'; text: string; hidden?: boolean; dist?: DistState; slider?: SliderRange }
  | { id: string; kind: 'table'; columns: TableColumn[]; hidden?: boolean };

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A document's settings read back from storage or a file, each missing or of the wrong type falling back to the default.
 * Sheets saved before a setting existed get its default too, so a document's readers use the plain field.
 */
export function cleanSettings(raw: unknown): Required<Settings> {
  const set = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out = {} as Required<Settings>;
  for (const name of Object.keys(SETTINGS) as (keyof Settings)[]) {
    const v = set[name];
    out[name] = typeof v === 'boolean' ? v : SETTINGS[name].fallback;
  }
  return out;
}

/**
 * A row read back from storage or a file, keeping only fields of the right type, or null when nothing usable is left.
 * Saved sheets can be hand-edited or come from another version, and one bad row must not stop a sheet from opening.
 * The id is '' when missing; the caller assigns a fresh one.
 */
export function cleanRow(raw: unknown): RowInput | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const hidden = raw.hidden === true ? { hidden: true } : {};
  if (raw.kind === 'table') {
    if (!Array.isArray(raw.columns)) return null;
    const columns = raw.columns.filter(isRecord).map((c) => ({
      header: typeof c.header === 'string' ? c.header : '',
      cells: Array.isArray(c.cells) ? c.cells.map((x) => (typeof x === 'string' ? x : isFiniteNum(x) ? String(x) : '')) : [],
    }));
    return columns.length ? { id, kind: 'table', columns, ...hidden } : null;
  }
  if ((raw.kind !== undefined && raw.kind !== 'expr') || typeof raw.text !== 'string') return null;
  const row: Extract<RowInput, { kind: 'expr' }> = { id, kind: 'expr', text: raw.text, ...hidden };
  const d = raw.dist, s = raw.slider;
  if (isRecord(d) && typeof d.cdf === 'boolean') {
    row.dist = { cdf: d.cdf, min: typeof d.min === 'string' ? d.min : '-inf', max: typeof d.max === 'string' ? d.max : '' };
  }
  if (isRecord(s) && isFiniteNum(s.min) && isFiniteNum(s.max) && isFiniteNum(s.step) && s.min < s.max && s.step > 0) {
    row.slider = { min: s.min, max: s.max, step: s.step };
  }
  return row;
}

type Ineq = '<' | '>' | '<=' | '>=';

/**
 * What a row draws. Call f and test synchronously, a whole drawing at a time: a drawing's samples share one line's
 * budget, and the end of the current task is what marks the drawing as over (see sampler).
 */
export type GraphItem =
  | { type: 'fx'; f: (x: number) => number; ineq?: Ineq }
  | { type: 'fy'; f: (y: number) => number; ineq?: Ineq }
  | { type: 'implicit'; f: (x: number, y: number) => number; ineq?: Ineq }
  | { type: 'region'; test: (x: number, y: number) => boolean }
  | { type: 'points'; pts: number[][]; connect?: boolean }
  | { type: 'polygon'; pts: number[][] }
  | { type: 'vector'; to: number[] }
  | { type: 'normal'; mu: number; sigma: number; shade?: [number, number] }
  | { type: 'binom'; n: number; p: number; shade?: [number, number] };

interface TableResult {
  columns: { values: (number | null)[]; computed: boolean; error?: string; sum?: number; probWarning?: string }[];
  ev?: number;
}

export interface RowResult {
  id: string;
  value?: Value;
  /**
   * The exact value behind `value` when exact math covers the line: rationals, π multiples, or proven balls.
   * `value` is then its nearest double. Pass it to the format functions to show every proven digit. Holds bigints.
   */
  precise?: Precise;
  error?: string;
  errorPos?: number;
  errorSpan?: Span;
  warnings?: LineWarning[];
  notes: string[];
  prob: boolean;
  slider?: { name: string; value: number };
  defines?: string;
  graph: GraphItem[];
  distProb?: number;
  distError?: string;
  table?: TableResult;
  truth?: boolean;
  heading?: string;
  lineName?: string;
}

/**
 * Same graph item: the same function object (see graphCache), or the same data. A front end can keep what it drew
 * for an item that is the same.
 */
export function sameGraphItem(a: GraphItem, b: GraphItem): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'fx': case 'fy': case 'implicit': {
      const o = b as typeof a;
      return a.f === o.f && a.ineq === o.ineq;
    }
    case 'region': return a.test === (b as typeof a).test;
    case 'points': {
      const o = b as typeof a;
      return a.connect === o.connect && samePts(a.pts, o.pts);
    }
    case 'polygon': return samePts(a.pts, (b as typeof a).pts);
    case 'vector': return samePts([a.to], [(b as typeof a).to]);
    case 'normal': {
      const o = b as typeof a;
      return a.mu === o.mu && a.sigma === o.sigma && a.shade?.[0] === o.shade?.[0] && a.shade?.[1] === o.shade?.[1];
    }
    case 'binom': {
      const o = b as typeof a;
      return a.n === o.n && a.p === o.p && a.shade?.[0] === o.shade?.[0] && a.shade?.[1] === o.shade?.[1];
    }
  }
}

function samePts(a: number[][], b: number[][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i];
    if (p.length !== q.length) return false;
    for (let j = 0; j < p.length; j++) if (!Object.is(p[j], q[j])) return false;
  }
  return true;
}

/** Line letters: 0 → A, 25 → Z, 26 → AA, 27 → AB, … */
export function lineName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function isLiteral(n: Node): number | null {
  if (n.k === 'num') return n.v;
  if (n.k === 'un' && n.a.k === 'num') return -n.a.v;
  return null;
}

function freeXY(n: Node, env: Env, bound: Set<string>, seen = new Set<string>()): { x: boolean; y: boolean } {
  const out = { x: false, y: false };
  const visit = (m: Node, b: Set<string>): void => {
    switch (m.k) {
      case 'id': {
        const name = m.name;
        if (b.has(name)) return;
        if (name === 'x') { out.x = true; return; }
        if (name === 'y') { out.y = true; return; }
        if (env.hasVar(name) || env.hasFunc(name) || name in CONSTANTS || readsAsValue(name)) return;
        // A word reads as letters multiplied (xy, 2tx) only when every letter is defined or is x or y. An unknown word
        // that happens to hold an x or a y (tax) is just unknown, not a graph of x.
        const letters = lettersOf(name, (ch) => isGraphVar(ch) || b.has(ch) || env.hasVar(ch) || ch in CONSTANTS);
        for (const ch of letters ?? []) {
          if (ch === 'x' && !b.has('x')) out.x = true;
          if (ch === 'y' && !b.has('y')) out.y = true;
        }
        return;
      }
      case 'call': {
        if (m.base) visit(m.base, b);
        const valueCall = callsValue(m.name, env, [...b]);
        // solve(3x = 12) solves for x, as solve(3x = 12, x) does, and solve(t^2 = 9) for t.
        const boundName = m.args.length >= 2 ? (m.args[1].k === 'id' ? m.args[1].name : null) : m.name === 'solve' && m.args[0] ? soleUnknown(m.args[0], (n) => b.has(n) || env.hasVar(n) || env.hasFunc(n)) : null;
        const lazyBinder = !!BUILTINS[m.name]?.binds && !env.hasFunc(m.name) && !valueCall && boundName !== null;
        if (lazyBinder) {
          const inner = new Set(b);
          inner.add(boundName);
          visit(m.args[0], inner);
          m.args.slice(2).forEach((a) => visit(a, b));
          if (BUILTINS[m.name].readsBound && m.args.length === 2) visit(m.args[1], b);
        } else m.args.forEach((a) => visit(a, b));
        const f = valueCall ? undefined : env.funcDef(m.name);
        if (f && !seen.has(m.name)) {
          seen.add(m.name);
          const r = freeXY(f.body, env, new Set(f.params), seen);
          out.x ||= r.x;
          out.y ||= r.y;
        }
        if (!f && !(m.name in BUILTINS) && !env.hasVar(m.name)) visit({ k: 'id', name: m.name, pos: 0 }, b);
        return;
      }
      default: children(m).forEach((c) => visit(c, b));
    }
  };
  visit(n, bound);
  return out;
}

const FLIP: Record<Ineq, Ineq> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };

function numericFn1(f: Fn): (t: number) => number {
  const s: Value[] = [0];
  const sample = sampler();
  return (t) => {
    s[0] = t;
    return sample(f, s);
  };
}

function numericFn2(f: Fn): (x: number, y: number) => number {
  const s: Value[] = [0, 0];
  const sample = sampler();
  return (x, y) => {
    s[0] = x;
    s[1] = y;
    return sample(f, s);
  };
}

/**
 * Runs one sample of a graph function. A graph is drawn after evaluateDocument returns, where no line's budget is
 * open, and f(60) for f(n) = f(n−1) + f(n−1) would never finish. A draw samples synchronously, so its samples share
 * one line's budget, opened at the first sample and reset once the draw is over; past it the rest of the draw is a gap.
 */
function sampler(): (f: Fn, s: Value[]) => number {
  let until = 0;
  let spent = false;
  return (f, s) => {
    const drawing = isDrawing();
    if (drawing) {
      if (!until) {
        until = drawDeadline();
        void Promise.resolve().then(() => {
          until = 0;
          spent = false;
        });
      }
      if (spent) return NaN;
    }
    try {
      const v = quietSample(f, s, drawing ? until : undefined);
      return typeof v === 'number' ? v : NaN;
    } catch (e) {
      if (drawing && e instanceof BudgetError) spent = true;
      return NaN;
    }
  };
}

interface Parsed {
  row: RowInput;
  index: number;
  ast?: Node;
  error?: CalcError;
  defVar?: { name: string; node: Node };
  defFunc?: { name: string; params: string[]; body: Node };
}

/**
 * Graph functions from earlier evaluations, by what they were built from. A keystroke on one line re-evaluates the
 * whole sheet, but a curve whose line and definitions didn't change keeps its old function object, so the graph can
 * tell it apart and skip re-sampling it. The old function still works: it was built from the same definitions.
 */
const graphCache = new Lru<string, { graph: GraphItem[]; notes: string[] }>(128);

function cachedGraph(tag: string, print: Fingerprint, env: Env, res: RowResult, build: () => void): void {
  if (print.reachesAns) return build();
  const key = `${tag}${settingsKey(env.settings)}|${print.key}`;
  const hit = graphCache.get(key);
  if (hit) {
    res.graph.push(...hit.graph);
    for (const n of hit.notes) env.note(n);
    return;
  }
  const notes = env.notesDuring(build);
  if (res.graph.length) graphCache.set(key, { graph: res.graph.slice(), notes });
}

function classifyDefinition(ast: Node): Pick<Parsed, 'defVar' | 'defFunc'> {
  if (ast.k !== 'rel' || ast.ops.length !== 1 || ast.ops[0] !== '=') return {};
  const [lhs, rhs] = ast.items;
  // xy = 1 is a curve: a name made only of x and y is those letters multiplied, never a variable.
  if (lhs.k === 'id' && !isGraphVar(lhs.name) && !lettersOf(lhs.name, isGraphVar)) {
    if (RESERVED.has(lhs.name)) throw new CalcError(`"${lhs.name}" is a built-in name and can't be redefined`);
    return { defVar: { name: lhs.name, node: rhs } };
  }
  if (lhs.k === 'call' && !lhs.base && lhs.args.length > 0 && lhs.args.every((a) => a.k === 'id')) {
    if (isGraphVar(lhs.name)) return {};
    if (lhs.name in CONSTANTS) throw new CalcError(`"${lhs.name}" is a constant, so it can't name a function. Try another name, like f`);
    const params = lhs.args.map((a) => (a as { name: string }).name);
    if (new Set(params).size !== params.length) throw new CalcError('Function inputs need different names');
    return { defFunc: { name: lhs.name, params, body: rhs } };
  }
  return {};
}

export function evaluateDocument(rows: RowInput[], settings: Settings): RowResult[] {
  const env: Env = new Env(settings, {
    improve: (name, v) => {
      const pr = exact.varFinal(name);
      if (!pr || (v !== undefined && !sameShape(pr, v))) return undefined;
      return toValue(pr);
    },
    // ans in a definition means the row above the definition's own, even when an earlier row asks for it first, so
    // the rows it reads are worked out then.
    reachRow: (r) => {
      if (results[r] || !parsed[r]) return;
      if (running.has(r)) throw new OrderError(`ans would read line ${r + 1}, which is still waiting on this value`);
      results[r] = evalRow(parsed[r]);
    },
  });
  const prints = new Fingerprints(env);
  const exact = new PreciseState(env, prints);
  const parsed: Parsed[] = rows.map((row, index) => {
    if (row.kind === 'table') return { row, index };
    const text = row.text.trim();
    if (!text || isHeading(text)) return { row, index };
    try {
      const ast = parse(unitPhrase(text) ?? text);
      return { row, index, ast, ...classifyDefinition(ast) };
    } catch (e) {
      return { row, index, error: e instanceof CalcError ? e : new CalcError(errorText(e)) };
    }
  });

  const counts = new Map<string, number>();
  const tableNames = new Map<number, string[]>();
  rows.forEach((row, i) => {
    if (row.kind !== 'table') return;
    const names = row.columns.map((c) => c.header.trim()).filter((h) => isIdentifier(h) && !isGraphVar(h));
    tableNames.set(i, names);
  });
  const bump = (n: string) => counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const p of parsed) {
    if (p.defVar) bump(p.defVar.name);
    if (p.defFunc) bump(p.defFunc.name);
  }
  tableNames.forEach((names) => names.forEach(bump));
  const dup = (n: string) => (counts.get(n) ?? 0) > 1;
  for (const p of parsed) {
    if (p.defVar && !dup(p.defVar.name)) env.defineVar({ name: p.defVar.name, node: p.defVar.node, row: p.index });
    if (p.defFunc && !dup(p.defFunc.name)) env.defineFunc({ ...p.defFunc });
  }
  const lettered = new Map<number, string>();
  if (settings.lineNames) {
    for (const p of parsed) {
      const name = lineName(p.index);
      if (counts.has(name) || env.hasFunc(name)) continue;
      if (p.row.kind === 'expr' && !p.row.text.trim()) {
        env.markEmptyLine(name);
        continue;
      }
      let node: Node | undefined;
      if (p.defVar && !dup(p.defVar.name)) node = { k: 'id', name: p.defVar.name, pos: 0 };
      else if (p.ast && !p.defFunc && p.ast.k !== 'rel') node = p.ast;
      if (!node) continue;
      env.defineVar({ name, node, row: p.index, letter: true });
      lettered.set(p.index, name);
    }
  }

  tableNames.forEach((names, i) => {
    const row = rows[i] as Extract<RowInput, { kind: 'table' }>;
    for (const col of row.columns) {
      const h = col.header.trim();
      if (!names.includes(h) || dup(h)) continue;
      const cells = trimCells(col.cells);
      const node: Node = { k: 'list', items: cells.map((c) => (c.trim() ? safeParse(c) : { k: 'num', v: NaN })) };
      env.defineVar({ name: h, node, row: i });
    }
  });

  const results: RowResult[] = [];
  const running = new Set<number>();
  const evalRow = (p: Parsed): RowResult => {
    const res: RowResult = { id: p.row.id, notes: [], prob: false, graph: [], lineName: lettered.get(p.index) };
    if (p.row.kind === 'expr' && isHeading(p.row.text)) res.heading = p.row.text.trim().replace(/^#+\s*/, '');
    running.add(p.index);
    env.inRow(res.notes, () => withLineBudget(() => {
      try {
        if (p.row.kind === 'table') evalTable(p.row, env, res, p.index);
        else if (p.error) {
          res.error = p.error.message;
          res.errorPos = p.error.pos;
        } else if (p.ast) {
          evalExprRow(p, env, res, dup, exact, prints);
        }
      } catch (e) {
        res.error = errorText(e);
        res.graph = [];
      }
    }));
    running.delete(p.index);
    if (p.row.kind === 'expr' && res.heading === undefined) {
      if (res.error) res.errorSpan = errorSpan(p.row.text, res.error, res.errorPos) ?? undefined;
      else {
        const warnings = lineWarnings(p.row.text, settings);
        if (warnings.length) res.warnings = warnings;
      }
    }
    env.finishRow(p.index, res.error ? undefined : res.value, p.defVar?.node ?? p.ast);
    const letter = lettered.get(p.index);
    if (letter && res.error) env.remember(letter, new CalcError(varErrorText(letter, res.error)));
    else if (letter && res.value !== undefined) env.remember(letter, res.value);
    return res;
  };
  for (const p of parsed) results[p.index] ??= evalRow(p);
  // A graph is drawn after this returns, where no line's budget is open, so nothing is left for it to work out: each
  // variable a curve can read that no line asked for (a table column, a letter only a graph reads) gets a line's
  // budget here.
  const drawn = parsed.filter((p) => p.ast && results[p.index].graph.some((g) => 'f' in g || 'test' in g)).map((p) => p.ast!);
  for (const name of varsReached(drawn, env)) {
    if (env.known(name)) continue;
    withLineBudget(() => {
      try {
        env.getVar(name);
      } catch (e) {
        // It had a whole budget of its own, so the timeout is its answer.
        if (e instanceof BudgetError) env.remember(name, new CalcError(varErrorText(name, e.message)));
      }
    });
  }
  return results;
}

function varsReached(nodes: Node[], env: Env): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const visit = (n: Node): void => {
    for (const name of namesIn(n)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const v = env.varDef(name);
      const f = env.funcDef(name);
      if (v) {
        out.add(name);
        if (v.node) visit(v.node);
      } else if (f) visit(f.body);
      else for (const ch of lettersOf(name) ?? []) visit({ k: 'id', name: ch, pos: 0 });
    }
  };
  nodes.forEach(visit);
  return out;
}

function safeParse(src: string): Node {
  try {
    return parse(src);
  } catch {
    return { k: 'num', v: NaN };
  }
}

function trimCells(cells: string[]): string[] {
  let end = cells.length;
  while (end > 0 && !cells[end - 1].trim()) end--;
  return cells.slice(0, end);
}

const EXACT_SHAPES = new Set(['list', 'point', 'vector', 'matrix']);

function evalExprRow(p: Parsed, env: Env, res: RowResult, dup: (n: string) => boolean, exact: PreciseState, prints: Fingerprints): void {
  const ast = p.ast!;
  const row = p.row as Extract<RowInput, { kind: 'expr' }>;
  if (p.defFunc) {
    const { name, params } = p.defFunc;
    if (dup(name)) throw new CalcError(`${name} is defined more than once`);
    res.defines = name;
    if (name in BUILTINS) env.note(`${name} replaces the built-in ${name} in this session`);
    if (params.length === 1 && params[0] === 'x') {
      cachedGraph('F', prints.ofFunc(name), env, res, () => {
        res.graph.push({ type: 'fx', f: numericFn1(env.getFunc(name)) });
      });
    } else env.getFunc(name);
    return;
  }
  if (p.defVar) {
    const { name, node } = p.defVar;
    if (dup(name)) throw new CalcError(`${name} is defined more than once`);
    res.defines = name;
    const xy = freeXY(node, env, new Set());
    if (xy.x || xy.y) throw new CalcError(`${name} can't depend on x or y. To graph, write y = …, or define a function ${name}(x) = …`);
    const lit = isLiteral(node);
    if (lit !== null) res.slider = { name, value: lit };
    try {
      res.value = env.getVar(name);
    } finally {
      for (const n of env.notesOf(name)) env.note(n);
    }
    const pr = exact.varFinal(name);
    if (pr && sameShape(pr, res.value)) res.precise = pr;
    res.prob = isProbNode(node);
    if (isDist(res.value)) evalDist(res.value, row.dist, env, res, p.index);
    else addValueGraph(res, res.value);
    return;
  }
  if (ast.k === 'rel') {
    evalRelation(ast, env, res, p.index, prints);
    return;
  }
  const xy = freeXY(ast, env, new Set());
  if (xy.y) throw new CalcError('To graph in terms of y, write x = …');
  if (xy.x) {
    cachedGraph('X', prints.of(ast, p.index), env, res, () => {
      res.graph.push({ type: 'fx', f: numericFn1(compile(ast, env, ['x'], p.index)) });
    });
    return;
  }
  let v: Value;
  try {
    v = compile(ast, env, [], p.index)([]);
  } catch (e) {
    // 200!/199! overflows doubles on the way, and 1/(1e16 + 1 − 1e16) divides by a zero only doubles see. Exact math
    // gets to both.
    let pr: Precise | null = null;
    if (e instanceof OverflowError || e instanceof EdgeError) {
      try {
        pr = exact.evaluate(ast, p.index);
      } catch {
        // Exact math has no value for it either, so the double's error stands.
      }
    }
    if (!pr) throw e;
    res.precise = pr;
    v = toValue(pr);
  }
  if (!res.precise && (typeof v === 'number' || EXACT_SHAPES.has(v.t))) {
    const pr = exact.evaluate(ast, p.index);
    if (pr && sameShape(pr, v)) {
      res.precise = pr;
      v = toValue(pr);
    }
  }
  res.value = v;
  res.prob = isProbNode(ast);
  if (isDist(v)) evalDist(v, row.dist, env, res, p.index);
  else addValueGraph(res, v);
}

function isProbNode(n: Node): boolean {
  // p_hat has always ignored the % toggle. It's kept that way for now: the fix is removing this test.
  if (n.k === 'call') return !!BUILTINS[n.name]?.prob && n.name !== 'p_hat';
  if (n.k === 'bin' && (n.op === '+' || n.op === '-')) return isProbNode(n.a) && isProbNode(n.b);
  return false;
}

function addValueGraph(res: RowResult, v: Value): void {
  if (typeof v !== 'object') return;
  if (v.t === 'point' && v.c.length === 2) res.graph.push({ type: 'points', pts: [v.c] });
  else if (v.t === 'list' && v.items.length && v.items.every((i) => typeof i === 'object' && i.t === 'point' && i.c.length === 2))
    res.graph.push({ type: 'points', pts: v.items.map((i) => (i as { c: number[] }).c) });
  else if (v.t === 'polygon') res.graph.push({ type: 'polygon', pts: v.pts });
  else if (v.t === 'vector' && v.c.length === 2) res.graph.push({ type: 'vector', to: v.c });
}

function evalBound(src: string, env: Env, row: number, fallback: number): number {
  const t = src.trim();
  if (!t) return fallback;
  return num(compile(parse(t), env, [], row)([]), 'Bound');
}

function evalDist(v: NormalDist | BinomDist, dist: DistState | undefined, env: Env, res: RowResult, row: number): void {
  const item: Extract<GraphItem, { type: 'normal' | 'binom' }> = v.t === 'normal' ? { type: 'normal', mu: v.mu, sigma: v.sigma } : { type: 'binom', n: v.n, p: v.p };
  res.graph.push(item);
  if (!dist?.cdf) return;
  try {
    const lo = evalBound(dist.min, env, row, -Infinity);
    const hi = evalBound(dist.max, env, row, Infinity);
    if (lo > hi) throw new CalcError('Min is above max');
    item.shade = [lo, hi];
    if (v.t === 'normal') res.distProb = normBetween((lo - v.mu) / v.sigma, (hi - v.mu) / v.sigma);
    else res.distProb = binomRange(v.n, v.p, lo, hi);
  } catch (e) {
    res.distError = e instanceof Error ? e.message : String(e);
  }
}

function evalRelation(ast: Extract<Node, { k: 'rel' }>, env: Env, res: RowResult, row: number, prints: Fingerprints): void {
  const xy = freeXY(ast, env, new Set());
  if (!xy.x && !xy.y) {
    res.truth = compile(ast, env, [], row)([]) === 1;
    return;
  }
  cachedGraph('G', prints.of(ast, row), env, res, () => graphRelation(ast, env, res, row));
}

function graphRelation(ast: Extract<Node, { k: 'rel' }>, env: Env, res: RowResult, row: number): void {
  if (ast.ops.length === 1) {
    const op = ast.ops[0] as RelOp;
    const [lhs, rhs] = ast.items;
    const sideXY = (n: Node) => freeXY(n, env, new Set());
    const explicit = (target: 'y' | 'x', other: Node, flip: boolean): boolean => {
      const d = sideXY(other);
      if (target === 'y' ? d.y : d.x) return false;
      const f = numericFn1(compile(other, env, [target === 'y' ? 'x' : 'y'], row));
      const ineq = op === '=' ? undefined : flip ? FLIP[op as Ineq] : (op as Ineq);
      res.graph.push(target === 'y' ? { type: 'fx', f, ineq } : { type: 'fy', f, ineq });
      return true;
    };
    if (lhs.k === 'id' && lhs.name === 'y' && explicit('y', rhs, false)) return;
    if (rhs.k === 'id' && rhs.name === 'y' && explicit('y', lhs, true)) return;
    if (lhs.k === 'id' && lhs.name === 'x' && explicit('x', rhs, false)) return;
    if (rhs.k === 'id' && rhs.name === 'x' && explicit('x', lhs, true)) return;
    const diff = compile({ k: 'bin', op: '-', a: lhs, b: rhs }, env, ['x', 'y'], row);
    res.graph.push({ type: 'implicit', f: numericFn2(diff), ineq: op === '=' ? undefined : (op as Ineq) });
    return;
  }
  if (ast.ops.includes('=')) throw new CalcError('Chains with = can\'t be graphed. Split them into separate lines');
  const test = numericFn2(compile(ast, env, ['x', 'y'], row));
  res.graph.push({ type: 'region', test: (x, y) => test(x, y) === 1 });
}

const isProbHeader = (header: string): boolean => /^p/i.test(header);

function evalTable(row: Extract<RowInput, { kind: 'table' }>, env: Env, res: RowResult, index: number): void {
  const cols = row.columns;
  const table: TableResult = { columns: [] };
  res.table = table;
  if (cols.length === 0) return;
  const first = cols[0].header.trim();
  const firstIsName = isIdentifier(first);
  const firstValues = evalCells(cols[0].cells, env, index);
  table.columns.push(summarize(firstValues, first, false));
  if (!firstIsName) table.columns[0].error = 'The first column header must be a name, like x or x_1';
  const n = firstValues.length;
  for (let c = 1; c < cols.length; c++) {
    const h = cols[c].header.trim();
    if (!h || isIdentifier(h)) {
      table.columns.push(summarize(evalCells(cols[c].cells, env, index), h, false));
      continue;
    }
    try {
      const f = compile(parse(h), env, firstIsName ? [first] : [], index);
      // Formulas are opaque here, so noise is judged against the whole column of inputs. All zeros, or none: the old 1.
      const big = firstValues.reduce<number>((m, x) => (x === null ? m : Math.max(m, Math.abs(x))), 0) || 1;
      const vals = firstValues.map((x) => {
        if (x === null) return null;
        try {
          const v = f([x]);
          return typeof v === 'number' ? tidy(v, big) : null;
        } catch {
          return null;
        }
      });
      table.columns.push(summarize(vals, h, true));
    } catch (e) {
      table.columns.push({ values: new Array(n).fill(null), computed: true, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const probCol = table.columns.findIndex((c, k) => k > 0 && isProbHeader(cols[k].header.trim()) && !c.computed);
  if (probCol > 0) {
    const xs = table.columns[0].values, ps = table.columns[probCol].values;
    const outcomes: number[] = [], chances: number[] = [];
    let ok = true;
    for (let k = 0; k < Math.max(xs.length, ps.length); k++) {
      const x = xs[k], p = ps[k];
      if (x == null && p == null) continue;
      if (x == null || p == null) { ok = false; break; }
      outcomes.push(x);
      chances.push(p);
    }
    if (ok) table.ev = weightedTotal(outcomes, chances);
  }
  for (let c = 1; c < table.columns.length; c++) {
    const pts: number[][] = [];
    table.columns[0].values.forEach((x, k) => {
      const y = table.columns[c].values[k];
      if (x !== null && y !== null && y !== undefined) pts.push([x, y]);
    });
    if (pts.length) res.graph.push({ type: 'points', pts });
  }
}

function evalCells(cells: string[], env: Env, row: number): (number | null)[] {
  return trimCells(cells).map((c) => {
    const t = c.trim();
    if (!t) return null;
    try {
      const v = compile(parse(t), env, [], row)([]);
      return typeof v === 'number' ? v : null;
    } catch {
      return null;
    }
  });
}

function summarize(values: (number | null)[], header: string, computed: boolean): TableResult['columns'][number] {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const sum = present.length ? tidy(present.reduce((a, b) => a + b, 0), present.reduce((a, b) => a + Math.abs(b), 0)) : undefined;
  const col: TableResult['columns'][number] = { values, computed, sum };
  if (isProbHeader(header) && present.length >= 2 && present.every((v) => v >= 0 && v <= 1) && sum !== undefined && Math.abs(sum - 1) > 1e-9)
    col.probWarning = `ΣP = ${sum}, should be 1`;
  return col;
}
