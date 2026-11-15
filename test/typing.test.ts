import { describe, it, expect } from 'vitest';
import { stepsOverCloser } from '../src/ui/brackets';

describe('keypad closers', () => {
  it('steps over the paren a function key already inserted', () => {
    // normalcdf(350, 500, 400, 50¦)
    const t = 'normalcdf(350, 500, 400, 50)';
    expect(stepsOverCloser(t, t.length - 1, ')')).toBe(true);
  });
  it('inserts when an inner paren is still open', () => {
    // normalcdf((1+2¦)
    const t = 'normalcdf((1+2)';
    expect(stepsOverCloser(t, t.length - 1, ')')).toBe(false);
  });
  it('inserts when the next character is something else', () => {
    expect(stepsOverCloser('sqrt(2', 6, ')')).toBe(false);
    expect(stepsOverCloser('f(x) + 1', 4, ')')).toBe(false);
  });
  it('handles brackets and braces the same way', () => {
    expect(stepsOverCloser('[1,2]', 4, ']')).toBe(true);
    expect(stepsOverCloser('{1,2}', 4, '}')).toBe(true);
    expect(stepsOverCloser('[[1,2]', 5, ']')).toBe(false);
  });
  it('ignores non-closers', () => {
    expect(stepsOverCloser('(1)', 2, '1')).toBe(false);
  });
});
