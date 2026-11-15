import { describe, it, expect } from 'vitest';
import { evaluateDocument, type RowInput } from '../src/engine/document';

const S = { deg: true, complex: false, sample: false, lineNames: true };
const run = (lines: string[]) => evaluateDocument(lines.map((text, i): RowInput => ({ id: String(i), kind: 'expr', text })), S);

describe('# headings', () => {
  it('are not evaluated and never error', () => {
    const r = run(['# Problem 3: wages', 'zscore(350, 400, 50)']);
    expect(r[0].error).toBeUndefined();
    expect(r[0].heading).toBe('Problem 3: wages');
    expect(r[0].value).toBeUndefined();
    expect(r[1].value).toBe(-1);
  });
  it('get no letter, and ans skips over them', () => {
    const r = run(['5', '# section', 'ans * 2']);
    expect(r[1].lineName).toBeUndefined();
    expect(r[2].value).toBe(10);
  });
});
