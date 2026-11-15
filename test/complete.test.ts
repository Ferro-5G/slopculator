import { describe, it, expect } from 'vitest';
import { applyCompletion, asList, BUILTIN_CANDIDATES, completions, emptyArgumentHint, enclosingCall, fitSignature, fitTokens, inEmptyArgument, nextInBrackets, nextSlot, ownFunctionUsage, sheetCandidates, signatureForArg, signatureParts, typingHelp, USAGE, type Candidate, trayNames } from '../src/ui/complete';
import { evaluateDocument, type RowInput } from '../src/engine/document';

const names = (text: string, extra: Candidate[] = []) => completions(text, text.length, [...extra, ...BUILTIN_CANDIDATES])?.items.map((c) => c.name) ?? [];

describe('completions', () => {
  it('finds functions by prefix, ignoring case, common ones first', () => {
    expect(names('norm')[0]).toBe('normalcdf');
    expect(names('ncr')[0]).toBe('nCr');
    expect(names('binom').slice(0, 2)).toEqual(['binompdf', 'binomcdf']);
  });
  it('finds functions from loose letters, after prefix matches', () => {
    expect(names('ncd')).toContain('normalcdf');
    expect(names('bpd')).toContain('binompdf');
    expect(names('zs')[0]).toBe('zscore');
  });
  it('ranks the sheet\'s own names first', () => {
    expect(names('me', [{ name: 'measure', call: false, own: true }])[0]).toBe('measure');
  });
  it('stays quiet for one letter, a finished name, and a caret inside a word', () => {
    expect(completions('n', 1, BUILTIN_CANDIDATES)).toBeNull();
    expect(names('normalcdf')).not.toContain('normalcdf');
    // Tab on a finished name used to swap in a different function.
    for (const done of ['mean', 'sd', 'sin', 'cos', 'tan', 'det', 'exp', 'ln', 'pi']) expect(names(done)).toEqual([]);
    expect(names('me', [{ name: 'me', call: false, own: true }])).toEqual([]);
    expect(completions('normal', 3, BUILTIN_CANDIDATES)).toBeNull();
    expect(completions('sin(', 2, BUILTIN_CANDIDATES)).toBeNull();
  });
  it('only completes the word before the caret', () => {
    const c = completions('2*si', 4, BUILTIN_CANDIDATES)!;
    expect(c.word).toBe('si');
    expect(c.start).toBe(2);
  });
});

describe('applyCompletion', () => {
  it('adds brackets to a call and puts the caret inside', () => {
    expect(applyCompletion('2*si', { start: 2, end: 4 }, { name: 'sin', call: true })).toEqual({ text: '2*sin()', caret: 6 });
  });
  it('inserts a plain name as it is', () => {
    expect(applyCompletion('to+1', { start: 0, end: 2 }, { name: 'total', call: false })).toEqual({ text: 'total+1', caret: 5 });
  });
});

