// Modern's glass, as every front end draws it: the corners of its cards and of the composer island, and a card's
// frosted fill, lit edge and lift, from the palette. The phone app sets these on its views; the web takes them as
// stylesheet variables (webtokens.ts).
import type { Palette } from './palettes.ts';

/** A glass card's corner: blocks and the graph card. */
export const GLASS_RADIUS = 18;
/** The composer island's corner. */
export const ISLAND_RADIUS = 20;

/** The page is pure black (OLED). */
export const isBlackSurface = (p: Palette): boolean => p.dark && p.bg.toLowerCase() === '#000000';

/** Modern's glass card: its translucent fill, specular edge and lift. Retro and High contrast keep their own. */
export function glassCard(p: Palette): { fill: string; edge: string; shadow: string } {
  if (!p.dark) {
    return {
      fill: 'rgba(255, 255, 255, 0.78)',
      edge: 'rgba(255, 255, 255, 0.92)',
      shadow: 'inset 0 1px 0 rgba(255,255,255,0.95), 0 4px 14px rgba(32,48,96,0.07), 0 0 0 0.5px rgba(23,23,26,0.05)',
    };
  }
  return {
    fill: isBlackSurface(p) ? 'rgba(22, 22, 26, 0.78)' : 'rgba(26, 30, 42, 0.72)',
    edge: 'rgba(255, 255, 255, 0.09)',
    shadow: 'inset 0 1px 0 rgba(255,255,255,0.13), 0 4px 14px rgba(0,0,0,0.26)',
  };
}
