import { SWATCHES, swatchOver, type ColorPref, type LookPref, type SwatchBase, type WebTheme } from './appearance.ts';

export type { LookPref } from './appearance.ts';

export interface CapColors {
  cap: string;
  top: string;
  ink: string;
  edge?: string;
}

export interface Palette {
  look: LookPref;
  shape: { key: number; chip: number; field: number; frame: number; frameBorder: number };
  tractor: boolean;
  dark: boolean;
  bg: string;
  plate: string;
  surface: string;
  surfaceHigh: string;
  formBg: string;
  formCard: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  rule2: string;
  accent: string;
  accent2: string;
  onAccent: string;
  accentSoft: string;
  well: string;
  error: string;
  warn: string;
  led: string;
  ledOff: string;
  lcd: string;
  lcdInk: string;
  lcdInk2: string;
  lcdGhost: string;
  bezel: string;
  tape: string;
  tapeBar: string;
  tapeActive: string;
  tapeHole: string;
  tapeEdge: string;
  capEdge: string;
  capLip: string;
  capShine: string;
  keyBed: string;
  /** A cap's rim, in points, all round (0: Retro's hairline, or none in Modern), and Modern's extra lip under it. */
  capRim: number;
  capLipW: number;
  capRimColor?: string;
  /** The line being typed: the width of Modern's accent bar down its left edge (Retro has its print head: 0). */
  activeBar: number;
  caret?: string;
  hc?: boolean;
  caps: { num: CapColors; fn: CapColors; op: CapColors; act: CapColors; hero: CapColors; red: CapColors };
  graphBg: string;
  grid: string;
  gridMajor: string;
  axis: string;
  hatch: boolean;
  glow: boolean;
  curves: string[];
}

/**
 * High contrast on Dark or Light: black or white, the other for ink and 2 pt rims, the accent raised to 7:1 and enter
 * filled with it. No translucency, gradients, glow, holes or unlit segments.
 */
function contrastOf(base: Palette, light: boolean, accent: string): Palette {
  const ground = light ? '#ffffff' : '#000000';
  const ink = light ? '#000000' : '#ffffff';
  const flat = (c: string, inkC: string, edge?: string): CapColors => ({ cap: c, top: c, ink: inkC, ...(edge ? { edge } : {}) });
  return {
    ...base,
    hc: true,
    dark: !light,
    bg: ground,
    plate: ground,
    well: ground,
    surface: ground,
    surfaceHigh: ground,
    formBg: light ? '#ebebeb' : '#000000',
    formCard: light ? '#ffffff' : '#141414',
    ink,
    ink2: ink,
    ink3: light ? '#262626' : '#d6d6d6',
    rule: light ? '#595959' : '#9a9a9a',
    rule2: ink,
    accent,
    accent2: accent,
    onAccent: light ? '#ffffff' : '#000000',
    accentSoft: light ? '#dfe7ff' : '#1a2233',
    error: light ? '#a10000' : '#ff7b7b',
    warn: light ? '#6b3a00' : '#ffc46b',
    led: accent,
    ledOff: light ? '#9a9a9a' : '#555555',
    lcd: ground,
    lcdInk: ink,
    lcdInk2: ink,
    lcdGhost: 'transparent',
    bezel: ink,
    tape: ground,
    tapeBar: ground,
    tapeActive: light ? '#f2f2f2' : '#262626',
    tapeHole: ground,
    tapeEdge: light ? '#595959' : '#9a9a9a',
    capEdge: ink,
    capRimColor: undefined,
    capLip: 'transparent',
    capShine: 'transparent',
    keyBed: ground,
    capRim: 2,
    capLipW: 0,
    activeBar: 3,
    caps: {
      num: flat(ground, ink),
      fn: flat(ground, ink),
      op: flat(ground, accent),
      act: flat(ground, ink),
      hero: flat(accent, light ? '#ffffff' : '#000000', ink),
      red: flat(ground, light ? '#a10000' : '#ff7b7b'),
    },
    graphBg: ground,
    grid: light ? '#e0e0e0' : '#1f1f1f',
    gridMajor: light ? '#9a9a9a' : '#555555',
    axis: ink,
    glow: false,
  };
}

/** Accent under High contrast, at 7:1 or more on white and on black. */
const HC_ACCENT = { light: '#0039b3', dark: '#8ab8ff' };