describe('nextSlot', () => {
  it('moves to the next existing argument', () => {
    expect(nextSlot('nCr(7, 5)', 5)).toEqual({ text: 'nCr(7, 5)', caret: 7 });
    expect(nextSlot('nCr(7,5)', 5)).toEqual({ text: 'nCr(7,5)', caret: 6 });
  });
  it('adds an argument a built-in still needs', () => {
    expect(nextSlot('binompdf(7)', 10)).toEqual({ text: 'binompdf(7, )', caret: 12 });
    expect(nextSlot('binompdf(7, 0.56)', 16)).toEqual({ text: 'binompdf(7, 0.56, )', caret: 18 });
  });
  it('leaves once every argument is there', () => {
    expect(nextSlot('binompdf(7, 0.56, 5)', 19)).toEqual({ text: 'binompdf(7, 0.56, 5)', caret: 20 });
    expect(nextSlot('sqrt(2)', 6)).toEqual({ text: 'sqrt(2)', caret: 7 });
    expect(nextSlot('mean(1, 2)', 9)).toEqual({ text: 'mean(1, 2)', caret: 10 });
  });
  it('offers an optional argument, and takes it back if left empty', () => {
    expect(nextSlot('round(2.5)', 9)).toEqual({ text: 'round(2.5, )', caret: 11 });
    expect(nextSlot('round(2.5, )', 11)).toEqual({ text: 'round(2.5)', caret: 10 });
    expect(nextSlot('round(2.5, )*3', 11)).toEqual({ text: 'round(2.5)*3', caret: 10 });
  });
  it('does not add an argument to an empty one', () => {
    expect(nextSlot('binompdf()', 9)).toEqual({ text: 'binompdf()', caret: 10 });
    expect(nextSlot('binompdf(7, )', 12)).toEqual({ text: 'binompdf(7, )', caret: 13 });
  });
  it('skips nested brackets', () => {
    expect(nextSlot('mean({1, 2}, 3)', 5)).toEqual({ text: 'mean({1, 2}, 3)', caret: 13 });
    expect(nextSlot('sqrt(sin(1))', 5)).toEqual({ text: 'sqrt(sin(1))', caret: 12 });
  });
  it('steps out of lists and plain brackets', () => {
    expect(nextSlot('{1, 2}', 2)).toEqual({ text: '{1, 2}', caret: 4 });
    expect(nextSlot('(1+2)*3', 4)).toEqual({ text: '(1+2)*3', caret: 5 });
  });
  it('has nowhere to go outside brackets', () => {
    expect(nextSlot('1+2', 3)).toBeNull();
    expect(nextSlot('sin(1)', 6)).toBeNull();
  });
});

describe('enclosingCall and signatureParts', () => {
  it('knows the argument the caret is on', () => {
    expect(enclosingCall('nCr(7, ', 7)).toEqual({ name: 'nCr', arg: 1 });
    expect(enclosingCall('mean({1, 2', 10)).toBeNull();
    expect(enclosingCall('1+2', 3)).toBeNull();
  });
  it('splits a signature around that argument', () => {
    expect(signatureParts('nCr(n, r)', 1)).toEqual({ before: 'nCr(n, ', current: 'r', after: ')' });
    expect(signatureParts('nCr(n, r)', 0)).toEqual({ before: 'nCr(', current: 'n', after: ', r)' });
    const parts = signatureParts('round(x) or round(x, places)', 0)!;
    expect(parts.before + parts.current + parts.after).toBe('round(x) or round(x, places)');
  });
  it('gives up on other text and extra arguments', () => {
    expect(signatureParts('Sort a list', 0)).toBeNull();
    expect(signatureParts('nCr(n, r)', 2)).toBeNull();
  });
});

describe('asList', () => {
  it('wraps a bare comma list', () => {
    expect(asList('44, 24, 13')).toBe('{44, 24, 13}');
    expect(asList('1, 2,')).toBe('{1, 2}');
    expect(asList('sin(1), 2')).toBe('{sin(1), 2}');
  });
  it('leaves everything else alone', () => {
    expect(asList('1+2')).toBeNull();
    expect(asList('nCr(7, 5)')).toBeNull();
    expect(asList('{1, 2}')).toBeNull();
    expect(asList('a = 1, 2')).toBeNull();
    expect(asList('1,, 2')).toBeNull();
  });
  it('produces a list the engine accepts', () => {
    const rows: RowInput[] = [{ id: '0', kind: 'expr', text: `sort(${asList('44, 24, 13')})` }];
    const r = evaluateDocument(rows, { deg: true, complex: false, sample: false })[0];
    expect(r.error).toBeUndefined();
    expect(JSON.stringify(r.value)).toContain('13');
  });
});

