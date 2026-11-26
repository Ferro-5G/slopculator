// Nodes are views of sheet expressions. Pin edits produce row text for the normal document evaluator.
import { children, isGraphVar, lettersOf, namesIn } from '../engine/ast';
import { BUILTINS, CONSTANTS } from '../engine/builtins';
import { lineDefines, parseLine, parseLineSpanned, type RowInput, type RowResult } from '../engine/document';
import { RESERVED, type Settings } from '../engine/evaluator';
import { canonicalName, lexedText } from '../engine/lexer';
import { inParens, isHeading, type Node, type Spanned } from '../engine/parser';
import { isFitNode } from '../engine/regress';
import { anyCase } from '../engine/resolve';
import { unitPhrase } from '../engine/units';
import { sheetDefiners, sheetWires, type CanvasRow, type Point, type Wire } from './canvas';
import { LIST_FNS, portExpr, portReads, rowPorts, type Definer } from './ports';

export type NodeCategory = 'input' | 'arithmetic' | 'functions' | 'trig' | 'stats' | 'output';

export interface NodeTemplate {
  id: string;
  title: string;
  symbol: string;
  category: NodeCategory;
  summary: string;
  inputs: { label: string; defaultValue: string }[];
  build: (name: string | null, args: string[]) => string;
}

type PinSpec = NodeTemplate['inputs'][number];
const input = (label: string, defaultValue = '0'): PinSpec => ({ label, defaultValue });
const pair = (a: string, b = a): PinSpec[] => [input('A', a), input('B', b)];
const assign = (name: string | null, rhs: string): string => name ? `${name} = ${rhs}` : rhs;

function operation(
  id: string, title: string, symbol: string, category: NodeCategory, summary: string, inputs: PinSpec[],
  rhs: (args: string[]) => string,
): NodeTemplate {
  return { id, title, symbol, category, summary, inputs, build: (name, args) => assign(name, rhs(args)) };
}

function binary(id: string, title: string, op: string, symbol: string, summary: string, defaultValue: string): NodeTemplate {
  return operation(id, title, symbol, 'arithmetic', summary, pair(defaultValue), ([a, b]) => `${a} ${op} ${b}`);
}

function call(id: string, title: string, summary: string, inputs = [input('x')], category: NodeCategory = 'functions'): NodeTemplate {
  return operation(id, title, id, category, summary, inputs, (args) => `${id}(${args.join(', ')})`);
}

const binaryTemplates = {
  '+': binary('add', 'Add', '+', '+', 'Add two values', '0'),
  '-': binary('sub', 'Subtract', '-', '−', 'Subtract B from A', '0'),
  '*': binary('mul', 'Multiply', '*', '×', 'Multiply two values', '1'),
  '/': binary('div', 'Divide', '/', '÷', 'Divide A by B', '1'),
  '^': binary('pow', 'Power', '^', '^', 'Raise A to the power B', '2'),
};

