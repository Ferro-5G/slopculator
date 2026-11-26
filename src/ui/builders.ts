// Declarative GUI builders for multi-argument expressions: Calculus, Normal, Data list, Chance, and HVAC.
// Pure logic with zero DOM so Web, iOS (SwiftUI), and Android (Material 3) render the exact same builders and live previews.
import { evaluateDocument, parseLine, type RowInput } from '../engine/document';
import { errorText } from '../engine/errors';
import type { Settings } from '../engine/evaluator';
import { plainValue, type DisplayOpts } from '../engine/format';
import { isDist } from '../engine/values';
import { isEmptyLine } from './document';
import { definedNames, freeName, nameProblem } from './editors';

export type FormBuilderKind = 'calc' | 'normal' | 'data' | 'chance' | 'hvac';

export type BuilderFieldKind = 'expr' | 'number' | 'list' | 'fluid' | 'toggle';

export interface BuilderFieldSpec {
  id: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  kind: BuilderFieldKind;
  unit?: string;
  /** The unit when the mode's SI switch is on, where it differs. */
  siUnit?: string;
  /** Optional field: omitted from the generated call when left blank. */
  optional?: boolean;
  /** Render two adjacent short fields side by side on wide layouts. */
  half?: boolean;
  /** Render three adjacent short fields on one row on wide layouts. */
  third?: boolean;
}

export interface BuilderModeSpec {
  id: string;
  label: string;
  note: string;
  fields: readonly BuilderFieldSpec[];
  /** Optional name suggestions (when the builder outputs `name = ...`, like Data list). */
  names?: readonly string[];
  nameHint?: string;
  build: (vals: Record<string, string>, name: string) => string;
  validate?: (vals: Record<string, string>) => string;
}

export interface BuilderPreset {
  label: string;
  mode?: string;
  values: Record<string, string>;
}

export interface FormBuilderSpec {
  kind: FormBuilderKind;
  title: string;
  subtitle: string;
  action: string;
  modes: readonly BuilderModeSpec[];
  presets?: readonly BuilderPreset[];
}

export const BUILDER_FLUIDS = ['R-410A', 'R-454B', 'R-32', 'R-22', 'R-134a', 'R-404A'] as const;
const fluidArg = (f: string): string => `"${(f || 'R-410A').replace(/^R-?/i, 'R')}"`;

const PLAIN_NUMBER = /^[-+−]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/**
 * Parses a free-form list separated by commas, semicolons or newlines. Spaces separate items only in a run of plain
 * numbers (`12 15 18`, pasted from a column); anywhere else they belong to the item, so `2 + 3` stays one item.
 */
export function parseListItems(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((chunk) => {
      const words = chunk.split(/\s+/);
      return words.length > 1 && words.every((w) => PLAIN_NUMBER.test(w)) ? words : [chunk];
    });
}

/** Why the list can't be inserted, or '' when it can: nothing entered, or an item that isn't a valid expression. */
function listProblem(raw: string): string {
  const items = parseListItems(raw);
  if (!items.length) return 'Enter at least one number.';
  try {
    parseLine(`{${items.join(', ')}}`);
    return '';
  } catch (e) {
    return errorText(e);
  }
}

const req = (vals: Record<string, string>, id: string, label: string): string =>
  (vals[id] ?? '').trim() ? '' : `Enter ${label.toLowerCase()}.`;

const v = (vals: Record<string, string>, id: string, fallback = ''): string => (vals[id] ?? '').trim() || fallback;

const withSi = (args: string[], si: boolean): string => (si ? [...args, '"SI"'].join(', ') : args.join(', '));