describe('signatures in a narrow space', () => {
  it('uses the form that has the argument', () => {
    expect(signatureForArg('round(x) or round(x, places)', 1)?.current).toBe('places');
    expect(signatureForArg('log(x), log(b, x), or log_b(x)', 1)?.current).toBe('x');
    expect(signatureForArg(USAGE.get('normalcdf')!, 3)?.current).toBe('σ');
  });
  it('keeps the argument being typed when it trims', () => {
    const parts = signatureParts('binombetween(n, p, a, b) = P(a ≤ X ≤ b)', 3)!;
    const fit = fitSignature(parts, 16);
    expect(fit.current).toBe('b');
    expect(fit.before.startsWith('…')).toBe(true);
    expect(fit.before.length + fit.current.length + fit.after.length).toBeLessThanOrEqual(16);
    const early = fitSignature(signatureParts('binombetween(n, p, a, b)', 0)!, 16);
    expect(early).toEqual({ before: 'binombetween(', current: 'n', after: ',…' });
    expect(fitSignature(signatureParts('nCr(n, r)', 1)!, 40)).toEqual({ before: 'nCr(n, ', current: 'r', after: ')' });
    expect(fitSignature({ before: 'f(', current: 'averylongname', after: ')' }, 6)).toEqual({ before: '', current: 'avery…', after: '' });
  });
});

describe('nextInBrackets', () => {
  it('treats brackets typed but not closed as closing at the end', () => {
    expect(nextInBrackets('binompdf(7', 10)).toEqual({ text: 'binompdf(7, )', caret: 12 });
    expect(nextInBrackets('(1+2', 4)).toEqual({ text: '(1+2)', caret: 5 });
    expect(nextInBrackets('{1, 2', 2)).toEqual({ text: '{1, 2', caret: 4 });
    expect(nextInBrackets('{1, 2', 5)).toEqual({ text: '{1, 2}', caret: 6 });
  });
  it('runs the whole binomge flow', () => {
    let e = applyCompletion('bge', completions('bge', 3, BUILTIN_CANDIDATES)!, { name: 'binomge', call: true });
    expect(e).toEqual({ text: 'binomge()', caret: 8 });
    const type = (t: string) => { e = { text: e.text.slice(0, e.caret) + t + e.text.slice(e.caret), caret: e.caret + t.length }; };
    const next = () => { e = nextInBrackets(e.text, e.caret)!; };
    type('7'); next(); type('0.56'); next(); type('5'); next();
    expect(e).toEqual({ text: 'binomge(7, 0.56, 5)', caret: 19 });
  });
});