const numberTemplate = operation('number', 'Number / Slider', '123', 'input', 'Set a number with a slider', [], () => '5');
const listTemplate = operation('list', 'Data List', '{}', 'input', 'Store a list of numbers', [], () => '{1, 2, 3, 4}');
const negTemplate = operation('neg', 'Negate', '−x', 'arithmetic', 'Reverse the sign of a value', [input('x')], ([x]) => `-(${x})`);
const pointTemplate = operation('point', 'Point', '(x, y)', 'output', 'Plot a 2D point', [input('x'), input('y')], ([x, y]) => `(${x}, ${y})`);
const plotTemplate: NodeTemplate = {
  id: 'plot', title: 'Scaled Line', symbol: 'kx', category: 'output', summary: 'Plot a line through the origin',
  inputs: [input('k', '1')], build: (_name, [k]) => `y = ${k} * x`,
};
const quadTemplate: NodeTemplate = {
  id: 'quadplot', title: 'Parabola', symbol: 'ax² + b', category: 'output', summary: 'Plot a quadratic curve',
  inputs: [input('a', '1'), input('b')], build: (_name, [a, b]) => `y = ${a} * x^2 + ${b}`,
};
const templates = [
  numberTemplate, listTemplate, ...Object.values(binaryTemplates),
  call('mod', 'Modulo', 'Remainder after division', pair('0', '1'), 'arithmetic'),
  negTemplate,
  call('sqrt', 'Square Root', 'Take the square root'),
  call('abs', 'Absolute Value', 'Take the magnitude'),
  call('ln', 'Natural Log', 'Logarithm with base e', [input('x', '1')]),
  call('log', 'Common Log', 'Logarithm with base 10', [input('x', '1')]),
  call('exp', 'Exponent', 'Raise e to a power'),
  call('round', 'Round', 'Round to a number of decimal places', [input('x'), input('d')]),
  call('min', 'Minimum', 'Return the smaller value', pair('0')),
  call('max', 'Maximum', 'Return the larger value', pair('0')),
  call('floor', 'Floor', 'Round down to an integer'),
  call('ceil', 'Ceiling', 'Round up to an integer'),
  call('gcd', 'Greatest Common Divisor', 'Find the largest shared divisor', pair('1')),
  call('lcm', 'Least Common Multiple', 'Find the smallest shared multiple', pair('1')),
  call('sin', 'Sine', 'Sine of an angle', [input('x')], 'trig'),
  call('cos', 'Cosine', 'Cosine of an angle', [input('x')], 'trig'),
  call('tan', 'Tangent', 'Tangent of an angle', [input('x')], 'trig'),
  call('mean', 'Mean', 'Average a data list or several numbers', [input('data', '{1, 2, 3, 4}')], 'stats'),
  call('zscore', 'Z-Score', 'Distance from the mean in standard deviations', [input('x'), input('mu'), input('sigma', '1')], 'stats'),
  call('normalcdf', 'Normal CDF', 'Probability between two bounds under a normal distribution',
    [input('a', '-1'), input('b', '1'), input('mu'), input('sigma', '1')], 'stats'),
  pointTemplate, plotTemplate, quadTemplate,
];
const byId = new Map(templates.map((t) => [t.id, t]));

export function searchNodeTemplates(query: string, opts: { hasInput?: boolean } = {}): NodeTemplate[] {
  const words = query.trim().toLowerCase().split(/\s+/);
  return templates.filter((t) => {
    const fields = [t.title, t.id, t.symbol, t.category, t.summary];
    for (const [op, template] of Object.entries(binaryTemplates)) if (template === t) fields.push(op);
    return (!opts.hasInput || t.inputs.length > 0) && words.every((word) => fields.some((field) => field.toLowerCase().includes(word)));
  });
}

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  input: 'Inputs', arithmetic: 'Arithmetic', functions: 'Functions', trig: 'Trigonometry', stats: 'Statistics', output: 'Graph outputs',
};

/** The templates a search finds, in the add-node menu's sections and order. */
export function groupNodeTemplates(query: string, opts: { hasInput?: boolean } = {}): { category: NodeCategory; label: string; templates: NodeTemplate[] }[] {
  const found = searchNodeTemplates(query, opts);
  return (Object.keys(CATEGORY_LABELS) as NodeCategory[]).flatMap((category) => {
    const group = found.filter((t) => t.category === category);
    return group.length ? [{ category, label: CATEGORY_LABELS[category], templates: group }] : [];
  });
}

type Span = readonly [number, number];

export interface InputPin extends PinSpec {
  index: number;
  text: string;
  spans: readonly Span[];
  wiredFrom: { rowId: string; name: string; fromPort?: string } | null;
  editable: boolean;
}

export interface NodeModel {
  rowId: string;
  name: string | null;
  templateId: string | null;
  title: string;
  symbol: string;
  category: NodeCategory;
  inputs: readonly InputPin[];
  isNodeCard: boolean;
  canOutput: boolean;
}

interface PinPart { node: Node; span: Span }
interface NodeInspection { model: NodeModel; tree: Node; parts: PinPart[][] }
type NodeOptions = { lineNames?: boolean };

function parseValue(text: string): Node | null {
  try {
    return parseLine(text);
  } catch {
    return null;
  }
}

function treeKey(tree: Node | null, replacements?: ReadonlyMap<Node, Node>): string {
  return JSON.stringify(tree, (key, value: unknown) => key === 'pos' ? undefined : replacements?.get(value as Node) ?? value);
}

