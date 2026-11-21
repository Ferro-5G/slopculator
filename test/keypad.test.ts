import { describe, it, expect } from 'vitest';
import { AC, ANS, bigOp, DIV, drawTone, ENTER, keyCaption, keyLines, LABEL_MIN, PAD, padRows, PANELS, phoneRows, keyLegend, legendText, textFits, type Key } from '../src/ui/keypad';
import { BUILTINS } from '../src/engine/builtins';
import refiled from './fixtures/banks-before-refile.json';

const labels = (r: Key[]) => r.map((k) => k.label).join(' ');
// What a key does, spaces aside: , and = type no spaces now (round 4 of the UX), and are the same keys as ever.
const does = (k: { action?: string; ins?: string; label: string }) => (k.action ? `action:${k.action}` : (k.ins ?? k.label).trim());

describe('the number pad', () => {
  it('is four rows of six for a right thumb under the everyday row: digits in the middle, operators down the right edge, no enter', () => {
    expect(PAD.length).toBe(4);
    for (const r of PAD) expect(r.length, labels(r)).toBe(6);
    // The caret keys up on the 7 row, out of the way; the parentheses down on the 1 row, where the thumb rests.
    expect(PAD.map(labels)).toEqual(['← → 7 8 9 ÷', 'xʸ √ 4 5 6 ×', '( ) 1 2 3 −', ', = 0 . ⌫ +']);
    expect(DIV).toMatchObject({ label: '÷', ins: '/' });
    expect(PAD.flat().some((k) => k.action === 'enter' || k.action === 'clearall')).toBe(false);
  });

  it('has every key the design asks for, with × ÷ − legends that type * / -; enter is the composer\'s', () => {
    const keys = PAD.flat();
    for (const digit of '0123456789.') expect(keys.some((k) => k.label === digit && k.ins === digit), digit).toBe(true);
    for (const ins of [',', '+', '-', '*', '/', '(', ')', '^', '√', '=']) expect(keys.some((k) => k.ins?.trim().startsWith(ins)), ins).toBe(true);
    for (const action of ['back', 'left', 'right']) expect(keys.some((k) => k.action === action), action).toBe(true);
    expect(ENTER.action).toBe('enter');
    expect(keys.find((k) => k.ins === '*')?.label).toBe('×');
    expect(keys.find((k) => k.ins === '/')?.label).toBe('÷');
    expect(keys.find((k) => k.ins === '-')?.label).toBe('−');
  });

  it('mirrors for a left hand group by group: operators down the left edge, order kept inside each group', () => {
    const rows = padRows(true);
    expect(rows.map(labels)).toEqual(['÷ 7 8 9 ← →', '× 4 5 6 xʸ √', '− 1 2 3 ( )', '+ 0 . ⌫ , =']);
    expect(padRows(false)).toBe(PAD);
    for (let i = 0; i < PAD.length; i++) expect([...rows[i]].sort((a, b) => a.label.localeCompare(b.label))).toEqual([...PAD[i]].sort((a, b) => a.label.localeCompare(b.label)));
  });

  it('draws enter as the one accent key: a bank\'s main keys are plain function keys, AC a quiet key', () => {
    const accented = [...PAD.flat(), ENTER, ANS, AC, ...PANELS.flatMap((p) => p.keys)].filter((k) => drawTone(k) === 'hero');
    expect(accented.map((k) => k.label)).toEqual(['enter']);
    for (const p of PANELS) for (const k of p.keys) if (k.tone === 'hero') expect(drawTone(k)).toBe('fn');
    expect(drawTone(AC)).toBe('fn');
  });
});

