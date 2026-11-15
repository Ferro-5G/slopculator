// null means automatic (12 significant digits).
export const ROUND_MAX = 15;
export const ROUND_SLIDER_MAX = ROUND_MAX + 1;
export const ROUND_CHOICES: (number | null)[] = [null, ...Array.from({ length: ROUND_MAX + 1 }, (_, n) => n)];

export function roundToSlider(places: number | null): number {
  return places === null ? 0 : Math.min(ROUND_SLIDER_MAX, Math.max(0, places + 1));
}

export function sliderToRound(position: number): number | null {
  return position <= 0 ? null : Math.min(ROUND_MAX, position - 1);
}

export function roundShort(places: number | null): string {
  return places === null ? 'Auto' : `${places} dp`;
}

export function roundLabel(places: number | null, plain = false): string {
  if (places === null) return plain ? 'Auto' : 'Automatic';
  if (places === 0) return plain ? 'Whole numbers' : 'Whole Number';
  return plain ? `${places} decimal place${places === 1 ? '' : 's'}` : `${places} Decimal Place${places === 1 ? '' : 's'}`;
}
