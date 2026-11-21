import { EDITOR_TILES, type EditorTile } from './editors';
import { ANS, keyCall, PANELS, type Key } from './keypad';

export interface Tile {
  face: string;
  name: string;
  say: string;
  key: Key;
  fluid?: boolean;
  insert?: string;
  matrixRow?: boolean;
}

export interface Page {
  name: string;
  note?: string;
  tiles: Tile[];
  editor?: EditorTile;
}

export interface Tab {
  name: string;
  subtitle: string;
  glyph: string;
  symbol: string;
  pages: Page[];
}

export const COLUMNS = 4;
export const hasFluidChips = (page: Page): boolean => page.tiles.some((t) => t.fluid);
/** A wide editor tile takes a row of its own. */
export const rowsOf = (page: Page, columns = COLUMNS): number =>
  Math.ceil((page.tiles.length + (page.editor && !page.editor.wide ? 1 : 0)) / columns) + (page.editor?.wide ? 1 : 0);

export const TILE_MAX = 58;
const TILE_FLOOR = 30;
export function tileHeight(sizeFor: (compact: boolean) => number, max: number): { tileH: number; compact: boolean } {
  const compact = sizeFor(false) < TILE_FLOOR;
  return { tileH: Math.min(max, Math.max(compact ? 1 : TILE_FLOOR, sizeFor(compact))), compact };
}

const keyOf = (bank: string, label: string): Key => {
  const k = PANELS.find((p) => p.name === bank)?.keys.find((x) => x.label === label);
  if (!k) throw new Error(`Thumb Index: no key ${bank}:${label}`);
  return k;
};

export function tileName(k: Key): string {
  const call = keyCall(k);
  if (call) return call;
  if (k.action) return k.label;
  return (k.ins ?? k.label).replace('¦', '').trim() || k.label;
}

const t = (bank: string, label: string, face: string, say: string, extra: { name?: string; fluid?: boolean; insert?: string; matrixRow?: boolean } = {}): Tile => {
  const key = keyOf(bank, label);
  return { face, say, key, name: extra.name ?? tileName(key), ...(extra.fluid ? { fluid: true } : {}), ...(extra.insert ? { insert: extra.insert } : {}), ...(extra.matrixRow ? { matrixRow: true } : {}) };
};

export const faceText = (face: string): string => face.replace(/_\{([^}]*)\}/g, '$1');

export function faceRuns(face: string): { text: string; sub?: boolean }[] {
  const out: { text: string; sub?: boolean }[] = [];
  let at = 0;
  for (const m of face.matchAll(/_\{([^}]*)\}/g)) {
    if (m.index! > at) out.push({ text: face.slice(at, m.index) });
    out.push({ text: m[1], sub: true });
    at = m.index! + m[0].length;
  }
  if (at < face.length) out.push({ text: face.slice(at) });
  return out;
}

export const ROW1: Key[] = [keyOf('Basic', 'x'), keyOf('Basic', 'y'), keyOf('Basic', 'π'), keyOf('Basic', 'e'), keyOf('Basic', '%'), ANS];

export const FLUIDS: { label: string; key: Key }[] = ['410A', '454B', '32', '22', '134a', '404A'].map((label) => ({ label, key: keyOf('Refrig', label) }));

export function tileKey(tile: Tile, fluid: string = FLUIDS[0].key.ins!): Key {
  if (tile.insert) return { ...tile.key, action: undefined, ins: tile.insert };
  if (!tile.fluid || !tile.key.ins) return tile.key;
  return { ...tile.key, ins: tile.key.ins.replace('(¦)', `(${fluid}, ¦)`) };
}

const si = (bank: string) => t(bank, 'SI', 'IP → SI', 'use metric (SI) units for the last argument');

