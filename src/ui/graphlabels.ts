/** How far the segment from (x1, y1) to (x2, y2) is from the box l, t, r, b; 0 when it crosses or touches it. */
export function segToBox(x1: number, y1: number, x2: number, y2: number, l: number, t: number, r: number, b: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  let u0 = 0, u1 = 1;
  const crosses = ([[-dx, x1 - l], [dx, r - x1], [-dy, y1 - t], [dy, b - y1]] as const).every(([pk, qk]) => {
    if (pk === 0) return qk >= 0;
    const u = qk / pk;
    if (pk < 0) u0 = Math.max(u0, u); else u1 = Math.min(u1, u);
    return u0 <= u1;
  });
  if (crosses) return 0;
  const toBox = (x: number, y: number) => Math.hypot(Math.max(l - x, 0, x - r), Math.max(t - y, 0, y - b));
  const len = dx * dx + dy * dy;
  const toSeg = (x: number, y: number) => {
    const u = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
    return Math.hypot(x1 + u * dx - x, y1 + u * dy - y);
  };
  return Math.min(toBox(x1, y1), toBox(x2, y2), toSeg(l, t), toSeg(r, t), toSeg(l, b), toSeg(r, b));
}

type Box = [number, number, number, number];

/** The nearest of the segments (x0, y0, x1, y1, …) to the box, up to cap; 0 when one crosses it. */
function segDistance([l, t, r, b]: Box, sg: ArrayLike<number>, cap: number): number {
  let best = cap;
  for (let k = 0; k + 3 < sg.length; k += 4) {
    const ax = sg[k], ay = sg[k + 1], bx = sg[k + 2], by = sg[k + 3];
    if (Math.min(ax, bx) > r + best || Math.max(ax, bx) < l - best || Math.min(ay, by) > b + best || Math.max(ay, by) < t - best) continue;
    best = Math.min(best, segToBox(ax, ay, bx, by, l, t, r, b));
    if (best === 0) return 0;
  }
  return best;
}

export interface NameSpotInput {
  /** This line's strokes as drawn, segments x0, y0, x1, y1, … in CSS px. */
  own: ArrayLike<number>;
  /** Every other line's strokes, the same way. */
  others: ArrayLike<number>;
  /** The plot a name may use: left, top, right, bottom (right already stops short of the tool column). */
  view: Box;
  tw: number;
  th: number;
  used: Box[];
  /** The axis lines on screen, x of the y-axis and y of the x-axis; off-screen ones are ignored. */
  axisX: number;
  axisY: number;
  clear: number;
  overAxes?: boolean;
}

export function nameSpot(o: NameSpotInput): Box | null {
  const { own, others, view, tw, th, used } = o;
  const [vl, vt, vr, vb] = view;
  const EDGE = 24, STEP = 16, MAX_ANCHORS = 96, MIN_OWN = 4, AXIS_OFF = 8;
  const anchors: [number, number, number, number][] = [];
  const inside = (x: number, y: number) => x >= vl + EDGE && x <= vr - EDGE && y >= vt + EDGE && y <= vb - EDGE;
  let walked = STEP / 2;
  for (let k = 0; k + 3 < own.length; k += 4) {
    const ax = own[k], ay = own[k + 1], bx = own[k + 2], by = own[k + 3];
    const len = Math.hypot(bx - ax, by - ay);
    if (!(len > 0)) {
      if (Number.isFinite(ax) && Number.isFinite(ay) && inside(ax, ay)) anchors.push([ax, ay, 1, 0]);
      continue;
    }
    const tx = (bx - ax) / len, ty = (by - ay) / len;
    for (let s = STEP - walked; s <= len; s += STEP) {
      const x = ax + tx * s, y = ay + ty * s;
      if (inside(x, y)) anchors.push([x, y, tx, ty]);
    }
    walked = (walked + len) % STEP;
  }
  if (!anchors.length) return null;
  const thin = anchors.length > MAX_ANCHORS ? anchors.filter((_, i) => i % Math.ceil(anchors.length / MAX_ANCHORS) === 0) : anchors;
  let minX = Infinity, maxX = -Infinity;
  for (const [x] of thin) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const span = maxX - minX;
  const { axisX, axisY } = o;
  const xAxisOn = Number.isFinite(axisY) && axisY >= vt && axisY <= vb;
  const yAxisOn = Number.isFinite(axisX) && axisX >= vl && axisX <= vr;
  const onAxis = ([l, t, r, b]: Box) => (yAxisOn && l - AXIS_OFF < axisX && r + AXIS_OFF > axisX) || (xAxisOn && t - AXIS_OFF < axisY && b + AXIS_OFF > axisY);
  const hitsLabel = ([l, t, r, b]: Box) => used.some(([l2, t2, r2, b2]) => l < r2 + 4 && r > l2 - 4 && t < b2 + 4 && b > t2 - 4);
  let best: { box: Box; score: number } | null = null;
  for (const [i, [x, y, tx, ty]] of thin.entries()) {
    const along = span >= 40 ? (x - minX) / span : thin.length > 1 ? i / (thin.length - 1) : 0.75;
    const nearAxis = (xAxisOn && Math.abs(y - axisY) < 6) || (yAxisOn && Math.abs(x - axisX) < 6);
    const up: [number, number] = ty > 0 || (ty === 0 && tx < 0) ? [ty, -tx] : [-ty, tx];
    const prev = thin[i - 1], next = thin[i + 1];
    const bx = prev && next ? x - (prev[0] + next[0]) / 2 : 0, by = prev && next ? y - (prev[1] + next[1]) / 2 : 0;
    const bend = Math.min(1, Math.hypot(bx, by) / 2);
    for (const [nx, ny] of [up, [-up[0], -up[1]] as [number, number]]) {
      for (const gap of [6, 10]) {
        const ox = x + nx * gap, oy = y + ny * gap;
        const reach = gap + Math.abs(nx) * tw / 2 + Math.abs(ny) * th / 2;
        const cx = x + nx * reach, cy = y + ny * reach;
        const centred: Box = [cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2];
        const l = nx >= 0 ? ox : ox - tw, t = ny <= 0 ? oy - th : oy;
        const cornered: Box = [l, t, l + tw, t + th];
        for (const box of [centred, cornered]) {
          if (box[0] < vl + 4 || box[2] > vr - 4 || box[1] < vt + 4 || box[3] > vb - 4) continue;
          if (hitsLabel(box) || (!o.overAxes && onAxis(box))) continue;
          const mine = segDistance(box, own, MIN_OWN);
          if (mine < MIN_OWN) continue;
          const room = segDistance(box, others, 48);
          if (room < o.clear) continue;
          const edge = Math.min(box[0] - vl, vr - box[2], box[1] - vt, vb - box[3]);
          const outer = bend > 0 ? Math.sign(nx * bx + ny * by) * bend : 0;
          const score =
            8 * outer +
            10 * (1 - Math.abs(along - 0.75) / 0.75) +
            12 * (Math.min(edge, 48) / 48) +
            10 * (room / 48) -
            0.5 * (gap - 6) -
            (nearAxis ? 8 : 0) +
            (ny < 0 ? 1 : 0);
          if (!best || score > best.score) best = { box, score };
        }
      }
    }
  }
  return best?.box ?? null;
}

