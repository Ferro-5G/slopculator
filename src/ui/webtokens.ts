// Colors the web draws with and the phones don't stay in the stylesheets; a variable named here comes only from here.
import { type ColorPref, swatchOver, type HeroCap, type LookPref, type SwatchBase, type WebTheme } from './appearance.ts';
import { type Palette, paletteFor, swatchBase } from './palettes.ts';

const THEMES: WebTheme[] = ['paper', 'ink', 'oled', 'contrast', 'contrastLight'];

const heroFill = (h: HeroCap): string => (h.top === h.cap ? h.cap : `linear-gradient(180deg, ${h.top}, ${h.cap})`);

function modernVars(p: Palette): Record<string, string> {
  return {
    ...sharedVars(p),
    '--bg': p.bg,
    '--accent-soft': p.accentSoft,
    '--active-fill': p.tapeActive,
    '--key': p.caps.num.cap,
    '--key-ink': p.caps.num.ink,
    '--key-fn': p.caps.fn.cap,
    '--key-fn-ink': p.caps.fn.ink,
    '--key-act': p.caps.act.cap,
    '--key-act-ink': p.caps.act.ink,
    '--key-op': p.caps.op.cap,
    '--key-op-ink': p.caps.op.ink,
    '--key-ac-ink': p.caps.red.ink,
    '--key-bed': p.keyBed,
    '--hero-fill': heroFill(p.caps.hero),
    '--hero-glow': p.caps.hero.cap,
  };
}

function sharedVars(p: Palette): Record<string, string> {
  return {
    '--ink': p.ink,
    '--ink-2': p.ink2,
    '--ink-3': p.ink3,
    '--rule': p.rule,
    '--rule-2': p.rule2,
    '--accent': p.accent,
    '--err': p.error,
    '--warn': p.warn,
    '--well': p.well,
    '--panel': p.surface,
    '--hero-ink': p.caps.hero.ink,
    '--graph-bg': p.graphBg,
    '--graph-grid': p.grid,
    '--graph-grid-major': p.gridMajor,
    '--graph-axis': p.axis,
    ...Object.fromEntries(p.curves.map((c, i) => [`--curve-${i + 1}`, c])),
  };
}

/** Where the web's colors differ from the phones' today, value by value. Delete an entry and the web takes the phones' color. */
const WEB_DIFFERS: Record<string, Record<string, string>> = {
  'modern/paper': { '--graph-grid-major': '#c4c4ca' },
  'modern/contrast': { '--warn': '#ffd400', '--curve-1': '#ffd400', '--curve-2': '#00e1ff', '--curve-3': '#7dff4f', '--curve-4': '#ff6bd6', '--curve-5': '#ff9f1c', '--curve-6': '#b39dff', '--curve-7': '#ff5c5c', '--curve-8': '#ffffff' },
};

function vars(look: LookPref, theme: WebTheme): Record<string, string> {
  const p = paletteFor(look, theme);
  return { ...modernVars(p), ...WEB_DIFFERS[`${look}/${theme}`] };
}

function block(selector: string, look: LookPref, theme: WebTheme): string {
  return `${selector} {\n${Object.entries(vars(look, theme)).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
}

/** The stylesheet variables, as rules `modern.css` opens with (`@palette;`, filled in by vite.config.ts). */
export function paletteCss(look: LookPref = 'modern'): string {
  return [
    block(":root,\n[data-theme='paper']", look, 'paper'),
    ...THEMES.slice(1).map((t) => block(`[data-theme='${t}']`, look, t)),
  ].join('\n');
}

export const SWATCH_BASE = Object.fromEntries(THEMES.map((t) => [`modern/${t}`, swatchBase(paletteFor('modern', t))])) as Record<`${LookPref}/${WebTheme}`, SwatchBase>;

/** Empty for the theme's own colors. */
export function colorTokens(look: LookPref, theme: WebTheme, color: ColorPref): Record<string, string> {
  if (color === 'default') return {};
  const s = swatchOver(SWATCH_BASE[`${look}/${theme}`], color);
  const out: Record<string, string> = { '--accent': s.accent, '--led': s.led, '--caret': s.caret, '--hero-ink': s.hero.ink, '--key-op-ink': s.opInk, '--hero-fill': heroFill(s.hero) };
  if (s.accentSoft) out['--accent-soft'] = s.accentSoft;
  if (s.hero.edge) out['--hero-edge'] = s.hero.edge;
  return out;
}
