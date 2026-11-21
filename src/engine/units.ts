// Unit table for convert(x, "from", "to"). Each unit maps to a base unit per dimension:
// base = (x + off) · k, so temperatures (affine) and plain scale factors share one formula.
import { fail } from './errors';

interface Unit {
  dim: string;
  k: number;
  off: number;
  name: string;
}

const UNITS: Record<string, Unit> = Object.create(null);
const LOWER: Record<string, Unit[]> = Object.create(null);

function add(dim: string, k: number, names: string[], off = 0): Unit {
  const u: Unit = { dim, k, off, name: names[0] };
  for (const n of names) {
    UNITS[n] = u;
    const l = n.toLowerCase();
    const list = (LOWER[l] ??= []);
    if (!list.includes(u)) list.push(u);
  }
  return u;
}

// Length (meters)
add('length', 1, ['m', 'meter', 'meters', 'metre', 'metres']);
add('length', 1000, ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres']);
add('length', 0.01, ['cm', 'centimeter', 'centimeters']);
add('length', 0.001, ['mm', 'millimeter', 'millimeters']);
add('length', 1e-6, ['μm', 'µm', 'um', 'micron', 'microns']);
add('length', 1e-9, ['nm', 'nanometer', 'nanometers']);
add('length', 0.0254, ['in', 'inch', 'inches']);
add('length', 0.3048, ['ft', 'foot', 'feet']);
add('length', 0.9144, ['yd', 'yard', 'yards']);
add('length', 1609.344, ['mi', 'mile', 'miles']);
add('length', 1852, ['nmi', 'nautical mile', 'nautical miles']);
add('length', 149597870700, ['au', 'AU']);
add('length', 9460730472580800, ['ly', 'light year', 'light years', 'lightyear', 'lightyears']);

// Mass (kilograms)
add('mass', 1, ['kg', 'kilogram', 'kilograms']);
add('mass', 0.001, ['g', 'gram', 'grams']);
add('mass', 1e-6, ['mg', 'milligram', 'milligrams']);
add('mass', 1e-9, ['μg', 'µg', 'ug', 'mcg', 'microgram', 'micrograms']);
add('mass', 1000, ['t', 'tonne', 'tonnes', 'metric ton', 'metric tons']);
add('mass', 0.45359237, ['lb', 'lbs', 'pound', 'pounds']);
add('mass', 0.028349523125, ['oz', 'ounce', 'ounces']);
add('mass', 6.35029318, ['st', 'stone', 'stones']);
add('mass', 907.18474, ['ton', 'tons', 'short ton', 'short tons']);
add('mass', 6.479891e-5, ['gr', 'grain', 'grains']);

// Time (seconds). A year is 365.25 days.
add('time', 1, ['s', 'sec', 'secs', 'second', 'seconds']);
add('time', 1e-3, ['ms', 'millisecond', 'milliseconds']);
add('time', 1e-6, ['μs', 'µs', 'us', 'microsecond', 'microseconds']);
add('time', 1e-9, ['ns', 'nanosecond', 'nanoseconds']);
add('time', 60, ['min', 'mins', 'minute', 'minutes']);
add('time', 3600, ['h', 'hr', 'hrs', 'hour', 'hours']);
add('time', 86400, ['d', 'day', 'days']);
add('time', 604800, ['wk', 'week', 'weeks']);
add('time', 31557600, ['yr', 'yrs', 'year', 'years']);

// Volume (cubic meters). US customary units.
add('volume', 1, ['m3', 'm³', 'cubic meter', 'cubic meters']);
add('volume', 1e-3, ['L', 'l', 'liter', 'liters', 'litre', 'litres']);
add('volume', 1e-6, ['mL', 'ml', 'milliliter', 'milliliters', 'cm3', 'cm³', 'cc']);
add('volume', 0.003785411784, ['gal', 'gallon', 'gallons']);
add('volume', 0.000946352946, ['qt', 'quart', 'quarts']);
add('volume', 0.000473176473, ['pt', 'pint', 'pints']);
add('volume', 0.0002365882365, ['cup', 'cups']);
add('volume', 2.95735295625e-5, ['floz', 'fl oz', 'fluid ounce', 'fluid ounces']);
add('volume', 1.478676478125e-5, ['tbsp', 'tablespoon', 'tablespoons']);
add('volume', 4.92892159375e-6, ['tsp', 'teaspoon', 'teaspoons']);
add('volume', 0.028316846592, ['ft3', 'ft³', 'cubic foot', 'cubic feet']);
add('volume', 1.6387064e-5, ['in3', 'in³', 'cubic inch', 'cubic inches']);
add('volume', 0.764554857984, ['yd3', 'yd³', 'cubic yard', 'cubic yards']);

// Area (square meters)
add('area', 1, ['m2', 'm²', 'square meter', 'square meters']);
add('area', 1e6, ['km2', 'km²']);
add('area', 1e-4, ['cm2', 'cm²']);
add('area', 1e-6, ['mm2', 'mm²']);
add('area', 0.09290304, ['ft2', 'ft²', 'sq ft', 'square foot', 'square feet']);
add('area', 0.00064516, ['in2', 'in²', 'sq in', 'square inch', 'square inches']);
add('area', 0.83612736, ['yd2', 'yd²', 'sq yd']);
add('area', 2589988.110336, ['mi2', 'mi²', 'sq mi', 'square mile', 'square miles']);
add('area', 4046.8564224, ['acre', 'acres']);
add('area', 10000, ['ha', 'hectare', 'hectares']);

// Speed (meters per second)
add('speed', 1, ['m/s', 'mps']);
add('speed', 1 / 3.6, ['km/h', 'kph', 'kmh', 'km/hr']);
add('speed', 0.44704, ['mph', 'mi/h', 'mi/hr']);
add('speed', 0.3048, ['ft/s', 'fps']);
add('speed', 1852 / 3600, ['knot', 'knots', 'kn', 'kt']);
add('speed', 0.00508, ['fpm', 'ft/min']);

// Temperature (kelvin), affine: K = (x + off) · k
add('temperature', 1, ['K', 'kelvin']);
add('temperature', 1, ['°C', 'C', 'degC', 'celsius'], 273.15);
add('temperature', 5 / 9, ['°F', 'F', 'degF', 'fahrenheit'], 459.67);
add('temperature', 5 / 9, ['°R', 'R', 'rankine']);

// Data (bits). kB/MB/GB/TB are powers of 1000; KiB/MiB/GiB/TiB are powers of 1024.
add('data', 1, ['b', 'bit', 'bits']);
add('data', 8, ['B', 'byte', 'bytes']);
add('data', 1e3, ['kb', 'kbit', 'kilobit', 'kilobits']);
add('data', 1e6, ['Mb', 'Mbit', 'megabit', 'megabits']);
add('data', 1e9, ['Gb', 'Gbit', 'gigabit', 'gigabits']);
add('data', 1e12, ['Tb', 'Tbit', 'terabit', 'terabits']);
add('data', 8e3, ['kB', 'KB', 'kilobyte', 'kilobytes']);
add('data', 8e6, ['MB', 'megabyte', 'megabytes']);
add('data', 8e9, ['GB', 'gigabyte', 'gigabytes']);
add('data', 8e12, ['TB', 'terabyte', 'terabytes']);
add('data', 8 * 2 ** 10, ['KiB', 'kibibyte', 'kibibytes']);
add('data', 8 * 2 ** 20, ['MiB', 'mebibyte', 'mebibytes']);
add('data', 8 * 2 ** 30, ['GiB', 'gibibyte', 'gibibytes']);
add('data', 8 * 2 ** 40, ['TiB', 'tebibyte', 'tebibytes']);

// Angle (radians)
add('angle', 1, ['rad', 'radian', 'radians']);
add('angle', Math.PI / 180, ['deg', '°', 'degree', 'degrees']);
add('angle', Math.PI / 200, ['grad', 'gon', 'gradian', 'gradians']);
add('angle', 2 * Math.PI, ['turn', 'turns', 'rev', 'revs', 'revolution', 'revolutions']);
add('angle', Math.PI / 10800, ['arcmin', 'arcminute', 'arcminutes']);
add('angle', Math.PI / 648000, ['arcsec', 'arcsecond', 'arcseconds']);

// Pressure (pascals). Gauge pressures convert by scale alone, so psi to kPa works for either kind of reading.
add('pressure', 1, ['Pa', 'pascal', 'pascals']);
add('pressure', 100, ['hPa']);
add('pressure', 1000, ['kPa']);
add('pressure', 1e6, ['MPa']);
add('pressure', 1e5, ['bar', 'bars']);
add('pressure', 100, ['mbar', 'millibar', 'millibars']);
add('pressure', 6894.757293168, ['psi', 'psig', 'psia', 'lb/in2']);
add('pressure', 101325, ['atm', 'atmosphere', 'atmospheres']);
add('pressure', 3386.389, ['inHg', 'in Hg', 'in. Hg', 'inches of mercury']);
add('pressure', 133.322387415, ['mmHg', 'mm Hg', 'torr', 'Torr']);
add('pressure', 0.133322387415, ['micronHg', 'microns Hg', 'mTorr', 'mtorr']);
add('pressure', 249.08891, ['inH2O', 'inwc', 'in wc', 'in. w.c.', 'in w.c.', 'wc', 'in H2O']);
add('pressure', 2989.06692, ['ftH2O', 'ftwc', 'ft wc', 'ft w.c.', 'ft H2O', 'ft of water', 'feet of water']);
add('pressure', 9.80665, ['mmH2O', 'mmwc', 'mm wc', 'mm H2O']);

// Power (watts). Btu are International Table.
add('power', 1, ['W', 'watt', 'watts']);
add('power', 1000, ['kW', 'kilowatt', 'kilowatts']);
add('power', 1e6, ['MW', 'megawatt', 'megawatts']);
add('power', 745.69987158227, ['hp', 'horsepower']);
add('power', 1055.05585262 / 3600, ['Btu/h', 'Btu/hr', 'BTU/h', 'BTU/hr', 'Btuh', 'BTUH']);
add('power', 1055.05585262 / 3.6, ['MBH', 'MBtu/h']);
const TON_OF_COOLING = add('power', (1055.05585262 / 3600) * 12000, ['TR', 'tonref', 'ton of refrigeration', 'tons of refrigeration', 'cooling ton', 'cooling tons']);

// Energy (joules)
add('energy', 1, ['J', 'joule', 'joules']);
add('energy', 1000, ['kJ', 'kilojoule', 'kilojoules']);
add('energy', 1e6, ['MJ', 'megajoule', 'megajoules']);
add('energy', 1e9, ['GJ', 'gigajoule', 'gigajoules']);
add('energy', 3600, ['Wh', 'watt hour', 'watt hours']);
add('energy', 3.6e6, ['kWh', 'kilowatt hour', 'kilowatt hours']);
add('energy', 3.6e9, ['MWh', 'megawatt hour', 'megawatt hours']);
add('energy', 4.184, ['cal', 'calorie', 'calories']);
add('energy', 4184, ['kcal', 'kilocalorie', 'kilocalories']);
add('energy', 1055.05585262, ['Btu', 'BTU', 'btu']);
add('energy', 105505585.262, ['therm', 'therms']);

// Volume flow (cubic meters per second). Gallons are US.
add('flow', 1, ['m3/s', 'm³/s']);
add('flow', 1 / 3600, ['m3/h', 'm³/h', 'm3/hr', 'm³/hr', 'cmh', 'CMH']);
add('flow', 1e-3, ['L/s', 'l/s', 'lps']);
add('flow', 1e-3 / 60, ['L/min', 'l/min', 'lpm']);
add('flow', 0.028316846592 / 60, ['CFM', 'cfm', 'ft3/min', 'ft³/min']);
add('flow', 0.003785411784 / 60, ['GPM', 'gpm', 'gal/min']);

// Specific enthalpy (joules per kilogram)
add('specific enthalpy', 1, ['J/kg']);
add('specific enthalpy', 1000, ['kJ/kg']);
add('specific enthalpy', 2326, ['Btu/lb', 'BTU/lb']);

// Humidity ratio (mass of water per mass of dry air)
add('humidity ratio', 1, ['kg/kg', 'lb/lb']);
add('humidity ratio', 1e-3, ['g/kg']);
add('humidity ratio', 1 / 7000, ['gr/lb', 'grains/lb']);

// Density (kilograms per cubic meter)
add('density', 1, ['kg/m3', 'kg/m³']);
add('density', 16.018463374, ['lb/ft3', 'lb/ft³']);

// Temperature difference (kelvin). A ΔT scales without the offset that a temperature has.
add('temperature difference', 1, ['dK', 'dC', 'delta K', 'delta C', 'ΔK', 'ΔC', 'Δ°C']);
add('temperature difference', 5 / 9, ['dF', 'delta F', 'ΔF', 'Δ°F']);

// Thermal resistance (m²·K/W) and transmittance (W/m²·K), in the units building envelopes are rated in.
add('thermal resistance', 1, ['RSI']);
add('thermal resistance', 0.17611018, ['R-value', 'Rvalue', 'R-IP']);
add('thermal transmittance', 1, ['USI', 'W/m2K', 'W/m²K']);
add('thermal transmittance', 5.6782633, ['U-value', 'Uvalue', 'U-IP', 'Btu/hft2F']);

function candidates(raw: string): Unit[] {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s in UNITS) return [UNITS[s]];
  const squeezed = s.replace(/ /g, '').replace(/\^2$/, '2').replace(/\^3$/, '3');
  if (squeezed in UNITS) return [UNITS[squeezed]];
  return LOWER[s.toLowerCase()] ?? LOWER[squeezed.toLowerCase()] ?? [];
}