function assignment(n: Node): n is Extract<Node, { k: 'rel' }> {
  return n.k === 'rel' && n.ops.length === 1 && n.ops[0] === '=';
}

function functionHead(n: Node): n is Extract<Node, { k: 'call' }> {
  return n.k === 'call' && !n.dot && !n.base && n.args.length > 0 && n.args.every((arg) => arg.k === 'id');
}

function makeInspector(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], opts: NodeOptions) {
  const definers = sheetDefiners(rows, results, opts);
  const byRow = new Map(rows.map((row, i) => [row.id, { row, result: results[i], i }]));
  const definer = (name: string): Definer | null => byRow.get(definers.get(name) ?? '') ?? null;
  const functionHeads = new Map<string, Extract<Node, { k: 'call' }> | null>();
  const sheetFunction = (name: string) => {
    if (!functionHeads.has(name)) {
      const src = definer(name)?.row;
      const tree = src?.kind === 'expr' ? parseValue(src.text) : null;
      const head = tree && assignment(tree) ? tree.items[0] : null;
      functionHeads.set(name, head && functionHead(head) && head.name === name ? head : null);
    }
    return functionHeads.get(name) ?? null;
  };

  return (row: RowInput, result: RowResult | undefined): NodeInspection | null => {
    if (row.kind !== 'expr' || !row.text.trim() || isHeading(row.text)) return null;
    const { text } = row;
    let parsed: Spanned | null = null;
    try {
      if (!text.includes('\\') && unitPhrase(text) === null) parsed = parseLineSpanned(text);
    } catch {
      // Leave partially typed text without editable spans.
    }
    const tree = parsed?.tree ?? parseValue(text);
    const model: NodeModel = {
      rowId: row.id, name: result?.defines ?? lineDefines(text), templateId: null, title: 'Expression',
      symbol: '', category: 'functions', inputs: [], isNodeCard: false, canOutput: !!tree,
    };
    if (!tree) return null;

    const [lhs, assigned] = assignment(tree) ? tree.items : [];
    if (lhs && functionHead(lhs) && model.name === lhs.name) {
      model.canOutput = false;
      model.title = lhs.name;
      return { model, tree, parts: [] };
    }
    const curve = (lhs?.k === 'id' && (isGraphVar(lhs.name) || !!lettersOf(lhs.name, isGraphVar)))
      || (result?.value === undefined && !!result?.graph.some((g) => g.type === 'fx' || g.type === 'fy' || g.type === 'implicit' || g.type === 'region'))
      || (!lhs && !isFitNode(tree) && namesIn(tree).some(isGraphVar) && result?.value === undefined);
    if (curve || (tree.k === 'rel' && !model.name && !isFitNode(tree))) model.canOutput = false;
    const rhs = lhs?.k === 'id' ? assigned : tree;
    const pins: InputPin[] = [];
    const parts: PinPart[][] = [];
    model.inputs = pins;

    const rawSpan = (node: Node): Span | undefined => {
      const span = parsed?.spanOf(node);
      if (!span || span[0] < 0 || span[0] >= span[1] || span[1] > text.length) return undefined;
      const end = span[0] + text.slice(...span).trimEnd().length;
      if (end <= span[0] || treeKey(parseValue(text.slice(span[0], end))) !== treeKey(node)) return undefined;
      return [span[0], end];
    };

    const wire = (node: Node): InputPin['wiredFrom'] => {
      if (node.k !== 'id' && !(node.k === 'call' && !node.base && node.args.length === 1 && node.args[0].k === 'id')) return null;
      const read = portReads(node, definer, (name) => !!sheetFunction(name)).reads[0];
      const name = read?.name ?? (node.k === 'id' ? node.name : null);
      if (!name || isGraphVar(name)) return null;
      const i = byRow.get(row.id)?.i ?? 0;
      const id = name === 'ans'
        ? rows.slice(0, i).reverse().find((r) => r.kind === 'table' || (r.text.trim() && !isHeading(r.text)))?.id
        : definers.get(name);
      return id && id !== row.id ? { rowId: id, name, ...(read ? { fromPort: read.port } : {}) } : null;
    };

    const add = (spec: PinSpec, nodes: Node[], wiredFrom = wire(nodes[0]), editable = true) => {
      const pinParts = nodes.flatMap((node) => {
        const span = rawSpan(node);
        return span ? [{ node, span }] : [];
      });
      parts.push(pinParts);
      const spans = pinParts.map(({ span }) => span);
      pins.push({
        ...spec, index: pins.length, text: spans[0] ? text.slice(...spans[0]) : spec.label, spans,
        wiredFrom, editable: editable && spans.length === nodes.length,
      });
    };

    const describe = (template: NodeTemplate, isNodeCard = false) => {
      Object.assign(model, { templateId: template.id, title: template.title, symbol: template.symbol, category: template.category, isNodeCard });
    };

    const compound = () => {
      const refs = new Map<string, { source: NonNullable<InputPin['wiredFrom']>; nodes: Node[]; editable: boolean }>();
      const remember = (source: NonNullable<InputPin['wiredFrom']>, node: Node, editable: boolean) => {
        const key = JSON.stringify(source);
        const found = refs.get(key);
        if (!found) refs.set(key, { source, nodes: [node], editable });
        else {
          found.nodes.push(node);
          found.editable &&= editable;
        }
      };
      const visit = (node: Node) => {
        const source = wire(node);
        if (source) {
          remember(source, node, true);
          return;
        }
        // Compact products share one token. Their dependencies can be shown, but that token is not an editable variable span.
        if (node.k === 'id' && !(node.name in CONSTANTS) && !definers.has(node.name)) {
          for (const name of new Set(lettersOf(node.name, (c) => isGraphVar(c) || c in CONSTANTS || definers.has(c)) ?? [])) {
            const id = definers.get(name);
            if (id && id !== row.id) remember({ rowId: id, name }, node, false);
          }
        }
        if (node.k === 'call' && !node.dot && definers.has(node.name) && !sheetFunction(node.name)) {
          const id = definers.get(node.name)!;
          if (id !== row.id) remember({ rowId: id, name: node.name }, node, false);
        }
        // These calls introduce local bindings. Leave the legacy dependency path in charge of their wires.
        if (node.k === 'call' && (scopedCalls.has(node.name) || BUILTINS[node.name]?.binds)) return;
        children(node).forEach(visit);
      };
      visit(rhs);
      for (const { source, nodes, editable } of refs.values()) add(input(source.fromPort ?? source.name), nodes, source, editable);
    };

    if (curve) {
      model.category = 'output';
      model.title = 'Curve';
      const powerOfX = (n: Node) => n.k === 'bin' && n.op === '^' && n.a.k === 'id' && n.a.name === 'x' && n.b.k === 'num' && n.b.v === 2;
      const coefficient = (n: Node) => !namesIn(n).some(isGraphVar)
        && (wire(n) !== null || !namesIn(n).some((name) => definers.has(name)));
      if (lhs?.k === 'id' && lhs.name === 'y' && rhs.k === 'bin') {
        if (rhs.op === '*' && rhs.b.k === 'id' && rhs.b.name === 'x' && coefficient(rhs.a)) {
          describe(plotTemplate);
          if (parsed) add(plotTemplate.inputs[0], [rhs.a]);
          return { model, tree, parts };
        }
        if (rhs.op === '+' && rhs.a.k === 'bin' && rhs.a.op === '*' && powerOfX(rhs.a.b) && [rhs.a.a, rhs.b].every(coefficient)) {
          describe(quadTemplate);
          if (parsed) {
            add(quadTemplate.inputs[0], [rhs.a.a]);
            add(quadTemplate.inputs[1], [rhs.b]);
          }
          return { model, tree, parts };
        }
      }
    } else if (rhs.k === 'num' || (rhs.k === 'un' && rhs.a.k === 'num' && model.name && !inParens(rhs.a))) {
      describe(numberTemplate);
      return { model, tree, parts };
    } else if (rhs.k === 'list' || result && rowPorts(row, result)?.kind === 'list' && rhs.k === 'bracket') {
      describe(listTemplate);
    }

    const structured = (template: NodeTemplate, nodes: Node[], specs = template.inputs) => {
      if (parsed) {
        describe(template, true);
        nodes.forEach((node, i) => add(specs[i] ?? input(`Input ${i + 1}`), [node]));
      } else describe(template);
      return { model, tree, parts };
    };

    if (!curve) {
      if (rhs.k === 'bin' && rhs.op !== 'nCr' && rhs.op !== 'nPr') {
        // A flat operation has one socket per operand. Ungrouped subexpressions with dependencies expose their reads.
        const nested = [rhs.a, rhs.b].some((n) => n.k === 'bin' && !inParens(n) && namesIn(n).some((name) => definers.has(name)));
        if (!nested) return structured(binaryTemplates[rhs.op], [rhs.a, rhs.b]);
      }
      if (rhs.k === 'un') return structured(negTemplate, [rhs.a]);
      if (rhs.k === 'point' && rhs.items.length === 2) return structured(pointTemplate, rhs.items);
      if (rhs.k === 'abs') return structured(byId.get('abs')!, [rhs.a]);
      if (rhs.k === 'call' && !rhs.dot && rhs.args.length >= 1 && rhs.args.length <= 4) {
        const head = sheetFunction(rhs.name);
        const builtin = anyCase(rhs.name);
        if (head || (builtin && !definers.has(rhs.name))) {
          const knownTemplate = byId.get(rhs.name.toLowerCase());
          const template = knownTemplate ?? call(rhs.name, rhs.name, '', rhs.args.map((_, i) => input(rhs.args.length === 1 ? 'x' : `Input ${i + 1}`)));
          // A list readout is replaceable as a whole, so plugging another readout in does not nest mean calls.
          if (wire(rhs)?.fromPort) return structured(template, [rhs], [input('data')]);
          const specs = head ? head.args.map((n) => input(n.k === 'id' ? n.name : 'x')) : callInputs(rhs, template.inputs);
          return structured(template, rhs.args, specs);
        }
      }
    }
    if (parsed) compound();
    return { model, tree, parts };
  };
}

