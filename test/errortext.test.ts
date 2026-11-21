import { describe, it, expect } from 'vitest';
import { friendlyError } from '../src/ui/errortext';
import { EMPTY_PARENS, ENDS_EARLY, arityText, divisionByZeroText, logDomainText, notRealText, emptyLineText, isWarningNote, readError, undefinedNameText, unexpectedText, unclosedText, unknownFunctionText, unknownNameText, unmatchedText, varErrorText } from '../src/engine/errors';
import { evaluateDocument } from '../src/engine/document';

const S = { deg: true, complex: false, sample: false };
// The message the app would show for a line, run through the real engine so the patterns track the parser.
const shown = (text: string) => {
  const r = evaluateDocument([{ id: '0', kind: 'expr', text }], S)[0];
  expect(r.error).toBeTruthy();
  return friendlyError(r.error!);
};

describe('a warning note', () => {
  it('is what the engine writes when probabilities do not add to 1, and no other note is one', () => {
    const notes = (text: string) => evaluateDocument([{ id: '0', kind: 'expr', text }], S)[0].notes;
    const [warned] = notes('EV({1, 2}, {0.5, 0.4})');
    expect(warned).toContain('probabilities add to 0.9');
    expect(isWarningNote(warned)).toBe(true);
    expect(isWarningNote('Population SD (÷ n)')).toBe(false);
  });
});

describe('readError', () => {
  it('reads back every form its writer produces', () => {
    expect(readError(ENDS_EARLY)).toEqual({ k: 'endsEarly' });
    expect(readError(EMPTY_PARENS)).toEqual({ k: 'emptyParens' });
    expect(readError(unmatchedText(')'))).toEqual({ k: 'unmatched', token: ')' });
    expect(readError(unexpectedText('*'))).toEqual({ k: 'unexpected', token: '*' });
    expect(readError(unclosedText(')', 'sin(', null))).toEqual({ k: 'unclosed', close: ')', what: 'sin(', got: null });
    expect(readError(unclosedText(']', '"["', ';'))).toEqual({ k: 'unclosed', close: ']', what: '"["', got: ';' });
    expect(readError(arityText('sin', 1, 1, 0, 'sin(x)'))).toEqual({ k: 'arity', name: 'sin', inputs: '1', got: 0 });
    expect(readError(arityText('nCr', 2, 2, 3, 'nCr(n, r)'))).toEqual({ k: 'arity', name: 'nCr', inputs: '2', got: 3 });
    expect(readError(arityText('mean', 1, Infinity, 0))).toEqual({ k: 'arity', name: 'mean', inputs: '1 or more', got: 0 });
    expect(readError(arityText('round', 1, 2, 5))).toEqual({ k: 'arity', name: 'round', inputs: '1 to 2', got: 5 });
    expect(readError(unknownNameText('q'))).toEqual({ k: 'unknown', name: 'q', hint: null, example: null });
    expect(readError(undefinedNameText('qq', null))).toEqual({ k: 'unknown', name: 'qq', hint: null, example: 'qq = 5' });
    expect(readError(undefinedNameText('pric', 'price'))).toEqual({ k: 'unknown', name: 'pric', hint: 'price', example: 'pric = 5' });
    expect(readError(unknownFunctionText('sinn', 'sin(…)'))).toEqual({ k: 'unknown', name: 'sinn', hint: 'sin(…)', example: null });
    expect(readError(emptyLineText('B'))).toEqual({ k: 'emptyLine', name: 'B' });
    expect(readError(varErrorText('A', varErrorText('B', unknownNameText('q'))))).toEqual({ k: 'inVar', name: 'A', inner: { k: 'inVar', name: 'B', inner: { k: 'unknown', name: 'q', hint: null, example: null } } });
    expect(readError(divisionByZeroText())).toEqual({ k: 'divZero' });
    expect(readError(divisionByZeroText(': total heat is 0'))).toEqual({ k: 'divZero' });
    expect(readError(notRealText('√', -3, true))).toEqual({ k: 'notReal' });
    expect(readError(notRealText('Even root', -2))).toEqual({ k: 'notReal' });
    expect(readError(logDomainText('ln', -1))).toEqual({ k: 'logDomain', name: 'ln' });
    expect(readError('Points can have 2 or 3 coordinates')).toEqual({ k: 'other' });
  });
});