function findUnit(raw: string): Unit | null {
  const hits = candidates(raw);
  return hits.length === 1 ? hits[0] : null;
}

function lookup(raw: string): Unit {
  const hits = candidates(raw);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    fail(`Unit "${raw}" is ambiguous. Use one of ${hits.map((u) => `"${u.name}"`).join(' or ')}${hits.every((u) => u.dim === 'data') ? ' (capital B is bytes, small b is bits)' : ''}`);
  }
  return fail(`Unknown unit "${raw}". Try units like m, ft, mi, kg, lb, L, gal, s, h, mph, °C, °F, MB, deg, psi, kW, Btu/h, CFM`);
}

const EXAMPLES: Record<string, string[]> = {
  length: ['ft', 'm', 'km', 'mi'], mass: ['kg', 'lb'], time: ['min', 's', 'h'], volume: ['L', 'gal'], temperature: ['°C', '°F'],
  speed: ['km/h', 'mph'], area: ['m2', 'ft2'], pressure: ['kPa', 'psi'], energy: ['kJ', 'Btu'], power: ['kW', 'Btu/h'],
};
export function otherUnit(raw: string): string | null {
  const u = findUnit(raw);
  for (const n of (u && EXAMPLES[u.dim]) ?? []) if (n in UNITS && UNITS[n] !== u) return n;
  return null;
}