export const TABS: Tab[] = [
  {
    name: 'Math',
    subtitle: 'Trig, logs, algebra, calculus, graphing & units',
    glyph: 'ƒ',
    symbol: 'function',
    pages: [
      {
        name: 'Basic',
        note: 'Core trig, logs, powers, roots & equation solver',
        tiles: [
          t('Trig', 'sin', 'sin', 'sine'), t('Trig', 'cos', 'cos', 'cosine'), t('Trig', 'tan', 'tan', 'tangent'), t('Algebra', 'ln', 'ln x', 'natural log'),
          t('Trig', 'sin⁻¹', 'sin⁻¹', 'inverse sine (angle)'), t('Trig', 'cos⁻¹', 'cos⁻¹', 'inverse cosine (angle)'), t('Trig', 'tan⁻¹', 'tan⁻¹', 'inverse tangent (angle)'), t('Algebra', 'log', 'log x', 'base-10 logarithm'),
          t('Basic', 'x²', 'x²', 'square'), t('Basic', 'x⁻¹', '1/x', 'reciprocal'), t('Algebra', 'eˣ', 'eˣ', 'exponential e^x'), t('Algebra', '10ˣ', '10ˣ', 'power of 10'),
          t('Algebra', '∛', '∛x', 'cube root'), t('Algebra', 'ⁿ√', 'ⁿ√x', 'nth root'), t('Basic', '|x|', '|x|', 'absolute value'), t('Basic', 'n!', 'n!', 'factorial'),
          t('Algebra', 'log_b', 'log base b', 'logarithm in any base'), t('Algebra', 'E', '× 10ⁿ', 'scientific notation'), t('Algebra', 'solve', 'f(x) = 0', 'solve an equation for x'), t('Trig', '°', 'θ°', 'degrees'),
        ],
      },
      {
        name: 'Trig',
        note: 'Reciprocal trig, angle conversion, unit circle & wave form',
        tiles: [
          t('Trig', 'csc', '1/sin', 'cosecant'), t('Trig', 'sec', '1/cos', 'secant'), t('Trig', 'cot', '1/tan', 'cotangent'), t('Trig', 'θ', 'θ', 'angle variable theta'),
          t('Trig', 'torad', '° → rad', 'convert degrees to radians'), t('Trig', 'todeg', 'rad → °', 'convert radians to degrees'), t('Trig', 'atan2', '(x, y) → θ', 'angle of a point (x, y)'), t('Trig', 'sin²', 'sin² x', 'sine squared'),
          t('Trig', 'arclen', 's = rθ', 'circle arc length'), t('Trig', 'sector', '½ r²θ', 'circle sector area'), t('Trig', 'unitcircle', '(cos, sin)', 'exact point on the unit circle'), t('Trig', 'period', '2π / b', 'period of a sine wave'),
          t('Trig', 'trigform', 'a·sin(bx)+d', 'amplitude, period, phase shift & midline'), t('Trig', 'tanform', 'a·tan(bx)+d', 'period & asymptotes of a tangent wave'),
        ],
      },
      {
        // A segment a sixth of a phone wide fits seven narrow letters at most: Number and Calculus didn't.
        name: 'Integer',
        note: 'Rounding, remainders, primes, complex numbers & variables',
        tiles: [
          t('Algebra', 'round', 'round x', 'round to decimal places'), t('Algebra', 'floor', '⌊x⌋', 'round down (floor)'), t('Algebra', 'ceil', '⌈x⌉', 'round up (ceiling)'), t('Algebra', 'abs', 'abs(x)', 'absolute value function'),
          t('Algebra', 'mod', 'a mod b', 'non-negative remainder'), t('Algebra', 'rem', 'rem(a, b)', 'signed remainder'), t('Algebra', 'quot', 'whole a ÷ b', 'integer quotient'), t('Algebra', 'gcd', 'gcd(a, b)', 'greatest common divisor'),
          t('Algebra', 'lcm', 'lcm(a, b)', 'least common multiple'), t('Algebra', 'factor', '2³·3²·5', 'prime factorization'), t('Algebra', 'isprime', 'prime?', 'test if a number is prime'), t('Algebra', 'divisors', 'd | n', 'all divisors of an integer'),
          t('Algebra', 're', 'Re z', 'real part of z'), t('Algebra', 'im', 'Im z', 'imaginary part of z'), t('Algebra', 'arg', 'arg z', 'angle of complex number z'), t('Algebra', 'conj', 'z̄', 'complex conjugate'),
          t('Algebra', 'a', 'a', 'variable a'), t('Algebra', 'b', 'b', 'variable b'), t('Algebra', 'c', 'c', 'variable c'), t('Algebra', 'n', 'n', 'variable n'),
        ],
      },
      {
        name: '∫ d/dx',
        note: 'Derivatives, integrals, polynomials, series & tangents',
        editor: EDITOR_TILES.calc,
        tiles: [
          t('Calculus', 'deriv', 'f′(a)', 'derivative at a point', { insert: 'deriv(¦, x, )' }), t('Calculus', 'deriv2', 'f″(a)', 'second derivative at a point', { insert: 'deriv2(¦, x, )' }), t('Calculus', '∫', '∫ₐᵇ f dx', 'definite integral (area under curve)', { insert: 'integral(¦, x, , )' }), t('Calculus', 't', 't', 'variable t'),
          t('Calculus', 'roots', 'p(x) = 0', 'all roots of a polynomial'), t('Calculus', 'polyval', 'p(x)', 'evaluate a polynomial'), t('Algebra', 'quad', 'ax²+bx+c = 0', 'quadratic formula roots'), t('Calculus', 'sum', 'Σ', 'sum of a list or series'),
          t('Calculus', 'seq', '{f(n)}', 'generate a list from a rule'), t('Calculus', 'gamma', 'Γ(x)', 'gamma function'),
          t('Calculus', 'tangent', 'tangent(f, p)', 'tangent line to f at x = p'), t('Calculus', 'riemann', 'Σ f·Δx', 'Riemann sum in n strips'),
        ],
      },
      {
        name: 'Graph',
        note: 'Curves, inequalities, domains, sliders & 2D geometry',
        editor: EDITOR_TILES.shape,
        tiles: [
          t('Graph', 'y =', 'y =', 'plot y as a function of x'), t('Graph', 'x =', 'x =', 'vertical line or x as a function of y'), t('Graph', 'f(x)=', 'f(x) =', 'define a reusable function'), t('Graph', '( , )', '(x, y)', 'plot a point'),
          t('Graph', '<', '<', 'shade below (dashed edge)'), t('Graph', '>', '>', 'shade above (dashed edge)'), t('Graph', '≤', '≤', 'shade below (solid edge)'), t('Graph', '≥', '≥', 'shade above (solid edge)'),
          t('Graph', '{x>0}', '{x > 0}', 'restrict curve domain'), t('Graph', '{ : }', '{x<0: a, b}', 'piecewise expression'), t('Graph', 'a =', 'a =', 'parameter a with slider'), t('Graph', 'b =', 'b =', 'parameter b with slider'),
          t('Graph', 'c =', 'c =', 'parameter c with slider'), t('Graph', 'd =', 'd =', 'parameter d with slider'), t('Graph', 'distance', '|PQ|', 'distance between two points'), t('Graph', 'slope', 'Δy / Δx', 'slope between two points'),
          t('Graph', 'midpoint', 'mid PQ', 'midpoint of two points'), t('Graph', 'area', 'area △', 'area of a polygon'), t('Graph', 'polygon', 'draw △', 'plot a polygon from points'),
        ],
      },
      {
        name: 'Units $',
        note: 'Unit conversions, loans, interest & number bases',
        tiles: [
          t('Units & $', 'convert', 'mi → km', 'convert between units'), t('Units & $', 'pmt', 'payment', 'monthly loan payment'), t('Units & $', 'compound', 'P(1+r/n)ⁿᵗ', 'compound interest'), t('Units & $', 'simple', 'P(1 + rt)', 'simple interest'),
          t('Units & $', 'continuous', 'Peʳᵗ', 'continuous compounding'), t('Units & $', 'pctchange', 'old → new %', 'percent change'), t('Units & $', '" "', '"text"', 'quoted string for units'), t('Units & $', 'hex', '→ base 16', 'convert to hexadecimal'),
          t('Units & $', 'bin', '→ base 2', 'convert to binary'), t('Units & $', 'dec', 'base b → 10', 'convert base b to decimal'),
        ],
      },
    ],
  },
  {
    name: 'Stats',
    subtitle: 'Normal curve, data summary, regression & inference',
    glyph: 'x̄',
    symbol: 'chart.bar',
    pages: [
      {
        name: 'Normal',
        note: 'Normal curve areas, z-scores, percentiles & bell plots',
        editor: EDITOR_TILES.normal,
        tiles: [
          t('Normal', 'normalcdf', 'z → area', 'area under the normal curve'), t('Normal', 'invNorm', 'area → z', 'z from an area, the normal percentile'), t('Normal', 'zscore', 'x → z', 'standardize to z-score'), t('Normal', 'x_from_z', 'z → x', 'raw value from z-score'),
          t('Normal', 'left tail', 'P(X < x)', 'left-tail probability'), t('Normal', 'right tail', 'P(X > x)', 'right-tail probability'), t('Normal', 'between', 'P(a < X < b)', 'probability between a and b'), t('Normal', 'outside', 'P(X ∉ [a, b])', 'two-tail area outside [a, b]'),
          t('Normal', 'normaldist', 'bell curve', 'plot an interactive normal curve'), t('Normal', 'normalpdf', 'f(x) height', 'normal density height'), t('Normal', 'empirical', '68·95·99.7', 'empirical rule estimate'), t('Normal', '−∞', '−∞', 'negative infinity'),
          t('Normal', 'μ', 'μ', 'mean mu'), t('Normal', 'σ', 'σ', 'standard deviation sigma'), t('Normal', 'μ =', 'μ =', 'mean mu with slider'), t('Normal', '∞', '∞', 'infinity'),
          t('Normal', 'σ =', 'σ =', 'standard deviation sigma with slider'),
        ],
      },
      {
        name: 'Data',
        note: 'Averages, spread, quartiles, box plots & regressions',
        editor: EDITOR_TILES.data,
        tiles: [
          t('Data', 'mean', 'x̄', 'arithmetic mean'), t('Data', 'median', 'x̃', 'median value'), t('Data', 'sdp', 'σ population', 'population standard deviation'), t('Data', 'sds', 's sample', 'sample standard deviation'),
          t('Data', 'mode', 'mode', 'most frequent value'), t('Data', 'range', 'max − min', 'data range'), t('Data', 'quartiles', 'Q1, Q3', 'first and third quartiles'), t('Data', 'fivenum', 'box plot', 'five-number summary & box plot'),
          t('Data', 'stats', 'n, x̄, σ, s', 'full summary statistics'), t('Data', 'percentile', 'p% → x', 'data percentile'), t('Data', 'sd', 'σ or s', 'standard deviation (follows SD mode)'), t('Data', 'linreg', 'y = ax + b', 'linear regression fit'),
          t('Data', 'quadreg', 'ax²+bx+c', 'quadratic regression fit'), t('Data', 'expreg', 'a·bˣ fit', 'exponential regression fit'), t('Data', 'corr', 'r', 'Pearson correlation r'), t('Data', 'varp', 'σ²', 'population variance'),
          t('Data', 'sort', 'low → high', 'sort list ascending'), t('Data', 'max', 'max', 'maximum value'), t('Data', 'min', 'min', 'minimum value'),
        ],
      },
      {
        name: 'Inference',
        note: 'Confidence intervals, t / χ² areas & standard error',
        tiles: [
          t('Inference', 'zcrit', 'C% → z*', 'critical z* for a confidence level'), t('Inference', 'invT', 'area → t', 'inverse t critical value'), t('Inference', 'tcdf', 't → area', 'area under Student’s t curve'), t('Inference', 'chi2cdf', 'χ² → area', 'chi-square tail area'),
          t('Inference', 'phat', 'p̂ = x/n', 'sample proportion'), t('Inference', 'sep', '√(p̂q̂/n)', 'standard error of a proportion'), t('Inference', 'moep', 'z*·SE', 'margin of error for a proportion'), t('Inference', 'moe', '1/√n', 'quick 95% margin of error'),
        ],
      },
    ],
  },
  {
    name: 'Chance',
    subtitle: 'Binomial, Poisson, permutations & expected value',
    glyph: '⚄',
    symbol: 'dice',
    pages: [
      {
        name: 'Chance',
        note: 'Binomial & Poisson probabilities, counting & expected value',
        editor: EDITOR_TILES.chance,
        tiles: [
          t('Chance', 'binompdf', 'P(X = k)', 'probability of exactly k'), t('Chance', 'binomcdf', 'P(X ≤ k)', 'probability of at most k'), t('Chance', 'binomge', 'P(X ≥ k)', 'probability of at least k'), t('Chance', 'between', 'P(a ≤ X ≤ b)', 'probability between a and b'),
          t('Chance', 'binomlt', 'P(X < k)', 'probability of fewer than k'), t('Chance', 'binomgt', 'P(X > k)', 'probability of more than k'), t('Chance', 'binomstats', 'np, σ', 'binomial mean and standard deviation'), t('Chance', 'binomdist', 'bar graph', 'plot binomial distribution bars'),
          t('Chance', 'poissonpdf', 'λ: P(= k)', 'Poisson probability of exactly k'), t('Chance', 'poissoncdf', 'λ: P(≤ k)', 'Poisson probability of at most k'), t('Chance', 'geompdf', '1st on k', 'geometric — first success on trial k'), t('Chance', 'EV', 'Σ x·p', 'expected value'),
          t('Chance', 'nCr', 'ₙCᵣ', 'combinations (order doesn’t matter)'), t('Chance', 'nPr', 'ₙPᵣ', 'permutations (order matters)'), t('Chance', 'count', 'a·b·c', 'fundamental counting principle'), t('Chance', 'netgain', 'EV − cost', 'expected net gain'),
          t('Chance', 'p', 'p', 'probability parameter p'), t('Data', '+ table', 'x, P table', 'insert an outcomes & probabilities table'),
        ],
      },
    ],
  },
  {
    name: 'Matrix',
    subtitle: 'Matrices, linear systems, vectors & transforms',
    glyph: '[ ]',
    symbol: 'square.grid.3x3',
    pages: [
      {
        name: 'Matrix',
        note: 'Build matrices below — plus det, inv, rref & eigen',
        editor: EDITOR_TILES.matrix,
        tiles: [
          t('Matrix', 'det', '|A|', 'matrix determinant'), t('Matrix', 'inv', 'A⁻¹', 'matrix inverse'), t('Matrix', 'transpose', 'Aᵀ', 'matrix transpose'), t('Matrix', 'identity', 'Iₙ', 'n × n identity matrix'),
          t('Matrix', 'rref', 'rref', 'reduced row echelon form'), t('Matrix', 'linsolve', 'AX = B', 'solve linear system AX = B'), t('Matrix', 'trace', 'tr A', 'matrix trace (diagonal sum)'), t('Matrix', 'rank', 'rank A', 'matrix rank'),
          t('Matrix', 'eigen', 'λ of A', 'matrix eigenvalues'), t('Matrix', '[ ]', '+ row', 'add a new row at the bottom of a matrix', { matrixRow: true }),
        ],
      },
      {
        name: 'Vectors',
        note: 'Dot & cross products, norms, angles & 2D transforms',
        editor: EDITOR_TILES.vector,
        tiles: [
          t('Matrix', '⟨ ⟩', '⟨x, y⟩', 'vector literal'), t('Matrix', 'dot', 'u · v', 'dot product'), t('Matrix', 'cross', 'u × v', '3D cross product'), t('Matrix', 'mag', '‖v‖', 'vector magnitude (length)'),
          t('Matrix', 'unit', 'v / ‖v‖', 'unit vector in same direction'), t('Matrix', 'vec', 'vec(x, y)', 'construct vector from components'), t('Matrix', 'angle', '∠(u, v)', 'angle between two vectors'), t('Matrix', 'rotation', 'turn θ', '2D rotation matrix by θ'),
          t('Matrix', 'dilation', 'scale k', '2D scaling matrix by k'), t('Matrix', 'reflectx', 'over x-axis', 'reflect across the x-axis'), t('Matrix', 'reflecty', 'over y-axis', 'reflect across the y-axis'), t('Matrix', 'reflectyx', 'over y = x', 'reflect across the line y = x'),
          t('Matrix', 'apply', 'M · points', 'apply transform matrix M to points'),
        ],
      },
    ],
  },
  {
    name: 'HVAC',
    subtitle: 'Refrigerants, psychrometrics, coils, ducts & hydronics',
    glyph: '❄',
    symbol: 'snowflake',
    pages: [
      {
        name: 'Refrig',
        note: 'Pick a refrigerant above — superheat, subcool & PT tables',
        editor: { ...EDITOR_TILES.hvac, mode: 'superheat', face: 'HVAC…', name: 'superheat builder' },
        tiles: [
          t('Refrig', 'superheat', 'T − T_{sat}', 'suction superheat above dew point', { fluid: true }), t('Refrig', 'subcool', 'T_{sat} − T', 'liquid subcooling below bubble point', { fluid: true }), t('Refrig', 'ptchart', '°F → psig', 'saturation pressure from temperature', { fluid: true }), t('Refrig', 'sattemp', 'psig → °F', 'saturation temperature from pressure', { fluid: true }),
          t('Refrig', 'target SH', 'target SH', 'fixed-orifice target superheat'), t('Refrig', 'refcycle', 'COP, EER', 'full refrigeration cycle performance', { fluid: true }), t('Refrig', 'refprops', 'h, s, ρ', 'saturated enthalpy, entropy & density', { fluid: true }), t('Refrig', 'list', 'fluids', 'list all built-in refrigerants'),
          t('Refrig', 'tbubble', 'bubble °F', 'liquid bubble temperature', { fluid: true }), t('Refrig', 'tdew', 'dew °F', 'vapor dew temperature', { fluid: true }), t('Refrig', 'pbubble', 'bubble psig', 'liquid bubble pressure', { fluid: true }), t('Refrig', 'pdew', 'dew psig', 'vapor dew pressure', { fluid: true }),
          t('Refrig', 'carnot', 'T_{c}/(T_{h}−T_{c})', 'ideal Carnot COP limit'), si('Refrig'),
        ],
      },
      {
        name: 'Air',
        note: 'Cooling coil loads, sensible/latent heat, airflow & EER/COP',
        tiles: [
          t('Air', 'coil', 'tons, SHR', 'cooling coil load from dry bulb & %RH'), t('Air', 'coilwb', 'coil from wb', 'cooling coil load from wet-bulb readings'), t('Air', 'sensible', '1.08·Q·ΔT', 'sensible heat transfer'), t('Air', 'latent', '0.68·Q·Δgr', 'latent heat transfer'),
          t('Air', 'total', '4.5·Q·Δh', 'total air enthalpy heat'), t('Air', 'shratio', 'SHR', 'sensible heat ratio'), t('Air', 'airflow', 'Btu/h → CFM', 'required airflow in CFM'), t('Air', 'temprise', 'Btu/h → ΔT', 'air temperature rise'),
          t('Air', 'mixair', 'mixed air', 'mixed airstream state'), t('Air', 'mixtemp', 'T_{mix}', 'mixed dry-bulb temperature'), t('Air', 'outdoor air %', 'OA %', 'outdoor air fraction'), t('Air', 'bypass', 'BF', 'coil bypass factor'),
          t('Air', 'air changes', 'CFM → ACH', 'air changes per hour'), t('Air', 'uaheat', 'U·A·ΔT', 'envelope conduction heat'), t('Air', 'uvalue', '1 / ΣR', 'overall U-value from R-values'), si('Air'),
          // Equipment ratings, beside the loads they're for: the Refrig page keeps four rows under its fluid chips.
          t('Refrig', 'eertocop', 'EER → COP', 'convert EER to COP'), t('Refrig', 'coptoeer', 'COP → EER', 'convert COP to EER'), t('Refrig', 'coptokw', 'COP → kW/t', 'convert COP to kW per ton'), t('Refrig', 'kwtocop', 'kW/t → COP', 'convert kW per ton to COP'),
        ],
      },
      {
        name: 'Psych',
        note: 'Moist-air properties, wet bulb, dew point & enthalpy',
        editor: { ...EDITOR_TILES.hvac, mode: 'psych', face: 'HVAC…', name: 'moist-air builder' },
        tiles: [
          t('Air', 'psych', 'db, rh → all', 'full moist-air state from dry bulb & %RH'), t('Air', 'wetbulb', 'T_{wb}', 'wet-bulb temperature', { name: 'wetbulb' }), t('Air', 'dewpoint', 'T_{dp}', 'dew-point temperature', { name: 'dewpoint' }), t('Air', 'enthalpy', 'h  Btu/lb', 'moist-air enthalpy'),
          t('Air', 'psychwb', 'db, wb → all', 'full moist-air state from dry & wet bulb'), t('Air', 'psychdp', 'db, dp → all', 'full moist-air state from dry bulb & dew point'), t('Air', 'RH from wb', 'wb → %RH', 'relative humidity from wet bulb'), t('Air', 'RH from dp', 'dp → %RH', 'relative humidity from dew point'),
          t('Air', 'grains', 'gr/lb', 'moisture in grains per pound'), t('Air', 'humratio', 'W  lb/lb', 'humidity ratio'), t('Air', 'specvol', 'v  ft³/lb', 'specific volume'), t('Air', 'density', 'ρ  lb/ft³', 'air density'),
          t('Air', 'altitude', 'ft → psia', 'standard barometric pressure at altitude'), t('Refrig', 'psat', 'water P_{sat}', 'water vapor saturation pressure'), si('Air'),
        ],
      },
      {
        name: 'Ducts',
        note: 'Duct sizing, friction loss, velocity pressure & fan laws',
        editor: { ...EDITOR_TILES.hvac, mode: 'duct', face: 'HVAC…', name: 'duct builder' },
        tiles: [
          t('Flow', 'ductsize', 'CFM, loss → d', 'round duct diameter from CFM & friction'), t('Flow', 'ductvel', 'CFM → FPM', 'duct air velocity'), t('Flow', 'ductloss', 'in / 100 ft', 'duct friction loss per 100 ft'), t('Flow', 'ductdia', 'FPM → d', 'round duct diameter from velocity'),
          t('Flow', 'eqdia', 'w × h → d', 'equivalent round duct diameter'), t('Flow', 'rectduct', 'd → w × h', 'rectangular duct for a round size'), t('Flow', 'velpress', '(V / 4005)²', 'velocity pressure (in. w.c.)'), t('Flow', 'pitot', 'VP → FPM', 'velocity from Pitot tube reading'),
          t('Flow', 'fanlaws', 'rpm₁ → rpm₂', 'fan affinity laws'), t('Flow', 'fanpower', 'fan BHP', 'fan brake horsepower'), t('Flow', 'achflow', 'ACH → CFM', 'CFM needed for target ACH'), t('Flow', 'ventair', '62.1 CFM', 'ASHRAE 62.1 outdoor ventilation air'),
          si('Flow'),
        ],
      },
      {
        name: 'Water',
        note: 'Hydronic heat & flow, pump power, valves & electrical',
        tiles: [
          t('Flow', 'water heat', '500·Q·ΔT', 'hydronic heat transfer'), t('Flow', 'water flow', 'Btu/h → GPM', 'required water flow in GPM'), t('Flow', 'pump power', 'pump BHP', 'pump brake horsepower'), t('Flow', 'pipevel', 'GPM → ft/s', 'water velocity in pipe'),
          t('Flow', 'pipeloss', 'ft / 100 ft', 'pipe friction head loss'), t('Flow', 'valvecv', 'GPM → Cv', 'control valve Cv required'), t('Flow', 'Cv flow', 'Cv → GPM', 'flow rate through a valve'), t('Flow', 'gasinput', 'gas meter', 'furnace gas input by clocking meter'),
          t('Flow', 'electric power', 'V·A·PF → kW', 'electrical power in kW'), t('Flow', 'V imbal', 'imbalance %', 'three-phase voltage imbalance'), si('Flow'),
        ],
      },
    ],
  },
];