describe('typingHelp', () => {
  const settings = { deg: true, complex: false, sample: false, lineNames: true };
  const help = (lines: string[], caret?: number, settled = true) => {
    const rows: RowInput[] = lines.map((text, i) => ({ id: String(i), kind: 'expr', text }));
    const results = evaluateDocument(rows, settings);
    const text = lines[lines.length - 1];
    const at = caret ?? text.length;
    return typingHelp({ rows, results, activeId: String(lines.length - 1), start: at, end: at, settled, suggestions: 4 });
  };
  it('suggests for a word, including the sheet\'s own names', () => {
    const h = help(['total = 2', 'to']);
    expect(h.kind === 'suggest' && h.completion.items[0]).toEqual({ name: 'total', call: false, own: true });
    const f = help(['area(x) = x^2', 'are']);
    expect(f.kind === 'suggest' && f.completion.items[0]).toEqual({ name: 'area', call: true, own: true });
  });
  it('shows the signature and Next inside a call', () => {
    const h = help(['binomge(7, )'], 11);
    expect(h.kind === 'call' && h.parts?.current).toBe('p');
    expect(h.kind === 'call' && h.next).toEqual({ text: 'binomge(7, )', caret: 12 });
  });
  it('shows your own function\'s definition', () => {
    const h = help(['area(w, h) = w*h', 'area(2, )'], 8);
    expect(h.kind === 'call' && h.usage).toBe('area(w, h) = w*h');
    expect(h.kind === 'call' && h.parts?.current).toBe('h');
  });
  it('offers ans and the letters of lines above, skipping empty and broken ones', () => {
    const h = help(['2', '', '1+', '3', '']);
    expect(h).toEqual({ kind: 'insert', tokens: ['ans', 'D', 'A'], next: null });
    expect(help([''])).toEqual({ kind: 'insert', tokens: [], next: null });
  });
  it('offers the names defined above first, nearest first, then ans, then letters', () => {
    const h = help(['price = 24.99', '2', 'tax = price * 0.0825', 'f(x) = x^2', '']);
    expect(h).toEqual({ kind: 'insert', tokens: ['f(', 'tax', 'price', 'ans', 'B'], next: null });
  });
  it('lets line letters fill only the room the names leave', () => {
    // The sheet from the screenshots: three letters nearer than tax and price must not push them off a short bar.
    const h = help(['price = 24.99', 'tax = price * 0.0825', 'price + tax', 'y = x^2/4 - 3', 'f(x) = 2x + 1', 'normalcdf(-1, 1, 0, 1)', '[[1,2],[3,4]]*2', '']);
    expect(h.kind === 'insert' && h.tokens.slice(0, 4)).toEqual(['f(', 'tax', 'price', 'ans']);
    expect(h.kind === 'insert' && fitTokens(h.tokens, 4)).toEqual(['f(', 'tax', 'price', 'ans']);
    expect(h.kind === 'insert' && fitTokens(h.tokens, 5)).toEqual(['f(', 'tax', 'price', 'ans', 'G']);
  });
  it('skips names that error, the line being typed, and repeats', () => {
    expect(help(['r = 2', 'r = 3', 'bad = 1+', 'ok = 1', 'mine = 4'])).toEqual({ kind: 'insert', tokens: ['ok', 'ans'], next: null });
  });
  it('offers names with letters off, and functions without an answer above', () => {
    const rows: RowInput[] = [{ id: '0', kind: 'expr', text: 'area(w, h) = w*h' }, { id: '1', kind: 'expr', text: '' }];
    const results = evaluateDocument(rows, { deg: true, complex: false, sample: false });
    expect(typingHelp({ rows, results, activeId: '1', start: 0, end: 0, settled: true, suggestions: 4 })).toEqual({ kind: 'insert', tokens: ['area('], next: null });
    const lettersOff = [{ id: '0', kind: 'expr', text: 'price = 3' }, { id: '1', kind: 'expr', text: '4' }, { id: '2', kind: 'expr', text: '' }] satisfies RowInput[];
    const off = evaluateDocument(lettersOff, { deg: true, complex: false, sample: false });
    expect(typingHelp({ rows: lettersOff, results: off, activeId: '2', start: 0, end: 0, settled: true, suggestions: 4 })).toEqual({ kind: 'insert', tokens: ['price', 'ans'], next: null });
  });
  it('offers Next in plain brackets, and has no letters off', () => {
    const h = help(['2', '(1+)'], 3);
    expect(h).toEqual({ kind: 'insert', tokens: ['ans', 'A'], next: { text: '(1+)', caret: 4 } });
  });
  it('waits for a pause before Wrap in { }', () => {
    expect(help(['44, 24, 13'], undefined, false).kind).toBe('insert');
    expect(help(['44, 24, 13'])).toEqual({ kind: 'wrap', text: '{44, 24, 13}' });
  });
  it('holds the suggestion back until the caret is at the word', () => {
    expect(help(['bge'], 1).kind).toBe('insert');
  });
});