const CALC_BUILDER: FormBuilderSpec = {
  kind: 'calc',
  title: 'Calculus builder',
  subtitle: '',
  action: 'Insert',
  modes: [
    {
      id: 'integral',
      label: 'Integral ∫',
      note: 'Definite integral of f(x) from lower bound a to upper bound b.',
      fields: [
        { id: 'expr', label: 'Expression', placeholder: 'x^2', defaultValue: 'x^2', kind: 'expr' },
        { id: 'var', label: 'Variable', placeholder: 'x', defaultValue: 'x', kind: 'expr', third: true },
        { id: 'a', label: 'Lower a', placeholder: '0', defaultValue: '0', kind: 'number', third: true },
        { id: 'b', label: 'Upper b', placeholder: '3', defaultValue: '3', kind: 'number', third: true },
      ],
      validate: (vals) => req(vals, 'expr', 'an expression') || req(vals, 'a', 'a lower bound') || req(vals, 'b', 'an upper bound'),
      build: (vals) => `integral(${v(vals, 'expr', 'x^2')}, ${v(vals, 'var', 'x')}, ${v(vals, 'a', '0')}, ${v(vals, 'b', '1')})`,
    },
    {
      id: 'deriv',
      label: 'Derivative f′',
      note: 'Slope of f(x) at x = a (leave a blank to graph the derivative function).',
      fields: [
        { id: 'expr', label: 'Expression', placeholder: 'x^3 - 3x', defaultValue: 'x^3 - 3x', kind: 'expr' },
        { id: 'var', label: 'Variable', placeholder: 'x', defaultValue: 'x', kind: 'expr', half: true },
        { id: 'a', label: 'At point a', placeholder: '2 (optional)', defaultValue: '2', kind: 'number', optional: true, half: true },
      ],
      validate: (vals) => req(vals, 'expr', 'an expression'),
      build: (vals) => {
        const a = v(vals, 'a');
        return a ? `deriv(${v(vals, 'expr', 'x^2')}, ${v(vals, 'var', 'x')}, ${a})` : `y = deriv(${v(vals, 'expr', 'x^2')}, ${v(vals, 'var', 'x')})`;
      },
    },
    {
      id: 'deriv2',
      label: '2nd deriv f″',
      note: 'Second derivative (concavity) of f(x) at x = a.',
      fields: [
        { id: 'expr', label: 'Expression', placeholder: 'x^3 - 3x', defaultValue: 'x^3 - 3x', kind: 'expr' },
        { id: 'var', label: 'Variable', placeholder: 'x', defaultValue: 'x', kind: 'expr', half: true },
        { id: 'a', label: 'At point a', placeholder: '2', defaultValue: '2', kind: 'number', half: true },
      ],
      validate: (vals) => req(vals, 'expr', 'an expression') || req(vals, 'a', 'a point a'),
      build: (vals) => `deriv2(${v(vals, 'expr', 'x^3')}, ${v(vals, 'var', 'x')}, ${v(vals, 'a', '1')})`,
    },
    {
      id: 'sum',
      label: 'Sum Σ',
      note: 'Series sum of a rule from n = start to end.',
      fields: [
        { id: 'expr', label: 'Term expression', placeholder: '2n + 1', defaultValue: '2n + 1', kind: 'expr' },
        { id: 'var', label: 'Index', placeholder: 'n', defaultValue: 'n', kind: 'expr', third: true },
        { id: 'a', label: 'Start', placeholder: '1', defaultValue: '1', kind: 'number', third: true },
        { id: 'b', label: 'End', placeholder: '10', defaultValue: '10', kind: 'number', third: true },
      ],
      validate: (vals) => req(vals, 'expr', 'a term expression') || req(vals, 'a', 'a start index') || req(vals, 'b', 'an end index'),
      build: (vals) => `sum(${v(vals, 'expr', 'n')}, ${v(vals, 'var', 'n')}, ${v(vals, 'a', '1')}, ${v(vals, 'b', '10')})`,
    },
  ],
  presets: [
    { label: '∫ x² (0→3)', mode: 'integral', values: { expr: 'x^2', var: 'x', a: '0', b: '3' } },
    { label: 'd/dx sin(x)', mode: 'deriv', values: { expr: 'sin(x)', var: 'x', a: '0' } },
    { label: 'Σ 1/2ⁿ', mode: 'sum', values: { expr: '1 / 2^n', var: 'n', a: '1', b: '10' } },
  ],
};