export function tileFor(name: string): { tab: number; page: number; tile: number } | null {
  for (let a = 0; a < TABS.length; a++)
    for (let b = 0; b < TABS[a].pages.length; b++) {
      const i = TABS[a].pages[b].tiles.findIndex((x) => tileName(x.key) === name);
      if (i >= 0) return { tab: a, page: b, tile: i };
    }
  return null;
}

/**
 * The small name under a tile's face, or nothing when it would only repeat the face: sin under sin, a = under a =,
 * gcd under gcd(a, b), or a name that is all punctuation (^2 under x²). A name the face doesn't spell out stays
 * (normalcdf under z → area), because that is the word to type.
 */
export function tileCaption(tile: { face: string; name: string }): string | undefined {
  // Raised and lowered letters (the x of eˣ) are decoration on a word, not part of it.
  const words = (text: string) => text.replace(/[\p{Lm}\p{No}]/gu, ' ').match(/[\p{L}_][\p{L}\p{N}_]*/gu)?.map((w) => w.replace(/_+$/, '')).filter(Boolean) ?? [];
  const named = words(tile.name);
  const shown = new Set(words(faceText(tile.face)));
  return named.every((w) => shown.has(w)) ? undefined : tile.name;
}

export const tileLabel = (tile: Tile): string => (tile.say === tile.name ? tile.say : `${tile.say}, ${tile.name}`);

export function homeOf(name: string): string | null {
  const at = tileFor(name);
  if (!at) return null;
  const tab = TABS[at.tab];
  return tab.pages.length > 1 ? `${tab.name} › ${tab.pages[at.page].name}` : tab.name;
}
