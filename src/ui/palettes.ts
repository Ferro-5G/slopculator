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
  flag?: string[];
  tapeBars?: string[];
}

// The accent is a signal, never a fill for the page; one cap system
// (digit, secondary, operator, and enter the one accent-filled key); every key's edge at least 3:1 against what's
// around it; Retro's paper calmer; High contrast on Light or Dark.

const PAPER: Palette = {
  look: 'retro',
  shape: { key: 5, chip: 3, field: 3, frame: 8, frameBorder: 4 },
  tractor: true,
  dark: false,
  bg: '#d8d3c5',
  plate: '#cfcabb',
  well: '#c4beae',
  surface: '#f6f3ea',
  surfaceHigh: '#ffffff',
  formBg: '#d8d3c5',
  formCard: '#f6f3ea',
  ink: '#1d1c18',
  ink2: '#47453d',
  ink3: '#5a574e',
  rule: 'rgba(29,28,24,0.16)',
  rule2: 'rgba(29,28,24,0.32)',
  // #b93c06 a touch darker: 4.5:1 on the warm active line too, where the caret is.
  accent: '#b23a06',
  accent2: '#f97316',
  onAccent: '#1a1206',
  accentSoft: 'rgba(249,115,22,0.18)',
  error: '#a8200d',
  warn: '#7f4d00',
  led: '#f97316',
  ledOff: '#9d9888',
  lcd: '#b6c2a2',
  lcdInk: '#151c10',
  lcdInk2: '#2c3724',
  lcdGhost: 'rgba(21,28,16,0.055)',
  bezel: '#23221e',
  // Plain paper, a faint green bar, and a warm neutral under the line being typed: no yellow.
  tape: '#fbfaf3',
  tapeBar: '#eef0e4',
  tapeActive: '#eae3d3',
  tapeHole: '#c4beae',
  tapeEdge: 'rgba(29,28,24,0.14)',
  // The tables' #6d685c, a hair darker: 3.0:1 on the bed rather than 2.99.
  capEdge: '#696458',
  capLip: 'rgba(29,28,24,0.2)',
  capShine: 'rgba(255,255,255,0.65)',
  keyBed: '#c4beae',
  capRim: 0,
  capLipW: 0,
  activeBar: 0,
  // Digit, secondary (functions, the editing keys, xʸ √ ( ) , =, ans, AC, the Thumb Index's tabs), operator (÷ × − + only) and enter.
  caps: {
    num: { cap: '#f7f4eb', top: '#ffffff', ink: '#1d1c18' },
    fn: { cap: '#dcd7c9', top: '#e9e5d9', ink: '#1d1c18' },
    op: { cap: '#3a3934', top: '#4a4943', ink: '#f7f4eb' },
    act: { cap: '#dcd7c9', top: '#e9e5d9', ink: '#1d1c18' },
    hero: { cap: '#f97316', top: '#ff8d3a', ink: '#1a1206', edge: '#a64a07' },
    red: { cap: '#dcd7c9', top: '#e9e5d9', ink: '#a8200d' },
  },
  graphBg: '#f7f8ef',
  grid: '#e0ebd9',
  gridMajor: '#b6cfb5',
  axis: '#2b352c',
  hatch: true,
  glow: false,
  curves: ['#1f4fc4', '#c8321f', '#12803c', '#6b3bc2', '#0e7c86', '#a66a00', '#b0237a', '#222222'],
};

const TRACES = ['#6ff5cf', '#ffb347', '#ff6fb5', '#6db8ff', '#b7f04a', '#b79bff', '#ff7d6b', '#e8f4ef'];