const NORMAL_BUILDER: FormBuilderSpec = {
  kind: 'normal',
  title: 'Normal curve builder',
  subtitle: '',
  action: 'Insert',
  modes: [
    {
      id: 'between',
      label: 'Between',
      note: 'Probability P(a < X < b) under a normal distribution.',
      fields: [
        { id: 'a', label: 'Lower bound a', placeholder: '-1', defaultValue: '-1', kind: 'number', half: true },
        { id: 'b', label: 'Upper bound b', placeholder: '1', defaultValue: '1', kind: 'number', half: true },
        { id: 'mu', label: 'Mean μ', placeholder: '0', defaultValue: '0', kind: 'number', half: true },
        { id: 'sd', label: 'Std dev σ', placeholder: '1', defaultValue: '1', kind: 'number', half: true },
      ],
      validate: (vals) => req(vals, 'a', 'a lower bound') || req(vals, 'b', 'an upper bound'),
      build: (vals) => {
        const mu = v(vals, 'mu', '0'), sd = v(vals, 'sd', '1');
        return mu === '0' && sd === '1'
          ? `normalcdf(${v(vals, 'a', '-1')}, ${v(vals, 'b', '1')})`
          : `normalcdf(${v(vals, 'a', '-1')}, ${v(vals, 'b', '1')}, ${mu}, ${sd})`;
      },
    },
    {
      id: 'left',
      label: 'Left tail',
      note: 'Probability P(X < x) to the left of a cutoff value.',
      fields: [
        { id: 'x', label: 'Cutoff x', placeholder: '1.96', defaultValue: '1.96', kind: 'number' },
        { id: 'mu', label: 'Mean μ', placeholder: '0', defaultValue: '0', kind: 'number', half: true },
        { id: 'sd', label: 'Std dev σ', placeholder: '1', defaultValue: '1', kind: 'number', half: true },
      ],
      validate: (vals) => req(vals, 'x', 'a cutoff x'),
      build: (vals) => {
        const mu = v(vals, 'mu', '0'), sd = v(vals, 'sd', '1');
        return mu === '0' && sd === '1'
          ? `normleft(${v(vals, 'x', '0')})`
          : `normleft(${v(vals, 'x', '0')}, ${mu}, ${sd})`;
      },
    },
    {
      id: 'right',
      label: 'Right tail',
      note: 'Probability P(X > x) to the right of a cutoff value.',
      fields: [
        { id: 'x', label: 'Cutoff x', placeholder: '1.96', defaultValue: '1.96', kind: 'number' },
        { id: 'mu', label: 'Mean μ', placeholder: '0', defaultValue: '0', kind: 'number', half: true },
        { id: 'sd', label: 'Std dev σ', placeholder: '1', defaultValue: '1', kind: 'number', half: true },
      ],
      validate: (vals) => req(vals, 'x', 'a cutoff x'),
      build: (vals) => {
        const mu = v(vals, 'mu', '0'), sd = v(vals, 'sd', '1');
        return mu === '0' && sd === '1'
          ? `normright(${v(vals, 'x', '0')})`
          : `normright(${v(vals, 'x', '0')}, ${mu}, ${sd})`;
      },
    },
    {
      id: 'inv',
      label: 'Percentile',
      note: 'Find the cutoff z or x for a given left-tail area p (invNorm).',
      fields: [
        { id: 'p', label: 'Left-tail area p', placeholder: '0.95', defaultValue: '0.95', kind: 'number' },
        { id: 'mu', label: 'Mean μ', placeholder: '0', defaultValue: '0', kind: 'number', half: true },
        { id: 'sd', label: 'Std dev σ', placeholder: '1', defaultValue: '1', kind: 'number', half: true },
      ],
      validate: (vals) => req(vals, 'p', 'a probability between 0 and 1'),
      build: (vals) => {
        const mu = v(vals, 'mu', '0'), sd = v(vals, 'sd', '1');
        return mu === '0' && sd === '1'
          ? `invNorm(${v(vals, 'p', '0.95')})`
          : `invNorm(${v(vals, 'p', '0.95')}, ${mu}, ${sd})`;
      },
    },
  ],
  presets: [
    { label: '±1σ (68%)', mode: 'between', values: { a: '-1', b: '1', mu: '0', sd: '1' } },
    { label: '95th %ile', mode: 'inv', values: { p: '0.95', mu: '0', sd: '1' } },
    { label: 'IQ > 130', mode: 'right', values: { x: '130', mu: '100', sd: '15' } },
  ],
};

