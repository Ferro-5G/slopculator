import { BUILTINS, BUILTIN_NAMES } from '../engine/builtins';
import { RECENT_MAX } from './document';
import { keyCall, keyCaption, legendText, PANELS, type Key } from './keypad';
import { TABS, faceText, tileFor, tileKey } from './thumbindex';

export interface FnEntry {
  name: string;
  /** What choosing it inserts; "¦" marks the caret. */
  ins: string;
  detail: string;
  bank?: string;
  words: string;
}

export const SYNONYMS: Record<string, string[]> = {
  invNorm: ['percentile', 'quantile', '95th', '90th', '99th', 'critical value', 'cutoff', 'cutoff for', 'z for', 'z score for', 'inverse normal', 'z from area', 'score from percentile'],
  zcrit: ['critical value', 'critical z', 'confidence level', 'middle 95%', 'z for', 'margin of error', 'percentile', 'quantile'],
  normalcdf: ['area between', 'area under the curve', 'normal probability', 'shade', 'proportion between', 'bell curve'],
  normbetween: ['probability between', 'chance between', 'between two values', 'probability in a range'],
  normaldist: ['bell curve', 'normal curve', 'shade', 'graph a normal'],
  zscore: ['standardize', 'standard score', 'how many standard deviations'],
  binompdf: ['binomial probability', 'exactly k successes', 'chance of exactly', 'probability of exactly', 'coin flips', 'binomial'],
  binomcdf: ['binomial probability', 'at most', 'cumulative binomial', 'binomial'],
  convert: ['miles', 'mile', 'mi', 'km', 'kilometers', 'kilometres', 'feet', 'ft', 'meters', 'metres', 'inches', 'pounds', 'lb', 'kg', 'fahrenheit', 'celsius', 'gallons', 'liters', 'convert units', 'unit conversion', 'units'],
  mean: ['average', 'avg', 'expected'],
  median: ['middle value'],
  sdp: ['standard deviation', 'population sd', 'spread'],
  sds: ['standard deviation', 'sample sd', 'spread'],
  nCr: ['combinations', 'choose'],
  nPr: ['permutations', 'arrangements'],
  solve: ['equation', 'find x', 'root', 'crosses zero', 'equals zero', 'x intercept'],
  roots: ['zeros', 'crosses zero', 'x intercepts', 'polynomial roots'],
  integral: ['area under', 'antiderivative', 'integrate'],
  deriv: ['derivative', 'slope at', 'rate of change', 'differentiate'],
  linreg: ['line of best fit', 'trend line', 'regression', 'least squares'],
  sqrt: ['square root', 'root'],
  abs: ['absolute value', 'magnitude'],
  compound: ['interest', 'savings', 'investment'],
  fivenum: ['box plot', 'quartiles', 'five number summary'],
  // Purpose words: what people type when they don't know the name.
  pmt: ['loan', 'loan payment', 'monthly payment', 'payment', 'mortgage', 'car loan', 'amortization'],
  simple: ['simple interest'],
  dewpoint: ['dew', 'dew point'],
  wetbulb: ['wet bulb'],
  ductsize: ['duct size', 'size a duct', 'duct diameter'],
  superheat: ['super heat', 'suction superheat'],
  subcool: ['subcooling', 'sub cool'],
  pctchange: ['percent change', 'percentage change', 'increase', 'decrease'],
  det: ['determinant'],
  inv: ['inverse matrix', 'matrix inverse'],
  poissoncdf: ['poisson', 'at most'],
  poissonpdf: ['poisson', 'exactly'],
};

const TILE_WORDS = new Map<string, string>();
for (const t of TABS) for (const p of t.pages) for (const tile of p.tiles) TILE_WORDS.set(tile.name, `${TILE_WORDS.get(tile.name) ?? ''} ${faceText(tile.face)} ${tile.say}`.trim());

/**
 * What people almost always mean by a percentile question: a z (or x) for an area under the normal curve. invNorm and
 * zcrit come before the list function percentile(list, p) for these.
 */
const NORMAL_PERCENTILE = /^(percentiles?|quantiles?|centiles?|z( score)? for\b.*|cutoff for\b.*|\d+(\.\d+)?\s*%|\d+(st|nd|rd|th)( percentile)?)$/;
const PERCENTILE_RANK: Record<string, number> = { invNorm: 1200, zcrit: 1150 };

