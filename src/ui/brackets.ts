export const OPENERS = '([{⟨', CLOSERS = ')]}⟩';

export const TYPED_OPENERS = '([{', TYPED_CLOSERS = ')]}';

export const closerOf = (open: string): string | undefined => TYPED_CLOSERS[TYPED_OPENERS.indexOf(open)];

/** The engine reads log_2(x) as log with a base, so a log_ name has log's inputs. */
export const callFunction = (name: string): string => (/^log_/.test(name) ? 'log' : name);

/** The forms a usage line lists, as in "log(x), log(b, x), or log_b(x)". */
// One space before "or", not \s+: each form is trimmed anyway, and \s+ retried at every space of a long run.
export const usageForms = (usage: string): string[] => usage.split(/;\s*|\sor\s+|,\s+(?=(?:or\s+)?[A-Za-z_]\w*\()/).map((f) => f.trim().replace(/^or\s+/, ''));

const isWordChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);
const isLetter = (c: string): boolean => /[A-Za-z]/.test(c);

/**
 * Where the name that ends at end starts: the first letter in the run of word characters before end, or -1. It finds
 * what /[A-Za-z][A-Za-z0-9_]*$/ would, in one pass. That regex retried at every letter of a long run, so a line of
 * 50,000 letters took seconds.
 */
export function nameStart(text: string, end: number): number {
  let start = end;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (start < end && !isLetter(text[start])) start++;
  return start < end ? start : -1;
}

export const callNameBefore = (text: string, open: number): string | undefined => {
  const start = nameStart(text, open);
  return start < 0 ? undefined : text.slice(start, open);
};

/** Each name( in text, as /([A-Za-z][A-Za-z0-9_]*)\(/g finds them, in one pass. */
export function callsIn(text: string): { name: string; index: number }[] {
  const out: { name: string; index: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!isWordChar(text[i])) continue;
    let end = i;
    while (end < text.length && isWordChar(text[end])) end++;
    const start = nameStart(text, end);
    if (start >= 0 && text[end] === '(') out.push({ name: text.slice(start, end), index: start });
    i = end;
  }
  return out;
}

export const leadingCall = (s: string): string | null => /^([A-Za-z_]\w*)\(/.exec(s)?.[1] ?? null;

const openerOf = (close: string): string | undefined => TYPED_OPENERS[TYPED_CLOSERS.indexOf(close)];

export function pieces(text: string, from: number, to: number, open = OPENERS, close = CLOSERS): [number, number][] {
  const out: [number, number][] = [];
  let depth = 0, start = from;
  for (let i = from; i < to; i++) {
    if (open.includes(text[i])) depth++;
    else if (close.includes(text[i])) depth--;
    else if (text[i] === ',' && depth === 0) { out.push([start, i]); start = i + 1; }
  }
  out.push([start, to]);
  return out;
}

export const splitTop = (s: string): string[] => pieces(s, 0, s.length, TYPED_OPENERS, TYPED_CLOSERS).map(([a, b]) => s.slice(a, b));

export function stepsOverCloser(text: string, pos: number, typed: string): boolean {
  const open = typed.length === 1 ? openerOf(typed) : undefined;
  if (!open || text[pos] !== typed) return false;
  let depth = 0;
  for (const ch of text) {
    if (ch === open) depth++;
    else if (ch === typed) depth--;
  }
  return depth <= 0;
}