// These parsings include engine-managed locals or rewrite their arguments.
const scopedCalls = new Set(['_with', '_each']);

function callInputs(n: Extract<Node, { k: 'call' }>, specs: PinSpec[]): PinSpec[] {
  switch (n.name.toLowerCase()) {
    case 'log': return n.args.length === 2 ? [input('base', '10'), input('x', '1')] : specs;
    case 'normalcdf': return n.args.length === 1 ? [input('z')] : specs;
    case 'mean': return n.args.length === 1 ? specs : [];
    case 'min': case 'max': return n.args.length === 1 ? [input('data', '{0, 1}')] : specs;
    default: return specs;
  }
}

/** Reuse the sheet's definition index when inspecting several rows in one pass. */
export function createNodeInspector(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], opts: NodeOptions = {}): (row: RowInput, result: RowResult | undefined) => NodeModel | null {
  const inspect = makeInspector(rows, results, opts);
  return (row, result) => inspect(row, result)?.model ?? null;
}

/** Dependency wires with per-pin targets for every wired input socket on the sheet. */
export function nodeSheetWires(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], opts: NodeOptions = {}): Wire[] {
  return sheetWires(rows, results, { ...opts, inspectPins: createNodeInspector(rows, results, opts) });
}

export function inspectNode(row: RowInput, result: RowResult | undefined, rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], opts: NodeOptions = {}): NodeModel | null {
  return createNodeInspector(rows, results, opts)(row, result);
}

