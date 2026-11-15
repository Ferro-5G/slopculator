import type { GraphItem, RowResult } from '../engine/document';
import { binomPdf } from '../engine/numeric';
import { piLabel } from './graphlabels';
import { BOUNDARY_DASH, binomPeakAtMean, contourCrossings, fitBounds, goodSpan, isDashed, normalPdf, piStep, shadeLabel, shadeProb, squareView, tickLabel, vectorArrow } from './plotmodel';
import { probLabelPlacement } from './problabel';
import { niceStep, tickValues } from './ticks';

export interface PlotOptions {
  width?: number;
  height?: number;
  xmin?: number;
  xmax?: number;
  ymin?: number;
  ymax?: number;
  theme?: 'light' | 'dark';
  colors?: string[];
  piTicks?: boolean;
}

const CURVES_LIGHT = ['#c4471d', '#2456c9', '#1f8443', '#7b3fd1', '#0d7a73', '#a8710b', '#c0257a'];
const CURVES_DARK = ['#f0794a', '#6d9bff', '#4cc27a', '#b28cff', '#3cc4ba', '#e0aa3e', '#f06aae'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function autoView(items: GraphItem[], w: number, h: number) {
  const curves = items.some((it) => it.type === 'fx' || it.type === 'fy' || it.type === 'implicit' || it.type === 'region');
  return (curves ? null : fitBounds(items, w, h, binomPeakAtMean))?.view ?? squareView({ xmin: -10, xmax: 10, ymin: -10, ymax: 10 }, w, h);
}

function axis(lo: number | undefined, hi: number | undefined, autoLo: number, autoHi: number): [number, number] {
  if (lo !== undefined && hi === undefined && !(lo < autoHi)) return [lo, lo + (autoHi - autoLo)];
  if (hi !== undefined && lo === undefined && !(autoLo < hi)) return [hi - (autoHi - autoLo), hi];
  return [lo ?? autoLo, hi ?? autoHi];
}

export function viewError(o: Pick<PlotOptions, 'xmin' | 'xmax' | 'ymin' | 'ymax'>): string | null {
  const [x0, x1] = axis(o.xmin, o.xmax, -10, 10), [y0, y1] = axis(o.ymin, o.ymax, -10, 10);
  if (!goodSpan(x0, x1)) return 'xmin must be less than xmax, and xmax − xmin finite';
  if (!goodSpan(y0, y1)) return 'ymin must be less than ymax, and ymax − ymin finite';
  return null;
}

export function plotSVG(results: RowResult[], o: PlotOptions = {}): string {
  const w = o.width ?? 720, h = o.height ?? 480;
  const dark = o.theme === 'dark';
  const C = dark
    ? { bg: '#171715', grid: '#21201e', major: '#2f2e2a', axis: '#8c8a82', text: '#b3b0a7', curves: CURVES_DARK }
    : { bg: '#fdfcfa', grid: '#efede7', major: '#dedbd2', axis: '#6d6b64', text: '#57564f', curves: CURVES_LIGHT };
  const drawn: { item: GraphItem; color: string }[] = [];
  results.forEach((r, i) => r.graph.forEach((item) => drawn.push({ item, color: o.colors?.[i] || C.curves[i % C.curves.length] })));
  const auto = autoView(drawn.map((d) => d.item), w, h);
  let [xmin, xmax] = axis(o.xmin, o.xmax, auto.xmin, auto.xmax), [ymin, ymax] = axis(o.ymin, o.ymax, auto.ymin, auto.ymax);
  if (!goodSpan(xmin, xmax)) [xmin, xmax] = [auto.xmin, auto.xmax];
  if (!goodSpan(ymin, ymax)) [ymin, ymax] = [auto.ymin, auto.ymax];
  const v = { xmin, xmax, ymin, ymax };
  const X = (x: number) => ((x - v.xmin) / (v.xmax - v.xmin)) * w;
  const Y = (y: number) => h - ((y - v.ymin) / (v.ymax - v.ymin)) * h;
  const toX = (px: number) => v.xmin + (px / w) * (v.xmax - v.xmin);
  const toY = (py: number) => v.ymin + ((h - py) / h) * (v.ymax - v.ymin);
  const f2 = (n: number) => (Math.round(n * 10) / 10).toString();
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11">`);
  out.push(`<rect width="${w}" height="${h}" fill="${C.bg}"/>`);

  const pi = o.piTicks ? piStep(v.xmax - v.xmin, w) : null;
  const niceX = niceStep(((v.xmax - v.xmin) / w) * 100), sy = niceStep(((v.ymax - v.ymin) / h) * 80);
  const sx = pi ? pi.step : niceX;
  const grid: string[] = [], major: string[] = [], labels: string[] = [];
  for (const x of tickValues(v.xmin, v.xmax, pi ? sx / 2 : sx / 5)) grid.push(`M${f2(X(x))} 0V${h}`);
  for (const y of tickValues(v.ymin, v.ymax, sy / 5)) grid.push(`M0 ${f2(Y(y))}H${w}`);
  const ax = X(0), ay = Y(0);
  for (const x of tickValues(v.xmin, v.xmax, sx)) {
    major.push(`M${f2(X(x))} 0V${h}`);
    if (Math.abs(x) > sx / 1e6 && X(x) > 14 && X(x) < w - 14) labels.push(`<text x="${f2(X(x))}" y="${f2(Math.min(Math.max(ay + 14, 14), h - 4))}" text-anchor="middle">${pi ? piLabel(Math.round(x / sx), pi.num, pi.den) : tickLabel(x, sx)}</text>`);
  }
  for (const y of tickValues(v.ymin, v.ymax, sy)) {
    major.push(`M0 ${f2(Y(y))}H${w}`);
    if (Math.abs(y) > sy / 1e6 && Y(y) > 10 && Y(y) < h - 10) labels.push(`<text x="${f2(Math.min(Math.max(ax - 5, 40), w - 4))}" y="${f2(Y(y) + 4)}" text-anchor="end">${tickLabel(y, sy)}</text>`);
  }
  out.push(`<path d="${grid.join('')}" stroke="${C.grid}" stroke-width="1"/>`);
  out.push(`<path d="${major.join('')}" stroke="${C.major}" stroke-width="1"/>`);
  out.push(`<path d="${ax >= 0 && ax <= w ? `M${f2(ax)} 0V${h}` : ''}${ay >= 0 && ay <= h ? `M0 ${f2(ay)}H${w}` : ''}" stroke="${C.axis}" stroke-width="1.25"/>`);

  const sample = (f: (x: number) => number): string => {
    let d = '', pen = false, prev: number | null = null;
    for (let px = -1; px <= w + 1; px += 1.5) {
      const y = f(toX(px));
      if (!Number.isFinite(y)) { pen = false; prev = null; continue; }
      let py = Y(y);
      if (prev !== null && Math.abs(py - prev) > h && Math.sign(py - h / 2) !== Math.sign(prev - h / 2)) pen = false;
      py = Math.max(-4 * h, Math.min(5 * h, py));
      d += `${pen ? 'L' : 'M'}${f2(px)} ${f2(py)}`;
      pen = true;
      prev = py;
    }
    return d;
  };

  const shadeRegion = (test: (x: number, y: number) => boolean, color: string) => {
    const cell = 4;
    let d = '';
    for (let py = 0; py < h; py += cell) {
      const y = toY(Math.min(py + cell / 2, h));
      let from = -1;
      for (let px = 0; ; px += cell) {
        const edge = Math.min(px, w);
        const inside = px < w && test(toX(Math.min(px + cell / 2, w)), y);
        if (inside && from < 0) from = px;
        if (!inside && from >= 0) {
          d += `M${from} ${py}h${edge - from}v${Math.min(cell, h - py)}H${from}Z`;
          from = -1;
        }
        if (px >= w) break;
      }
    }
    if (d) out.push(`<path d="${d}" fill="${color}" fill-opacity="0.16"/>`);
  };

  for (const { item: it, color } of drawn) {
    if (it.type === 'region') shadeRegion(it.test, color);
    else if (it.type === 'implicit' && it.ineq) {
      shadeRegion((x, y) => {
        const v = it.f(x, y);
        return it.ineq === '<' ? v < 0 : it.ineq === '<=' ? v <= 0 : it.ineq === '>' ? v > 0 : v >= 0;
      }, color);
    }
    const dash = isDashed(it) ? ` stroke-dasharray="${BOUNDARY_DASH.join(' ')}"` : '';
    switch (it.type) {
      case 'fx': {
        const d = sample(it.f);
        if (it.ineq && d) {
          const edge = it.ineq.startsWith('>') ? -2 : h + 2;
          const fill = d.split('M').filter(Boolean).map((run) => {
            const first = run.split('L')[0].split(' ')[0], last = run.split('L').at(-1)!.split(' ')[0];
            return `M${first} ${edge}L${run}L${last} ${edge}Z`;
          }).join('');
          out.push(`<path d="${fill}" fill="${color}" fill-opacity="0.16"/>`);
        }
        out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"${dash}/>`);
        break;
      }
      case 'fy': {
        let d = '', pen = false;
        for (let py = -1; py <= h + 1; py += 1.5) {
          const x = it.f(toY(py));
          if (!Number.isFinite(x)) { pen = false; continue; }
          d += `${pen ? 'L' : 'M'}${f2(Math.max(-4 * w, Math.min(5 * w, X(x))))} ${f2(py)}`;
          pen = true;
        }
        if (it.ineq && d) {
          const edge = it.ineq.startsWith('>') ? w + 2 : -2;
          const fill = d.split('M').filter(Boolean).map((run) => {
            const first = run.split('L')[0].split(' ')[1], last = run.split('L').at(-1)!.split(' ')[1];
            return `M${edge} ${first}L${run}L${edge} ${last}Z`;
          }).join('');
          out.push(`<path d="${fill}" fill="${color}" fill-opacity="0.16"/>`);
        }
        out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4"${dash}/>`);
        break;
      }
      case 'implicit': {
        const cell = 4, cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
        const g = new Float64Array(cols * rows);
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) g[j * cols + i] = it.f(toX(i * cell), toY(j * cell));
        let d = '';
        for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
          const a = g[j * cols + i], b = g[j * cols + i + 1], c = g[(j + 1) * cols + i + 1], e = g[(j + 1) * cols + i];
          if (![a, b, c, e].every(Number.isFinite)) continue;
          const x0 = i * cell, y0 = j * cell, pts = contourCrossings(a, b, c, e).map(([u, v]) => [x0 + u * cell, y0 + v * cell]);
          if (pts.length >= 2) d += `M${f2(pts[0][0])} ${f2(pts[0][1])}L${f2(pts[1][0])} ${f2(pts[1][1])}`;
        }
        out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"${dash}/>`);
        break;
      }
      case 'normal': {
        const pdf = normalPdf(it);
        if (it.shade) {
          const a = Math.max(it.shade[0], toX(-1)), b = Math.min(it.shade[1], toX(w + 1));
          if (a < b) {
            let d = `M${f2(X(a))} ${f2(Y(0))}`;
            for (let px = X(a); px < X(b); px += 1.5) d += `L${f2(px)} ${f2(Y(pdf(toX(px))))}`;
            d += `L${f2(X(b))} ${f2(Y(pdf(b)))}L${f2(X(b))} ${f2(Y(0))}Z`;
            out.push(`<path d="${d}" fill="${color}" fill-opacity="0.32"/>`);
            const txt = shadeLabel(shadeProb(it, it.shade[0], it.shade[1]));
            const at = probLabelPlacement({ a, b, mu: it.mu, pdf, X, Y });
            out.push(`<text x="${f2(at.x)}" y="${f2(at.y)}" text-anchor="${at.anchor}" dominant-baseline="middle" font-size="${at.big ? 15 : 12}" font-weight="600" fill="${color}" stroke="${C.bg}" stroke-width="4" paint-order="stroke">${txt}</text>`);
          }
        }
        out.push(`<path d="${sample(pdf)}" fill="none" stroke="${color}" stroke-width="2.4"/>`);
        break;
      }
      case 'binom': {
        const lo = Math.max(0, Math.ceil(v.xmin)), hi = Math.min(it.n, Math.floor(v.xmax));
        // Counting with i, not k: past 2^53, k++ leaves k unchanged.
        for (let i = 0; i <= hi - lo && hi - lo < w; i++) {
          const k = lo + i, p = binomPdf(it.n, it.p, k);
          const op = it.shade && (k < it.shade[0] || k > it.shade[1]) ? 0.35 : 1;
          out.push(`<g opacity="${op}"><path d="M${f2(X(k))} ${f2(Y(0))}V${f2(Y(p))}" stroke="${color}" stroke-width="2.5"/><circle cx="${f2(X(k))}" cy="${f2(Y(p))}" r="3.5" fill="${color}"/></g>`);
        }
        break;
      }
      case 'points':
        for (const [x, y] of it.pts) out.push(`<circle cx="${f2(X(x))}" cy="${f2(Y(y))}" r="6" fill="${C.bg}"/><circle cx="${f2(X(x))}" cy="${f2(Y(y))}" r="4.5" fill="${color}"/>`);
        break;
      case 'polygon': {
        const d = it.pts.map(([x, y], k) => `${k ? 'L' : 'M'}${f2(X(x))} ${f2(Y(y))}`).join('') + 'Z';
        out.push(`<path d="${d}" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="2"/>`);
        break;
      }
      case 'vector': {
        const x0 = X(0), y0 = Y(0), x1 = X(it.to[0]), y1 = Y(it.to[1]);
        const arrow = vectorArrow(x0, y0, x1, y1);
        if (!arrow) out.push(`<circle cx="${f2(x1)}" cy="${f2(y1)}" r="4.5" fill="${color}"/>`);
        else {
          out.push(`<path d="M${f2(x0)} ${f2(y0)}L${f2(arrow.base[0])} ${f2(arrow.base[1])}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`);
          out.push(`<path d="M${f2(x1)} ${f2(y1)}L${f2(arrow.left[0])} ${f2(arrow.left[1])}L${f2(arrow.right[0])} ${f2(arrow.right[1])}Z" fill="${color}"/>`);
        }
        break;
      }
      case 'region':
        break;
    }
  }
  out.push(`<g fill="${C.text}">${labels.join('')}</g>`);
  out.push(`<desc>${esc(`Slopculator plot, x ${tickLabel(v.xmin, niceX)} to ${tickLabel(v.xmax, niceX)}`)}</desc>`);
  out.push('</svg>');
  return out.join('');
}
