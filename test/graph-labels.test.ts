import { describe, it, expect } from 'vitest';
import { piLabel, nameSpot } from '../src/ui/graphlabels';

describe('π tick labels', () => {
  it('reduces fractions of π', () => {
    // Ticks every π/2
    expect([-2, -1, 0, 1, 2, 3, 4].map((k) => piLabel(k, 1, 2))).toEqual(['−π', '−π/2', '0', 'π/2', 'π', '3π/2', '2π']);
    // Ticks every π/4
    expect([1, 2, 3, 4, 6].map((k) => piLabel(k, 1, 4))).toEqual(['π/4', 'π/2', '3π/4', 'π', '3π/2']);
    // Ticks every 2π
    expect([1, 2, -1].map((k) => piLabel(k, 2, 1))).toEqual(['2π', '4π', '−2π']);
  });
});

describe('curve names sit on their own stroke', () => {
  type Box = [number, number, number, number];
  const W = 800, H = 600;
  const view: Box = [0, 0, W, H];
  /** A function's stroke as segments in screen px, sampled every 2 px across the plot. */
  const stroke = (f: (px: number) => number) => {
    const sg: number[] = [];
    for (let px = 0; px + 2 <= W; px += 2) sg.push(px, f(px), px + 2, f(px + 2));
    return sg;
  };
  /** The nearest distance from the box to the stroke's points. */
  const gapTo = ([l, t, r, b]: Box, sg: number[]) => {
    let best = Infinity;
    for (let k = 0; k < sg.length; k += 2) best = Math.min(best, Math.hypot(Math.max(l - sg[k], 0, sg[k] - r), Math.max(t - sg[k + 1], 0, sg[k + 1] - b)));
    return best;
  };
  const base = { others: [] as number[], view, tw: 120, th: 20, used: [] as Box[], axisX: 400.5, axisY: 300.5, clear: 12 };

  it('puts a parabola name beside its arm, well clear of the top edge it runs off', () => {
    // y = x² with its vertex low in the view and both arms leaving through the top.
    const own = stroke((px) => 560 - ((px - 400) / 40) ** 2 * 10);
    const box = nameSpot({ ...base, own })!;
    expect(box).not.toBeNull();
    expect(gapTo(box, own)).toBeLessThanOrEqual(11);
    expect(gapTo(box, own)).toBeGreaterThanOrEqual(3);
    expect(box[1]).toBeGreaterThan(40);
    // The right-hand part of the visible stretch.
    expect((box[0] + box[2]) / 2).toBeGreaterThan(400);
  });

  it('keeps a bell curve name on the curve, not out in empty space', () => {
    const own = stroke((px) => 300 - 120 * Math.exp(-(((px - 400) / 40) ** 2) / 2));
    const box = nameSpot({ ...base, own })!;
    expect(box).not.toBeNull();
    expect(gapTo(box, own)).toBeLessThanOrEqual(11);
  });

  it('draws no name for a curve with nothing in view', () => {
    expect(nameSpot({ ...base, own: stroke(() => -50) })).toBeNull();
    expect(nameSpot({ ...base, own: [] })).toBeNull();
  });

  it('steps around a label already placed and stays deterministic', () => {
    const own = stroke((px) => 500 - px * 0.5);
    const first = nameSpot({ ...base, own })!;
    expect(nameSpot({ ...base, own })).toEqual(first);
    const second = nameSpot({ ...base, own, used: [first] })!;
    expect(second).not.toBeNull();
    const overlap = second[0] < first[2] && second[2] > first[0] && second[1] < first[3] && second[3] > first[1];
    expect(overlap).toBe(false);
    expect(gapTo(second, own)).toBeLessThanOrEqual(11);
  });

  it('keeps clear of another curve when it can', () => {
    const own = stroke((px) => 500 - px * 0.5);
    const others = stroke((px) => 480 - px * 0.5);
    const box = nameSpot({ ...base, own, others });
    // The tag goes on the far side of its own line from the neighbour 20 px away.
    expect(box).not.toBeNull();
    const [l, t, r, b] = box!;
    const cx = (l + r) / 2, cy = (t + b) / 2;
    expect(cy).toBeGreaterThan(500 - cx * 0.5);
  });
});
