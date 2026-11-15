import { describe, it, expect } from 'vitest';
import { run } from './sheet';
import { plotSVG } from '../src/ui/svg';

describe('a sheet run through the engine', () => {
  it('evaluates lines with shared variables and letters', () => {
    const { lines } = run(['328-400', '406-400', 'A/50', 'B/50', 'normalcdf(C, D)']);
    expect(lines.map((l) => l.result)).toEqual(['-72', '6', '-1.44', '0.12', '0.472824726486']);
    expect(lines[2].fraction).toBe('-36/25');
  });
  it('reports errors without throwing', () => {
    expect(run(['1/0']).lines[0].error).toMatch(/Division by zero/);
  });
  it('respects radians and rounding', () => {
    expect(run(['sin(pi/6)'], { deg: false }).lines[0].result).toBe('0.5');
    expect(run(['1/3'], { places: 3 }).lines[0].result).toBe('0.333');
  });
  it('draws an SVG', () => {
    const { results } = run(['y = x^2', 'normaldist(0, 1)', '(1, 2)']);
    const svg = plotSVG(results);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<circle');
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(4);
  });

  it('exports a 2D vector as a shaft and a filled head, framed from the origin to its tip', () => {
    const arrowSvg = plotSVG(run(['⟨30, 40⟩']).results, { width: 400, height: 400 });
    const paths = [...arrowSvg.matchAll(/<path d="([^"]+)"([^/]*)\/>/g)].slice(-2);
    expect(paths[0][2]).toContain('stroke-linecap="round"');
    expect(paths[1][1].endsWith('Z')).toBe(true);
    expect(paths[1][2]).toContain('fill="#');
    expect(arrowSvg).not.toContain('NaN');
    // The tip is well inside a view fitted to it: the automatic ±10 would put 30, 40 far off the page.
    const tip = /^M([\d.]+) ([\d.]+)L/.exec(paths[1][1])!;
    expect(Number(tip[1])).toBeLessThan(400);
    expect(Number(tip[2])).toBeGreaterThan(0);
  });

  it('exports a zero vector as a dot, with no arrow to point', () => {
    const dot = plotSVG(run(['⟨0, 0⟩']).results);
    expect(dot).toContain('<circle');
    expect(dot).not.toContain('NaN');
  });
});
