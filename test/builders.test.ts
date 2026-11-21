import { describe, expect, it } from 'vitest';
import { dataListSummary, evaluateBuilderPreview, fieldUnit, FORM_BUILDERS, modeDefaults } from '../src/ui/builders';

const S = { deg: false, complex: false, sample: false };
const D = { places: null, exact: false, percent: false };
const rows = [
  { id: 'a', kind: 'expr' as const, text: '2' },
  { id: 'b', kind: 'expr' as const, text: '100' },
];

describe('a builder preview', () => {
  it('reads ans where Insert will put the line: after the active line, not at the end of the sheet', () => {
    expect(evaluateBuilderPreview('ans + 1', rows, S, D, 'a').answer).toBe('3');
    expect(evaluateBuilderPreview('ans + 1', rows, S, D).answer).toBe('101');
  });

  it('works a data list out once, so an ans in it is the line above for the mean and the spread alike', () => {
    const summary = dataListSummary('ans, 2', [{ id: 'x', kind: 'expr' as const, text: '10' }], S, D, 'x');
    expect(summary).toMatch(/x̄ = 6\b/);
    expect(summary).toMatch(/s = 5\.65/);
  });

  it('takes the place of an empty active line', () => {
    const withBlank = [rows[0], { id: 'blank', kind: 'expr' as const, text: '' }, rows[1]];
    expect(evaluateBuilderPreview('ans + 1', withBlank, S, D, 'blank').answer).toBe('3');
  });
});

describe('builder fields', () => {
  const superheat = FORM_BUILDERS.hvac.modes.find((m) => m.id === 'superheat')!;
  const subcool = FORM_BUILDERS.hvac.modes.find((m) => m.id === 'subcool')!;

  it('start each mode from its own defaults, though two modes share a field id', () => {
    expect(modeDefaults(superheat).p).toBe('118');
    expect(modeDefaults(subcool).p).toBe('340');
  });

  it('show their SI units while the SI switch is on', () => {
    const p = superheat.fields.find((f) => f.id === 'p')!;
    expect(fieldUnit(p, { si: 'false' })).toBe('psig');
    expect(fieldUnit(p, { si: 'true' })).toBe('kPa');
  });
});
