export const OPENERS = '([{⟨', CLOSERS = ')]}⟩';

export const TYPED_OPENERS = '([{', TYPED_CLOSERS = ')]}';

export const closerOf = (open: string): string | undefined => TYPED_CLOSERS[TYPED_OPENERS.indexOf(open)];

/** The engine reads log_2(x) as log with a base, so a log_ name has log's inputs. */
export const callFunction = (name: string): string => (/^log_/.test(name) ? 'log' : name);

/** The forms a usage line lists, as in "log(x), log(b, x), or log_b(x)". */
export const usageForms = (usage: string): string[] => usage.split(/;\s*|\s+or\s+|,\s+(?=(?:or\s+)?[A-Za-z_]\w*\()/).map((f) => f.trim().replace(/^or\s+/, ''));

export const callNameBefore = (text: string, open: number): string | undefined => /([A-Za-z][A-Za-z0-9_]*)$/.exec(text.slice(0, open))?.[1];

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