export function nextNodeName(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], prefix = 'n'): string {
  const defined = sheetDefiners(rows, results, { lineNames: true });
  const used = new Set(defined.keys());
  for (const row of rows) {
    const tree = row.kind === 'expr' && row.text.trim() && !isHeading(row.text) ? parseValue(row.text) : null;
    if (tree) for (const name of namesIn(tree)) used.add(name);
  }
  const safePrefix = /^[a-z][a-z0-9_]*$/i.test(prefix) ? prefix : 'n';
  const available = (candidate: string) => {
    const name = canonicalName(candidate);
    return !used.has(name) && !RESERVED.has(name) && !(name in CONSTANTS) && !(name in BUILTINS) && lineDefines(`${candidate} = 0`) === name;
  };
  if (prefix === 'a') {
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') if (available(letter)) return letter;
  }
  for (let i = 1; ; i++) {
    const candidate = `${safePrefix}${i}`;
    if (available(candidate)) return candidate;
  }
}

export function wouldCreateCycle(wires: readonly Wire[], fromId: string, toId: string): boolean {
  const next = new Map<string, string[]>();
  for (const { from, to } of wires) {
    const targets = next.get(from);
    if (targets) targets.push(to);
    else next.set(from, [to]);
  }
  const seen = new Set<string>();
  const pending = [toId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id === fromId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const target of next.get(id) ?? []) pending.push(target);
  }
  return false;
}