/** Warm vellum canvas with crisp lifted white blocks, drafting-ink cobalt accent, and tactile key caps. */
const M_LIGHT: Palette = {
  look: 'modern',
  shape: { key: 12, chip: 8, field: 10, frame: 0, frameBorder: 0 },
  tractor: false,
  dark: false,
  bg: '#f4f3ef',
  plate: '#f4f3ef',
  well: '#ebe9e3',
  surface: '#ffffff',
  surfaceHigh: '#eeede8',
  formBg: '#efeee9',
  formCard: '#ffffff',
  ink: '#17171a',
  ink2: '#4d4d55',
  ink3: '#61616b',
  rule: 'rgba(23,23,26,0.1)',
  rule2: 'rgba(23,23,26,0.19)',
  accent: '#2952cc',
  accent2: '#2952cc',
  onAccent: '#ffffff',
  accentSoft: '#e5ecfc',
  error: '#cf2b1f',
  warn: '#b04808',
  led: '#2952cc',
  ledOff: 'transparent',
  lcd: '#f4f3ef',
  lcdInk: '#17171a',
  lcdInk2: '#61616b',
  lcdGhost: 'transparent',
  bezel: 'transparent',
  tape: '#f4f3ef',
  tapeBar: '#f4f3ef',
  tapeActive: '#eeede8',
  tapeHole: 'transparent',
  tapeEdge: 'transparent',
  // A light 1 pt lip, about 14% black over the bed: the fills carry the hierarchy, the lip only sets a key down.
  capEdge: '#c3c4c8',
  capLip: 'transparent',
  capShine: 'transparent',
  keyBed: '#e3e4e9',
  capRim: 0,
  capLipW: 1,
  activeBar: 3,
  caps: {
    num: { cap: '#ffffff', top: '#ffffff', ink: '#17171a' },
    fn: { cap: '#d1d3da', top: '#d1d3da', ink: '#17171a' },
    op: { cap: '#d1d3da', top: '#d1d3da', ink: '#1c42b8' },
    act: { cap: '#d1d3da', top: '#d1d3da', ink: '#4a4b54' },
    hero: { cap: '#2952cc', top: '#3560dc', ink: '#ffffff', edge: '#1d3c99' },
    red: { cap: '#d1d3da', top: '#d1d3da', ink: '#a61b12' },
  },
  graphBg: '#faf9f6',
  grid: '#efede8',
  gridMajor: '#dcd9d0',
  axis: '#6b6b74',
  hatch: false,
  glow: false,
  curves: ['#d94f3d', '#0f8a72', '#c87d0e', '#6d48d6', '#1e68b8', '#c22977', '#557d14', '#26262a'],
};

/** Deep obsidian-ink canvas, elevated graphite blocks, warm alabaster type, and luminous ultramarine accent. */
const M_DARK: Palette = {
  ...M_LIGHT,
  shape: { ...M_LIGHT.shape, key: 10 },
  dark: true,
  bg: '#111319',
  plate: '#111319',
  well: '#161922',
  surface: '#191d26',
  surfaceHigh: '#232836',
  formBg: '#111319',
  formCard: '#191d26',
  ink: '#f1f0ec',
  ink2: '#c0c5d1',
  ink3: '#8c95a6',
  rule: '#262c3a',
  rule2: '#374054',
  accent: '#8aadff',
  accent2: '#5080ff',
  onAccent: '#091124',
  accentSoft: '#1b2640',
  error: '#ff7a70',
  warn: '#f2b84b',
  led: '#5080ff',
  lcd: '#111319',
  lcdInk: '#f1f0ec',
  lcdInk2: '#8c95a6',
  tape: '#111319',
  tapeBar: '#111319',
  tapeActive: '#232836',
  // No outline round the keys: caps a step lighter than their tray, a 1 px darker lip under each, and digits told
  // from the other keys by their larger legend more than by their fill.
  capEdge: '#0c0e13',
  keyBed: '#090b10',
  capRim: 0,
  capLipW: 1,
  caps: {
    num: { cap: '#282d3a', top: '#282d3a', ink: '#f4f3ef' },
    fn: { cap: '#212530', top: '#212530', ink: '#e9e8e3' },
    op: { cap: '#212530', top: '#212530', ink: '#8aadff' },
    act: { cap: '#212530', top: '#212530', ink: '#c0c5d1' },
    hero: { cap: '#5080ff', top: '#5080ff', ink: '#091124', edge: '#3662db' },
    red: { cap: '#212530', top: '#212530', ink: '#ff8f87' },
  },
  graphBg: '#151820',
  grid: '#1e2330',
  gridMajor: '#2c3345',
  axis: '#8690a3',
  curves: ['#ff7a70', '#2cc7a8', '#f2b84b', '#a48bff', '#58c4f5', '#ff9fcf', '#b6d96a', '#f1f0ec'],
};

