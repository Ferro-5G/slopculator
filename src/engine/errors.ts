export class CalcError extends Error {
  pos?: number;
  constructor(message: string, pos?: number) {
    super(message);
    this.name = 'CalcError';
    this.pos = pos;
  }
}

/**
 * Above 0 while a graph samples a function. Its errors only mean "no point here", so nobody reads them, and
 * building one (message, Error object, stack) costs far more than the math: a curve like ln(x) fails for every
 * pixel left of 0. In quiet mode fail() throws one shared error instead.
 */
let quietDepth = 0;
const QUIET = new CalcError('Error while sampling a graph');

export function fail(message: string): never {
  if (quietDepth > 0) throw QUIET;
  throw new CalcError(message);
}

/** A line that ran past its budget. Code that turns errors into "no value here" (integrands, root finders) rethrows it. */
export class BudgetError extends CalcError {}

/**
 * ans in a definition that would read the line asking for the definition. It depends on which line asked first, not on
 * the definition, so the definition's own line still gets its value.
 */
export class OrderError extends CalcError {}

/** A result too big for a double. Exact math may still get there, so a line that hits this gets a second try. */
export class OverflowError extends CalcError {}

export function failOverflow(message: string): never {
  if (quietDepth > 0) throw QUIET;
  throw new OverflowError(message);
}

/**
 * What to show for anything thrown while a line is read or worked out. The JavaScript engine's own limits (a stack too
 * deep for ten thousand nested brackets, a number or a list past its size limit) arrive as a RangeError whose words
 * mean nothing to someone doing math, so they become a sentence about the line.
 */
export const TOO_BIG = 'This line is too long or too deeply nested to work out. Split it into shorter lines';
export const errorText = (e: unknown): string => (e instanceof RangeError ? TOO_BIG : e instanceof Error ? e.message : String(e));

/**
 * A failure that turns on a number sitting exactly on an edge: a zero divisor, a log of 0, a root of a negative.
 * Doubles can land there by cancellation (1e16 + 1 − 1e16 is 0 in doubles and 1 in fact), so exact math gets a second
 * try, as it does after an overflow.
 */
export class EdgeError extends CalcError {}

export function failEdge(message: string | (() => string)): never {
  if (quietDepth > 0) throw QUIET;
  throw new EdgeError(typeof message === 'string' ? message : message());
}

/**
 * Exact math proved the line has no value: it divides by a number that is exactly 0. Doubles can miss that
 * (0.1 + 0.2 − 0.3 is 5.6e−17 to them), so this overrules whatever they worked out.
 */
export class ExactlyUndefined extends CalcError {}

/**
 * The work budget of the line being evaluated: document.ts opens one per line, and hot loops (user function calls,
 * sums, integrands) charge it. Without it one line could freeze the app: f(40) for f(n) = f(n−1) + f(n−1), a sum of a
 * million terms inside another, or seq inside seq building a trillion values. A graph being drawn gets one too.
 */
let deadline = Infinity;
let ticks = 0;
let items = 0;
const LINE_BUDGET_MS = 2000;
const SHEET_BUDGET_MS = 6000;
const ITEM_LIMIT = 10_000_000;

const TOO_SLOW = `This line takes more than ${LINE_BUDGET_MS / 1000} seconds to work out, so it was stopped`;
const SHEET_TOO_SLOW = `The whole sheet takes more than ${SHEET_BUDGET_MS / 1000} seconds to work out, so this line was stopped`;

/** When the sheet being evaluated runs out of time, and which of the two limits the open deadline is. */
let sheetEnd = Infinity;
let stopText = TOO_SLOW;

/**
 * Runs fn, a whole sheet's evaluation, with the sheet's budget. Each line still gets its own 2 seconds, but no line
 * runs past the sheet's end: without this, a sheet of slow lines (one a file or a link can bring in) cost 2 seconds a
 * line on every load and every keystroke. Cheap lines after the end still finish, since the clock is read only every
 * 1024 steps.
 */
export function withSheetBudget<T>(fn: () => T): T {
  const outer = sheetEnd;
  sheetEnd = Date.now() + SHEET_BUDGET_MS;
  try {
    return fn();
  } finally {
    sheetEnd = outer;
  }
}

