import { describe, expect, it } from 'vitest';
import { edgeCovers } from '../src/ui/listedges';

const row = (top: number, bottom: number) => ({ top, bottom });

describe('the covers at the list\'s edges', () => {
  it('covers a sliver under 24 at either edge, and nothing more', () => {
    expect(edgeCovers([row(-40, 10), row(10, 90), row(90, 150)], 0, 100)).toEqual({ top: 10, bottom: 10 });
    expect(edgeCovers([row(-40, 24), row(76, 150)], 0, 100)).toEqual({ top: 0, bottom: 0 });
  });
  it('leaves a row inside the list, or one cut by under half a pixel', () => {
    expect(edgeCovers([row(0, 50), row(50, 100)], 0, 100)).toEqual({ top: 0, bottom: 0 });
    expect(edgeCovers([row(-0.4, 50), row(50, 100.4)], 0, 100)).toEqual({ top: 0, bottom: 0 });
  });
  it('leaves a row taller than the list alone', () => {
    expect(edgeCovers([row(-10, 30)], 0, 20)).toEqual({ top: 0, bottom: 0 });
  });
});
