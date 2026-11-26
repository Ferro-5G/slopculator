import { describe, expect, it } from 'vitest';
import { cleanSettings, evaluateDocument, type RowInput } from '../src/engine/document';
import { GRAPH_BLOCK, sheetWires, wireKey, type Rect, type Wire } from '../src/ui/canvas';
import { wideWireRoutes } from '../src/ui/canvaswide';
import { cleanSheetView, withSheetView } from '../src/ui/document';
import {
  bezierWirePath, canConnect, connectPin, disconnectPin, groupNodeTemplates, inspectNode, nextNodeName, nodeSheetWires,
  planSpawnNode, searchNodeTemplates, setPinValue, wouldCreateCycle, type NodeMutationResult,
} from '../src/ui/nodegraph';

const settings = cleanSettings({});
const lines = (...texts: string[]) => texts.map((text, i) => ({ id: `r${i + 1}`, kind: 'expr' as const, text }));
const evaluate = (rows: RowInput[]) => evaluateDocument(rows, settings);
const inspect = (rows: RowInput[], i: number) => {
  const results = evaluate(rows);
  return inspectNode(rows[i], results[i], rows, results);
};
const apply = (rows: RowInput[], mutation: NodeMutationResult): RowInput[] => {
  if (!mutation.ok) throw new Error(`Unexpected rejection: ${mutation.reason}`);
  return rows.map((row) => {
    const change = mutation.changes.find((c) => c.rowId === row.id);
    return row.kind === 'expr' && change ? { ...row, text: change.text } : row;
  });
};
const texts = (rows: RowInput[]) => rows.map((row) => row.kind === 'expr' ? row.text : '');


it('routes both wires to their measured input sockets even on vertically stacked blocks', () => {
  const wires: Wire[] = [
    { from: 'source', fromPort: 'mean', to: 'target', toPin: 0, name: 'data' },
    { from: 'source', fromPort: 'mean', to: 'target', toPin: 1, name: 'data' },
  ];
  const rects = new Map<string, Rect>([
    ['source', { x: 0, y: 0, w: 120, h: 60 }],
    ['target', { x: 0, y: 140, w: 120, h: 60 }],
  ]);
  const routes = wideWireRoutes(wires, rects, null, () => false, null, () => 0, {
    portY: () => 42.5,
    inPortY: (wire) => wire.toPin === 0 ? 151.5 : 181.5,
  });
  expect(routes.map((r) => [r.from, r.to])).toEqual([
    [{ x: 120, y: 42.5 }, { x: 0, y: 151.5 }],
    [{ x: 120, y: 42.5 }, { x: 0, y: 181.5 }],
  ]);
});

describe('node templates', () => {
  it('contains the full catalog', () => {
    expect(searchNodeTemplates('').map((t) => t.id)).toEqual([
      'number', 'list', 'add', 'sub', 'mul', 'div', 'pow', 'mod', 'neg',
      'sqrt', 'abs', 'ln', 'log', 'exp', 'round', 'min', 'max', 'floor', 'ceil', 'gcd', 'lcm',
      'sin', 'cos', 'tan', 'mean', 'zscore', 'normalcdf', 'point', 'plot', 'quadplot',
    ]);
  });

  it.each(searchNodeTemplates('').map((t) => [t.id, t] as const))('spawns and evaluates %s in the document engine', (id, template) => {
    const plan = planSpawnNode([], [], settings, { templateId: id });
    expect(plan?.changes).toEqual([]);
    const rows = lines(plan!.text);
    const [result] = evaluate(rows);
    expect(result.error).toBeUndefined();
    expect(result.value !== undefined || result.graph.length > 0).toBe(true);
    expect(result.graph.length > 0).toBe(template.category === 'output');
    const model = inspectNode(rows[0], result, rows, [result]);
    expect(model?.templateId).toBe(id);
    expect(model?.inputs.map(({ label, defaultValue }) => ({ label, defaultValue }))).toEqual(template.inputs);
    expect(model?.inputs.every((pin) => pin.editable)).toBe(true);
  });

  it('searches all display fields and filters out templates without inputs', () => {
    expect(searchNodeTemplates('  SQUARE root ').map((t) => t.id)).toEqual(['sqrt']);
    expect(searchNodeTemplates('×').map((t) => t.id)).toEqual(['mul']);
    expect(searchNodeTemplates('*').map((t) => t.id)).toEqual(['mul']);
    expect(searchNodeTemplates('trig').map((t) => t.id)).toEqual(['sin', 'cos', 'tan']);
    expect(searchNodeTemplates('standard deviations').map((t) => t.id)).toEqual(['zscore']);
    expect(searchNodeTemplates('number / slider', { hasInput: true })).toEqual([]);
    expect(searchNodeTemplates('', { hasInput: true })).toHaveLength(28);
    expect(searchNodeTemplates('unmatched')).toEqual([]);
  });

  it('groups search results into labeled sections in menu order', () => {
    expect(groupNodeTemplates('').map((g) => g.label)).toEqual(['Inputs', 'Arithmetic', 'Functions', 'Trigonometry', 'Statistics', 'Graph outputs']);
    expect(groupNodeTemplates('', { hasInput: true }).map((g) => g.category)).not.toContain('input');
    expect(groupNodeTemplates('log')).toEqual([{ category: 'functions', label: 'Functions', templates: searchNodeTemplates('log') }]);
  });
});