describe('bank rows', () => {
  it('each bank is one row of its real keys, at least five of them', () => {
    for (const p of PANELS) {
      expect(p.keys.length, p.name).toBeGreaterThanOrEqual(5);
    }
  });

  it('no bank key repeats a pad key, = included, or ÷', () => {
    const pad = new Set([...PAD.flat(), DIV].map(does));
    expect(pad.has('=')).toBe(true);
    for (const p of PANELS) for (const k of p.keys) expect(pad.has(does(k)), `${p.name}: ${k.label}`).toBe(false);
  });

  it('no key repeats within a bank', () => {
    for (const p of PANELS) {
      const seen = p.keys.map(does);
      expect(new Set(seen).size, `${p.name}: ${seen.join(' ')}`).toBe(seen.length);
    }
  });

  it('every key from the banks as they were before the re-filing (Nov 7) is still on the pad or a bank', () => {
    // By function, so a convert that starts on other units, or an ∫ that fills in x, is the same key.
    const fn = (d: string) => /^([A-Za-z_]\w*)\(/.exec(d)?.[1] ?? d.trim();
    const now = new Set([...PAD.flat(), ANS, AC, DIV, ...PANELS.flatMap((p) => p.keys)].map((k) => fn(does(k))));
    for (const p of refiled as { name: string; keys: { label: string; does: string }[] }[])
      for (const k of p.keys) expect(now.has(fn(k.does)), `${p.name}: ${k.label} (${k.does})`).toBe(true);
  });

  it('the old filler keys are gone: no bank borrows another bank\'s keys just to fill a row', () => {
    const keys = (n: string) => PANELS.find((p) => p.name === n)!.keys.map((k) => k.label);
    expect(keys('Chance')).not.toContain('n!');
    expect(keys('Matrix')).not.toContain('A');
    expect(keys('Refrig')).not.toContain('convert');
    expect(keys('Flow')).not.toContain('convert');
    for (const l of ['π', 'x²', '|x|', 'e']) expect(keys('Graph')).not.toContain(l);
  });

  it('each bank shows its hero keys in its first three columns, before any sliding', () => {
    for (const p of PANELS) {
      const first = new Set(p.keys.slice(0, 6));
      for (const k of p.keys) if (k.tone === 'hero') expect(first.has(k), `${p.name}: ${k.label}`).toBe(true);
    }
  });

  it('each function bank has at least one hero key, and no more than four', () => {
    for (const p of PANELS.slice(1)) {
      const heroes = p.keys.filter((k) => k.tone === 'hero').length;
      expect(heroes, p.name).toBeGreaterThanOrEqual(1);
      expect(heroes, p.name).toBeLessThanOrEqual(4);
    }
  });

  it('Basic is the everyday extras, by use: x, y, π, e, x² first (= is on the pad)', () => {
    expect(PANELS[0].keys.slice(0, 6).map((k) => k.label)).toEqual(['x', 'y', 'π', 'e', 'x²', 'x⁻¹']);
    for (const label of ['%', '|x|']) expect(PANELS[0].keys.some((k) => k.label === label), label).toBe(true);
  });

  it('ans, AC and ÷ have fixed homes (ans on the everyday row, AC on the composer, ÷ on the pad), and are in no bank\'s sliding keys', () => {
    expect(AC).toMatchObject({ label: 'AC', action: 'clearall', tone: 'red' });
    expect(ANS).toMatchObject({ label: 'ans', ins: 'ans' });
    for (const p of PANELS)
      for (const k of p.keys) {
        expect(does(k), `${p.name}: ${k.label}`).not.toBe(does(AC));
        expect(does(k), `${p.name}: ${k.label}`).not.toBe(does(DIV));
        expect(does(k), `${p.name}: ${k.label}`).not.toBe(does(ANS));
      }
    const pad = new Set(PAD.flat().map(does));
    expect(pad.has(does(AC)) || pad.has(does(ANS))).toBe(false);
    expect(pad.has(does(DIV))).toBe(true);
  });

  it('the Graph bank types y = 2x + 1 with the pad, from keys that show before any sliding', () => {
    const graph = PANELS.find((p) => p.name === 'Graph')!;
    const reach = new Map([...PAD.flat(), ...graph.keys.slice(0, 4)].map((k) => [k.label, k.ins]));
    expect(['y =', '2', 'x', '+', '1'].map((l) => reach.get(l)).join('')).toBe('y = 2x+1');
  });

  it('every function has one home: no function key is on two banks', () => {
    const home = new Map<string, string>();
    for (const p of PANELS)
      for (const k of p.keys) {
        const m = /^([A-Za-z_]\w*)\(/.exec(k.ins ?? '');
        if (!m || (k.tone !== 'fn' && k.tone !== 'hero')) continue;
        expect(home.get(m[1]), `${m[1]} is on ${home.get(m[1])} and ${p.name}`).toBeUndefined();
        home.set(m[1], p.name);
      }
    for (const f of ['sin', 'cos', 'tan']) expect(home.get(f)).toBe('Trig');
    const basic = new Set(PANELS[0].keys.map(does));
    for (const p of PANELS.slice(1)) for (const k of p.keys) if (['^-1', '!'].includes(does(k)) && p.name !== 'Matrix') expect(basic.has(does(k)) ? p.name : '', k.label).toBe('');
  });

  it('a key\'s face says the function: superheat, not SH', () => {
    const k = (label: string) => PANELS.flatMap((p) => p.keys).find((x) => x.label === label);
    expect(k('superheat')?.ins).toBe('superheat(¦)');
    expect(k('SH')).toBeUndefined();
    expect(keyLegend('superheat')).toEqual(['super', 'heat']);
    // A two-line face shows no caption.
    expect(keyCaption(k('superheat')!)).toBeUndefined();
    for (const old of ['SC', 'OA %', 'ACH', 'GPM', 'kW', 'RH wb', 'SH goal']) expect(k(old), old).toBeUndefined();
  });

  it('every function key explains itself and names a real function', () => {
    for (const p of PANELS)
      for (const k of p.keys) {
        // Only function keys; "f(x) = " on the Graph bank is a template, not a call.
        if (k.tone !== 'fn' && k.tone !== 'hero') continue;
        const m = /^([A-Za-z_]\w*)\(/.exec(k.ins ?? '');
        if (m) {
          expect(BUILTINS[m[1]], `${p.name}: ${k.label} → ${m[1]}`).toBeDefined();
          expect(k.title, `${p.name}: ${k.label} has no help text`).toBeTruthy();
        }
      }
  });

  it('sub-labels stay short enough to fit under a key', () => {
    for (const k of [...PAD.flat(), ...PANELS.flatMap((p) => p.keys)]) if (k.sub) expect(k.sub.length, k.label).toBeLessThanOrEqual(15);
  });
});

describe('one-handed phone key heights', () => {
  it('48 and 56 on a tall phone, never under 44 on a short one', () => {
    expect(phoneRows(874)).toEqual({ bank: 48, pad: 56 });
    for (const h of [568, 667, 736, 844, 932]) {
      const r = phoneRows(h);
      expect(Math.min(r.bank, r.pad), String(h)).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('readable bank labels', () => {
  it('one caption rule: a long label shows alone, a short one keeps a caption that fits every platform, ⌫ needs none', () => {
    const find = (bank: string, label: string) => PANELS.find((p) => p.name === bank)!.keys.find((k) => k.label === label)!;
    expect(keyCaption(find('Normal', 'normaldist'))).toBeUndefined();
    expect(keyCaption(find('Normal', 'x_from_z'))).toBeUndefined();
    expect(keyCaption(find('Normal', 'zscore'))).toBe('(x−μ)/σ');
    const back = PAD.flat().find((k) => k.action === 'back')!;
    // The hold still clears the line (the key's title says so); it isn't printed under the key on any platform.
    expect(keyCaption(back)).toBeUndefined();
    for (const k of PAD.flat().filter((k) => k.action === 'left' || k.action === 'right')) expect(keyCaption(k)).toBeUndefined();
    expect(keyCaption(ANS)).toBeUndefined();
    // z crit says it's the middle 95%, so .95 no longer reads as the 95th percentile; the normal percentile says so
    // on its face.
    expect(keyCaption(find('Inference', 'zcrit'))).toBe('mid 95%');
    expect(keyLegend('percentile')).toEqual(['data', 'quantile']);
    // AC's face is the whole key: no caption restates what it clears.
    expect(keyCaption(AC)).toBeUndefined();
  });

  it('a key\'s face names it in words, broken between words, never inside one', () => {
    expect(keyLegend('normaldist')).toEqual(['normal', 'curve']);
    expect(keyLegend('invNorm')).toEqual(['invNorm']);
    expect(legendText('invNorm')).toBe('invNorm');
    // Every key on every bank: at most two lines, no underscore, and every line about fits the narrowest key it's drawn
    // on (55 px on a 375 phone or a 1440 desktop, less its padding) at LABEL_MIN in the condensed face the stylesheets
    // fall back to. textFits is a rough sum; the e2e checks every key's real width in the browser.
    for (const p of PANELS) for (const k of p.keys) {
      const lines = keyLegend(k.label);
      expect(lines.length >= 1 && lines.length <= 2, k.label).toBe(true);
      for (const l of lines) {
        expect(l.includes('_'), `${k.label}: ${l}`).toBe(false);
        expect(textFits(l, 'condensed', LABEL_MIN, 55), `${k.label}: ${l}`).toBe(true);
      }
    }
  });

  it('a label goes on two lines only when one line won\'t fit at 13 pt, and nothing is drawn under 12', () => {
    // A 62 pt key (an iPhone Air's) leaves about 54 for the label: a two-word face splits, solve and z-score don't.
    expect(keyLines('normaldist', 54)).toEqual(['normal', 'curve']);
    expect(keyLines('normalcdf', 54)).toEqual(['normal', 'cdf']);
    expect(keyLines('solve', 54)).toEqual(['solve']);
    expect(keyLines('zscore', 54)).toEqual(['z-score']);
    expect(keyLines('wetbulb', 80)).toEqual(['wet bulb']);
    expect(keyLines('wetbulb', 46)).toEqual(['wet', 'bulb']);
  });

  it('⌫ says Undo brings back a line it cleared', () => {
    expect(PAD.flat().find((k) => k.action === 'back')!.title).toMatch(/Undo/);
  });
});

describe('definition keys (UX round 3)', () => {
  it('a = is a definition at a fresh line start, plain a anywhere else', async () => {
    const { definitionInsert } = await import('../src/ui/lineedit');
    expect(definitionInsert('a = ', '', 0)).toBe('a = ');
    expect(definitionInsert('a = ', 'y = ', 4)).toBe('a');
    expect(definitionInsert('a = ', 'x^2', 3)).toBe('a');
    expect(definitionInsert('y = ', 'x^2', 0)).toBe('y = ');
    expect(definitionInsert('a = ', 'y <= x', 0)).toBe('a');
    expect(definitionInsert('sqrt(', 'y = ', 4)).toBe('sqrt(');
  });
});

describe('keys put in no hidden spaces (UX round 4)', () => {
  it(', and = type just themselves', () => {
    const pad = PAD.flat();
    expect(pad.find((k) => k.label === ',')!.ins).toBe(',');
    expect(pad.find((k) => k.label === '=')!.ins).toBe('=');
  });
});

describe('bigOp', () => {
  const key = (label: string, sub?: string): Key => ({ label, sub, ins: label, tone: 'op' });

  it('is a lone operator drawn as an operator', () => {
    expect(bigOp(key('+'), 'op')).toBe(true);
    expect(bigOp(key('+'), 'fn')).toBe(false);
    expect(bigOp(key('xʸ'), 'op')).toBe(false);
    expect(bigOp(key('+', 'add'), 'op')).toBe(false);
  });

  it('leaves the asterisk mono', () => {
    expect(bigOp(key('*'), 'op')).toBe(false);
  });
});