const DESCRIPTIONS: Record<string, string> = {
  percentile: 'Data percentile (list): percentile(list, p), the value p of the way up a list',
  invNorm: 'Normal percentile (z): invNorm(p) → z with P(Z ≤ z) = p; invNorm(p, μ, σ) → x',
  zcrit: 'Middle-area critical z: zcrit(0.95) = 1.96, the z that leaves the middle 95% (not the 95th percentile)',
  // In x, as people write them and the phone's tiles fill them in.
  deriv: 'deriv(expr, x, a): the slope at x = a. In a graph, y = deriv(x^3, x)',
  deriv2: 'deriv2(expr, x, a): the second derivative at x = a',
  integral: 'integral(expr, x, a, b): the area from a to b; -inf and inf work as bounds',
};

export const SHOW_FROM = 90;

const FILLER = new Set(['to', 'in', 'into', 'of', 'the', 'a', 'an', 'for', 'and', 'from', 'with', 'how', 'do', 'i', 'find', 'get', 'what', 'is', 'per', 'on', 'at', 'by']);

const STOP = new Set([...FILLER, 'it', 'its', 'where', 'when', 'which', 'that', 'this', 'these', 'those', 'them', 'value', 'values', 'number', 'numbers',
  'does', 'can', 'me', 'my', 'you', 'want', 'need', 'are', 'be', 'will', 'there', 'some', 'calculate', 'compute', 'work', 'out',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']);
const BARE_NUMBER = /^[-+]?\d+([.,]\d+)?$/;
const contentWords = (q: string): string[] => q.split(' ').filter((w) => w && !STOP.has(w) && !BARE_NUMBER.test(w));
const stem = (w: string): string =>
  w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y`
  : /(ss|x|ch|sh)es$/.test(w) ? w.slice(0, -2)
  : w.length > 3 && /[^sui]s$/.test(w) ? w.slice(0, -1)
  : w;
const phraseKey = (text: string): string => contentWords(text.toLowerCase()).map(stem).join(' ');
const PHRASE_DISCOUNT = 10;
const nameWords = (name: string): string[] => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const startsAWord = (text: string, w: string): boolean => text.startsWith(w) || text.split(/[^\p{L}\p{N}%]+/u).some((t) => t.startsWith(w));
const Z_FOR = /^z( score)? for\b/;

export function keyFunctions(): { name: string; key: Key; bank: string }[] {
  return PANELS.flatMap((p) => p.keys.flatMap((key) => {
    const name = keyCall(key);
    return name ? [{ name, key, bank: p.name }] : [];
  }));
}

export function functionCatalog(): FnEntry[] {
  const out: FnEntry[] = [];
  const seen = new Set<unknown>();
  for (const { name, key, bank } of keyFunctions()) {
    const b = BUILTINS[name];
    if (!b || seen.has(b)) continue;
    seen.add(b);
    out.push({ name, ins: key.ins!, detail: DESCRIPTIONS[name] ?? key.title ?? b.usage ?? '', bank, words: `${legendText(key.label)} ${keyCaption(key) ?? ''}`.toLowerCase() });
  }
  for (const name of BUILTIN_NAMES) {
    const b = BUILTINS[name];
    if (!/^[A-Za-z]/.test(name) || seen.has(b)) continue;
    seen.add(b);
    out.push({ name, ins: b.max === 0 ? name : `${name}(¦)`, detail: DESCRIPTIONS[name] ?? b.usage ?? '', words: '' });
  }
  return out;
}

/** How well a function matches a query; -1 when it doesn't. */
export function searchScore(query: string, e: FnEntry): number {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return 0;
  if (NORMAL_PERCENTILE.test(q) && PERCENTILE_RANK[e.name]) return PERCENTILE_RANK[e.name];
  if (Z_FOR.test(q)) return -1;
  const plain = plainScore(q, e, false);
  const content = contentWords(q);
  if (!content.length || content.join(' ') === q) return plain;
  const phrase = plainScore(content.join(' '), e, true);
  const best = Math.max(plain, phrase >= 0 ? phrase - PHRASE_DISCOUNT : -1);
  return best >= SHOW_FROM ? best : Math.max(best, overlapScore(content, e));
}

function plainScore(q: string, e: FnEntry, phrase: boolean): number {
  const name = e.name.toLowerCase();
  if (name === q) return 1000;
  const syn = (SYNONYMS[e.name] ?? []).map((s) => s.toLowerCase());
  if (syn.includes(q)) return 950;
  if (phrase && syn.some((s) => phraseKey(s) === phraseKey(q))) return 950;
  if (e.words && e.words.trim() === q) return 940;
  if (!phrase) {
    if (name.startsWith(q)) return 800 - name.length;
    if (q.length >= 3 && syn.some((s) => startsAWord(s, q))) return 700;
    if (q.length >= 3 && startsAWord(e.words, q)) return 690;
  }
  const hayWords = `${name} ${e.words} ${e.detail} ${e.bank ?? ''} ${syn.join(' ')} ${TILE_WORDS.get(e.name) ?? ''}`.toLowerCase().split(/[^\p{L}\p{N}%]+/u);
  const near = [...nameWords(e.name), ...`${e.words} ${syn.join(' ')}`.toLowerCase().split(/[^\p{L}\p{N}%]+/u)].filter(Boolean);
  const nearStarts = (w: string) => near.some((t) => t.startsWith(w));
  const nameAndBank = `${name} ${e.words} ${e.bank ?? ''} ${syn.join(' ')}`.toLowerCase().split(/[^\p{L}\p{N}%]+/u);
  const synWords = new Set(syn.flatMap((s) => s.split(' ')));
  let s = 0, matched = 0;
  for (const w of q.split(' ')) {
    if (synWords.has(w)) { s += 150; matched++; }
    else if (w.length >= 3 && nearStarts(w)) { s += 100; matched++; }
    else if (!FILLER.has(w) && nameAndBank.includes(w)) { s += 100; matched++; }
    else if (!FILLER.has(w) && hayWords.includes(w)) { s += 45; matched++; }
    else if (w.length >= 5 && nearStarts(w.slice(0, 5))) { s += 60; matched++; }
    else if (w.length >= 5 && nameWords(e.name).some((t) => t.startsWith(w.slice(0, 3)))) { s += 30; matched++; }
    else if (!FILLER.has(w)) return -1;
  }
  return matched ? Math.min(s, 680) : -1;
}

function overlapScore(content: string[], e: FnEntry): number {
  if (content.length < 2) return -1;
  const syn = (SYNONYMS[e.name] ?? []).join(' ');
  const hay = new Set([...nameWords(e.name), ...`${e.words} ${e.detail} ${e.bank ?? ''} ${syn} ${TILE_WORDS.get(e.name) ?? ''}`.toLowerCase().split(/[^\p{L}\p{N}%]+/u)].filter(Boolean).map(stem));
  const near = [...nameWords(e.name), ...`${e.words} ${syn}`.toLowerCase().split(/[^\p{L}\p{N}%]+/u)].filter(Boolean);
  const matched = content.map(stem).filter((w) => hay.has(w) || (w.length >= 4 && near.some((t) => t.startsWith(w)))).length;
  return matched >= 2 && matched * 2 >= content.length ? Math.min(60 + 40 * matched, 260) : -1;
}

/** What choosing it in Find inserts: the tile's own form where the tile fills in more than the catalog's plain call. */
export function findInsert(e: FnEntry, fluid: string): string {
  const at = tileFor(e.name);
  const tile = at ? TABS[at.tab].pages[at.page].tiles[at.tile] : undefined;
  return tile && (tile.fluid || tile.insert) ? tileKey(tile, fluid).ins ?? e.ins : e.ins;
}

export function pushRecent(recent: readonly string[], name: string): string[] {
  return [name, ...recent.filter((n) => n !== name)].slice(0, RECENT_MAX);
}

const DEFAULTS_SHOWN = 40;

/** Never an action, so Enter on an empty search can't clear anything. */
export function findDefaults(all: FnEntry[], recent: readonly string[]): FnEntry[] {
  const byName = new Map(all.map((e) => [e.name, e]));
  const out: FnEntry[] = [];
  const seen = new Set<string>();
  const add = (e: FnEntry | undefined) => { if (e && !seen.has(e.name)) { seen.add(e.name); out.push(e); } };
  for (const n of recent) add(byName.get(n));
  for (const e of all) if (e.bank) add(e);
  return out.slice(0, DEFAULTS_SHOWN);
}

export function searchFunctions(query: string, entries: FnEntry[] = functionCatalog(), limit = 40): FnEntry[] {
  const ranked = entries
    .map((e, i) => ({ e, i, s: searchScore(query, e) }))
    .filter((x) => x.s >= SHOW_FROM)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const floor = (ranked[0]?.s ?? 0) * WEAK_TAIL;
  return ranked.filter((x) => x.s >= floor).slice(0, limit).map((x) => x.e);
}

const WEAK_TAIL = 0.25;
