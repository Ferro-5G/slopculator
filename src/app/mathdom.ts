import type { MathBox } from '../ui/typeset';

const SVG = 'http://www.w3.org/2000/svg';

/** Stroke paths in a 10 × 100 box, stretched to the body's height. */
const DELIM: Record<string, string> = {
  '(': 'M8.5 1C3 22 3 78 8.5 99',
  ')': 'M1.5 1C7 22 7 78 1.5 99',
  '[': 'M8 1H3V99H8',
  ']': 'M2 1H7V99H2',
  '{': 'M9 1C5 1 5 4 5 10V40C5 46 3 50 1 50C3 50 5 54 5 60V90C5 96 5 99 9 99',
  '}': 'M1 1C5 1 5 4 5 10V40C5 46 7 50 9 50C7 50 5 54 5 60V90C5 96 5 99 1 99',
  '|': 'M5 1V99',
  '⟨': 'M8.5 1L2 50L8.5 99',
  '⟩': 'M1.5 1L8 50L1.5 99',
};
const RADICAL = 'M0 60L2.6 53L5.2 98.5L10 0.5';

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function stroke(path: string, cls: string): HTMLElement {
  const slot = el('span', cls);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 10 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  slot.append(svg);
  return slot;
}

const breaksAfter = (b: MathBox) => b.t === 'run' && (b.role === 'op' || b.role === 'punct' || (b.role === 'text' && b.s === '/'));

function tallBox(b: MathBox): boolean {
  return b.t === 'frac' || b.t === 'matrix' || b.t === 'cases' || (b.t === 'fence' && b.tall) || (b.t === 'sqrt' && b.body.some(tallBox)) || (b.t === 'sup' && b.base.some(tallBox));
}

function boxes(list: MathBox[], into: HTMLElement): void {
  for (const b of list) into.append(box(b));
}

function box(b: MathBox): Node {
  switch (b.t) {
    case 'run':
      return el('span', `m-run m-${b.role}`, b.s);
    case 'sup': {
      const s = el('span', b.base.some(tallBox) ? 'm-sup tall' : 'm-sup');
      boxes(b.base, s);
      const e = el('span', 'm-exp');
      boxes(b.exp, e);
      s.append(e);
      return s;
    }
    case 'sub': {
      const s = el('span', 'm-subs');
      boxes(b.base, s);
      const e = el('span', 'm-sub');
      boxes(b.sub, e);
      s.append(e);
      return s;
    }
    case 'frac': {
      const f = el('span', 'm-frac');
      const n = el('span', 'm-numer');
      const d = el('span', 'm-denom');
      boxes(b.num, n);
      boxes(b.den, d);
      f.append(n, d);
      return f;
    }
    case 'sqrt': {
      const s = el('span', b.index ? 'm-sqrt indexed' : 'm-sqrt');
      if (b.index) {
        const i = el('span', 'm-index');
        boxes(b.index, i);
        s.append(i);
      }
      const body = el('span', 'm-radicand');
      boxes(b.body, body);
      s.append(stroke(RADICAL, 'm-rad'), body);
      return s;
    }
    case 'fence': {
      if (!b.tall) {
        const f = el('span', 'm-fence');
        f.append(el('span', 'm-run m-delim', b.open));
        boxes(b.body, f);
        f.append(el('span', 'm-run m-delim', b.close));
        return f;
      }
      const f = el('span', 'm-fence tall');
      const body = el('span', 'm-fbody');
      boxes(b.body, body);
      f.append(stroke(DELIM[b.open] ?? DELIM['('], 'm-dl'), body, stroke(DELIM[b.close] ?? DELIM[')'], 'm-dr'));
      return f;
    }
    case 'matrix': {
      const t = el('table', 'mat');
      for (const r of b.rows) {
        const tr = el('tr', '');
        for (const c of r) {
          const td = el('td', '');
          boxes(c, td);
          tr.append(td);
        }
        t.append(tr);
      }
      const w = el('span', 'mat-wrap m-mat');
      w.append(t);
      return w;
    }
    case 'cases': {
      const c = el('span', 'm-cases');
      const t = el('table', 'm-ctable');
      for (const r of b.rows) {
        const tr = el('tr', '');
        const val = el('td', 'm-cval');
        const cond = el('td', 'm-ccond');
        if (r.val) boxes(r.val, val);
        if (r.cond) boxes(r.cond, cond);
        else cond.append(el('span', 'm-otherwise', 'otherwise'));
        tr.append(val, cond);
        t.append(tr);
      }
      c.append(stroke(DELIM['{'], 'm-dl'), t);
      return c;
    }
  }
}

export function mathNode(list: MathBox[]): HTMLElement {
  const root = el('span', 'm-root');
  let seg = el('span', 'm-seg');
  list.forEach((b, i) => {
    seg.append(box(b));
    if (breaksAfter(b) && i < list.length - 1) {
      root.append(seg, document.createElement('wbr'));
      seg = el('span', 'm-seg');
    }
  });
  root.append(seg);
  return root;
}

const SPELLINGS: Record<string, string[]> = {
  '−': ['-'],
  '×': ['*'],
  '≤': ['<='],
  '≥': ['>='],
  'π': ['pi', 'π'],
  '∞': ['infinity', 'inf', '∞'],
  'τ': ['tau', 'τ'],
  'φ': ['phi', 'φ'],
};
const MAX_GAP = 8;

export function mapSource(root: HTMLElement, src: string): void {
  let at = 0;
  const lower = src.toLowerCase();
  for (const run of root.querySelectorAll<HTMLElement>('.m-run')) {
    const s = run.textContent ?? '';
    let best = -1, len = 0;
    for (const sp of SPELLINGS[s] ?? [s]) {
      const k = lower.indexOf(sp.toLowerCase(), at);
      if (k >= 0 && k - at <= MAX_GAP && (best < 0 || k < best)) { best = k; len = sp.length; }
    }
    if (best < 0) continue;
    run.dataset.a = String(best);
    run.dataset.n = String(len);
    at = best + len;
  }
}

export function caretAt(root: HTMLElement, x: number, y: number, srcLength: number): number {
  const hit = document.elementsFromPoint(x, y).find((e) => root.contains(e) && (e as HTMLElement).dataset?.a !== undefined) as HTMLElement | undefined;
  if (!hit) {
    const r = root.getBoundingClientRect();
    return x < r.left + 4 ? 0 : srcLength;
  }
  const a = Number(hit.dataset.a), n = Number(hit.dataset.n);
  const r = hit.getBoundingClientRect();
  const f = r.width > 0 ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 1;
  const chars = [...(hit.textContent ?? '')].length;
  return chars === n ? a + Math.round(f * n) : a + (f < 0.5 ? 0 : n);
}
