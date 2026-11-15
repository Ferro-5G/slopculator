import { describe, expect, it } from 'vitest';
import { run } from './sheet';
import { plotSVG } from '../src/ui/svg';

const plot = (line: string) => plotSVG(run([line]).results, { width: 200, height: 150, xmin: -2, xmax: 2, ymin: -2, ymax: 2 });

/** The shaded (translucent) paths of an SVG, each split into closed polygons of pixel points. */
function shaded(svg: string): [number, number][][] {
  const paths = [...svg.matchAll(/<path\b([^>]*)\/?>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
  return paths.filter((a) => a['fill-opacity'] && a.fill !== 'none').flatMap((a) => {
    const polys: [number, number][][] = [];
    let x = 0, y = 0;
    for (const [, op, args] of a.d.matchAll(/([MLHVhvlZ])([^MLHVhvlZ]*)/g)) {
      const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (op === 'M') polys.push([]);
      if (op === 'M' || op === 'L') [x, y] = n;
      else if (op === 'H') x = n[0];
      else if (op === 'V') y = n[0];
      else if (op === 'h') x += n[0];
      else if (op === 'v') y += n[0];
      else if (op === 'l') { x += n[0]; y += n[1]; }
      else continue;
      polys.at(-1)!.push([x, y]);
    }
    return polys;
  });
}
const inside = (poly: [number, number][], px: number, py: number) => {
  let odd = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
};
/** Whether the graph point (x, y) is shaded, on plot()'s 200 by 150 view of -2 to 2. */
const shadedAt = (svg: string, x: number, y: number) => shaded(svg).some((poly) => inside(poly, ((x + 2) / 4) * 200, ((2 - y) / 4) * 150));

describe('all SVG graph kinds keep their meaning', () => {
  it('shades both orientations of explicit inequalities', () => {
    expect(shadedAt(plot('y > x'), 0, 1)).toBe(true);
    expect(shadedAt(plot('y > x'), 0, -1)).toBe(false);
    expect(shadedAt(plot('x > y^2'), 1, 0)).toBe(true);
    expect(shadedAt(plot('x > y^2'), -1, 0)).toBe(false);
    expect(shadedAt(plot('x < y^2'), -1, 0)).toBe(true);
    expect(shadedAt(plot('x < y^2'), 1, 0)).toBe(false);
  });
  it('shades an implicit inequality as well as its boundary', () => {
    expect(shadedAt(plot('x^2 + y^2 < 1'), 0.1, 0.1)).toBe(true);
    expect(shadedAt(plot('x^2 + y^2 < 1'), 1.5, 0.1)).toBe(false);
  });
  it('draws chained regions rather than reporting a blank plotted item', () => {
    const band = plot('-1 < x < 1');
    expect(shadedAt(band, 0.1, 0.1)).toBe(true);
    for (const x of [-1.5, 1.5]) expect(shadedAt(band, x, 0.1), String(x)).toBe(false);
    expect(shaded(plot('1 < x < 0'))).toEqual([]);
    expect(shaded(plot('x^2 + y^2 = 1'))).toEqual([]);
  });
});
