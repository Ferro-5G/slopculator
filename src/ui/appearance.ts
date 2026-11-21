export type LookPref = 'modern' | 'retro';
export const LOOK_NAMES: [LookPref, string][] = [['modern', 'Modern'], ['retro', 'Retro']];

export type MotionPref = 'full' | 'reduced' | 'off';
export const MOTION_NAMES: [MotionPref, string][] = [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']];

export type GraphRatePref = 'high' | '60';
export const GRAPH_RATE_NAMES: [GraphRatePref, string][] = [['high', 'Highest'], ['60', '60 Hz']];
export const GRAPH_RATE_NOTE = "How smoothly the graph moves. Highest uses your display's full rate while you move it, and 60 Hz uses a little less battery. A graph that's still draws nothing either way.";
/** The shortest gap between graph frames in ms. Under 16.7 so that timing jitter can't skip a 60 Hz frame. */
export const graphFrameGap = (rate: GraphRatePref | undefined): number => (rate === '60' ? 15 : 0);
export const motionOf = (pref: MotionPref | undefined, systemReduced: boolean): MotionPref => ((pref ?? 'full') === 'full' && systemReduced ? 'reduced' : pref ?? 'full');

export type ColorPref = 'default' | 'teal' | 'green' | 'amber' | 'rose' | 'violet' | 'graphite';
export const COLOR_NAMES: [ColorPref, string][] = [['default', 'Default'], ['teal', 'Teal'], ['green', 'Green'], ['amber', 'Amber'], ['rose', 'Rose'], ['violet', 'Violet'], ['graphite', 'Graphite']];
export const COLORS: ColorPref[] = COLOR_NAMES.map(([c]) => c);

// A swatch is a signal, not a fill: it changes the accent (the caret, the active line's outline, "+ New line", the
// selected tab, toggles and links), enter's fill and ink, and the operator legends. Never a page, paper, bed or cap.

export const SWATCHES: Record<Exclude<ColorPref, 'default'>, { light: string; dark: string; darkInk: string }> = {
  teal: { light: '#0f766e', dark: '#7ee8da', darkInk: '#04211d' },
  green: { light: '#166534', dark: '#86e6a5', darkInk: '#052012' },
  amber: { light: '#92400e', dark: '#fcd477', darkInk: '#241703' },
  rose: { light: '#be123c', dark: '#ffb1c1', darkInk: '#2a0610' },
  violet: { light: '#6d28d9', dark: '#cbb6ff', darkInk: '#170a33' },
  graphite: { light: '#374151', dark: '#cbd5e1', darkInk: '#0f172a' },
};

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const fade = (hex: string, a: number): string => `rgba(${hexRgb(hex).join(',')},${a})`;
function mix(a: string, b: string, t: number): string {
  const y = hexRgb(b);
  return `#${hexRgb(a).map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of an opaque #rrggbb color. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** WCAG contrast ratio between two opaque colors. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
export function atLeast(fg: string, bg: string, ratio: number): string {
  const toward = luminance(bg) > 0.18 ? '#000000' : '#ffffff';
  let c = fg;
  for (let t = 0.04; contrast(c, bg) < ratio && t <= 1.0001; t += 0.04) c = mix(fg, toward, t);
  return c;
}

export interface HeroCap { cap: string; top: string; ink: string; edge?: string }
export interface SwatchBase { look: 'modern' | 'retro'; dark: boolean; hc: boolean; page: string; active: string; accent: string; opCap: string; opInk: string; hero: HeroCap }
export interface SwatchLayer { accent: string; accent2: string; onAccent?: string; accentSoft?: string; led: string; opInk: string; hero: HeroCap; caret: string }

export function swatchOver(b: SwatchBase, color: Exclude<ColorPref, 'default'>): SwatchLayer {
  const s = SWATCHES[color];
  if (b.hc) {
    const accent = atLeast(atLeast(b.dark ? s.dark : s.light, b.page, 7), b.active, 7);
    return { accent, accent2: accent, led: accent, opInk: accent, hero: { ...b.hero, cap: accent, top: accent }, caret: accent };
  }
  const fill = b.dark ? s.dark : s.light;
  const ink = b.dark ? s.darkInk : '#ffffff';
  let top = fill;
  if (b.look === 'retro' || !b.dark) for (let t = 0.12; t > 0; t -= 0.02) { const c = mix(fill, '#ffffff', t); if (contrast(ink, c) >= 4.5) { top = c; break; } }
  // Retro Light's operators are charcoal caps with ivory legends whatever the swatch; elsewhere the legend is the accent, kept readable on its cap.
  const opInk = b.look === 'retro' && !b.dark ? b.opInk : atLeast(fill, b.opCap, 4.5);
  const accent = atLeast(atLeast(fill, b.page, 4.5), b.active, 4.5);
  return { accent, accent2: fill, onAccent: ink, accentSoft: fade(fill, b.dark ? 0.2 : 0.14), led: fill, opInk, hero: { cap: fill, top, ink, edge: mix(fill, '#000000', 0.35) }, caret: accent };
}

export type WebTheme = 'paper' | 'ink' | 'oled' | 'contrast' | 'contrastLight';

// Mode (System, Light, Dark), Pure black when dark, and High contrast, shared by the web and mobile. Before they were
// split out, one `theme` preference held all three as five values; a stored `theme` with none of the new fields is
// read as the matching choices, and themeOf gives the old value back for anything that still reads it.

export type ModePref = 'system' | 'light' | 'dark';
/** The old single preference: paper is Light, ink is Dark, oled is Dark in pure black, contrast is High contrast. */
export type ThemeValue = 'system' | 'paper' | 'ink' | 'oled' | 'contrast';
export const THEME_NAMES: [ThemeValue, string][] = [['system', 'System'], ['paper', 'Light'], ['ink', 'Dark'], ['oled', 'OLED black'], ['contrast', 'High contrast']];

export interface AppearanceChoice {
  mode: ModePref;
  pureBlack: boolean;
  contrast: boolean;
}

export interface StoredAppearance {
  theme?: ThemeValue;
  mode?: ModePref;
  pureBlack?: boolean;
  contrast?: boolean;
}

export const MODE_NAMES: [ModePref, string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

/** The choices a stored preference makes, reading the old `theme` when the new fields aren't there. Dark when nothing is stored. */
export function appearanceOf(p: StoredAppearance): AppearanceChoice {
  if (p.mode) return { mode: p.mode, pureBlack: !!p.pureBlack, contrast: !!p.contrast };
  switch (p.theme) {
    case 'paper': return { mode: 'light', pureBlack: false, contrast: false };
    case 'ink': return { mode: 'dark', pureBlack: false, contrast: false };
    case 'oled': return { mode: 'dark', pureBlack: true, contrast: false };
    case 'contrast': return { mode: 'system', pureBlack: false, contrast: true };
    case 'system': return { mode: 'system', pureBlack: false, contrast: false };
    // Slopculator is designed dark first: with nothing chosen, it's dark whatever the system says.
    default: return { mode: 'dark', pureBlack: false, contrast: false };
  }
}

/** The old single value for these choices. System in pure black stays system: themeFor takes pureBlack too. */
export function themeOf(a: AppearanceChoice): ThemeValue {
  if (a.contrast) return 'contrast';
  if (a.mode === 'light') return 'paper';
  if (a.mode === 'dark') return a.pureBlack ? 'oled' : 'ink';
  return 'system';
}

/** What to store for a change: the new fields, and the old value kept in step for anything that still reads it. */
export function appearancePatch(now: StoredAppearance, change: Partial<AppearanceChoice>): Required<StoredAppearance> {
  const a = { ...appearanceOf(now), ...change };
  return { mode: a.mode, pureBlack: a.pureBlack, contrast: a.contrast, theme: themeOf(a) };
}

export function interfaceStyle(a: AppearanceChoice): 'light' | 'dark' | 'unspecified' {
  return a.mode === 'system' ? 'unspecified' : a.mode;
}

export function themeOfChoice(a: AppearanceChoice, systemDark: boolean): WebTheme {
  const dark = a.mode === 'dark' || (a.mode === 'system' && systemDark);
  if (a.contrast) return dark ? 'contrast' : 'contrastLight';
  return dark ? (a.pureBlack ? 'oled' : 'ink') : 'paper';
}