/** The same device with the lights off: warm graphite, not blue-grey. */
const INK: Palette = {
  ...PAPER,
  dark: true,
  bg: '#1d1b18',
  plate: '#24221e',
  well: '#141310',
  surface: '#26241f',
  surfaceHigh: '#2f2c27',
  formBg: '#1d1b18',
  formCard: '#26241f',
  ink: '#ece6da',
  ink2: '#c4bdb0',
  ink3: '#a39c8f',
  rule: 'rgba(255,240,220,0.1)',
  rule2: 'rgba(255,240,220,0.24)',
  accent: '#ff9a57',
  error: '#ff8a7a',
  warn: '#e7b04c',
  ledOff: '#3e3b35',
  lcd: '#06110e',
  lcdInk: '#6ff5cf',
  lcdInk2: '#43b698',
  lcdGhost: 'rgba(111,245,207,0.05)',
  bezel: '#080807',
  tape: '#26241f',
  tapeBar: '#2a2b23',
  tapeActive: '#36362d',
  tapeHole: '#141310',
  tapeEdge: 'rgba(255,240,220,0.1)',
  // A lit rim round each cap's face, over a black lip.
  capEdge: '#000000',
  capRimColor: '#7d776b',
  // The operator amber: the accent's orange read dim on the active line.
  caret: '#ffb27a',
  capLip: 'rgba(0,0,0,0.35)',
  capShine: 'rgba(255,255,255,0.12)',
  keyBed: '#141310',
  caps: {
    num: { cap: '#4a4740', top: '#57534b', ink: '#f5f0e6' },
    fn: { cap: '#35332e', top: '#3f3c36', ink: '#ece6da' },
    op: { cap: '#1b1a17', top: '#24221e', ink: '#ffb27a' },
    act: { cap: '#35332e', top: '#3f3c36', ink: '#ece6da' },
    hero: { cap: '#f97316', top: '#ff8d3a', ink: '#1a1206', edge: '#a64a07' },
    red: { cap: '#35332e', top: '#3f3c36', ink: '#ff8a7a' },
  },
  graphBg: '#07110e',
  grid: '#10241c',
  gridMajor: '#1d4034',
  axis: '#79b8a1',
  hatch: false,
  glow: true,
  curves: TRACES,
};

/** Dark on true black: only the page, paper, bed and chrome go black. Caps keep visible rims and their depth, enter stays lit, and nothing glows. */
const OLED: Palette = {
  ...INK,
  bg: '#000000',
  plate: '#000000',
  well: '#000000',
  surface: '#000000',
  surfaceHigh: '#0c0c0d',
  formBg: '#000000',
  formCard: '#111113',
  rule: 'rgba(255,255,255,0.14)',
  rule2: 'rgba(255,255,255,0.28)',
  ledOff: '#2a2a2a',
  lcd: '#000000',
  lcdGhost: 'transparent',
  bezel: '#2a2a2a',
  tape: '#000000',
  tapeBar: '#0e0f0b',
  tapeActive: '#1f1b10',
  tapeHole: '#1c1c1c',
  tapeEdge: 'rgba(255,255,255,0.14)',
  capEdge: '#6b665c',
  capRimColor: undefined,
  capLip: 'transparent',
  capShine: 'transparent',
  keyBed: '#000000',
  caps: {
    num: { cap: '#1a1814', top: '#1a1814', ink: '#f5f0e6', edge: '#8a8478' },
    fn: { cap: '#000000', top: '#000000', ink: '#ece6da', edge: '#6b665c' },
    op: { cap: '#000000', top: '#000000', ink: '#ffb98a', edge: '#6b665c' },
    act: { cap: '#000000', top: '#000000', ink: '#ece6da', edge: '#6b665c' },
    hero: { cap: '#f97316', top: '#f97316', ink: '#1a1206', edge: '#a64a07' },
    red: { cap: '#000000', top: '#000000', ink: '#ff8a7a', edge: '#6b665c' },
  },
  graphBg: '#000000',
  grid: '#0c1512',
  gridMajor: '#1a2e27',
  glow: false,
};

/**
 * High contrast on Dark or Light: black or white, the other for ink and 2 pt rims, the accent raised to 7:1 and enter
 * filled with it. No translucency, gradients, glow, holes or unlit segments. Square geometry and mono type stay Retro's.
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

/** Each look's own accent under High contrast, at 7:1 or more on white and on black. */
const HC_ACCENT = { retro: { light: '#8f2d00', dark: '#ffa463' }, modern: { light: '#0039b3', dark: '#8ab8ff' } };

const CONTRAST = contrastOf(OLED, false, HC_ACCENT.retro.dark);
const CONTRAST_LIGHT = contrastOf(PAPER, true, HC_ACCENT.retro.light);

const RETRO: Record<WebTheme, Palette> = { paper: PAPER, ink: INK, oled: OLED, contrast: CONTRAST, contrastLight: CONTRAST_LIGHT };