const DATA_BUILDER: FormBuilderSpec = {
  kind: 'data',
  title: 'Data list builder',
  subtitle: 'Paste or type values separated by spaces, commas, or new lines.',
  action: 'Insert list',
  modes: [
    {
      id: 'list',
      label: 'Data list',
      note: '',
      names: ['L', 'X', 'Y', 'D', 'S', 'A', 'B'],
      nameHint: 'Name it to reuse in mean(L), sds(L), or fivenum(L).',
      fields: [
        { id: 'items', label: 'Values', placeholder: '12, 15, 18, 22, 25', defaultValue: '', kind: 'list' },
      ],
      validate: (vals) => listProblem(vals.items ?? ''),
      build: (vals, name) => {
        const body = `{${parseListItems(vals.items ?? '').join(', ')}}`;
        return name.trim() ? `${name.trim()} = ${body}` : body;
      },
    },
  ],
  presets: [
    { label: 'Sample data', values: { items: '12, 15, 18, 18, 21, 24, 29' } },
    { label: 'Test scores', values: { items: '78, 84, 88, 91, 93, 96' } },
    { label: 'Clear', values: { items: '' } },
  ],
};

const CHANCE_BUILDER: FormBuilderSpec = {
  kind: 'chance',
  title: 'Probability builder',
  subtitle: '',
  action: 'Insert',
  modes: [
    {
      id: 'binom_eq',
      label: 'Binom = k',
      note: 'Probability of exactly k successes in n independent trials.',
      fields: [
        { id: 'n', label: 'Trials n', placeholder: '10', defaultValue: '10', kind: 'number', half: true },
        { id: 'p', label: 'Success prob p', placeholder: '0.5', defaultValue: '0.5', kind: 'number', half: true },
        { id: 'k', label: 'Successes k', placeholder: '6', defaultValue: '6', kind: 'number' },
      ],
      validate: (vals) => req(vals, 'n', 'trials n') || req(vals, 'p', 'probability p') || req(vals, 'k', 'successes k'),
      build: (vals) => `binompdf(${v(vals, 'n', '10')}, ${v(vals, 'p', '0.5')}, ${v(vals, 'k', '5')})`,
    },
    {
      id: 'binom_le',
      label: 'Binom ≤ k',
      note: 'Probability of at most k successes in n independent trials.',
      fields: [
        { id: 'n', label: 'Trials n', placeholder: '10', defaultValue: '10', kind: 'number', half: true },
        { id: 'p', label: 'Success prob p', placeholder: '0.5', defaultValue: '0.5', kind: 'number', half: true },
        { id: 'k', label: 'At most k', placeholder: '6', defaultValue: '6', kind: 'number' },
      ],
      validate: (vals) => req(vals, 'n', 'trials n') || req(vals, 'p', 'probability p') || req(vals, 'k', 'cutoff k'),
      build: (vals) => `binomcdf(${v(vals, 'n', '10')}, ${v(vals, 'p', '0.5')}, ${v(vals, 'k', '5')})`,
    },
    {
      id: 'binom_ge',
      label: 'Binom ≥ k',
      note: 'Probability of at least k successes in n independent trials.',
      fields: [
        { id: 'n', label: 'Trials n', placeholder: '10', defaultValue: '10', kind: 'number', half: true },
        { id: 'p', label: 'Success prob p', placeholder: '0.5', defaultValue: '0.5', kind: 'number', half: true },
        { id: 'k', label: 'At least k', placeholder: '7', defaultValue: '7', kind: 'number' },
      ],
      validate: (vals) => req(vals, 'n', 'trials n') || req(vals, 'p', 'probability p') || req(vals, 'k', 'cutoff k'),
      build: (vals) => `binomge(${v(vals, 'n', '10')}, ${v(vals, 'p', '0.5')}, ${v(vals, 'k', '7')})`,
    },
    {
      id: 'poisson',
      label: 'Poisson',
      note: 'Probability of k events given average rate λ per interval.',
      fields: [
        { id: 'lam', label: 'Average rate λ', placeholder: '3.5', defaultValue: '3.5', kind: 'number', half: true },
        { id: 'k', label: 'Events k', placeholder: '4', defaultValue: '4', kind: 'number', half: true },
        { id: 'cum', label: 'Cumulative P(X ≤ k)', placeholder: '', defaultValue: 'false', kind: 'toggle' },
      ],
      validate: (vals) => req(vals, 'lam', 'average rate λ') || req(vals, 'k', 'event count k'),
      build: (vals) => `${vals.cum === 'true' ? 'poissoncdf' : 'poissonpdf'}(${v(vals, 'lam', '3')}, ${v(vals, 'k', '2')})`,
    },
  ],
  presets: [
    { label: '10 coin flips', mode: 'binom_eq', values: { n: '10', p: '0.5', k: '6' } },
    { label: 'At least 8/10', mode: 'binom_ge', values: { n: '10', p: '0.5', k: '8' } },
    { label: 'Poisson λ=4', mode: 'poisson', values: { lam: '4', k: '3', cum: 'false' } },
  ],
};

