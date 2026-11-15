import { describe, expect, it } from 'vitest';
import type { RowResult } from '../src/engine/document';
import type { DocRow } from '../src/ui/document';
import { type DraggablePoint, draggablePoints, draggedLines } from '../src/ui/plotmodel';

const line = (id: string, text: string, more: Partial<Extract<DocRow, { kind: 'expr' }>> = {}): DocRow => ({ id, kind: 'expr', text, color: 0, ...more });
const slider = (id: string, name: string, value: number) => ({ id, slider: { name, value } }) as unknown as RowResult;
const plain = (id: string, more: Partial<RowResult> = {}) => ({ id, ...more }) as unknown as RowResult;

describe('draggablePoints', () => {
  const rows = [line('a', 'a = 1'), line('b', 'b = 2'), line('p', '(a, b)')];
  const results = [slider('a', 'a', 1), slider('b', 'b', 2), plain('p')];

  it('finds a point whose two names are sliders, at their values', () => {
    expect(draggablePoints(rows, results)).toEqual([{ x: 1, y: 2, xLine: rows[0], yLine: rows[1], labels: ['a', 'b'] }]);
  });

  it('passes over a point unless both names are sliders', () => {
    expect(draggablePoints([rows[0], line('p', '(a, 5)')], [results[0], plain('p')])).toEqual([]);
    expect(draggablePoints([rows[0], line('p', '(a, c)')], [results[0], plain('p')])).toEqual([]);
  });

  it('passes over a hidden point and one with an error', () => {
    expect(draggablePoints([rows[0], rows[1], { ...rows[2], hidden: true }], results)).toEqual([]);
    expect(draggablePoints(rows, [results[0], results[1], plain('p', { error: 'no' })])).toEqual([]);
  });

  it('does not count a slider line that has an error', () => {
    expect(draggablePoints(rows, [{ ...results[0], error: 'no' }, results[1], plain('p')])).toEqual([]);
  });

  it('matches a name however it is spelled and writes it back the same way', () => {
    const spelled = [line('s', 'θ = 1'), line('b', 'b = 2'), line('p', '(theta, b)')];
    const got = draggablePoints(spelled, [slider('s', 'θ', 1), slider('b', 'b', 2), plain('p')]);
    expect(got).toHaveLength(1);
    expect(got[0].labels).toEqual(['theta', 'b']);
  });
});

describe('draggedLines', () => {
  const rows = [line('a', 'a = 1', { slider: { min: 0, max: 10, step: 0.5 } }), line('b', 'b = 2', { slider: { min: 0, max: 10, step: 2 } }), line('p', '(a, b)')];
  const point = draggablePoints(rows, [slider('a', 'a', 1), slider('b', 'b', 2), plain('p')])[0];

  it("snaps each axis to its own slider's step", () => {
    expect(draggedLines(point, 3.3, 6.9).map((e) => [e.line.id, e.text])).toEqual([['a', 'a = 3.5'], ['b', 'b = 6']]);
  });

  it("uses a slider's automatic step when it has no range of its own", () => {
    const auto = [line('a', 'a = 1'), line('b', 'b = 2'), line('p', '(a, b)')];
    const p = draggablePoints(auto, [slider('a', 'a', 1), slider('b', 'b', 2), plain('p')])[0];
    expect(draggedLines(p, 3.14159, -2.71828).map((e) => e.text)).toEqual(['a = 3', 'b = -3']);
  });

  it('writes the names as the point spells them', () => {
    const spelled = [line('s', 'θ = 1'), line('b', 'b = 2'), line('p', '(theta, b)')];
    const p = draggablePoints(spelled, [slider('s', 'θ', 1), slider('b', 'b', 2), plain('p')])[0];
    expect(draggedLines(p, 1, 2)[0].text).toBe('theta = 1');
  });

  it('leaves no float noise in a written step', () => {
    const p = { ...point, xLine: line('a', 'a = 1', { slider: { min: 0, max: 1, step: 0.1 } }) as DraggablePoint['xLine'] };
    expect(draggedLines(p, 0.3, 2)[0].text).toBe('a = 0.3');
  });
});