/**
 * Runs fn with a line's budget. A line can need another line worked out first (ans in a definition reads the line
 * above it), so this puts back the budget that was open before, with the time spent in between given back, up to the
 * sheet's end.
 */
export function withLineBudget<T>(fn: () => T): T {
  const outer = { deadline, ticks, items, stopText };
  const started = Date.now();
  const lineEnd = started + LINE_BUDGET_MS;
  deadline = Math.min(lineEnd, sheetEnd);
  stopText = lineEnd <= sheetEnd ? TOO_SLOW : SHEET_TOO_SLOW;
  ticks = 0;
  items = 0;
  try {
    return fn();
  } finally {
    const given = outer.deadline + (Date.now() - started);
    deadline = outer.deadline === Infinity || given <= sheetEnd ? given : sheetEnd;
    stopText = deadline === given ? outer.stopText : SHEET_TOO_SLOW;
    ticks = outer.ticks;
    items = outer.items;
  }
}

export function charge(count = 0): void {
  if (deadline === Infinity) return;
  if (count && (items += count) > ITEM_LIMIT) throw new BudgetError('This line builds more than 10 million values, so it was stopped');
  if ((++ticks & 1023) === 0 && Date.now() > deadline) throw new BudgetError(stopText);
}

/**
 * charge() counts calls, and one call to a built-in can be most of a second's work: a 512×512 matrix product is 134
 * million multiply-adds. Built-ins that do that much charge their work here, and the clock is read every million units
 * however few calls they took, so a graph whose samples are matrix products still stops at its budget.
 */
let work = 0;
const WORK_PER_CHECK = 1 << 20;
export function chargeWork(units: number): void {
  if (deadline === Infinity || (work += units) < WORK_PER_CHECK) return;
  work = 0;
  if (Date.now() > deadline) throw new BudgetError(stopText);
}

export const drawDeadline = (): number => Date.now() + LINE_BUDGET_MS;
/** Whether a graph is being drawn on its own: evaluating a line always has that line's budget open. */
export const isDrawing = (): boolean => deadline === Infinity;

// Stack capture off for the throws that don't go through fail() (Error.stackTraceLimit works in V8 and JavaScriptCore;
// elsewhere it does nothing).
const ErrorCtor = Error as { stackTraceLimit?: number };

export function quietSample<A, R>(f: (a: A) => R, a: A, until?: number): R {
  const limit = ErrorCtor.stackTraceLimit;
  ErrorCtor.stackTraceLimit = 0;
  quietDepth++;
  if (until !== undefined) {
    deadline = until;
    items = 0;
  }
  try {
    return f(a);
  } finally {
    quietDepth--;
    ErrorCtor.stackTraceLimit = limit;
    if (until !== undefined) deadline = Infinity;
  }
}

/** Runs fn with real error messages, even in a graph sample: a variable's value and message are kept, so they count. */
export function withFullErrors<T>(fn: () => T): T {
  const saved = quietDepth;
  quietDepth = 0;
  try {
    return fn();
  } finally {
    quietDepth = saved;
  }
}

export function failLazy(message: () => string): never {
  if (quietDepth > 0) throw QUIET;
  throw new CalcError(message());
}

/**
 * fn's result, or undefined if it throws. Exact math only refines a value the float path already found, so any failure
 * there (out of memory, a bug) keeps the double. This is the one place to narrow what that swallows: the one thing it
 * lets through is proof that there is no value at all.
 */
export function orDouble<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ExactlyUndefined) throw e;
    return undefined;
  }
}

// Messages that are read back as well as shown. A row's result carries its error as text, so each form has one writer
// here and readError beside them turns the text back into the form: errorSpan and src/ui/errortext.ts read its tags.
export const ENDS_EARLY = 'Expression ends too early';
export const EMPTY_PARENS = 'Empty parentheses';
export const unmatchedText = (token: string): string => `Unmatched "${token}"`;
export const unexpectedText = (token: string): string => `Unexpected "${token}"`;
const END_OF_INPUT = 'end of input';
/** got is the token found instead of the closer, null when the line ran out. */
export const unclosedText = (close: string, what: string, got: string | null): string =>
  `Expected "${close}" to close ${what}, got ${got === null ? END_OF_INPUT : `"${got}"`}`;