const HVAC_BUILDER: FormBuilderSpec = {
  kind: 'hvac',
  title: 'HVAC builder',
  subtitle: '',
  action: 'Insert',
  modes: [
    {
      id: 'superheat',
      label: 'Superheat',
      note: 'Suction-line superheat above saturation dew temperature.',
      fields: [
        { id: 'fluid', label: 'Refrigerant', placeholder: 'R-410A', defaultValue: 'R-410A', kind: 'fluid' },
        { id: 'p', label: 'Suction pressure', placeholder: '118', defaultValue: '118', kind: 'number', unit: 'psig', siUnit: 'kPa', half: true },
        { id: 't', label: 'Suction line temp', placeholder: '50', defaultValue: '50', kind: 'number', unit: '°F', siUnit: '°C', half: true },
        { id: 'si', label: 'Use SI metric units (kPa, °C)', placeholder: '', defaultValue: 'false', kind: 'toggle' },
      ],
      validate: (vals) => req(vals, 'p', 'suction pressure') || req(vals, 't', 'line temperature'),
      build: (vals) => `superheat(${withSi([fluidArg(vals.fluid), v(vals, 'p', '118'), v(vals, 't', '50')], vals.si === 'true')})`,
    },
    {
      id: 'subcool',
      label: 'Subcool',
      note: 'Liquid-line subcooling below saturation bubble temperature.',
      fields: [
        { id: 'fluid', label: 'Refrigerant', placeholder: 'R-410A', defaultValue: 'R-410A', kind: 'fluid' },
        { id: 'p', label: 'Liquid pressure', placeholder: '340', defaultValue: '340', kind: 'number', unit: 'psig', siUnit: 'kPa', half: true },
        { id: 't', label: 'Liquid line temp', placeholder: '95', defaultValue: '95', kind: 'number', unit: '°F', siUnit: '°C', half: true },
        { id: 'si', label: 'Use SI metric units (kPa, °C)', placeholder: '', defaultValue: 'false', kind: 'toggle' },
      ],
      validate: (vals) => req(vals, 'p', 'liquid pressure') || req(vals, 't', 'line temperature'),
      build: (vals) => `subcool(${withSi([fluidArg(vals.fluid), v(vals, 'p', '340'), v(vals, 't', '95')], vals.si === 'true')})`,
    },
    {
      id: 'psych',
      label: 'Moist air',
      note: 'Full psychrometric state from dry-bulb temperature and relative humidity.',
      fields: [
        { id: 'db', label: 'Dry bulb', placeholder: '75', defaultValue: '75', kind: 'number', unit: '°F', siUnit: '°C', third: true },
        { id: 'rh', label: 'Rel. humidity', placeholder: '50', defaultValue: '50', kind: 'number', unit: '%RH', third: true },
        { id: 'alt', label: 'Altitude', placeholder: '0', defaultValue: '', kind: 'number', unit: 'ft', siUnit: 'm', optional: true, third: true },
        { id: 'si', label: 'Use SI metric units (°C, m)', placeholder: '', defaultValue: 'false', kind: 'toggle' },
      ],
      validate: (vals) => req(vals, 'db', 'dry-bulb temp') || req(vals, 'rh', 'relative humidity'),
      build: (vals) => {
        const args = [v(vals, 'db', '75'), v(vals, 'rh', '50')];
        if (v(vals, 'alt')) args.push(v(vals, 'alt'));
        return `psych(${withSi(args, vals.si === 'true')})`;
      },
    },
    {
      id: 'coil',
      label: 'Cooling coil',
      note: 'Total, sensible & latent cooling load, tons, SHR, and condensate.',
      fields: [
        { id: 'cfm', label: 'Airflow', placeholder: '1200', defaultValue: '1200', kind: 'number', unit: 'CFM' },
        { id: 'db1', label: 'Entering DB', placeholder: '75', defaultValue: '75', kind: 'number', unit: '°F', half: true },
        { id: 'rh1', label: 'Entering %RH', placeholder: '50', defaultValue: '50', kind: 'number', unit: '%', half: true },
        { id: 'db2', label: 'Leaving DB', placeholder: '55', defaultValue: '55', kind: 'number', unit: '°F', half: true },
        { id: 'rh2', label: 'Leaving %RH', placeholder: '90', defaultValue: '90', kind: 'number', unit: '%', half: true },
      ],
      validate: (vals) => req(vals, 'cfm', 'airflow') || req(vals, 'db1', 'entering DB') || req(vals, 'rh1', 'entering RH') || req(vals, 'db2', 'leaving DB') || req(vals, 'rh2', 'leaving RH'),
      build: (vals) => `coil(${v(vals, 'cfm', '1200')}, ${v(vals, 'db1', '75')}, ${v(vals, 'rh1', '50')}, ${v(vals, 'db2', '55')}, ${v(vals, 'rh2', '90')})`,
    },
    {
      id: 'duct',
      label: 'Duct size',
      note: 'Round duct diameter from airflow and friction rate.',
      fields: [
        { id: 'cfm', label: 'Airflow', placeholder: '1000', defaultValue: '1000', kind: 'number', unit: 'CFM', half: true },
        { id: 'loss', label: 'Friction rate', placeholder: '0.1', defaultValue: '0.1', kind: 'number', unit: 'in./100ft', half: true },
      ],
      validate: (vals) => req(vals, 'cfm', 'airflow') || req(vals, 'loss', 'friction rate'),
      build: (vals) => `ductsize(${v(vals, 'cfm', '1000')}, ${v(vals, 'loss', '0.1')})`,
    },
  ],
};

