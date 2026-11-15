import { describe, expect, it } from 'vitest';
import { MATRIX_SHOWN_MAX, matrixCells } from '../src/ui/answerlayout';

const square = (n: number, m = n) => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => i * m + j));

describe('the cells a matrix answer shows', () => {
  it('shows a matrix up to the limit whole', () => {
    expect(matrixCells([[1, 2], [3, 4]], String)).toEqual({ cells: [['1', '2'], ['3', '4']], more: null });
    const { cells, more } = matrixCells(square(MATRIX_SHOWN_MAX), String);
    expect(cells.length).toBe(MATRIX_SHOWN_MAX);
    expect(more).toBeNull();
  });

  it('shows the top-left corner of a bigger one, marks where the rest is, and says so', () => {
    // A 256 × 256 matrix drew 65,536 cells and froze the page for seconds on every load.
    let formatted = 0;
    const { cells, more } = matrixCells(square(256), (c) => (formatted++, String(c)));
    expect(formatted).toBe(MATRIX_SHOWN_MAX * MATRIX_SHOWN_MAX);
    expect(cells.length).toBe(MATRIX_SHOWN_MAX + 1);
    expect(cells[0].length).toBe(MATRIX_SHOWN_MAX + 1);
    expect(cells[0].at(-1)).toBe('…');
    expect(cells.at(-1)!.every((c) => c === '⋮')).toBe(true);
    expect(more).toBe(`256 × 256 matrix, showing the top-left ${MATRIX_SHOWN_MAX} × ${MATRIX_SHOWN_MAX}`);
  });

  it('cuts only the side that is too big', () => {
    const wide = matrixCells(square(2, 40), String);
    expect(wide.cells.length).toBe(2);
    expect(wide.cells[1]).toEqual([...Array.from({ length: MATRIX_SHOWN_MAX }, (_, j) => String(40 + j)), '…']);
    expect(wide.more).toBe(`2 × 40 matrix, showing the top-left 2 × ${MATRIX_SHOWN_MAX}`);
  });
});
