// The Thumb Index: every key the banks held has one home, and every tile says what it computes.
import { describe, it, expect } from 'vitest';
import { ANS, PAD, DIV, PANELS } from '../src/ui/keypad';
import { homeOf, faceRuns, faceText, COLUMNS, FLUIDS, ROW1, rowsOf, TABS, tileCaption, tileFor, tileHeight, tileKey, tileLabel, tileName, TILE_MAX } from '../src/ui/thumbindex';
import { EDITORS, EDITOR_TILES } from '../src/ui/editors';

const does = (k: { action?: string; ins?: string; label: string }) => (k.action ? `action:${k.action}` : (k.ins ?? k.label).trim());
const tiles = TABS.flatMap((t) => t.pages.flatMap((p) => p.tiles));
const ROWS = 5;

describe('the Thumb Index', () => {
  it('has the five tabs, in order', () => {
    expect(TABS.map((t) => t.name)).toEqual(['Math', 'Stats', 'Chance', 'Matrix', 'HVAC']);
    expect(TABS[0].pages.map((p) => p.name)).toEqual(['Basic', 'Trig', 'Integer', '∫ d/dx', 'Graph', 'Units $']);
    expect(TABS[1].pages.map((p) => p.name)).toEqual(['Normal', 'Data', 'Inference']);
    expect(TABS[3].pages.map((p) => p.name)).toEqual(['Matrix', 'Vectors']);
    expect(TABS[4].pages.map((p) => p.name)).toEqual(['Refrig', 'Air', 'Psych', 'Ducts', 'Water']);
    expect(ROW1.map((k) => k.label)).toEqual(['x', 'y', 'π', 'e', '%', 'ans']);
    expect(does(ROW1[5])).toBe(does(ANS));
  });

  it('gives every bank key a home: row 1, the pad, a tile or a refrigerant chip', () => {
    const keys = PANELS.flatMap((p) => p.keys.map((k) => ({ bank: p.name, k })));
    const home = new Set([...ROW1, ...PAD.flat(), DIV, ...tiles.map((t) => t.key), ...FLUIDS.map((f) => f.key)].map(does));
    for (const { bank, k } of keys) expect(home.has(does(k)), `${bank}: ${k.label}`).toBe(true);
  });

  it('collapses duplicates: no two tiles insert the same thing (the HVAC pages each keep their IP → SI tile)', () => {
    const seen = new Map<string, string>();
    for (const t of TABS) for (const p of t.pages) for (const tile of p.tiles) {
      const d = does(tile.key);
      if (d === '"SI"') continue;
      expect(seen.get(d), `${d} is on ${seen.get(d)} and ${t.name}/${p.name}`).toBeUndefined();
      seen.set(d, `${t.name}/${p.name}`);
    }
    for (const k of ROW1) expect(seen.has(does(k)), k.label).toBe(false);
    for (const f of FLUIDS) expect(seen.has(does(f.key)), f.label).toBe(false);
  });

  it('never needs to scroll: at most 4 × 5 tiles a page, and 4 × 4 under the Refrig page\'s fluid chips', () => {
    for (const t of TABS) for (const p of t.pages) expect(p.tiles.length, `${t.name}/${p.name}`).toBeLessThanOrEqual(COLUMNS * (p.name === 'Refrig' ? ROWS - 1 : ROWS));
  });

  it('leads every tile with what it computes, its name small under it, and a plain meaning to read aloud', () => {
    for (const tile of tiles) {
      expect(tile.face.trim(), tileName(tile.key)).toBeTruthy();
      expect(tile.name.trim(), tile.face).toBeTruthy();
      expect(tile.say.trim(), tile.face).toBeTruthy();
      // Short enough not to shrink to a tiny size, and no literal underscore: subscripts are marked _{…}.
      expect(faceText(tile.face).length, tile.face).toBeLessThanOrEqual(13);
      expect(tile.face.replace(/_\{[^}]*\}/g, ''), tile.face).not.toContain('_');
    }
    expect(faceText('T − T_{sat}')).toBe('T − Tsat');
    expect(faceRuns('T_{wb}')).toEqual([{ text: 'T' }, { text: 'wb', sub: true }]);
    const chance = TABS[2].pages[0].tiles.find((t) => t.name === 'binompdf')!;
    expect(tileLabel(chance)).toBe('probability of exactly k, binompdf');
  });

  it('fills a refrigerant tile with the chosen fluid, R-410A first', () => {
    const sh = tiles.find((t) => t.name === 'superheat')!;
    expect(FLUIDS.map((f) => f.label)).toEqual(['410A', '454B', '32', '22', '134a', '404A']);
    expect(tileKey(sh).ins).toBe('superheat("R410A", ¦)');
    expect(tileKey(sh, '"R134a"').ins).toBe('superheat("R134a", ¦)');
    const eer = tiles.find((t) => t.name === 'eertocop')!;
    expect(tileKey(eer, '"R134a"').ins).toBe('eertocop(¦)');
  });

  it('inserts skeletons with slots where a key\'s own text wouldn\'t do: a 2 × 2, a 3 × 3, f′(a) in x', () => {
    const by = (name: string, face: string) => tiles.find((t) => t.name === name && t.face === face)!;
    expect(tileKey(by('matrix', '2 × 2')).ins).toBe('[[¦, ], [, ]]');
    expect(tileKey(by('matrix', '3 × 3'))).toMatchObject({ ins: '[[¦, , ], [, , ], [, , ]]', action: undefined });
    expect(tileKey(tiles.find((t) => t.name === 'deriv')!).ins).toBe('deriv(¦, x, )');
    expect(tileKey(tiles.find((t) => t.name === 'integral')!).ins).toBe('integral(¦, x, , )');
    expect(faceText(tiles.find((t) => t.name === 'sdp')!.face)).toBe('σ population');
  });


  it('finds the tile that holds a function, for Find', () => {
    expect(tileFor('binompdf')).toEqual({ tab: 2, page: 0, tile: 0 });
    expect(tileFor('ductsize')).toEqual({ tab: 4, page: 3, tile: 0 });
    expect(tileFor('nope')).toBeNull();
  });
});

