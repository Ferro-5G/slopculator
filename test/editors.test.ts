import { describe, expect, it } from 'vitest';
import type { Settings } from '../src/engine/evaluator';
import type { DisplayOpts } from '../src/engine/format';
import { dataListSummary, evaluateBuilderPreview, FORM_BUILDERS, parseListItems } from '../src/ui/builders';
import { EDITORS, polygonPreviewPoints, stepSize, vectorMagnitude, type ListEditor } from '../src/ui/editors';

const { matrix, shape, vector } = EDITORS;
const blank = (spec: ListEditor) => Array.from({ length: spec.size.max }, () => Array.from({ length: spec.columns }, () => ''));
const filled = (spec: ListEditor, rows: string[][]) => blank(spec).map((row, r) => rows[r] ?? row);

describe('the shape editor', () => {
  it('asks for two points, and says so on the first box to fill', () => {
    expect(shape.problems(blank(shape), 3)).toEqual([{ r: 0, c: 0, message: 'A shape needs at least 2 points.' }]);
    expect(shape.problems(filled(shape, [['1', '2']]), 3)).toEqual([{ r: 1, c: 0, message: 'A shape needs at least 2 points.' }]);
  });
  it('flags a half-filled point on its empty side, first', () => {
    expect(shape.problems(filled(shape, [['1', '']]), 3).map((p) => [p.r, p.c])).toEqual([[0, 1], [0, 1]]);
    expect(shape.problems(filled(shape, [['1', '2'], ['', '4'], ['5', '6']]), 3)).toEqual([{ r: 1, c: 0, message: 'Fill in both x and y, or leave this point empty.' }]);
  });
  it('writes the points it has, past the count nothing', () => {
    expect(shape.line(' T ', filled(shape, [['1', '2'], ['', ''], ['3', '4'], ['5', '6']]), 3)).toBe('T = polygon((1, 2), (3, 4))');
    expect(shape.line('', filled(shape, [['1', '2'], ['3', '4']]), 2)).toBe('polygon((1, 2), (3, 4))');
  });
});

describe('the vector editor', () => {
  it('says what is missing on its first box, as a cell problem', () => {
    expect(vector.problems(blank(vector), 2)).toEqual([{ r: 0, c: 0, message: 'Fill in at least one component.' }]);
    expect(vector.problems(filled(vector, [[''], ['3']]), 2)).toEqual([]);
    expect(vector.problems(filled(vector, [[''], [''], ['3']]), 2)).toHaveLength(1);
  });
  it('writes each component, an empty one as 0', () => {
    expect(vector.line(' v ', filled(vector, [['1'], [''], ['3']]), 3)).toBe('v = ⟨1, 0, 3⟩');
    expect(vector.line('', filled(vector, [['1'], ['2']]), 2)).toBe('⟨1, 2⟩');
  });
  it('heads components x, y, z up to three, then counts', () => {
    expect([0, 1, 2].map((r) => vector.heading(r, 3))).toEqual(['x', 'y', 'z']);
    expect([0, 3].map((r) => vector.heading(r, 4))).toEqual(['1', '4']);
  });
});

describe('the matrix editor', () => {
  it('writes rows and columns up to its size, an empty box as 0', () => {
    expect(matrix.line('A', [['1', ''], ['3', '4'], ['9', '9']], 2, 2)).toBe('A = [[1, 0], [3, 4]]');
    expect(matrix.line('', [['1', '2', '9']], 1, 2)).toBe('[[1, 2]]');
  });
});

describe('stepSize', () => {
  it('stays inside an editor\'s limits', () => {
    expect(stepSize(shape.size, shape.size.min, -1)).toBe(shape.size.min);
    expect(stepSize(vector.size, vector.size.max, 1)).toBe(vector.size.max);
    expect(stepSize(matrix.size, 2, 1)).toBe(3);
  });
});

describe('live geometry previews', () => {
  it('extracts numeric polygon points and skips incomplete or symbolic coordinates', () => {
    expect(polygonPreviewPoints([['0', '0'], ['4', '0'], ['2', '3'], ['x', '1']], 4)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
    ]);
  });

  it('computes vector magnitude when all active components are numeric', () => {
    expect(vectorMagnitude([['3'], ['4']], 2)).toBe(5);
    expect(vectorMagnitude([['3'], ['']], 2)).toBe(3);
    expect(vectorMagnitude([[''], ['']], 2)).toBeNull();
    expect(vectorMagnitude([['a'], ['4']], 2)).toBeNull();
  });
});

describe('declarative GUI builders', () => {
  const settings: Settings = { deg: false, complex: true, sample: true };
  const display: DisplayOpts = { places: null, exact: false, percent: false };

  it('builds and live-evaluates Calculus, Normal, Chance, and HVAC expressions', () => {
    const intExpr = FORM_BUILDERS.calc.modes[0].build({ expr: 'x^2', var: 'x', a: '0', b: '3' }, '');
    expect(intExpr).toBe('integral(x^2, x, 0, 3)');
    expect(evaluateBuilderPreview(intExpr, [], settings, display)).toEqual({ answer: '9', error: null });

    const normExpr = FORM_BUILDERS.normal.modes[0].build({ a: '-1', b: '1', mu: '0', sd: '1' }, '');
    expect(normExpr).toBe('normalcdf(-1, 1)');
    expect(evaluateBuilderPreview(normExpr, [], settings, display).answer).toMatch(/^0\.68268/);

    const binomExpr = FORM_BUILDERS.chance.modes[0].build({ n: '10', p: '0.5', k: '5' }, '');
    expect(binomExpr).toBe('binompdf(10, 0.5, 5)');
    expect(evaluateBuilderPreview(binomExpr, [], settings, display).answer).toMatch(/^0\.24609/);

    const shExpr = FORM_BUILDERS.hvac.modes[0].build({ fluid: 'R-410A', p: '118', t: '50', si: 'false' }, '');
    expect(shExpr).toBe('superheat("R410A", 118, 50)');
    expect(evaluateBuilderPreview(shExpr, [], settings, display).answer).toBeTruthy();

    const shSi = FORM_BUILDERS.hvac.modes[0].build({ fluid: 'R-410A', p: '800', t: '10', si: 'true' }, '');
    expect(shSi).toBe('superheat("R410A", 800, 10, "SI")');
  });

  it('parses free-form data lists and computes live summary stats', () => {
    expect(parseListItems('10, 20\n30; 40  50')).toEqual(['10', '20', '30', '40', '50']);
    const line = FORM_BUILDERS.data.modes[0].build({ items: '10, 20, 30' }, 'L');
    expect(line).toBe('L = {10, 20, 30}');
    expect(dataListSummary('10, 20, 30', [], settings, display)).toBe('n = 3 · x̄ = 20 · s = 10');
  });
});