/** The unit a field shows: its SI unit while the mode's SI switch is on. */
export const fieldUnit = (field: BuilderFieldSpec, values: Record<string, string>): string | undefined =>
  values.si === 'true' && field.siUnit ? field.siUnit : field.unit;

/** A mode's fields at their defaults. Each mode keeps its own values: two modes can share a field id (`p`, `t`). */
export const modeDefaults = (mode: { fields: readonly { id: string; defaultValue: string }[] }): Record<string, string> =>
  Object.fromEntries(mode.fields.map((f) => [f.id, f.defaultValue]));

export const FORM_BUILDERS: Record<FormBuilderKind, FormBuilderSpec> = {
  calc: CALC_BUILDER,
  normal: NORMAL_BUILDER,
  data: DATA_BUILDER,
  chance: CHANCE_BUILDER,
  hvac: HVAC_BUILDER,
};

/**
 * The sheet with the builder's lines where Insert will put them: in place of the active line when it's empty, else
 * right after it (at the end with no active line), so `ans` and names read what they will once it's inserted.
 * Returns the sheet and where the first of the lines sits.
 */
function placeLines(rows: readonly RowInput[], activeId: string | null | undefined, lines: RowInput[]): { probe: RowInput[]; at: number } {
  const i = activeId ? rows.findIndex((r) => r.id === activeId) : -1;
  if (i < 0) return { probe: [...rows, ...lines], at: rows.length };
  const replace = isEmptyLine(rows[i]);
  return { probe: [...rows.slice(0, replace ? i : i + 1), ...lines, ...rows.slice(i + 1)], at: replace ? i : i + 1 };
}