describe('fix round 2 helpers', () => {
  it('labels a function with its Thumb Index home', () => {
    expect(homeOf('dewpoint')).toBe('HVAC › Psych');
    expect(homeOf('pmt')).toBe('Math › Units $');
    expect(homeOf('binompdf')).toBe('Chance');
    expect(homeOf('nope')).toBeNull();
  });
});

describe('the editor tiles', () => {
  const pages = TABS.flatMap((t) => t.pages);
  it('every editor has its words, and a tile on one page', () => {
    for (const k of ['matrix', 'shape', 'vector'] as const) for (const v of Object.values(EDITORS[k].text)) expect(v.trim().length).toBeGreaterThan(0);
    expect(pages.flatMap((p) => (p.editor ? [p.editor.editor] : [])).sort()).toEqual(['matrix', 'shape', 'vector']);
  });

  it('counts an editor tile a page shows: a wide one takes its own row, a narrow one takes a cell', () => {
    const page = (name: string) => pages.find((p) => p.name === name)!;
    expect(rowsOf({ ...page('Matrix'), editor: undefined })).toBe(3);
    expect(rowsOf(page('Matrix'))).toBe(4);
    expect(rowsOf({ name: 'p', tiles: tiles.slice(0, 4) })).toBe(1);
    expect(rowsOf({ name: 'p', tiles: tiles.slice(0, 4), editor: EDITOR_TILES.shape })).toBe(2);
    expect(rowsOf(page('Graph'), 5)).toBe(4);
  });

  it('names an editor cell for a screen reader', () => {
    expect(EDITORS.matrix.cellLabel(0, 2)).toBe('Row 1, column 3');
    expect(EDITORS.shape.cellLabel(1, 1)).toBe('Point 2, y');
    expect(EDITORS.vector.cellLabel(0, 0)).toBe('Component 1');
  });
});

describe('how tall a tile is', () => {
  it('stays regular at 30 or more, up to the most it may be', () => {
    expect(tileHeight(() => 44, TILE_MAX)).toEqual({ tileH: 44, compact: false });
    expect(tileHeight(() => 200, TILE_MAX)).toEqual({ tileH: TILE_MAX, compact: false });
    expect(tileHeight(() => 30, TILE_MAX)).toEqual({ tileH: 30, compact: false });
  });
  it('goes compact under 30, measured again with the compact metrics', () => {
    expect(tileHeight((compact) => (compact ? 34 : 29), TILE_MAX)).toEqual({ tileH: 34, compact: true });
    expect(tileHeight((compact) => (compact ? -3 : 10), TILE_MAX)).toEqual({ tileH: 1, compact: true });
  });
});

describe('a tile\'s caption', () => {
  const caption = (name: string) => tileCaption(tiles.find((t) => t.name === name)!);
  it('is left out when it would repeat the face', () => {
    for (const name of ['sin', 'θ', 'a =', 'μ', 'rref', 'max', 'gcd', 'ln', 'f', '^2', 'e^', '||', '{}', '"SI"']) expect(caption(name), name).toBeUndefined();
  });
  it('stays when it is the word to type and the face does not spell it', () => {
    for (const name of ['normalcdf', 'invNorm', 'asin', 'nthroot', 'solve', 'x_from_z', 'nCr', 'inf', 'E', 'det']) expect(caption(name), name).toBe(name);
  });
  it('never removes the name a screen reader hears', () => {
    for (const t of tiles) expect(tileLabel(t)).toContain(t.say);
  });
});