export function piLabel(k: number, num: number, den: number): string {
  if (k === 0) return '0';
  let p = Math.abs(k) * num, q = den;
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(p, q);
  p /= d;
  q /= d;
  return `${k < 0 ? '−' : ''}${p === 1 ? '' : p}π${q === 1 ? '' : `/${q}`}`;
}

export type YTickAlign = 'left' | 'right';
export type YTickBase = 'top' | 'middle' | 'bottom';

export interface YTickSpotInput {
  /** Screen x of the y-axis, and screen y of this tick. */
  ax: number;
  py: number;
  /** Label width and height in screen px. */
  tw: number;
  th: number;
  /** Usable plot bounds: [left, top, right, bottom]. */
  view: Box;
  /** True when the y-axis is pinned near the left edge so labels default to the right of the axis. */
  pinLeft: boolean;
  /** True when a candidate label box crowds a plotted curve, POI ring, or already-placed label. */
  isCrowded: (box: Box) => boolean;
}

export interface YTickPlacement {
  x: number;
  y: number;
  align: YTickAlign;
  base: YTickBase;
}

/**
 * Picks a clean spot for a y-axis tick label so curves and crossing markers (such as a parabola vertex at (0, −2))
 * never strike through the number. Tries the default side first, then the opposite side and gentle vertical offsets.
 */
export function yTickSpot(o: YTickSpotInput): YTickPlacement {
  const { ax, py, tw, th, view: [vl, vt, vr, vb], pinLeft, isCrowded } = o;
  const leftX = Math.min(ax - 5, vr - 5);
  const rightX = Math.max(ax + 6, vl + 5);
  const shift = Math.max(11, Math.ceil(th * 0.65));
  const primary: YTickPlacement = pinLeft
    ? { x: Math.max(ax + 5, vl + 5), y: py, align: 'left', base: 'middle' }
    : { x: leftX, y: py, align: 'right', base: 'middle' };

  const candidates: YTickPlacement[] = pinLeft
    ? [
        primary,
        { x: primary.x, y: py + shift, align: 'left', base: 'top' },
        { x: primary.x, y: py - shift, align: 'left', base: 'bottom' },
      ]
    : [
        primary,
        { x: rightX, y: py, align: 'left', base: 'middle' },
        { x: rightX, y: py + shift, align: 'left', base: 'top' },
        { x: leftX, y: py + shift, align: 'right', base: 'top' },
        { x: rightX, y: py - shift, align: 'left', base: 'bottom' },
        { x: leftX, y: py - shift, align: 'right', base: 'bottom' },
      ];

  const boxOf = (c: YTickPlacement): Box => {
    const l = c.align === 'right' ? c.x - tw : c.x;
    const t = c.base === 'top' ? c.y : c.base === 'bottom' ? c.y - th : c.y - th / 2;
    return [l, t, l + tw, t + th];
  };

  for (const c of candidates) {
    const b = boxOf(c);
    if (b[0] < vl + 2 || b[2] > vr - 2 || b[1] < vt + 2 || b[3] > vb - 2) continue;
    if (!isCrowded(b)) return c;
  }
  return primary;
}