export function arityText(name: string, min: number, max: number, got: number, usage?: string): string {
  const range = min === max ? `${min}` : max === Infinity ? `${min} or more` : `${min} to ${max}`;
  return `${name} takes ${range} input${max === 1 ? '' : 's'}${usage ? `: ${usage}` : ''}, got ${got}`;
}
export const unknownNameText = (name: string): string => `Unknown name "${name}"`;
export const undefinedNameText = (name: string, hint: string | null): string =>
  `${unknownNameText(name)}. ${hint ? `Did you mean ${hint}? Or define` : 'Define'} it on its own line, like ${name} = 5`;
export const unknownFunctionText = (name: string, hint: string | null = null): string =>
  `Unknown function "${name}"${hint ? `. Did you mean ${hint}?` : ''}`;
export const emptyLineText = (name: string): string => `Line ${name} is empty`;
export const varErrorText = (name: string, message: string): string => `"${name}" has an error: ${message}`;
/** Every division by zero says this first; some say why after it ("…: total heat is 0"). */
export const DIVISION_BY_ZERO = 'Division by zero';
export const divisionByZeroText = (why = ''): string => `${DIVISION_BY_ZERO}${why}`;
/** what is "√" or "Even root"; complex says Complex mode would give a value. */
export const notRealText = (what: string, x: number, complex = false): string =>
  `${what} of a negative number (${x}) isn't real${complex ? '. Turn on Complex mode to get i' : ''}`;
export const logDomainText = (name: string, x: number): string => `${name} is only defined for positive numbers, got ${x}`;
const WARNING = 'Warning: ';
export const warningNote = (text: string): string => `${WARNING}${text}`;
export const isWarningNote = (note: string): boolean => note.startsWith(WARNING);

export type ErrorForm =
  | { k: 'endsEarly' | 'emptyParens' | 'other' }
  | { k: 'unmatched' | 'unexpected'; token: string }
  | { k: 'unclosed'; close: string; what: string; got: string | null }
  | { k: 'arity'; name: string; inputs: string; got: number }
  | { k: 'unknown'; name: string; hint: string | null; example: string | null }
  | { k: 'emptyLine'; name: string }
  | { k: 'divZero' }
  | { k: 'notReal' }
  | { k: 'logDomain'; name: string }
  | { k: 'inVar'; name: string; inner: ErrorForm };

export function readError(message: string): ErrorForm {
  if (message === ENDS_EARLY) return { k: 'endsEarly' };
  if (message === EMPTY_PARENS) return { k: 'emptyParens' };
  let m = /^"([^"]+)" has an error: ([\s\S]*)$/.exec(message);
  if (m) return { k: 'inVar', name: m[1], inner: readError(m[2]) };
  m = /^Expected "(.+?)" to close (.+?), got (.+)$/.exec(message);
  if (m) return { k: 'unclosed', close: m[1], what: m[2], got: m[3] === END_OF_INPUT ? null : m[3].replace(/^"(.*)"$/, '$1') };
  m = /^Unmatched "(.+)"$/.exec(message);
  if (m) return { k: 'unmatched', token: m[1] };
  m = /^Unexpected "(.+)"$/.exec(message);
  if (m) return { k: 'unexpected', token: m[1] };
  m = /^(.+?) takes ([^:]*?) inputs?(?:: .*)?, got (\d+)$/.exec(message);
  if (m) return { k: 'arity', name: m[1], inputs: m[2], got: Number(m[3]) };
  m = /^Unknown (function|name) "([^"]+)"([\s\S]*)$/.exec(message);
  if (m) {
    const example = m[1] === 'name' ? /^\. (?:Did you mean [^?]+\? Or define|Define) it on its own line, like (.+)$/.exec(m[3]) : null;
    return { k: 'unknown', name: m[2], hint: /Did you mean ([^?]+)\?/.exec(m[3])?.[1] ?? null, example: example?.[1] ?? null };
  }
  if (message.startsWith(DIVISION_BY_ZERO)) return { k: 'divZero' };
  if (/^(?:√|Even root) of a negative number \(.*\) isn't real/.test(message)) return { k: 'notReal' };
  m = /^(.+?) is only defined for positive numbers, got /.exec(message);
  if (m) return { k: 'logDomain', name: m[1] };
  m = /^Line ([A-Z]+) is empty/.exec(message);
  return m ? { k: 'emptyLine', name: m[1] } : { k: 'other' };
}
