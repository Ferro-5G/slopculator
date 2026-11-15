import { describe, expect, it } from 'vitest';
import { EDITORS, stepSize, type ListEditor } from '../src/ui/editors';

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
