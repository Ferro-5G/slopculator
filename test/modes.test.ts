import { describe, expect, it } from 'vitest';
import { cleanSettings } from '../src/engine/document';
import { CHOICES, PHONE_MODES, PHONE_SETTINGS, SWITCHES, titleCased, type ModeDoc, type ModePatch } from '../src/ui/modes';

const blank = (): ModeDoc => ({ settings: cleanSettings({}), display: { places: null, exact: false, percent: false } });
const applied = (doc: ModeDoc, p: ModePatch): ModeDoc => ({ settings: { ...doc.settings, ...p.settings }, display: { ...doc.display, ...p.display } });

describe('the modes table', () => {
  const all = { ...CHOICES, ...SWITCHES };

  it.each(Object.entries(all))('%s reads back what it patches, from either side', (_id, m) => {
    for (const v of [true, false, true]) expect(m.read(applied(blank(), m.patch(v)))).toBe(v);
  });

  it('patches only the mode it belongs to', () => {
    for (const m of Object.values(all)) {
      const others = Object.values(all).filter((o) => o !== m);
      const before = others.map((o) => o.read(blank()));
      for (const v of [true, false]) expect(others.map((o) => o.read(applied(blank(), m.patch(v))))).toEqual(before);
    }
  });

  it('starts a new sheet as it always has', () => {
    const on = (m: { read: (d: ModeDoc) => boolean }) => m.read(blank());
    expect(Object.fromEntries(Object.entries(all).map(([id, m]) => [id, on(m)]))).toEqual({
      angle: true, answers: true, huge: true, sd: true, addPercent: true, working: true, percent: false, letters: false, complex: false,
    });
  });

  it('gives every choice a home on the phones', () => {
    expect([...PHONE_MODES, ...PHONE_SETTINGS].sort()).toEqual(Object.keys(CHOICES).sort());
  });
});

describe('titleCased', () => {
  it.each([
    ['Standard deviation', 'Standard Deviation'],
    ['Adding a percent', 'Adding a Percent'],
    ['Of the number', 'Of the Number'],
    ['As a number', 'As a Number'],
    ['Every digit', 'Every Digit'],
    ['Working', 'Working'],
  ])('%s becomes %s', (words, title) => expect(titleCased(words)).toBe(title));
});
