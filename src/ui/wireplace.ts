// Where things sit on a wide canvas's wires, shared by every front end: a wire's tag on the run into its block, the
// room a tag needs on that run, the wires an open line's steps take up into the line, and which of an open line's
// steps a wire into it ends in. The web worked these out in src/app first; they're here so the phone app's tablet
// layout puts them in the same places. No DOM here.
import type { Point, Rect } from './canvas';
import type { Unfolded } from './unfold';

/** The run a tag needs into its block: its width and room either side, so it never sits on a bend. */
export const tagRun = (tagWidth: number): number => tagWidth + 30;

/**
 * Where a wire's tag goes (its centre): on the last straight run long enough to hold it (the run into the block,
 * unless that's too short), near the block's end of it; else on the longest run. `vert` says the run goes down.
 */
export function tagSpot(pts: readonly Point[], w: number, h: number): { x: number; y: number; vert: boolean } {
  const segs = pts.slice(1).map((q, i) => ({ p: pts[i], q, vert: pts[i].x === q.x, len: Math.abs(q.x - pts[i].x) + Math.abs(q.y - pts[i].y) }));
  if (!segs.length) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, vert: false };
  const fits = (s: (typeof segs)[number]) => s.len >= (s.vert ? h + 16 : w + 20);
  const seg = [...segs].reverse().find(fits) ?? segs.reduce((a, b) => (b.len > a.len ? b : a), segs[segs.length - 1]);
  const last = seg === segs[segs.length - 1];
  if (seg.vert) return { x: seg.p.x, y: last ? seg.q.y - Math.sign(seg.q.y - seg.p.y) * (h / 2 + 12) : (seg.p.y + seg.q.y) / 2, vert: true };
  const dir = Math.sign(seg.q.x - seg.p.x);
  return { x: last ? seg.q.x - dir * (w / 2 + 12) : (seg.p.x + seg.q.x) / 2, y: seg.p.y, vert: false };
}

/**
 * Where a wire carrying `name` into an open line ends: in each step that reads the name itself, and in the line too
 * only when the line reads it itself.
 */
export function openLineEnds(u: Unfolded, name: string): { steps: string[]; line: boolean } {
  return { steps: u.steps.filter((s) => s.inputs.includes(name)).map((s) => s.id), line: u.line.inputs.includes(name) };
}

/**
 * The wires an open line's top steps take up into the line's foot, each as square points: the lowest step furthest
 * right, so they never cross; straight across and up when the step ends left of its place, else up out of the step's
 * top and across under the line. `tops` are the steps the line reads, as world rects, by id.
 */
export function trayRises(tops: readonly { id: string; rect: Rect }[], line: Rect): { id: string; points: Point[] }[] {
  const sorted = [...tops].sort((p, q) => p.rect.y - q.rect.y);
  const foot = line.y + line.h;
  return sorted.map(({ id, rect: r }, i) => {
    const tx = Math.max(line.x + 18, line.x + line.w - 26 - (sorted.length - 1 - i) * 14);
    const out = { x: r.x + r.w, y: r.y + r.h / 2 };
    const points = out.x + 12 <= tx
      ? [out, { x: tx, y: out.y }, { x: tx, y: foot }]
      : [{ x: r.x + r.w - 18, y: r.y }, { x: r.x + r.w - 18, y: foot + 9 + i * 5 }, { x: tx, y: foot + 9 + i * 5 }, { x: tx, y: foot }];
    return { id, points };
  });
}

export interface TagBox { key: string; x: number; y: number; w: number; h: number; vert: boolean }
/**
 * Moves tags that would overlap apart, in order: a tag on a run down moves up it by a tag's height and a little,
 * one on a run across moves back along it, until it's clear of the tags placed before it. (x, y) is each centre.
 */
export function spreadTags(tags: readonly TagBox[], gap = 6): TagBox[] {
  const out: TagBox[] = [];
  const hit = (a: TagBox, b: TagBox) => Math.abs(a.x - b.x) * 2 < a.w + b.w + gap && Math.abs(a.y - b.y) * 2 < a.h + b.h + gap;
  for (const t of tags) {
    let at = t;
    for (let tries = 0; tries < 8 && out.some((o) => hit(at, o)); tries++) at = at.vert ? { ...at, y: at.y - (at.h + gap) } : { ...at, x: at.x - (at.w + gap) };
    out.push(at);
  }
  return out;
}
