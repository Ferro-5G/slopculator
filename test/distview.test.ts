import { describe, expect, it } from 'vitest';
import type { DisplayOpts } from '../src/engine/format';
import type { Value } from '../src/engine/values';
import { DIST_OFF, distPresets, distStatement } from '../src/ui/distview';

const o: DisplayOpts = { places: null, exact: false, percent: false };
const normal = { t: 'normal', mu: 400, sigma: 50 } as Value;
const binom = { t: 'binom', n: 10, p: 0.3 } as Value;
const say = (min: string, max: string, v = normal) => distStatement({ min, max }, v, o);

describe('distStatement', () => {
  it('says which tail is shaded', () => {
    expect(say('-inf', '450').stmt).toBe('P(X < 450)');
    expect(say('350', 'inf').stmt).toBe('P(X > 350)');
    expect(say('350', '450').stmt).toBe('P(350 < X < 450)');
    expect(say('−∞', '+∞').stmt).toBe('P(all)');
  });

  it('reads a blank bound as open', () => {
    expect(say(' ', ' ').stmt).toBe('P(all)');
    expect(say('-inf', '').stmt).toBe('P(all)');
    expect(say('350', '').stmt).toBe('P(X > 350)');
  });

  it('counts a binomial with ≤ and ≥', () => {
    expect(say('-inf', '4', binom).stmt).toBe('P(X ≤ 4)');
    expect(say('2', 'inf', binom).stmt).toBe('P(X ≥ 2)');
    expect(say('2', '4', binom).stmt).toBe('P(2 ≤ X ≤ 4)');
  });

  it('prints a negative bound with a real minus', () => {
    expect(say('-2', '3').stmt).toBe('P(−2 < X < 3)');
  });

  it('gives z-scores for a normal only', () => {
    expect(say('350', '500').zText).toBe('z from −1 to 2');
    expect(say('-inf', '450').zText).toBe('z from −∞ to 1');
    expect(say('350', 'inf').zText).toBe('z from −1 to ∞');
    expect(say('-inf', 'inf').zText).toBe('');
    expect(say('2', '4', binom).zText).toBe('');
    expect(say('abc', '450').zText).toBe('');
  });
});

describe('distPresets', () => {
  it('keeps the bound a tail already has', () => {
    expect(distPresets({ min: '350', max: '450' }, normal).left).toEqual({ min: '-inf', max: '450' });
    expect(distPresets({ min: '350', max: '450' }, normal).right).toEqual({ min: '350', max: 'inf' });
  });

  it('starts a tail at 0 when the bound is blank or open', () => {
    expect(distPresets({ min: '350', max: 'inf' }, normal).left).toEqual({ min: '-inf', max: '0' });
    expect(distPresets({ min: '-inf', max: '450' }, normal).right).toEqual({ min: '0', max: 'inf' });
    expect(distPresets({ ...DIST_OFF }, normal).left.max).toBe('0');
    expect(distPresets({ min: '350', max: '∞' }, normal).left.max).toBe('0');
    expect(distPresets({ min: '−inf', max: '450' }, normal).right.min).toBe('0');
  });

  it('gives a normal its sigma bands, with no float noise', () => {
    expect(distPresets(DIST_OFF, normal).bands).toEqual([
      { k: 1, min: '350', max: '450' },
      { k: 2, min: '300', max: '500' },
      { k: 3, min: '250', max: '550' },
    ]);
    expect(distPresets(DIST_OFF, { t: 'normal', mu: 0.1, sigma: 0.2 } as Value).bands[0]).toMatchObject({ min: '-0.1', max: '0.3' });
  });

  it('has no bands for a binomial', () => {
    expect(distPresets(DIST_OFF, binom).bands).toEqual([]);
  });
});
