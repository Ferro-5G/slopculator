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

const si = (bank: string) => t(bank, 'SI', 'IP → SI', 'switch this function to metric, as its last input');

export const TABS: Tab[] = [
  {
    name: 'Math',
    subtitle: 'functions, trig, numbers, calculus, graphing, units and money',
    glyph: 'ƒ',
    symbol: 'function',
    pages: [
      {
        name: 'Basic',
        tiles: [
          t('Trig', 'sin', 'sin', 'sine'), t('Trig', 'cos', 'cos', 'cosine'), t('Trig', 'tan', 'tan', 'tangent'), t('Algebra', 'ln', 'ln x', 'natural log'),
          t('Trig', 'sin⁻¹', 'sin⁻¹', 'inverse sine, the angle'), t('Trig', 'cos⁻¹', 'cos⁻¹', 'inverse cosine, the angle'), t('Trig', 'tan⁻¹', 'tan⁻¹', 'inverse tangent, the angle'), t('Algebra', 'log', 'log x', 'log base 10'),
          t('Basic', 'x²', 'x²', 'square'), t('Basic', 'x⁻¹', '1/x', 'reciprocal'), t('Algebra', 'eˣ', 'eˣ', 'e to a power'), t('Algebra', '10ˣ', '10ˣ', '10 to a power'),
          t('Algebra', '∛', '∛x', 'cube root'), t('Algebra', 'ⁿ√', 'ⁿ√x', 'nth root'), t('Basic', '|x|', '|x|', 'absolute value'), t('Basic', 'n!', 'n!', 'factorial'),
          t('Algebra', 'log_b', 'log base b', 'log in any base'), t('Algebra', 'E', '× 10ⁿ', 'scientific notation'), t('Algebra', 'solve', 'f(x) = 0', 'solve an equation for x'), t('Trig', '°', 'θ°', 'degrees'),
        ],
      },
      {
        name: 'Trig',
        tiles: [
          t('Trig', 'csc', '1/sin', 'cosecant'), t('Trig', 'sec', '1/cos', 'secant'), t('Trig', 'cot', '1/tan', 'cotangent'), t('Trig', 'θ', 'θ', 'theta'),
          t('Trig', 'torad', '° → rad', 'degrees to radians'), t('Trig', 'todeg', 'rad → °', 'radians to degrees'), t('Trig', 'atan2', '(x, y) → θ', 'angle of a point'), t('Trig', 'sin²', 'sin² x', 'sine squared'),
          t('Trig', 'arclen', 's = rθ', 'arc length'), t('Trig', 'sector', '½ r²θ', 'sector area'), t('Trig', 'unitcircle', '(cos, sin)', 'exact point on the unit circle'), t('Trig', 'period', '2π / b', 'period of a sine wave'),
          t('Trig', 'trigform', 'a·sin(bx)+d', 'amplitude, period, shift and midline'), t('Trig', 'tanform', 'a·tan(bx)+d', 'period and asymptotes of a tangent'),
        ],
      },
      {
        // A segment a sixth of a phone wide fits seven narrow letters at most: Number and Calculus didn't.
        name: 'Integer',
        tiles: [
          t('Algebra', 'round', 'round x', 'round to places'), t('Algebra', 'floor', '⌊x⌋', 'round down'), t('Algebra', 'ceil', '⌈x⌉', 'round up'), t('Algebra', 'abs', 'abs(x)', 'absolute value, as a function'),
          t('Algebra', 'mod', 'a mod b', 'remainder'), t('Algebra', 'rem', 'rem(a, b)', 'remainder with the sign of a'), t('Algebra', 'quot', 'whole a ÷ b', 'whole-number quotient'), t('Algebra', 'gcd', 'gcd(a, b)', 'greatest common divisor'),
          t('Algebra', 'lcm', 'lcm(a, b)', 'least common multiple'), t('Algebra', 'factor', '2³·3²·5', 'prime factors'), t('Algebra', 'isprime', 'prime?', 'is it prime'), t('Algebra', 'divisors', 'd | n', 'every divisor'),
          t('Algebra', 're', 'Re z', 'real part'), t('Algebra', 'im', 'Im z', 'imaginary part'), t('Algebra', 'arg', 'arg z', 'angle of a complex number'), t('Algebra', 'conj', 'z̄', 'complex conjugate'),
          t('Algebra', 'a', 'a', 'the letter a'), t('Algebra', 'b', 'b', 'the letter b'), t('Algebra', 'c', 'c', 'the letter c'), t('Algebra', 'n', 'n', 'the letter n'),
        ],
      },
      {
        name: '∫ d/dx',
        tiles: [
          t('Calculus', 'deriv', 'f′(a)', 'derivative at a point', { insert: 'deriv(¦, x, )' }), t('Calculus', 'deriv2', 'f″(a)', 'second derivative', { insert: 'deriv2(¦, x, )' }), t('Calculus', '∫', '∫ₐᵇ f dx', 'integral, the area', { insert: 'integral(¦, x, , )' }), t('Calculus', 't', 't', 'the variable t'),
          t('Calculus', 'roots', 'p(x) = 0', 'every root of a polynomial'), t('Calculus', 'polyval', 'p(x)', 'value of a polynomial'), t('Algebra', 'quad', 'ax²+bx+c = 0', 'roots of a quadratic'), t('Calculus', 'sum', 'Σ', 'sum of a list or a series'),
          t('Calculus', 'seq', '{f(n)}', 'a list from a rule'), t('Calculus', 'gamma', 'Γ(x)', 'gamma function'),
        ],
      },
      {
        name: 'Graph',
        editor: EDITOR_TILES.shape,
        tiles: [
          t('Graph', 'y =', 'y =', 'graph y as a function of x'), t('Graph', 'x =', 'x =', 'a vertical line, or x as a function of y'), t('Graph', 'f(x)=', 'f(x) =', 'define a function'), t('Graph', '( , )', '(x, y)', 'a point'),
          t('Graph', '<', '<', 'shade below, dashed edge'), t('Graph', '>', '>', 'shade above, dashed edge'), t('Graph', '≤', '≤', 'shade below, solid edge'), t('Graph', '≥', '≥', 'shade above, solid edge'),
          t('Graph', '{x>0}', '{x > 0}', 'domain restriction'), t('Graph', '{ : }', '{x<0: a, b}', 'piecewise'), t('Graph', 'a =', 'a =', 'define a, with a slider'), t('Graph', 'b =', 'b =', 'define b, with a slider'),
          t('Graph', 'c =', 'c =', 'define c, with a slider'), t('Graph', 'd =', 'd =', 'define d, with a slider'), t('Graph', 'distance', '|PQ|', 'distance between two points'), t('Graph', 'slope', 'Δy / Δx', 'slope between two points'),
          t('Graph', 'midpoint', 'mid PQ', 'midpoint'), t('Graph', 'area', 'area △', 'area of a polygon'), t('Graph', 'polygon', 'draw △', 'draw a shape'),
        ],
      },
      {
        name: 'Units $',
        tiles: [
          t('Units & $', 'convert', 'mi → km', 'convert units'), t('Units & $', 'pmt', 'payment', 'monthly loan payment'), t('Units & $', 'compound', 'P(1+r/n)ⁿᵗ', 'compound interest'), t('Units & $', 'simple', 'P(1 + rt)', 'simple interest'),
          t('Units & $', 'continuous', 'Peʳᵗ', 'continuous growth'), t('Units & $', 'pctchange', 'old → new %', 'percent change'), t('Units & $', '" "', '"text"', 'text in quotes, for units'), t('Units & $', 'hex', '→ base 16', 'to hexadecimal'),
          t('Units & $', 'bin', '→ base 2', 'to binary'), t('Units & $', 'dec', 'base b → 10', 'to base 10'),
        ],
      },
    ],
  },
  {
    name: 'Stats',
    subtitle: 'the normal curve, data and inference',
    glyph: 'x̄',
    symbol: 'chart.bar',
    pages: [
      {
        name: 'Normal',
        tiles: [
          t('Normal', 'normalcdf', 'z → area', 'area under the normal curve'), t('Normal', 'invNorm', 'area → z', 'z from an area, the normal percentile'), t('Normal', 'zscore', 'x → z', 'z-score'), t('Normal', 'x_from_z', 'z → x', 'value from a z-score'),
          t('Normal', 'left tail', 'P(X < x)', 'left tail'), t('Normal', 'right tail', 'P(X > x)', 'right tail'), t('Normal', 'between', 'P(a < X < b)', 'between a and b'), t('Normal', 'outside', 'P(X ∉ [a, b])', 'both tails, outside a and b'),
          t('Normal', 'normaldist', 'bell curve', 'draw the normal curve'), t('Normal', 'normalpdf', 'f(x) height', 'height of the curve'), t('Normal', 'empirical', '68·95·99.7', 'empirical rule'), t('Normal', '−∞', '−∞', 'negative infinity'),
          t('Normal', 'μ', 'μ', 'mu, the mean'), t('Normal', 'σ', 'σ', 'sigma, the standard deviation'), t('Normal', 'μ =', 'μ =', 'define mu, with a slider'), t('Normal', '∞', '∞', 'infinity'),
          t('Normal', 'σ =', 'σ =', 'define sigma, with a slider'),
        ],
      },
      {
        name: 'Data',
        tiles: [
          t('Data', 'mean', 'x̄', 'mean'), t('Data', 'median', 'x̃', 'median'), t('Data', 'sdp', 'σ population', 'population standard deviation'), t('Data', 'sds', 's sample', 'sample standard deviation'),
          t('Data', '{ }', '{ , , }', 'a list'), t('Data', 'mode', 'mode', 'most common value'), t('Data', 'range', 'max − min', 'range'), t('Data', 'quartiles', 'Q1, Q3', 'quartiles'),
          t('Data', 'fivenum', 'box plot', 'five-number summary'), t('Data', 'stats', 'n, x̄, σ, s', 'summary statistics'), t('Data', 'percentile', 'p% → x', 'data percentile'), t('Data', 'sd', 'σ or s', 'standard deviation, by the switch'),
          t('Data', 'linreg', 'y = ax + b', 'linear fit'), t('Data', 'quadreg', 'ax²+bx+c', 'quadratic fit'), t('Data', 'expreg', 'a·bˣ fit', 'exponential fit'), t('Data', 'corr', 'r', 'correlation'),
          t('Data', 'varp', 'σ²', 'population variance'), t('Data', 'sort', 'low → high', 'sort a list'), t('Data', 'max', 'max', 'largest value'), t('Data', 'min', 'min', 'smallest value'),
        ],
      },
      {
        name: 'Inference',
        tiles: [
          t('Inference', 'zcrit', 'C% → z*', 'critical z for a confidence level'), t('Inference', 'invT', 'area → t', 't from an area'), t('Inference', 'tcdf', 't → area', 'area under the t curve'), t('Inference', 'chi2cdf', 'χ² → area', 'chi-square area'),
          t('Inference', 'phat', 'p̂ = x/n', 'sample proportion'), t('Inference', 'sep', '√(p̂q̂/n)', 'standard error of a proportion'), t('Inference', 'moep', 'z*·SE', 'margin of error for a proportion'), t('Inference', 'moe', '1/√n', 'quick margin of error'),
        ],
      },
    ],
  },
  {
    name: 'Chance',
    subtitle: 'binomial, Poisson, counting',
    glyph: '⚄',
    symbol: 'dice',
    pages: [
      {
        name: 'Chance',
        tiles: [
          t('Chance', 'binompdf', 'P(X = k)', 'probability of exactly k'), t('Chance', 'binomcdf', 'P(X ≤ k)', 'probability of at most k'), t('Chance', 'binomge', 'P(X ≥ k)', 'probability of at least k'), t('Chance', 'between', 'P(a ≤ X ≤ b)', 'probability between a and b'),
          t('Chance', 'binomlt', 'P(X < k)', 'probability of fewer than k'), t('Chance', 'binomgt', 'P(X > k)', 'probability of more than k'), t('Chance', 'binomstats', 'np, σ', 'binomial mean and standard deviation'), t('Chance', 'binomdist', 'bar graph', 'binomial bars on the graph'),
          t('Chance', 'poissonpdf', 'λ: P(= k)', 'Poisson, exactly k'), t('Chance', 'poissoncdf', 'λ: P(≤ k)', 'Poisson, at most k'), t('Chance', 'geompdf', '1st on k', 'first success on trial k'), t('Chance', 'EV', 'Σ x·p', 'expected value'),
          t('Chance', 'nCr', 'ₙCᵣ', 'combinations'), t('Chance', 'nPr', 'ₙPᵣ', 'permutations'), t('Chance', 'count', 'a·b·c', 'counting principle'), t('Chance', 'netgain', 'EV − cost', 'net gain'),
          t('Chance', 'p', 'p', 'the letter p'), t('Data', '+ table', 'x, P table', 'add a table of outcomes and probabilities'),
        ],
      },
    ],
  },
  {
    name: 'Matrix',
    subtitle: 'matrices and vectors',
    glyph: '[ ]',
    symbol: 'square.grid.3x3',
    pages: [
      {
        name: 'Matrix',
        editor: EDITOR_TILES.matrix,
        tiles: [
          t('Matrix', 'det', '|A|', 'determinant'), t('Matrix', 'inv', 'A⁻¹', 'inverse'), t('Matrix', 'new matrix', '3 × 3', 'a 3 by 3 matrix, cell by cell', { name: 'matrix', insert: '[[¦, , ], [, , ], [, , ]]' }), t('Matrix', '[[ ]]', '2 × 2', 'a 2 by 2 matrix, cell by cell', { name: 'matrix', insert: '[[¦, ], [, ]]' }),
          t('Matrix', 'transpose', 'Aᵀ', 'transpose'), t('Matrix', 'identity', 'Iₙ', 'identity matrix'), t('Matrix', 'rref', 'rref', 'reduced row echelon form'), t('Matrix', '[ ]', '+ row', 'a row: in a matrix, a new row at its foot', { matrixRow: true }),
          t('Matrix', 'linsolve', 'AX = B', 'solve a system'), t('Matrix', 'trace', 'tr A', 'trace'), t('Matrix', 'rank', 'rank A', 'rank'), t('Matrix', 'eigen', 'λ of A', 'eigenvalues'),
        ],
      },
      {
        name: 'Vectors',
        editor: EDITOR_TILES.vector,
        tiles: [
          t('Matrix', '⟨ ⟩', '⟨x, y⟩', 'a vector'), t('Matrix', 'dot', 'u · v', 'dot product'), t('Matrix', 'cross', 'u × v', 'cross product'), t('Matrix', 'mag', '‖v‖', 'magnitude'),
          t('Matrix', 'unit', 'v / ‖v‖', 'unit vector'), t('Matrix', 'vec', 'vec(x, y)', 'vector from parts'), t('Matrix', 'angle', '∠(u, v)', 'angle between vectors'), t('Matrix', 'rotation', 'turn θ', 'rotation matrix'),
          t('Matrix', 'dilation', 'scale k', 'dilation matrix'), t('Matrix', 'reflectx', 'over x-axis', 'reflect over the x-axis'), t('Matrix', 'reflecty', 'over y-axis', 'reflect over the y-axis'), t('Matrix', 'reflectyx', 'over y = x', 'reflect over y equals x'),
          t('Matrix', 'apply', 'M · points', 'apply a matrix to points'),
        ],
      },
    ],
  },
  {
    name: 'HVAC',
    subtitle: 'refrigerant, air, psychrometrics, ducts, water',
    glyph: '❄',
    symbol: 'snowflake',
    pages: [
      {
        name: 'Refrig',
        tiles: [
          t('Refrig', 'superheat', 'T − T_{sat}', 'superheat, suction line above the dew point', { fluid: true }), t('Refrig', 'subcool', 'T_{sat} − T', 'subcooling, liquid line below the bubble point', { fluid: true }), t('Refrig', 'ptchart', '°F → psig', 'pressure from a temperature', { fluid: true }), t('Refrig', 'sattemp', 'psig → °F', 'saturation temperature from a pressure', { fluid: true }),
          t('Refrig', 'target SH', 'target SH', 'fixed-orifice target superheat'), t('Refrig', 'refcycle', 'COP, EER', 'the whole refrigeration cycle', { fluid: true }), t('Refrig', 'refprops', 'h, s, ρ', 'saturated properties', { fluid: true }), t('Refrig', 'list', 'fluids', 'every refrigerant with a table'),
          t('Refrig', 'tbubble', 'bubble °F', 'bubble temperature', { fluid: true }), t('Refrig', 'tdew', 'dew °F', 'dew temperature', { fluid: true }), t('Refrig', 'pbubble', 'bubble psig', 'bubble pressure', { fluid: true }), t('Refrig', 'pdew', 'dew psig', 'dew pressure', { fluid: true }),
          t('Refrig', 'carnot', 'T_{c}/(T_{h}−T_{c})', 'Carnot COP, the ideal limit'), si('Refrig'),
        ],
      },
      {
        name: 'Air',
        tiles: [
          t('Air', 'coil', 'tons, SHR', 'coil load from dry bulb and humidity'), t('Air', 'coilwb', 'coil from wb', 'coil load from wet bulb readings'), t('Air', 'sensible', '1.08·Q·ΔT', 'sensible heat'), t('Air', 'latent', '0.68·Q·Δgr', 'latent heat'),
          t('Air', 'total', '4.5·Q·Δh', 'total heat'), t('Air', 'shratio', 'SHR', 'sensible heat ratio'), t('Air', 'airflow', 'Btu/h → CFM', 'airflow needed'), t('Air', 'temprise', 'Btu/h → ΔT', 'temperature rise'),
          t('Air', 'mixair', 'mixed air', 'two airstreams mixed'), t('Air', 'mixtemp', 'T_{mix}', 'mixed temperature by flow'), t('Air', 'outdoor air %', 'OA %', 'percent outdoor air'), t('Air', 'bypass', 'BF', 'coil bypass factor'),
          t('Air', 'air changes', 'CFM → ACH', 'air changes per hour'), t('Air', 'uaheat', 'U·A·ΔT', 'conduction heat'), t('Air', 'uvalue', '1 / ΣR', 'U-value from R-values'), si('Air'),
          // Equipment ratings, beside the loads they're for: the Refrig page keeps four rows under its fluid chips.
          t('Refrig', 'eertocop', 'EER → COP', 'EER to COP'), t('Refrig', 'coptoeer', 'COP → EER', 'COP to EER'), t('Refrig', 'coptokw', 'COP → kW/t', 'COP to kilowatts per ton'), t('Refrig', 'kwtocop', 'kW/t → COP', 'kilowatts per ton to COP'),
        ],
      },
      {
        name: 'Psych',
        tiles: [
          t('Air', 'psych', 'db, rh → all', 'every property from dry bulb and humidity'), t('Air', 'wetbulb', 'T_{wb}', 'wet bulb', { name: 'wetbulb' }), t('Air', 'dewpoint', 'T_{dp}', 'dew point', { name: 'dewpoint' }), t('Air', 'enthalpy', 'h  Btu/lb', 'enthalpy'),
          t('Air', 'psychwb', 'db, wb → all', 'every property from dry bulb and wet bulb'), t('Air', 'psychdp', 'db, dp → all', 'every property from dry bulb and dew point'), t('Air', 'RH from wb', 'wb → %RH', 'relative humidity from wet bulb'), t('Air', 'RH from dp', 'dp → %RH', 'relative humidity from dew point'),
          t('Air', 'grains', 'gr/lb', 'grains of moisture'), t('Air', 'humratio', 'W  lb/lb', 'humidity ratio'), t('Air', 'specvol', 'v  ft³/lb', 'specific volume'), t('Air', 'density', 'ρ  lb/ft³', 'air density'),
          t('Air', 'altitude', 'ft → psia', 'standard pressure at altitude'), t('Refrig', 'psat', 'water P_{sat}', 'saturation pressure of water'), si('Air'),
        ],
      },
      {
        name: 'Ducts',
        tiles: [
          t('Flow', 'ductsize', 'CFM, loss → d', 'duct size from airflow and friction'), t('Flow', 'ductvel', 'CFM → FPM', 'duct velocity'), t('Flow', 'ductloss', 'in / 100 ft', 'duct friction loss'), t('Flow', 'ductdia', 'FPM → d', 'round duct size from velocity'),
          t('Flow', 'eqdia', 'w × h → d', 'round equivalent of a rectangle'), t('Flow', 'rectduct', 'd → w × h', 'rectangle for a round size'), t('Flow', 'velpress', '(V / 4005)²', 'velocity pressure'), t('Flow', 'pitot', 'VP → FPM', 'velocity from a pitot reading'),
          t('Flow', 'fanlaws', 'rpm₁ → rpm₂', 'fan laws'), t('Flow', 'fanpower', 'fan BHP', 'fan brake horsepower'), t('Flow', 'achflow', 'ACH → CFM', 'airflow for air changes'), t('Flow', 'ventair', '62.1 CFM', 'ASHRAE 62.1 ventilation air'),
          si('Flow'),
        ],
      },
      {
        name: 'Water',
        tiles: [
          t('Flow', 'water heat', '500·Q·ΔT', 'water heat'), t('Flow', 'water flow', 'Btu/h → GPM', 'water flow needed'), t('Flow', 'pump power', 'pump BHP', 'pump brake horsepower'), t('Flow', 'pipevel', 'GPM → ft/s', 'pipe velocity'),
          t('Flow', 'pipeloss', 'ft / 100 ft', 'pipe friction loss'), t('Flow', 'valvecv', 'GPM → Cv', 'valve Cv needed'), t('Flow', 'Cv flow', 'Cv → GPM', 'flow through a valve'), t('Flow', 'gasinput', 'gas meter', 'gas input from clocking a meter'),
          t('Flow', 'electric power', 'V·A·PF → kW', 'electric power'), t('Flow', 'V imbal', 'imbalance %', 'voltage imbalance'), si('Flow'),
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