/** Dark on true black: only the page and bed go black; the keys keep dark fills, and enter stays filled. */
const M_OLED: Palette = {
  ...M_DARK,
  bg: '#000000',
  plate: '#000000',
  well: '#000000',
  surface: '#000000',
  surfaceHigh: '#0c0c0d',
  formBg: '#000000',
  formCard: '#111113',
  rule: 'rgba(255,255,255,0.14)',
  rule2: 'rgba(255,255,255,0.22)',
  accentSoft: '#0b1426',
  lcd: '#000000',
  tape: '#000000',
  tapeBar: '#000000',
  tapeActive: '#141416',
  keyBed: '#000000',
  capLipW: 0,
  caps: {
    // No outlines here either: dark fills on the black, the digits a step lighter so they stay first.
    num: { cap: '#323237', top: '#323237', ink: '#fafafa' },
    fn: { cap: '#1c1c1f', top: '#1c1c1f', ink: '#fafafa' },
    op: { cap: '#1c1c1f', top: '#1c1c1f', ink: '#9dc4ff' },
    act: { cap: '#1c1c1f', top: '#1c1c1f', ink: '#b4b4bc' },
    hero: { cap: '#2563eb', top: '#2563eb', ink: '#ffffff' },
    red: { cap: '#1c1c1f', top: '#1c1c1f', ink: '#ff8178' },
  },
  graphBg: '#000000',
  grid: '#101012',
  gridMajor: '#222226',
};

const M_CONTRAST = contrastOf(M_OLED, false, HC_ACCENT.dark);
const M_CONTRAST_LIGHT = contrastOf(M_LIGHT, true, HC_ACCENT.light);

const MODERN: Record<WebTheme, Palette> = { paper: M_LIGHT, ink: M_DARK, oled: M_OLED, contrast: M_CONTRAST, contrastLight: M_CONTRAST_LIGHT };

export function swatchBase(p: Palette): SwatchBase {
  return { look: p.look, dark: p.dark, hc: !!p.hc, page: p.bg, active: p.tapeActive, accent: p.accent, opCap: p.caps.op.cap, opInk: p.caps.op.ink, hero: p.caps.hero };
}

function colorize(p: Palette, color: Exclude<ColorPref, 'default'>): Palette {
  const s = swatchOver(swatchBase(p), color);
  return {
    ...p,
    accent: s.accent,
    accent2: s.accent2,
    led: s.led,
    ...(s.onAccent ? { onAccent: s.onAccent } : {}),
    ...(s.accentSoft ? { accentSoft: s.accentSoft } : {}),
    caret: p.hc ? p.caret : undefined,
    caps: { ...p.caps, op: { ...p.caps.op, ink: s.opInk }, hero: s.hero },
  };
}

const built = new Map<string, Palette>();

/** Kept once built, so a palette stays the same object between renders. */
export function paletteFor(_look: LookPref | undefined, theme: WebTheme, color: ColorPref = 'default'): Palette {
  const key = `${theme}/${color}`;
  let out = built.get(key);
  if (!out) {
    const p = MODERN[theme];
    out = color === 'default' ? p : colorize(p, color);
    built.set(key, out);
  }
  return out;
}

export function swatchColors(_look: LookPref | undefined, color: ColorPref): { light: string; dark: string } {
  if (color !== 'default') return SWATCHES[color];
  return { light: MODERN.paper.accent2, dark: MODERN.ink.accent2 };
}

/** Which of a theme's curve colors each tab wears. Math blue, Stats green, Chance violet, Matrix amber, HVAC teal. */
const TAB_CURVES = [4, 6, 3, 2, 1];
const tabHuesOf = (curves: readonly string[]) => TAB_CURVES.map((i) => curves[i]);
const TAB_LIGHT = tabHuesOf(M_LIGHT.curves);
const TAB_DARK = tabHuesOf(M_DARK.curves);

export function tabHues(curves: readonly (string | null | undefined)[], dark: boolean): string[] {
  const picked = TAB_CURVES.map((i) => curves[i]);
  const distinct = picked.every((c) => !!c) && new Set(picked.map((c) => c!.toLowerCase())).size === TAB_CURVES.length;
  return distinct ? (picked as string[]) : dark ? TAB_DARK : TAB_LIGHT;
}
