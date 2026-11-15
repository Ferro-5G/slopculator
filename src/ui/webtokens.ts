// Colors the web draws with and the phones don't stay in the stylesheets; a variable named here comes only from here.
import { type ColorPref, swatchOver, type HeroCap, type LookPref, type SwatchBase, type WebTheme } from './appearance.ts';
import { type Palette, paletteFor, swatchBase } from './palettes.ts';

const THEMES: WebTheme[] = ['paper', 'ink', 'oled', 'contrast', 'contrastLight'];
const PRIDE_THEMES: WebTheme[] = ['paper', 'ink', 'oled'];

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

function retroVars(p: Palette): Record<string, string> {
  const cap = (name: string, c: Palette['caps']['num']) => ({ [`--cap-${name}`]: c.cap, [`--cap-${name}-top`]: c.top, [`--cap-${name}-ink`]: c.ink });
  return {
    ...sharedVars(p),
    '--bg': p.bg,
    '--plate': p.plate,
    '--led': p.led,
    '--led-off': p.ledOff,
    '--bezel': p.bezel,
    '--lcd': p.lcd,
    '--lcd-ink': p.lcdInk,
    '--lcd-ink-2': p.lcdInk2,
    '--tape': p.tape,
    '--tape-bar': p.tapeBar,
    '--tape-active': p.tapeActive,
    '--tape-hole': p.tapeHole,
    '--tape-edge': p.tapeEdge,
    '--cap-edge': p.capEdge,
    '--cap-num-edge': p.caps.num.edge ?? p.capEdge,
    '--cap-lip': p.capLip,
    '--cap-shine': p.capShine,
    ...cap('num', p.caps.num),
    ...cap('fn', p.caps.fn),
    ...cap('act', p.caps.act),
    ...cap('op', p.caps.op),
    ...cap('red', p.caps.red),
    '--hero': p.caps.hero.cap,
    '--hero-top': p.caps.hero.top,
    '--hero-edge': p.caps.hero.edge ?? p.capEdge,
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
  'modern/ink': { '--graph-grid-major': '#34343c' },
  'modern/contrast': { '--warn': '#ffd400', '--curve-1': '#ffd400', '--curve-2': '#00e1ff', '--curve-3': '#7dff4f', '--curve-4': '#ff6bd6', '--curve-5': '#ff9f1c', '--curve-6': '#b39dff', '--curve-7': '#ff5c5c', '--curve-8': '#ffffff' },
  'modern/paper/pride': { '--accent-soft': '#f3e8f8', '--active-fill': '#f2f3f6', '--key-fn': '#ffffff', '--key-act': '#d6f5e3', '--key-op': '#f5ebf9', '--hero-fill': 'linear-gradient(100deg, var(--rainbow))', '--hero-glow': '#2563eb' },
  'modern/ink/pride': { '--active-fill': '#1f1f23', '--hero-fill': 'linear-gradient(100deg, var(--rainbow))', '--hero-glow': '#2563eb' },
  'modern/oled/pride': { '--graph-grid': '#241632', '--graph-grid-major': '#3a2450', '--active-fill': '#141416', '--hero-fill': 'linear-gradient(100deg, var(--rainbow))', '--hero-glow': '#2563eb' },
  'retro/ink': { '--led-off': '#3e3f43', '--bezel': '#08090a' },
  'retro/contrast': { '--warn': '#ffd400', '--curve-1': '#ffd400', '--curve-2': '#00e1ff', '--curve-3': '#7dff4f', '--curve-4': '#ff6bd6', '--curve-5': '#ff9f1c', '--curve-6': '#b39dff', '--curve-7': '#ff5c5c', '--curve-8': '#ffffff' },
  'retro/paper/pride': { '--bg': '#d9cfe3', '--cap-num-edge': '#696458' },
  'retro/ink/pride': { '--graph-bg': '#140e1c', '--bg': '#1d191f', '--led-off': '#3e3f43', '--bezel': '#08090a', '--lcd': '#ffc6e6', '--tape-hole': '#c2b3d2', '--cap-edge': 'rgba(74, 19, 88, 0.5)' },
  'retro/oled/pride': { '--lcd': '#ffc6e6', '--tape-hole': '#c2b3d2', '--cap-edge': 'rgba(74, 19, 88, 0.5)', '--cap-num-edge': '#8a8478' },
};

function vars(look: LookPref, theme: WebTheme, pride: boolean): Record<string, string> {
  const p = paletteFor(look, theme, pride);
  return { ...(look === 'retro' ? retroVars(p) : modernVars(p)), ...WEB_DIFFERS[`${look}/${theme}${pride ? '/pride' : ''}`] };
}

function block(selector: string, look: LookPref, theme: WebTheme, pride: boolean): string {
  return `${selector} {\n${Object.entries(vars(look, theme, pride)).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
}

/** A look's stylesheet variables, as rules the look's stylesheet opens with (`@palette;`, filled in by vite.config.ts). */
export function paletteCss(look: LookPref): string {
  return [
    block(":root,\n[data-theme='paper']", look, 'paper', false),
    ...THEMES.slice(1).map((t) => block(`[data-theme='${t}']`, look, t, false)),
    ...PRIDE_THEMES.map((t) => block(`[data-pride][data-theme='${t}']`, look, t, true)),
  ].join('\n');
}

export const SWATCH_BASE = Object.fromEntries((['modern', 'retro'] as const).flatMap((look) => THEMES.map((t) => [`${look}/${t}`, swatchBase(paletteFor(look, t))]))) as Record<`${LookPref}/${WebTheme}`, SwatchBase>;

/** Empty for the theme's own colors. */
export function colorTokens(look: LookPref, theme: WebTheme, color: ColorPref): Record<string, string> {
  if (color === 'default') return {};
  const s = swatchOver(SWATCH_BASE[`${look}/${theme}`], color);
  const out: Record<string, string> = { '--accent': s.accent, '--led': s.led, '--caret': s.caret, '--hero-ink': s.hero.ink };
  if (s.accentSoft) out['--accent-soft'] = s.accentSoft;
  if (s.hero.edge) out['--hero-edge'] = s.hero.edge;
  if (look === 'retro') Object.assign(out, { '--hero': s.hero.cap, '--hero-top': s.hero.top, '--cap-op-ink': s.opInk });
  else Object.assign(out, { '--key-op-ink': s.opInk, '--hero-fill': heroFill(s.hero) });
  return out;
}
