

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
export const ICONS: Record<string, string> = {
  keys: '<rect x="1.75" y="4" width="12.5" height="8" rx="1.75"/><path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5.5 9.5h5" />',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  minus: '<path d="M3.5 8h9"/>',
  fit: '<path d="M2.75 5.75v-3h3M10.25 2.75h3v3M13.25 10.25v3h-3M5.75 13.25h-3v-3"/><path d="M5 10.5c1.2-4 4.8-4 6-5" stroke-width="1.4"/>',
  home: '<path d="M2.75 7.25 8 2.75l5.25 4.5V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3.25a.5.5 0 0 1-.5-.5Z"/>',
  download: '<path d="M8 2.75v7.5M4.75 7 8 10.25 11.25 7M3 13.25h10"/>',
  table: '<rect x="2.75" y="3" width="10.5" height="10" rx="1.75"/><path d="M2.75 6.5h10.5M7 6.5V13"/>',
  bell: '<path d="M1.75 12.5c2.6 0 3.2-8.5 6.25-8.5s3.65 8.5 6.25 8.5"/><path d="M8 4v8.5" stroke-dasharray="1.2 1.6"/>',
  // The starter examples, after the symbols iOS gives the same ones.
  curve: '<path d="M1.75 13.75h12.5"/><path d="M1.75 11.75c1.9 0 2.6-1.2 3.45-3.8S6.85 3 8 3s1.95 2.35 2.8 4.95 1.55 3.8 3.45 3.8"/>',
  func: '<path d="M8.75 2.75c-1.75-.35-2.6.5-2.9 2.1L4.6 12c-.3 1.6-1.15 2.1-2.35 1.75M3.75 6.25h4.5M9.5 7.75l3.75 4.5M13.25 7.75 9.5 12.25"/>',
  bars: '<rect x="2.75" y="8.75" width="2.5" height="4.5" rx=".5"/><rect x="6.75" y="2.75" width="2.5" height="10.5" rx=".5"/><rect x="10.75" y="5.75" width="2.5" height="7.5" rx=".5"/>',
  sliders: '<path d="M2.25 3.75h6.5M12.25 3.75h1.5M2.25 8h1.5M7.25 8h6.5M2.25 12.25h4.5M10.25 12.25h3.5"/><circle cx="10.5" cy="3.75" r="1.75"/><circle cx="5.5" cy="8" r="1.75"/><circle cx="8.5" cy="12.25" r="1.75"/>',
  sigma: '<path d="M12 3.25H4l4 4.75-4 4.75h8"/>',
  history: '<path d="M2.75 8a5.25 5.25 0 1 0 1.55-3.7"/><path d="M2.6 2.6v2.6h2.6"/><path d="M8 5.25V8l2 1.25"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25 13.5 13.5"/>',
  clear: '<path d="M3 4.5h10M6.25 4.5V3h3.5v1.5M4.5 4.5l.6 8.1a.75.75 0 0 0 .75.65h4.3a.75.75 0 0 0 .75-.65l.6-8.1"/>',
};
export function icon(name: keyof typeof ICONS): HTMLElement {
  const s = h('span', { class: 'gi', 'aria-hidden': 'true' });
  s.innerHTML = lineIcon(ICONS[name]);
  return s;
}
export function lineIcon(body: string, { stroke = '1.6', extra = '' }: { stroke?: string; extra?: string } = {}): string {
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;
}

export const iconLabel = (name: keyof typeof ICONS, label: string) => [icon(name), h('span', { class: 'gl' }, label)];
/**
 * A group with one Tab stop. Arrow keys, Home and End move inside it (the WAI-ARIA toolbar pattern),
 * so Tab jumps between areas instead of crawling through every button.
 */
export function roving(container: HTMLElement, selector: string): () => void {
  const items = () => [...container.querySelectorAll<HTMLElement>(selector)].filter((el) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled);
  // Visibility (offsetParent) needs a layout, so refreshing right after a render would force one on every
  // keystroke. Calls in one frame share one refresh, at the start of the next.
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const list = items();
      if (!list.length) return;
      const cur = list.findIndex((el) => el.tabIndex === 0);
      list.forEach((el, k) => (el.tabIndex = k === (cur < 0 ? 0 : cur) ? 0 : -1));
    });
  };
  container.addEventListener('focusin', (e) => {
    const list = items();
    if (!list.includes(e.target as HTMLElement)) return;
    list.forEach((el) => (el.tabIndex = el === e.target ? 0 : -1));
  });
  container.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const isSelect = (document.activeElement as HTMLElement).tagName === 'SELECT';
    // A slider keeps its arrow keys for its value; Tab leaves it.
    if ((document.activeElement as HTMLInputElement).type === 'range' && e.key !== 'Home' && e.key !== 'End') return;
    let n = -1;
    if (e.key === 'ArrowRight' || (!isSelect && e.key === 'ArrowDown')) n = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || (!isSelect && e.key === 'ArrowUp')) n = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    if (n < 0) return;
    e.preventDefault();
    list.forEach((el, k) => (el.tabIndex = k === n ? 0 : -1));
    list[n].focus();
  });
  return refresh;
}