type Connection = { fromId: string; fromPort?: string; toId: string; toPin: number };
export type NodeChange = { rowId: string; text: string };
type Rejection = { ok: false; reason: 'self' | 'cycle' | 'invalid' };
export type NodeMutationResult = { ok: true; changes: NodeChange[] } | Rejection;

export const nodeRejectionText = (reason: Rejection['reason']): string => reason === 'cycle' ? 'That would make a loop' : "Can't connect these";

const invalid: Rejection = { ok: false, reason: 'invalid' };

type ExprRow = Extract<RowInput, { kind: 'expr' }>;
const exprRow = (rows: readonly CanvasRow[], id: string): ExprRow | undefined =>
  rows.find((r): r is ExprRow => r.id === id && r.kind === 'expr');

// Compare syntax around the edit using the parser's own binding rules, including implicit multiplication and power.
function replacePins(text: string, inspection: NodeInspection, index: number, value: string): string | null {
  const replacement = parseValue(value);
  if (!replacement || replacement.k === 'rel' || !inspection.model.inputs[index]?.editable) return null;
  const expression = unitPhrase(value) ?? lexedText(value);
  const parts = [...inspection.parts[index]].sort((a, b) => b.span[0] - a.span[0]);
  const expected = new Map<Node, Node>();
  let edited = text;
  for (const { node, span: [start, end] } of parts) {
    expected.set(node, replacement);
    const shape = treeKey(inspection.tree, expected);
    const matches = (candidate: string) => treeKey(parseValue(candidate)) === shape;
    const splice = (value: string) => edited.slice(0, start) + value + edited.slice(end);
    const bare = splice(expression);
    // `a - -1` and `--3` parse, but read as typos.
    const signs = /^[-−]/.test(expression) && /[-−+]\s*$/.test(edited.slice(0, start));
    if (!signs && matches(bare)) edited = bare;
    else {
      const grouped = splice(`(${expression})`);
      if (!matches(grouped)) return null;
      edited = grouped;
    }
  }
  return edited;
}

export function connectPin(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], settings: Settings, req: Connection): NodeMutationResult {
  if (req.fromId === req.toId) return { ok: false, reason: 'self' };
  const source = exprRow(rows, req.fromId);
  const target = exprRow(rows, req.toId);
  if (!source || !target) return invalid;
  const inspect = makeInspector(rows, results, settings);
  const resultOf = (id: string) => results[rows.findIndex((r) => r.id === id)];
  const result = resultOf(source.id);
  const from = inspect(source, result);
  const to = inspect(target, resultOf(target.id));
  if (!from || !to?.model.inputs[req.toPin]?.editable) return invalid;
  const port = req.fromPort === undefined ? null : rowPorts(source, result);
  if (req.fromPort === undefined ? !from.model.canOutput : !port?.ports.includes(req.fromPort)) return invalid;
  if (wouldCreateCycle(sheetWires(rows, results, settings), source.id, target.id)) return { ok: false, reason: 'cycle' };

  const changes: NodeChange[] = [];
  const definers = sheetDefiners(rows, results, settings);
  const owns = (name: string | null | undefined): name is string => !!name && definers.get(name) === source.id;
  if (from.model.name && !owns(from.model.name)) return invalid;
  // A fit's parameters are names of their own. Every other output is read through its row's name, given one if it has none.
  let base = '';
  if (port?.kind !== 'fit') {
    const lineName = settings.lineNames ? result?.lineName : undefined;
    base = from.model.name ?? (owns(lineName) ? lineName : '');
    if (!base) {
      if (from.tree.k === 'rel') return invalid;
      base = nextNodeName(rows, results);
      const text = assign(base, (unitPhrase(source.text) ?? lexedText(source.text)).trim());
      const parsed = parseValue(text);
      if (!parsed || !assignment(parsed) || treeKey(parsed.items[1]) !== treeKey(from.tree)) return invalid;
      changes.push({ rowId: source.id, text });
    }
  }
  let name = port ? portExpr(base, port.kind, req.fromPort!) : base;
  if (port?.kind === 'list') {
    const call = parseValue(name);
    if (call?.k === 'call' && definers.has(call.name)) {
      const alias = Object.keys(LIST_FNS).find((fn) => LIST_FNS[fn] === req.fromPort && !definers.has(fn));
      name = alias ? `${alias}(${base})` : '';
    }
  }
  if (!name) return invalid;

  const text = replacePins(target.text, to, req.toPin, name);
  if (text === null) return invalid;
  changes.push({ rowId: target.id, text });
  return { ok: true, changes };
}