describe('node inspection', () => {
  it.each([['+', 'add', '0'], ['-', 'sub', '0'], ['*', 'mul', '1'], ['/', 'div', '1'], ['^', 'pow', '2']])(
    'inspects the two operands of %s', (op, templateId, defaultValue) => {
      const rows = lines('a = 5', `t = a ${op} 3`);
      const model = inspect(rows, 1);
      expect(model).toMatchObject({ name: 't', templateId, isNodeCard: true, canOutput: true, category: 'arithmetic' });
      expect(model?.inputs).toEqual([
        { index: 0, label: 'A', defaultValue, text: 'a', spans: [[4, 5]], wiredFrom: { rowId: 'r1', name: 'a' }, editable: true },
        { index: 1, label: 'B', defaultValue, text: '3', spans: [[8, 9]], wiredFrom: null, editable: true },
      ]);
    },
  );

  it('inspects negation, points, built-ins and user calls', () => {
    const rows = lines('a = 5', 'n1 = -a', 'P = (a, 3)', 'n2 = normalcdf(-1, 2, 0, 3)', 'f(t, u) = t + u', 'n3 = f(a, 2)', 'n4 = hypot(3, 4)');
    expect(inspect(rows, 1)).toMatchObject({ templateId: 'neg', isNodeCard: true, inputs: [{ label: 'x', text: 'a' }] });
    expect(inspect(rows, 2)).toMatchObject({ templateId: 'point', isNodeCard: true, canOutput: true, inputs: [{ label: 'x', text: 'a' }, { label: 'y', text: '3' }] });
    expect(inspect(rows, 3)?.inputs.map((p) => [p.label, p.text])).toEqual([['a', '-1'], ['b', '2'], ['mu', '0'], ['sigma', '3']]);
    expect(inspect(rows, 4)).toMatchObject({ isNodeCard: false, canOutput: false, inputs: [] });
    expect(inspect(rows, 5)).toMatchObject({ isNodeCard: true, inputs: [{ label: 't', text: 'a' }, { label: 'u', text: '2' }] });
    expect(inspect(rows, 6)).toMatchObject({ isNodeCard: true, inputs: [{ editable: true, text: '3' }, { editable: true, text: '4' }] });
  });

  it('keeps sliders and data lists as input rows and excludes headings and blanks', () => {
    const rows = lines('a = 5', 'b = -4', 'data = {1, 2, 3, 4}', '# Chapter', ' ');
    for (const k of [0, 1, 2]) expect(inspect(rows, k)).toMatchObject({ category: 'input', canOutput: true, isNodeCard: false, inputs: [] });
    expect(inspect(rows, 3)).toBeNull();
    expect(inspect(rows, 4)).toBeNull();
  });

  it('collects every occurrence of each variable in a compound formula', () => {
    const rows = lines('a = 2', 'b = 5', 'c = 3', 'd = b^2 - 4*a*c + b');
    const model = inspect(rows, 3);
    expect(model).toMatchObject({ isNodeCard: false, canOutput: true });
    expect(model?.inputs.map((p) => [p.label, p.spans])).toEqual([
      ['b', [[4, 5], [18, 19]]], ['a', [[12, 13]]], ['c', [[14, 15]]],
    ]);
    const result = connectPin(rows, evaluate(rows), settings, { fromId: 'r1', toId: 'r4', toPin: 0 });
    expect(texts(apply(rows, result))[3]).toBe('d = a^2 - 4*a*c + a');
  });

  it('exposes curve parameters and keeps outgoing graph wires', () => {
    const rows = lines('k = 4', 'a = 2', 'b = 3', 'y = k * x', 'y = 2 * x^2 + 3', 'y = sin(a*x) + b', 'x = y + a');
    expect(inspect(rows, 3)).toMatchObject({ templateId: 'plot', category: 'output', canOutput: false, inputs: [{ label: 'k', text: 'k', wiredFrom: { rowId: 'r1', name: 'k' } }] });
    expect(inspect(rows, 4)).toMatchObject({ templateId: 'quadplot', canOutput: false, inputs: [{ text: '2' }, { text: '3' }] });
    expect(inspect(rows, 5)?.inputs.map((p) => p.label)).toEqual(['a', 'b']);
    expect(inspect(rows, 6)).toMatchObject({ canOutput: false, inputs: [{ text: 'a' }] });
    expect(nodeSheetWires(rows, evaluate(rows))).toContainEqual({ from: 'r4', to: GRAPH_BLOCK, name: '' });
  });

  it('leaves rewritten text and synthetic spans out of raw edits', () => {
    const rows = lines('5 mi to km', String.raw`\frac{1}{2} + 1`, 'a = 2', 'b = a²');
    for (const i of [0, 1]) {
      expect(inspect(rows, i)).toMatchObject({ canOutput: true, isNodeCard: false, inputs: [] });
      expect(setPinValue(rows, evaluate(rows), settings, { rowId: rows[i].id, pinIndex: 0, value: '3' })).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(inspect(rows, 3)?.inputs[1]).toMatchObject({ editable: false, spans: [] });
  });

  it('resolves direct variables, readout expressions and fit parameters to the correct port', () => {
    const rows = lines('A = psych(26, 50, "SI")', 'data = {1, 2, 3, 4}', 'q = A.h + mean(data)', 'm2 = mean(data)',
      'x1 = [1, 2, 3, 4]', 'y1 = [2, 4, 6, 8]', 'y1 ~ m*x1 + b', 'r = m + 0');
    expect(inspect(rows, 2)?.inputs.map((p) => [p.text, p.wiredFrom])).toEqual([
      ['A.h', { rowId: 'r1', name: 'A', fromPort: 'h' }],
      ['mean(data)', { rowId: 'r2', name: 'data', fromPort: 'mean' }],
    ]);
    expect(inspect(rows, 3)?.inputs[0].wiredFrom?.fromPort).toBe('mean');
    expect(inspect(rows, 7)?.inputs[0].wiredFrom).toEqual({ rowId: 'r7', name: 'm', fromPort: 'm' });
    expect(nodeSheetWires(rows, evaluate(rows)).filter((w) => w.to === 'r3').map(wireKey)).toEqual(['r1.h>r3@0', 'r2.mean>r3@1']);
  });
});

describe('pin mutations', () => {
  it('wires each operand and evaluates the resulting row', () => {
    const rows = lines('a = 5', 'b = 3', 'n1 = 0 + 0');
    const req = { fromId: 'r1', toId: 'r3', toPin: 0 };
    expect(canConnect(rows, evaluate(rows), settings, req)).toEqual({ ok: true });
    const first = apply(rows, connectPin(rows, evaluate(rows), settings, req));
    expect(texts(first)[2]).toBe('n1 = a + 0');
    expect(evaluate(first)[2].value).toBe(5);
    const both = apply(first, connectPin(first, evaluate(first), settings, { ...req, fromId: 'r2', toPin: 1 }));
    expect(texts(both)[2]).toBe('n1 = a + b');
    expect(evaluate(both)[2].value).toBe(8);
    expect(rows[2].text).toBe('n1 = 0 + 0');
  });

  it('names an anonymous source and updates its consumer in one plan', () => {
    const rows = lines('3 + 4', 'n2 = 10 - 2');
    const mutation = connectPin(rows, evaluate(rows), settings, { fromId: 'r1', toId: 'r2', toPin: 1 });
    expect(mutation).toEqual({ ok: true, changes: [{ rowId: 'r1', text: 'n1 = 3 + 4' }, { rowId: 'r2', text: 'n2 = 10 - n1' }] });
    expect(evaluate(apply(rows, mutation))[1].value).toBe(3);
  });

  it('uses only the requested pin when both read the same variable', () => {
    const rows = lines('a = 5', 'n1 = a + a');
    const results = evaluate(rows);
    expect(sheetWires(rows, results).map(wireKey)).toEqual(['r1>r2']);
    expect(nodeSheetWires(rows, results).map(wireKey)).toEqual(['r1>r2@0', 'r1>r2@1']);
    expect(disconnectPin(rows, results, settings, { rowId: 'r2', pinIndex: 1 })).toEqual({ ok: true, changes: [{ rowId: 'r2', text: 'n1 = a + 0' }] });
  });

  it('rejects cycles, self-wiring, invalid pins and unavailable ports', () => {
    const rows = lines('A = 1 + 0', 'B = A + 1', 'C = B + 1');
    const results = evaluate(rows);
    const req = { fromId: 'r3', toId: 'r1', toPin: 0 };
    expect(wouldCreateCycle(sheetWires(rows, results), 'r3', 'r1')).toBe(true);
    expect(wouldCreateCycle(sheetWires(rows, results), 'r1', 'r3')).toBe(false);
    expect(connectPin(rows, results, settings, req)).toEqual({ ok: false, reason: 'cycle' });
    expect(canConnect(rows, results, settings, { ...req, fromId: 'r1' })).toEqual({ ok: false, reason: 'self' });
    expect(connectPin(rows, results, settings, { fromId: 'r1', toId: 'r3', toPin: 2 })).toEqual({ ok: false, reason: 'invalid' });
    expect(connectPin(rows, results, settings, { fromId: 'r1', fromPort: 'h', toId: 'r3', toPin: 0 })).toEqual({ ok: false, reason: 'invalid' });
    expect(texts(rows)).toEqual(['A = 1 + 0', 'B = A + 1', 'C = B + 1']);
  });

  it.each([
    ['n1 = 2 * 3', 0, ' 1 + 2 ', 'n1 = (1 + 2) * 3', 9],
    ['n1 = 2 * 3', 0, '-3', 'n1 = -3 * 3', -9],
    ['n1 = 2^2', 0, '-3', 'n1 = (-3)^2', 9],
    ['n1 = 2^2', 1, '-3', 'n1 = 2^-3', 0.125],
    ['n1 = 12 / 2', 1, '2 * 3', 'n1 = 12 / (2 * 3)', 2],
    ['n1 = (2) * 3', 0, '1 + 2', 'n1 = (1 + 2) * 3', 9],
    ['n1 = max(1, 2)', 1, '3 + 4', 'n1 = max(1, 3 + 4)', 7],
    ['n1 = 5 - 1', 1, '-1', 'n1 = 5 - (-1)', 6],
    ['n1 = -(2)', 0, '-3', 'n1 = -(-3)', 3],
  ] as const)('preserves the syntax around a replacement in %s', (original, pinIndex, value, expected, answer) => {
    const rows = lines(original);
    const result = setPinValue(rows, evaluate(rows), settings, { rowId: 'r1', pinIndex, value });
    const edited = apply(rows, result);
    expect(texts(edited)).toEqual([expected]);
    expect(evaluate(edited)[0].value).toBe(answer);
  });

  it('rejects invalid pin text and assignments', () => {
    const rows = lines('2 + 3');
    for (const value of [' ', '1 +', 'a = 2']) {
      expect(setPinValue(rows, evaluate(rows), settings, { rowId: 'r1', pinIndex: 1, value })).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('inserts a converted unit phrase using the same normalization as the document', () => {
    const rows = lines('0 + 0');
    const result = setPinValue(rows, evaluate(rows), settings, { rowId: 'r1', pinIndex: 1, value: '5 mi to km' });
    expect(texts(apply(rows, result))).toEqual(['0 + convert(5, "mi", "km")']);
    expect(evaluate(apply(rows, result))[0].value).toBe(evaluate(lines('5 mi to km'))[0].value);
  });

  it('inserts runnable expressions for readout ports', () => {
    const rows = lines('data = {1, 2, 3, 4}', 'n1 = 2^2');
    const wired = apply(rows, connectPin(rows, evaluate(rows), settings, { fromId: 'r1', fromPort: 'mean', toId: 'r2', toPin: 0 }));
    expect(texts(wired)[1]).toBe('n1 = mean(data)^2');
    expect(evaluate(wired)[1].value).toBe(6.25);
  });

  it('names an anonymous list before wiring one of its readouts', () => {
    const rows = lines('{1, 2, 3, 4}', 'n2 = 1 + 0');
    const mutation = connectPin(rows, evaluate(rows), settings, { fromId: 'r1', fromPort: 'mean', toId: 'r2', toPin: 1 });
    expect(mutation).toEqual({ ok: true, changes: [{ rowId: 'r1', text: 'n1 = {1, 2, 3, 4}' }, { rowId: 'r2', text: 'n2 = 1 + mean(n1)' }] });
    expect(evaluate(apply(rows, mutation))[1].value).toBe(3.5);
  });

  it('reads an unnamed line by its line name instead of renaming it', () => {
    const named = cleanSettings({ lineNames: true });
    const rows = lines('3 + 4', 'n1 = 1 + 0');
    const results = evaluateDocument(rows, named);
    const mutation = connectPin(rows, results, named, { fromId: 'r1', toId: 'r2', toPin: 1 });
    expect(mutation).toEqual({ ok: true, changes: [{ rowId: 'r2', text: `n1 = 1 + ${results[0].lineName}` }] });
    expect(evaluateDocument(apply(rows, mutation), named)[1].value).toBe(8);
  });

  it('refuses an output whose name another line defines', () => {
    const rows = lines('a = 1', 'a = 2', 'n1 = 0 + 0');
    expect(connectPin(rows, evaluate(rows), settings, { fromId: 'r2', toId: 'r3', toPin: 0 })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('uses a list readout alias when a sheet function shadows the default call', () => {
    const rows = lines('data = {1, 2, 3, 4}', 'mean(t) = 100', 'n1 = 1 + 0');
    const wired = apply(rows, connectPin(rows, evaluate(rows), settings, { fromId: 'r1', fromPort: 'mean', toId: 'r3', toPin: 1 }));
    expect(texts(wired)[2]).toBe('n1 = 1 + avg(data)');
    expect(evaluate(wired)[2].value).toBe(3.5);
    expect(inspect(wired, 2)?.inputs[1].wiredFrom?.fromPort).toBe('mean');
  });
});

describe('naming and spawning', () => {
  it('avoids explicit definitions, table names, reserved names and aliases', () => {
    const rows: RowInput[] = [...lines('n1 = 1', 'a = 2', 'b = 3'), { id: 'table', kind: 'table', columns: [{ header: 'n2', cells: ['1'] }] }];
    const results = evaluate(rows);
    expect(nextNodeName(rows, results)).toBe('n3');
    expect(nextNodeName(rows, results, 'a')).toBe('c');
    const all = lines(...[...'abcdefghijklmnopqrstuvwxyz'].filter((letter) => !['e', 'i', 'x', 'y'].includes(letter)).map((letter) => `${letter} = 2`));
    expect(nextNodeName(all, evaluate(all), 'a')).toBe('a1');
  });

  it('connects a named source to the requested pin in the new row', () => {
    const rows = lines('a = 5');
    const req = { templateId: 'sub', connectFrom: { rowId: 'r1' }, toPin: 1 };
    expect(planSpawnNode(rows, evaluate(rows), settings, req)).toEqual({ text: 'n1 = 0 - a', changes: [] });
    expect(planSpawnNode(rows, evaluate(rows), settings, { ...req, templateId: 'plot', toPin: 0 })?.text).toBe('y = a * x');
    expect(planSpawnNode(rows, evaluate(rows), settings, { ...req, templateId: 'list' })).toBeNull();
    expect(planSpawnNode(rows, evaluate(rows), settings, { ...req, templateId: 'missing' })).toBeNull();
  });

  it('reserves the new name before planning an anonymous source name', () => {
    const rows = lines('3 + 4');
    const plan = planSpawnNode(rows, evaluate(rows), settings, { templateId: 'add', connectFrom: { rowId: 'r1' } });
    expect(plan).toEqual({ text: 'n1 = n2 + 0', changes: [{ rowId: 'r1', text: 'n2 = 3 + 4' }] });
    const final = apply(rows, { ok: true, changes: plan!.changes });
    expect(evaluate([...final, { id: 'new', kind: 'expr', text: plan!.text }])[1].value).toBe(7);
  });
});

it('draws a cubic drag path with horizontal end tangents', () => {
  expect(bezierWirePath({ x: 0, y: 10 }, { x: 100, y: 60 })).toBe('M0,10 C50,10 50,60 100,60');
  expect(bezierWirePath({ x: 60, y: 20 }, { x: 20, y: 40 })).toBe('M60,20 C84,20 -4,40 20,40');
});

it('sanitizes and transfers the phone node canvas view flag', () => {
  expect(cleanSheetView({ nodes: true })).toEqual({ nodes: true });
  expect(cleanSheetView({ nodes: false })).toEqual({ nodes: false });
  expect(cleanSheetView({ nodes: 'yes' })).toEqual({});
  expect(withSheetView({ graph: true }, { nodes: true })).toEqual({ nodes: true });
  expect(withSheetView({ nodes: true }, {}, true)).toEqual({ nodes: true });
  expect(withSheetView({ nodes: true }, {}, false)).toEqual({});
});
