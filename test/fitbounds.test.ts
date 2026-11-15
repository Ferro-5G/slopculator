import { describe, expect, it } from 'vitest';
import type { GraphItem } from '../src/engine/document';
import { binomPeakAtMean, distFitKey, distNeedsFit, fitBounds, homeView, squareView } from '../src/ui/plotmodel';

const curve: GraphItem = { type: 'fx', f: (x: number) => x };
const normal: GraphItem = { type: 'normal', mu: 0, sigma: 1 };
const points = (...pts: [number, number][]): GraphItem => ({ type: 'points', pts });
const fit = (items: GraphItem[], w = 300, h = 600) => fitBounds(items, w, h, binomPeakAtMean);

describe('fitBounds', () => {
  it('has nothing to fit in a curve with no size of its own', () => {
    expect(fit([])).toBeNull();
    expect(fit([curve])).toBeNull();
  });

  it('frames distributions alone from a little below the axis, on their own scale', () => {
    const { view, square } = fit([normal])!;
    expect(square).toBe(false);
    expect(view.xmin).toBe(-4);
    expect(view.xmax).toBe(4);
    expect(view.ymax / view.ymin).toBeCloseTo(-1.18 / 0.12, 8);
  });

  it('pads anything else by 15% and squares it, with a point counting as 2 wide', () => {
    const { view, square } = fit([points([1, 1])], 100, 100)!;
    expect(square).toBe(true);
    expect(view).toEqual({ xmin: 0.7, xmax: 1.3, ymin: 0.7, ymax: 1.3 });
  });

  it('squares a tall window around the items', () => {
    const { view } = fit([points([-1, -1], [1, 1])], 300, 600)!;
    expect((view.xmax - view.xmin) / 300).toBeCloseTo((view.ymax - view.ymin) / 600, 12);
    expect((view.xmin + view.xmax) / 2).toBeCloseTo(0, 12);
    expect((view.ymin + view.ymax) / 2).toBeCloseTo(0, 12);
  });

  it('frames a curve beside a distribution as a plot, not as the distribution alone', () => {
    const alone = fit([normal])!, both = fit([normal, curve])!;
    expect(both.square).toBe(true);
    expect(both.view.xmax - both.view.xmin).toBeGreaterThan(alone.view.xmax - alone.view.xmin);
  });

  it('leaves the padding unsquared in a window with no size yet', () => {
    expect(fit([points([1, 1])], 0, 0)!.view).toEqual({ xmin: 0.7, xmax: 1.3, ymin: 0.7, ymax: 1.3 });
  });

  it('goes home when the points are too far apart to subtract', () => {
    const huge = points([-1e308, 0], [1e308, 0]);
    expect(fit([huge])).toEqual({ view: homeView(300, 600), square: true });
    expect(fit([huge], 0, 0)).toEqual({ view: homeView(0, 0), square: true });
  });

  it('goes home when a distribution is too narrow to have a span', () => {
    expect(fit([{ type: 'normal', mu: 1e20, sigma: 1e-5 }])).toEqual({ view: homeView(300, 600), square: true });
  });

  it('squareView keeps the centre and fits the larger span', () => {
    expect(squareView({ xmin: 0, xmax: 10, ymin: 0, ymax: 1 }, 100, 100)).toEqual({ xmin: 0, xmax: 10, ymin: -4.5, ymax: 5.5 });
  });
});

describe('when a distribution gets a new fit', () => {
  const bell = { type: 'normal', mu: 0, sigma: 1 } as GraphItem;
  const framed = { xmin: -4, xmax: 4, ymin: -0.05, ymax: 0.5 };
  const needs = (v: typeof framed) => distNeedsFit([bell], v);
  it('leaves a curve that sits well in the view', () => {
    expect(needs(framed)).toBe(false);
  });
  it('refits a bell zoomed out along x to a spike', () => {
    expect(needs({ ...framed, xmin: -100, xmax: 100 })).toBe(true);
  });
  it('refits a curve mostly off screen, too tall, too flat, or with its base cut off', () => {
    expect(needs({ ...framed, xmin: 2, xmax: 10 })).toBe(true);
    expect(needs({ ...framed, ymax: 0.3 })).toBe(true);
    expect(needs({ ...framed, ymax: 2 })).toBe(true);
    expect(needs({ ...framed, ymin: 0.01 })).toBe(true);
  });
  it('keys on the shape of each distribution and nothing else', () => {
    const line = { type: 'fx', f: () => 0 } as unknown as GraphItem;
    expect(distFitKey([line])).toBe('');
    expect(distFitKey([bell, line, { type: 'binom', n: 10, p: 0.5 } as GraphItem])).toBe('n0,1|b10,0.5');
  });
});
