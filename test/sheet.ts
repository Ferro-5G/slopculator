// Runs lines through the engine the way a sheet does and reports each answer as plain JSON, for tests that check
// values, fractions and notes without a page. It also lists the built-in functions, which the docs test counts.
import { cleanSettings, evaluateDocument, type RowInput, type RowResult } from '../src/engine/document';
import type { Settings } from '../src/engine/evaluator';
import { formatValue, plainValue, fractionText, exactText, isWholeNum, type DisplayOpts } from '../src/engine/format';
import { BUILTINS, BUILTIN_NAMES } from '../src/engine/builtins';
import { keyFunctions } from '../src/ui/search';
import { isDist, type Value } from '../src/engine/values';

export interface Options {
  deg?: boolean;
  exact?: boolean;
  sample?: boolean;
  percent?: boolean;
  complex?: boolean;
  places?: number | null;
  letters?: boolean;
  /** a + b% adds b% of a, as the iPhone Calculator does (80 + 15% = 92). False makes % only divide by 100. Default true. */
  percentOf?: boolean;
}

export interface LineResult {
  line: number;
  letter?: string;
  input: string;
  result?: string;
  pretty?: string;
  value?: unknown;
  fraction?: string;
  exact?: string;
  error?: string;
  notes?: string[];
  graphed?: boolean;
}

export function settingsOf(o: Options): Settings {
  return cleanSettings({ ...o, lineNames: o.letters ?? true });
}

function displayOf(o: Options): DisplayOpts {
  return { places: o.places ?? null, exact: o.exact ?? false, percent: o.percent ?? false };
}

/** Plain JSON for a value (numbers stay numbers; Infinity and NaN become strings). */
function toJSON(v: Value | undefined): unknown {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x)));
}

function toRows(lines: string[]): RowInput[] {
  return lines.map((text, i) => ({ id: `l${i}`, kind: 'expr', text }));
}

export function run(lines: string[], o: Options = {}): { lines: LineResult[]; results: RowResult[] } {
  const rows = toRows(lines);
  const results = evaluateDocument(rows, settingsOf(o));
  const d = displayOf(o);
  return {
    results,
    lines: results.map((r, i): LineResult => {
      const out: LineResult = { line: i + 1, input: lines[i] };
      if (r.lineName) out.letter = r.lineName;
      if (r.error) out.error = r.error;
      else if (r.truth !== undefined) out.result = String(r.truth);
      else if (r.value !== undefined && !isDist(r.value)) {
        out.result = plainValue(r.value, { ...d, exact: false }, r.prob, r.precise);
        out.pretty = formatValue(r.value, d, r.prob, r.precise);
        out.value = toJSON(r.value);
        const ex = r.precise && 'k' in r.precise ? r.precise : undefined;
        if (typeof r.value === 'number' && !isWholeNum(r.value, ex)) {
          const f = fractionText(r.value, ex);
          if (f) out.fraction = f;
          else {
            const e = exactText(r.value, ex);
            if (e) out.exact = e.replace(/−/g, '-');
          }
        }
      }
      const notes = [...r.notes, ...(r.warnings ?? []).map((w) => `Check: ${w.message}${w.fix ? ` For that, write ${w.fix}` : ''}`)];
      if (notes.length) out.notes = notes;
      if (r.graph.length) out.graphed = true;
      return out;
    }),
  };
}

interface FnInfo {
  name: string;
  usage: string;
  description: string;
  tab?: string;
  aliases: string[];
}

let catalog: FnInfo[] | null = null;
export function functions(): FnInfo[] {
  if (catalog) return catalog;
  const byDef = new Map<unknown, FnInfo>();
  const fromKeys = new Map<string, { title?: string; tab: string }>();
  for (const { name, key, bank } of keyFunctions()) if (!fromKeys.has(name)) fromKeys.set(name, { title: key.title, tab: bank });
  for (const name of BUILTIN_NAMES) {
    if (!/^[A-Za-z]/.test(name)) continue;
    const def = BUILTINS[name];
    const existing = byDef.get(def);
    if (existing) {
      existing.aliases.push(name);
      continue;
    }
    const k = fromKeys.get(name);
    const usage = def.usage ?? (def.max === 0 ? name : `${name}(${def.min === def.max ? Array.from({ length: def.min }, (_, i) => String.fromCharCode(97 + i)).join(', ') : '…'})`);
    byDef.set(def, { name, usage, description: k?.title ?? def.usage ?? '', tab: k?.tab, aliases: [] });
  }
  for (const info of byDef.values()) {
    const keyName = [info.name, ...info.aliases].find((n) => fromKeys.has(n));
    if (keyName && keyName !== info.name) {
      info.aliases = [info.name, ...info.aliases.filter((a) => a !== keyName)];
      info.name = keyName;
      const k = fromKeys.get(keyName)!;
      info.description = k.title ?? info.description;
      info.tab = k.tab;
    }
  }
  catalog = [...byDef.values()].sort((a, b) => a.name.localeCompare(b.name));
  return catalog;
}
