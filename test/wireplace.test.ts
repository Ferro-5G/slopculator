import { describe, expect, it } from 'vitest';
import { spreadTags, tagRun, tagSpot, trayRises } from '../src/ui/wireplace';

describe('wireplace', () => {
  it('puts a tag on the run into its block, short of the end', () => {
    expect(tagSpot([{ x: 0, y: 10 }, { x: 200, y: 10 }], 60, 24)).toEqual({ x: 200 - 30 - 12, y: 10, vert: false });
    // The last run is too short: the tag goes on the longest.
    expect(tagSpot([{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 20, y: 300 }], 60, 24)).toEqual({ x: 0, y: 150, vert: true });
    expect(tagRun(80)).toBe(110);
  });
  it("rises an open line's steps into its foot without crossing", () => {
    const line = { x: 100, y: 0, w: 300, h: 60 };
    const r = trayRises([{ id: 'b', rect: { x: 120, y: 200, w: 80, h: 30 } }, { id: 'a', rect: { x: 120, y: 120, w: 80, h: 30 } }], line);
    expect(r.map((x) => x.id)).toEqual(['a', 'b']);
    const ends = r.map((x) => x.points[x.points.length - 1]);
    expect(ends.every((p) => p.y === 60)).toBe(true);
    expect(ends[1].x).toBeGreaterThan(ends[0].x);
  });
});

describe('spreadTags', () => {
  it('moves an overlapping tag up its run', () => {
    const [a, b] = spreadTags([{ key: 'a', x: 100, y: 50, w: 60, h: 24, vert: true }, { key: 'b', x: 120, y: 50, w: 60, h: 24, vert: true }]);
    expect(a.y).toBe(50);
    expect(b.y).toBe(50 - 30);
  });
});