export function unitKind(raw: string): string | null {
  return findUnit(raw)?.dim ?? null;
}

export function isUnit(raw: string): boolean {
  return findUnit(raw) !== null;
}

export function unitConverter(from: string, to: string): (x: number) => number {
  let a = lookup(from), b = lookup(to);
  // "ton" is mass until the other side is power, like convert(36000, "Btu/h", "ton").
  if (a.dim === 'power' && isTon(b)) b = TON_OF_COOLING;
  if (b.dim === 'power' && isTon(a)) a = TON_OF_COOLING;
  if (a.dim !== b.dim) fail(`Can't convert ${from} (${a.dim}) to ${to} (${b.dim}). Both units must measure the same thing`);
  if (a === b) return (x) => x;
  return (x) => {
    const mid = ((x + a.off) * a.k) / b.k;
    return snap(mid - b.off, Math.abs(mid));
  };
}

const isTon = (u: Unit): boolean => u === UNITS.ton;

/**
 * Round away float noise measured against the size of the intermediate value, not the result:
 * 0 °C → °F passes through 491.67 − 459.67, so the noise is a few ulps of 491.67.
 */
function snap(r: number, scale: number): number {
  if (!Number.isFinite(r) || r === 0) return r;
  const tol = Math.max(Math.abs(r), scale) * Number.EPSILON * 8;
  if (Math.abs(r) <= tol) return 0;
  for (let p = 1; p <= 13; p++) {
    const s = Number(r.toPrecision(p));
    if (Math.abs(s - r) <= tol) return s;
  }
  return r;
}

/**
 * "5 mi to km" (or in, into, as, →) written as convert(5, "mi", "km"), or null when the line isn't that or either unit
 * is unknown or ambiguous. Lines like this are worked out as the convert call they name.
 */
export function unitPhrase(text: string, known: (name: string) => boolean = isUnit): string | null {
  const m = /^\s*(?:convert\s+)?(-?(?:\d[\d,]*(?:\.\d*)?|\.\d+))\s*([^\s\d(),"=+*/^-][^\s(),"=+*^]*(?:\^\d)?)\s+(?:to|in|into|as|->|→)\s+([^\s(),"=+*^]+(?:\^\d)?)\s*$/i.exec(text);
  if (!m) return null;
  // m^2 is how a keyboard writes m², which the table knows as m2.
  const from = m[2].replace('^', ''), to = m[3].replace('^', '');
  if (!known(from) || !known(to)) return null;
  return `convert(${m[1].replace(/,/g, '')}, "${from}", "${to}")`;
}
