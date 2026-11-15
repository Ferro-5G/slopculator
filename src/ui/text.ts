export const TYPING_PAUSE_MS = 600;

const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff, isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;

export const charBefore = (s: string, i: number) => (i >= 2 && isLow(s.charCodeAt(i - 1)) && isHigh(s.charCodeAt(i - 2)) ? 2 : 1);
export const charAfter = (s: string, i: number) => (isHigh(s.charCodeAt(i)) && isLow(s.charCodeAt(i + 1)) ? 2 : 1);

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