describe('friendlyError', () => {
  it('names the call a ) is missing from', () => {
    expect(friendlyError('Expected ")" to close normcdf(, got end of input')).toBe('normcdf( is missing a )');
    expect(shown('normcdf(1, 2')).toBe('normcdf( is missing a )');
    expect(shown('sin(30')).toBe('sin( is missing a )');
  });
  it('says which bracket is missing', () => {
    expect(shown('(1 + 2')).toBe('Missing )');
    expect(shown('[1, 2')).toBe('Missing ]');
    expect(shown('{1, 2')).toBe('Missing }');
    expect(shown('⟨1, 2')).toBe('Missing ⟩');
    expect(shown('|3 - 5')).toBe('Missing closing |');
  });
  it('says where a closer is needed when something else came first', () => {
    expect(friendlyError('Expected "]" to close "[", got ")"')).toBe('Missing ] before )');
    expect(friendlyError('Expected ")" to close sin(, got ";"')).toBe('sin( needs a ) before ;');
  });
  it('calls a stray closer extra', () => {
    expect(shown('1 + 2)')).toBe('Extra )');
    expect(shown('2]')).toBe('Extra ]');
  });
  it('says an operator needs something before it', () => {
    expect(shown('^2')).toBe('^ needs something before it');
    expect(shown('*3')).toBe('* needs something before it');
    expect(shown('2 * / 3')).toBe('/ needs something before it');
  });
  it('says a value is missing before a closer', () => {
    expect(shown('(2 +)')).toBe("Something's missing before )");
  });
  it('covers lines that stop early and empty parentheses', () => {
    expect(shown('2 +')).toBe('Unfinished: add what comes next');
    expect(shown('()')).toBe('Empty ( )');
  });
  it('leaves everything else alone', () => {
    expect(friendlyError('Unexpected ","')).toBe('Unexpected ","');
    expect(friendlyError('Division by zero')).toBe('Division by zero');
    expect(friendlyError('Unknown name "foo". Did you mean floor?')).toBe('Unknown name "foo". Did you mean floor?');
    expect(friendlyError('Unexpected "x"')).toBe('Unexpected "x"');
    expect(friendlyError('')).toBe('');
  });
});

describe('calm while typing covers the cases still red (UX round 3)', () => {
  it('treats a premature closer and a leading operator as unfinished', async () => {
    const { calmWhileTyping } = await import('../src/ui/errortext');
    expect(calmWhileTyping('2*(3+)', 'Unexpected ")"', 5)).toBe(true);
    expect(calmWhileTyping('2*(3)+)', 'Unexpected ")"', 7)).toBe(false);
    expect(calmWhileTyping('2*(3+)', 'Unexpected ")"', 6)).toBe(false);
    expect(calmWhileTyping('sqrt(2+)', 'Unexpected ")"', 7)).toBe(true);
    expect(calmWhileTyping('*100', 'Unexpected "*"')).toBe(true);
    expect(calmWhileTyping('-100', 'Unknown name "x"')).toBe(false);
    expect(calmWhileTyping('normalcdf(', 'Expression ends too early')).toBe(true);
  });
});

describe('what a screen reader hears (UX round 4)', () => {
  it('says the calm hint or offer, or the plain words, never the raw parser message', async () => {
    const { spokenError } = await import('../src/ui/errortext');
    const { isUnit, otherUnit } = await import('../src/engine/units');
    expect(spokenError('*100', 'Unexpected "*"', true, isUnit, otherUnit)).toBe('going on from the line above? Use ans × 100');
    expect(spokenError('2*(3+', 'Expression ends too early', true, isUnit, otherUnit)).toBe('Unfinished: add what comes next');
    expect(spokenError('3 m + 2 s', 'Unknown name "m". Define it on its own line, like m = 5', false, isUnit, otherUnit)).toBe("error. Length and time can't be added");
    expect(spokenError('*100', 'Unexpected "*"', false, isUnit, otherUnit)).not.toContain('Unexpected');
  });
});
