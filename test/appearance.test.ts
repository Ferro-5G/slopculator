import { describe, it, expect } from 'vitest';
import { appearanceOf, appearancePatch, interfaceStyle, themeOf } from '../src/ui/appearance';

describe('Appearance: the old theme preference read as Mode, Pure black and High contrast', () => {
  it('maps each old theme onto the new choices', () => {
    expect(appearanceOf({ theme: 'paper' })).toEqual({ mode: 'light', pureBlack: false, contrast: false });
    expect(appearanceOf({ theme: 'ink' })).toEqual({ mode: 'dark', pureBlack: false, contrast: false });
    expect(appearanceOf({ theme: 'oled' })).toEqual({ mode: 'dark', pureBlack: true, contrast: false });
    expect(appearanceOf({ theme: 'contrast' })).toEqual({ mode: 'system', pureBlack: false, contrast: true });
    expect(appearanceOf({ theme: 'system' })).toEqual({ mode: 'system', pureBlack: false, contrast: false });
    expect(appearanceOf({})).toEqual({ mode: 'dark', pureBlack: true, contrast: false });
  });

  it('gives every old theme back unchanged', () => {
    for (const theme of ['system', 'paper', 'ink', 'oled', 'contrast'] as const) expect(themeOf(appearanceOf({ theme }))).toBe(theme);
  });

  it('prefers the new fields once they are stored', () => {
    expect(appearanceOf({ theme: 'paper', mode: 'dark', pureBlack: true })).toEqual({ mode: 'dark', pureBlack: true, contrast: false });
  });

  it('keeps the old value in step with a change', () => {
    expect(appearancePatch({ theme: 'ink' }, { pureBlack: true })).toEqual({ mode: 'dark', pureBlack: true, contrast: false, theme: 'oled' });
    expect(appearancePatch({ theme: 'oled' }, { mode: 'light' })).toEqual({ mode: 'light', pureBlack: true, contrast: false, theme: 'paper' });
    // High contrast wins over the mode, and turning it off goes back to the mode underneath.
    const on = appearancePatch({ theme: 'paper' }, { contrast: true });
    expect(on.theme).toBe('contrast');
    expect(appearancePatch(on, { contrast: false }).theme).toBe('paper');
    // System in pure black has no old value of its own; it stays system, and themeFor gets pureBlack.
    expect(appearancePatch({}, { pureBlack: true })).toEqual({ mode: 'dark', pureBlack: true, contrast: false, theme: 'oled' });
  });

  it('sets the interface style from the mode, High contrast included; System follows the phone', () => {
    expect(interfaceStyle({ mode: 'light', pureBlack: false, contrast: true })).toBe('light');
    expect(interfaceStyle({ mode: 'dark', pureBlack: false, contrast: true })).toBe('dark');
    expect(interfaceStyle({ mode: 'system', pureBlack: true, contrast: false })).toBe('unspecified');
    expect(interfaceStyle({ mode: 'light', pureBlack: false, contrast: false })).toBe('light');
  });
});
