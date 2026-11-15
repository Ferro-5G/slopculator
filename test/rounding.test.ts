import { describe, it, expect } from 'vitest';
import { ROUND_CHOICES, ROUND_MAX, ROUND_SLIDER_MAX, roundLabel, roundShort, roundToSlider, sliderToRound } from '../src/ui/rounding';
import { plainNumber } from '../src/engine/format';

describe('rounding slider', () => {
  it('runs from Auto through ROUND_MAX places', () => {
    expect(sliderToRound(0)).toBeNull();
    expect(sliderToRound(1)).toBe(0);
    expect(sliderToRound(ROUND_SLIDER_MAX)).toBe(ROUND_MAX);
    expect(roundToSlider(null)).toBe(0);
    expect(roundToSlider(0)).toBe(1);
  });
  it('round-trips every stop', () => {
    for (const places of ROUND_CHOICES) expect(sliderToRound(roundToSlider(places))).toBe(places);
  });
  it('clamps values outside the range, like an old saved sheet', () => {
    expect(roundToSlider(40)).toBe(ROUND_SLIDER_MAX);
    expect(sliderToRound(99)).toBe(ROUND_MAX);
    expect(sliderToRound(-3)).toBeNull();
  });
  it('has readable labels', () => {
    expect(roundShort(null)).toBe('Auto');
    expect(roundShort(3)).toBe('3 dp');
    expect(roundLabel(null)).toBe('Automatic');
    expect(roundLabel(0)).toBe('Whole Number');
    expect(roundLabel(1)).toBe('1 Decimal Place');
    expect(roundLabel(10)).toBe('10 Decimal Places');
  });
  it('formats numbers across the whole range', () => {
    expect(plainNumber(0.81859461412, 0)).toBe('1');
    expect(plainNumber(0.81859461412, 3)).toBe('0.819');
    expect(plainNumber(0.81859461412, 10)).toBe('0.8185946141');
    expect(plainNumber(0.5, ROUND_MAX)).toBe('0.500000000000000');
  });
});
