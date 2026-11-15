import { describe, expect, it } from 'vitest';
import { STARTERS, starterRows, type Starter } from '../src/ui/starters';

const dist = { cdf: true, min: '0', max: '1' };
const shaded = (lines: string[]): Starter => ({ id: 'normal', title: 'A', lines, dist });

describe('starterRows', () => {
  it.each([[['a']], [['a', 'b']], [['a', 'b', 'c']], [['a', 'b', 'c', 'd']]])('keeps every line of %j and shades only the last', (lines) => {
    const rows = starterRows(shaded(lines));
    expect(rows.map((r) => r.text)).toEqual(lines);
    expect(rows.map((r) => !!r.dist)).toEqual(lines.map((_, i) => i === lines.length - 1));
  });
  it('leaves an unshaded starter plain', () => {
    expect(starterRows({ id: 'sliders', title: 'A', lines: ['a', 'b'] })).toEqual([{ text: 'a' }, { text: 'b' }]);
  });
  it('gives each load its own copy of the shading', () => {
    const ex = shaded(['a']);
    expect(starterRows(ex)[0].dist).not.toBe(ex.dist);
  });
  it('holds every shipped starter', () => {
    for (const ex of STARTERS) expect(starterRows(ex).map((r) => r.text)).toEqual(ex.lines);
  });
});