// Retro's names stay meaningful here: lcd is the answer's background, tape the lines', and a cap is a key.
/** Warm vellum canvas with crisp lifted white blocks, drafting-ink cobalt accent, and tactile key caps. */
const M_LIGHT: Palette = {
  ...PAPER,
  look: 'modern',
  shape: { key: 12, chip: 8, field: 10, frame: 0, frameBorder: 0 },
  tractor: false,
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

const M_CONTRAST = contrastOf(M_OLED, false, HC_ACCENT.modern.dark);
const M_CONTRAST_LIGHT = contrastOf(M_LIGHT, true, HC_ACCENT.modern.light);

const MODERN: Record<WebTheme, Palette> = { paper: M_LIGHT, ink: M_DARK, oled: M_OLED, contrast: M_CONTRAST, contrastLight: M_CONTRAST_LIGHT };

const FLAG = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982'];
const FLAG_DARK = ['#ff5c5c', '#ff9f43', '#ffe14d', '#34d399', '#5b8cff', '#c084fc'];
const TINTS = ['#ffd1e3', '#ffe0c2', '#fff5b8', '#cdf5dc', '#cfe3ff', '#e6d4ff'];
const TINTS_DARK = ['#4a2040', '#4a3220', '#46421e', '#1f4634', '#22304f', '#3a2452'];
const PENS = ['#e40303', '#e86f00', '#c9a000', '#008026', '#24408e', '#732982', '#e4287c', '#18181b'];
/** Modern's Pride: the flag in neon for the atmosphere, the composer's rim, Enter and the stripe over the keys. */
const NEON_DARK = ['#ff2e63', '#ff8a00', '#ffe600', '#00f58a', '#1fb6ff', '#b44dff'];
const NEON_LIGHT = ['#f0124d', '#ff7a00', '#f5c800', '#00d977', '#0a9cf5', '#9b30f5'];
const PENS_DARK = ['#ff5c5c', '#ff9f43', '#ffe14d', '#34d399', '#5b8cff', '#c084fc', '#f472b6', '#fafafa'];
const BARS_OLED = ['#180b0c', '#18110a', '#17160a', '#0a1810', '#0a1018', '#140a18'];

/**
 * Pride colors, the same as the [data-pride] blocks in the web's stylesheets. Modern keeps its theme and lights it with
 * the flag in neon (p.flag), as Aurora Glow does. Retro lays the flag over its palette: pink is the accent, the six
 * stripes are the pens, the enter key wears the flag, operator keys take a stripe each, and the line list's bars cycle
 * through six tints (p.tapeBars). High contrast keeps its own rules.
 */
function prideify(p: Palette, theme: WebTheme): Palette {
  if (p.hc) return p;
  const dark = theme !== 'paper';
  const oled = theme === 'oled';
  const flag = dark ? FLAG_DARK : FLAG;
  if (p.look === 'modern') {
    // Modern's Pride is light, not paint: the theme stays as it is, and the flag, in neon, lights the canvas and the
    // composer the way Aurora Glow does. The accent turns neon violet.
    const neon = dark ? NEON_DARK : NEON_LIGHT;
    const accent = dark ? '#c77dff' : '#9b30f5';
    return { ...p, flag: neon, accent, accent2: accent, led: accent, accentSoft: dark ? 'rgba(199,125,255,0.24)' : 'rgba(155,48,245,0.16)', onAccent: '#ffffff' };
  }
  const base: Palette = {
    ...p,
    flag,
    accent: dark ? '#ff7bc8' : '#732982',
    accent2: dark ? '#ff3fa4' : '#e4287c',
    onAccent: '#ffffff',
    accentSoft: dark ? 'rgba(255,63,164,0.2)' : 'rgba(228,40,124,0.18)',
    led: dark ? '#ff3fa4' : '#e4287c',
    caps: { ...p.caps, hero: { cap: '#c2187a', top: dark ? '#ff3fa4' : '#e4287c', ink: '#ffffff', edge: '#4a0f3a' } },
    curves: dark ? PENS_DARK.map((c) => (c === '#fafafa' ? '#f3e8f8' : c)) : PENS.map((c) => (c === '#18181b' ? '#222222' : c)),
  };
  if (!dark) {
    return {
      ...base,
      bg: '#f3e4ff',
      tapeHole: '#c2b3d2',
      tape: '#fffafd',
      tapeBars: TINTS,
      plate: '#ecd9f7',
      well: '#e3cdf2',
      surface: '#fff6fb',
      formBg: '#f3e4ff',
      formCard: '#fff6fb',
      lcd: '#ffc6e6',
      lcdInk: '#4a1358',
      lcdInk2: '#7a3b8e',
      lcdGhost: 'rgba(74,19,88,0.06)',
      capEdge: 'rgba(74,19,88,0.5)',
      caps: {
        ...base.caps,
        num: { cap: '#ffe4f1', top: '#fff2f8', ink: '#5b1f6e' },
        fn: { cap: '#d9f0ff', top: '#e9f7ff', ink: '#1f3a6e' },
        op: { cap: '#b96bd8', top: '#cf8ae8', ink: '#ffffff' },
        act: { cap: '#c9f2dc', top: '#dcf8e8', ink: '#1a4a33' },
      },
      graphBg: '#fff7fb',
      grid: '#fde6f2',
      gridMajor: '#ebc3e0',
      axis: '#2f2436',
    };
  }
  const tube: Palette = {
    ...base,
    lcdInk: '#ff7bc8',
    lcdInk2: '#b4508f',
    lcdGhost: 'rgba(255,123,200,0.05)',
    caps: {
      ...base.caps,
      num: { cap: oled ? '#000000' : '#3a2a4a', top: oled ? '#000000' : '#4a3860', ink: '#ffb3e0' },
      fn: { cap: oled ? '#000000' : '#2a1c3a', top: oled ? '#000000' : '#382848', ink: '#9be7ff' },
      op: { cap: oled ? '#000000' : '#1c1226', top: oled ? '#000000' : '#281a36', ink: '#ffe066' },
      act: { cap: oled ? '#000000' : '#22182c', top: oled ? '#000000' : '#2d2238', ink: '#b7f0c8' },
    },
    grid: oled ? '#130b17' : '#221428',
    gridMajor: oled ? '#2a1830' : '#3d2447',
    axis: '#c084fc',
  };
  return oled
    ? { ...tube, tapeBars: BARS_OLED }
    : { ...tube, bg: '#1d1427', plate: '#2a1c36', well: '#1a1024', surface: '#241a30', formBg: '#1d1427', formCard: '#241a30', tape: '#1d1427', tapeBars: TINTS_DARK };
}


export function swatchBase(p: Palette): SwatchBase {
  return { look: p.look, dark: p.dark, hc: !!p.hc, page: p.tractor ? p.tape : p.bg, active: p.tapeActive, accent: p.accent, opCap: p.caps.op.cap, opInk: p.caps.op.ink, hero: p.caps.hero };
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
export function paletteFor(look: LookPref | undefined, theme: WebTheme, pride = false, color: ColorPref = 'default'): Palette {
  const key = `${look}/${theme}/${pride}/${color}`;
  let out = built.get(key);
  if (!out) {
    const p = (look === 'retro' ? RETRO : MODERN)[theme];
    out = pride && !p.hc ? prideify(p, theme) : color === 'default' ? p : colorize(p, color);
    built.set(key, out);
  }
  return out;
}

export function swatchColors(look: LookPref | undefined, color: ColorPref): { light: string; dark: string } {
  if (color !== 'default') return SWATCHES[color];
  const themes = look === 'retro' ? RETRO : MODERN;
  return { light: themes.paper.accent2, dark: themes.ink.accent2 };
}

/** Which of a theme's curve colors each tab wears. Math blue, Stats green, Chance violet, Matrix amber, HVAC teal. */
const TAB_CURVES = [0, 2, 3, 5, 4];
const tabHuesOf = (curves: readonly string[]) => TAB_CURVES.map((i) => curves[i]);
const TAB_LIGHT = tabHuesOf(PAPER.curves);
const TAB_DARK = tabHuesOf(M_DARK.curves);

export function tabHues(curves: readonly (string | null | undefined)[], dark: boolean): string[] {
  const picked = TAB_CURVES.map((i) => curves[i]);
  const distinct = picked.every((c) => !!c) && new Set(picked.map((c) => c!.toLowerCase())).size === TAB_CURVES.length;
  return distinct ? (picked as string[]) : dark ? TAB_DARK : TAB_LIGHT;
}
