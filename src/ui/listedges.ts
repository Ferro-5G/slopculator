/** The most of a row an edge's cover hides. More showing is a row cut by the edge, and a taller band reads as blank space. */
const SLIVER = 24;

/** Room kept between a revealed line and the list's edge, enough that a fraction or matrix lands whole. */
export const EDGE_CLEAR = 36;

/** How far in from each edge to cover a sliver of a row at rest, else 0. */
export function edgeCovers(rects: readonly { top: number; bottom: number }[], top: number, bottom: number): { top: number; bottom: number } {
  const covers = { top: 0, bottom: 0 };
  for (const r of rects) {
    if (r.top < top - 0.5 && r.bottom > bottom + 0.5) continue;
    if (r.top < top - 0.5 && r.bottom > top + 0.5 && r.bottom - top < SLIVER) covers.top = Math.max(covers.top, r.bottom - top);
    if (r.top < bottom - 0.5 && r.bottom > bottom + 0.5 && bottom - r.top < SLIVER) covers.bottom = Math.max(covers.bottom, bottom - r.top);
  }
  return covers;
}