describe('fitTokens', () => {
  it('keeps ans and the nearest lines', () => {
    expect(fitTokens(['ans', 'D', 'C', 'B', 'A'], 3)).toEqual(['ans', 'D', 'C']);
    expect(fitTokens(['ans', 'A'], 3)).toEqual(['ans', 'A']);
    expect(fitTokens(['C', 'B', 'A'], 2)).toEqual(['C', 'B']);
  });
  it('lets long names take more room, nearest first', () => {
    const width = (name: string) => Math.max(1, name.length / 3);
    expect(fitTokens(['ans', 'monthly_payment', 'B', 'A'], 6, width)).toEqual(['ans', 'monthly_payment']);
    expect(fitTokens(['ans', 'tax', 'price', 'A'], 4, width)).toEqual(['ans', 'tax', 'price']);
    // ans and the nearest name show even when they don't fit; they shrink instead.
    expect(fitTokens(['ans', 'a_very_long_name_indeed'], 3, width)).toEqual(['ans', 'a_very_long_name_indeed']);
    expect(fitTokens(['ans', 'B', 'A'], 1)).toEqual(['ans', 'B']);
  });
});

describe('sheetCandidates', () => {
  it('lists own names first, and finds own functions', () => {
    const rows: RowInput[] = [{ id: '0', kind: 'expr', text: 'rate = 2' }, { id: '1', kind: 'expr', text: 'area(x) = x' }];
    const results = evaluateDocument(rows, { deg: true, complex: false, sample: false });
    expect(sheetCandidates(rows, results).slice(0, 2).map((c) => c.name).sort()).toEqual(['area', 'rate']);
    expect(ownFunctionUsage('area', rows)).toBe('area(x) = x');
    expect(ownFunctionUsage('none', rows)).toBeNull();
  });
});

describe('inEmptyArgument', () => {
  it('finds a caret in an argument with nothing in it', () => {
    expect(inEmptyArgument('nCr(7, )', 7)).toBe(true);
    expect(inEmptyArgument('nCr(, 5)', 4)).toBe(true);
    expect(inEmptyArgument('sqrt()', 5)).toBe(true);
    expect(inEmptyArgument('nCr(7, ', 7)).toBe(true);
    expect(inEmptyArgument('nCr(7,  )', 6)).toBe(true);
  });
  it('is false once the argument has something, or the caret is elsewhere', () => {
    expect(inEmptyArgument('nCr(7, 5)', 7)).toBe(false);
    expect(inEmptyArgument('nCr(7, 5)', 8)).toBe(false);
    expect(inEmptyArgument('nCr(7, )', 5)).toBe(false);
    expect(inEmptyArgument('nCr(7, )+', 9)).toBe(false);
  });
  it('is false outside a function call', () => {
    expect(inEmptyArgument('()', 1)).toBe(false);
    expect(inEmptyArgument('{1, }', 4)).toBe(false);
    expect(inEmptyArgument('nCr({1, }, 2)', 8)).toBe(false);
    expect(inEmptyArgument('', 0)).toBe(false);
  });
});

describe('emptyArgumentHint', () => {
  const none: RowInput[] = [];
  it('names the argument to fill in', () => {
    expect(emptyArgumentHint('nCr(7, )', 7, none)?.parts?.current).toBe('r');
    expect(emptyArgumentHint('binomge(7, )', 11, none)?.parts?.current).toBe('p');
  });
  it('knows the sheet\'s own functions and not unknown ones', () => {
    const rows: RowInput[] = [{ id: '0', kind: 'expr', text: 'area(w, h) = w*h' }];
    expect(emptyArgumentHint('area(2, )', 8, rows)?.parts?.current).toBe('h');
    expect(emptyArgumentHint('nope(2, )', 8, rows)).toBeNull();
  });
  it('steps aside when the caret leaves the slot, so a real error still shows', () => {
    expect(emptyArgumentHint('nCr(7, )+(', 10, none)).toBeNull();
    expect(emptyArgumentHint('nCr(7, )', 3, none)).toBeNull();
  });
});

describe('the names strip over the keypad', () => {
  it('leaves ans out, since ans has its own key; with only ans there is nothing to show', () => {
    expect(trayNames(['price', 'f(', 'ans', 'A', 'B'])).toEqual(['price', 'f(', 'A', 'B']);
    expect(trayNames(['ans'])).toEqual([]);
  });
});