/** Evaluates a builder's generated expression against the current sheet so the user sees the live answer before inserting. */
export function evaluateBuilderPreview(
  line: string,
  rows: readonly RowInput[],
  settings: Settings,
  display: DisplayOpts,
  activeId?: string | null,
): { answer: string | null; error: string | null } {
  if (!line.trim()) return { answer: null, error: null };
  const { probe, at } = placeLines(rows, activeId, [{ id: '__builder__', kind: 'expr', text: line }]);
  const last = evaluateDocument(probe, settings)[at];
  if (!last) return { answer: null, error: null };
  if (last.error) return { answer: null, error: last.error };
  if (last.value !== undefined && !isDist(last.value)) {
    return { answer: plainValue(last.value, display, last.prob, last.precise), error: null };
  }
  return { answer: null, error: null };
}

/** Quick stats summary for the Data List Builder (`n = 7 · x̄ = 19.6 · s = 5.65`). */
export function dataListSummary(
  raw: string,
  rows: readonly RowInput[],
  settings: Settings,
  display: DisplayOpts,
  activeId?: string | null,
): string | null {
  const items = parseListItems(raw);
  if (!items.length) return null;
  const listExpr = `{${items.join(', ')}}`;
  // The list is worked out once, where Insert lands, under a name nothing else uses, so an `ans` in it reads the line
  // above and the mean and spread both come from that one list.
  const used = definedNames(rows);
  const name = freeName(Array.from({ length: 20 }, (_, i) => `datalist${i || ''}`), used) || 'datalist';
  const { probe, at } = placeLines(rows, activeId, [
    { id: '__dl_l__', kind: 'expr', text: `${name} = ${listExpr}` },
    { id: '__dl_m__', kind: 'expr', text: `mean(${name})` },
    { id: '__dl_s__', kind: 'expr', text: items.length > 1 ? `sds(${name})` : '0' },
  ]);
  const res = evaluateDocument(probe, settings);
  const m = res[at + 1];
  const s = res[at + 2];
  if (m?.error || m?.value === undefined || isDist(m.value)) return `${items.length} item${items.length === 1 ? '' : 's'}`;
  const meanTxt = plainValue(m.value, display);
  if (items.length === 1 || s?.error || s?.value === undefined || isDist(s.value)) return `n = 1 · x̄ = ${meanTxt}`;
  const sdTxt = plainValue(s.value, display);
  return `n = ${items.length} · x̄ = ${meanTxt} · s = ${sdTxt}`;
}

export { definedNames, freeName, nameProblem };
