import { describe, expect, it } from 'vitest';
import { linesLabel, savedOn } from '../src/ui/document';

const year = new Date().getFullYear();

describe('savedOn', () => {
  it('leaves this year off', () => {
    expect(savedOn(new Date(year, 5, 3).getTime())).not.toContain(String(year));
  });
  it('shows the year on a sheet from another one', () => {
    expect(savedOn(new Date(year - 1, 10, 3).getTime())).toContain(String(year - 1));
  });
});

describe('linesLabel', () => {
  it.each([[0, '0 lines'], [1, '1 line'], [2, '2 lines']])('%i reads %s', (n, label) => expect(linesLabel(n)).toBe(label));
});