export function canConnect(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], settings: Settings, req: Connection): { ok: true } | Rejection {
  const result = connectPin(rows, results, settings, req);
  return result.ok ? { ok: true } : result;
}

function editPin(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], settings: Settings, rowId: string, pinIndex: number, value?: string): NodeMutationResult {
  const row = exprRow(rows, rowId);
  if (!row) return invalid;
  const inspection = makeInspector(rows, results, settings)(row, results[rows.findIndex((r) => r.id === rowId)]);
  const pin = inspection?.model.inputs[pinIndex];
  if (!inspection || !pin?.editable) return invalid;
  const text = replacePins(row.text, inspection, pinIndex, value === undefined ? pin.defaultValue : value.trim());
  return text === null ? invalid : { ok: true, changes: [{ rowId, text }] };
}

export function disconnectPin(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], settings: Settings, req: { rowId: string; pinIndex: number }): NodeMutationResult {
  return editPin(rows, results, settings, req.rowId, req.pinIndex);
}

export function setPinValue(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], settings: Settings, req: { rowId: string; pinIndex: number; value: string }): NodeMutationResult {
  return editPin(rows, results, settings, req.rowId, req.pinIndex, req.value);
}

/** The new row's text, plus any existing rows to change in the same edit. */
export interface SpawnPlan { text: string; changes: NodeChange[] }

export function planSpawnNode(rows: readonly CanvasRow[], results: readonly (RowResult | undefined)[], settings: Settings, req: {
  templateId: string; connectFrom?: { rowId: string; fromPort?: string }; toPin?: number;
}): SpawnPlan | null {
  const template = byId.get(req.templateId);
  if (!template) return null;
  const name = template === plotTemplate || template === quadTemplate ? null : nextNodeName(rows, results, template === numberTemplate ? 'a' : 'n');
  const text = template.build(name, template.inputs.map((pin) => pin.defaultValue));
  if (!req.connectFrom) return { text, changes: [] };
  // This row lives only for validation. The front end assigns the real id when applying the plan.
  let id = '#new-node';
  while (rows.some((r) => r.id === id)) id += '#';
  const toPin = req.toPin ?? 0;
  const attached = connectPin([...rows, { id, kind: 'expr', text }], results, settings, {
    fromId: req.connectFrom.rowId, fromPort: req.connectFrom.fromPort, toId: id, toPin,
  });
  if (!attached.ok) return null;
  const changes = attached.changes.filter((change) => change.rowId !== id);
  return { text: attached.changes.find((change) => change.rowId === id)!.text, changes };
}

/** A cubic with horizontal tangents at the source and destination sockets. */
export function bezierWirePath(from: Point, to: Point): string {
  const reach = Math.max(24, Math.abs(to.x - from.x) * 0.5, Math.abs(to.y - from.y) * 0.25);
  return `M${from.x},${from.y} C${from.x + reach},${from.y} ${to.x - reach},${to.y} ${to.x},${to.y}`;
}
