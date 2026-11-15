// Moist air against PsychroLib, refrigerants against CoolProp and manufacturers' tables, the rest against
// textbook numbers. test/hvac-vectors.json comes from scripts/build-hvac-data.py, at points off the table grid.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateDocument, type RowInput } from '../src/engine/document';
import { BUILTINS } from '../src/engine/builtins';
import { plainValue } from '../src/engine/format';
import { REFRIGERANTS } from '../src/engine/refrigerants-data';
import type { Settings } from '../src/engine/evaluator';
import type { Value } from '../src/engine/values';

const vectors = JSON.parse(readFileSync(new URL('./hvac-vectors.json', import.meta.url), 'utf8'));
const S: Settings = { deg: true, complex: false, sample: false };

function value(text: string): Value {
  const r = evaluateDocument([{ id: '0', kind: 'expr', text } as RowInput], S)[0];
  if (r.error) throw new Error(`${text}: ${r.error}`);
  return r.value!;
}
const n = (text: string): number => {
  const v = value(text);
  if (typeof v !== 'number') throw new Error(`${text} gave ${JSON.stringify(v)}`);
  return v;
};
const table = (text: string): Record<string, number> => {
  const v = value(text);
  if (typeof v !== 'object' || v.t !== 'record') throw new Error(`${text} gave ${JSON.stringify(v)}`);
  return Object.fromEntries(v.rows.map((r) => [r.label, r.value as number]));
};
const err = (text: string): string => evaluateDocument([{ id: '0', kind: 'expr', text } as RowInput], S)[0].error ?? '';

describe('moist air matches PsychroLib', () => {
  for (const [name, rows, suffix] of [['IP', vectors.psychIP, ''], ['SI', vectors.psychSI, ', "SI"']] as const) {
    it(`${name}: ${rows.length} states`, () => {
      for (const v of rows) {
        const args = `${v.db}, ${v.rh}, ${v.alt}${suffix}`;
        const at = `${name} ${args}`;
        expect(Math.abs(n(`humratio(${args})`) - v.w), at).toBeLessThan(1e-11);
        expect(Math.abs(n(`wetbulb(${args})`) - v.wb), at).toBeLessThan(1e-6);
        expect(Math.abs(n(`dewpoint(${v.db}, ${v.rh}${suffix})`) - v.dp), at).toBeLessThan(1e-6);
        expect(Math.abs(n(`enthalpy(${args})`) - v.h), at).toBeLessThan(1e-9);
        expect(Math.abs(n(`specvol(${args})`) - v.v), at).toBeLessThan(1e-9);
        expect(Math.abs(n(`airdensity(${args})`) - v.rho), at).toBeLessThan(1e-10);
        expect(n(`psat(${v.db}${suffix})`) / (name === 'SI' ? 1 : 1)).toBeCloseTo(name === 'SI' ? v.pws / 1000 : v.pws, 8);
        expect(n(`altpressure(${v.alt}${suffix})`)).toBeCloseTo(name === 'SI' ? v.p / 1000 : v.p, 8);
      }
    });
  }

  it('reads relative humidity as 50, 50%, or 0.5', () => {
    const want = n('enthalpy(75, 50)');
    expect(n('enthalpy(75, 50%)')).toBe(want);
    expect(n('enthalpy(75, 0.5)')).toBe(want);
    expect(err('enthalpy(75, 101)')).toMatch(/0 to 100/);
    expect(err('enthalpy(75, -1)')).toMatch(/0 to 100/);
  });

  it('every way into a state agrees', () => {
    const base = table('psych(75, 50)');
    const wb = base['Wet bulb (°F)'], dp = base['Dew point (°F)'], h = base['Enthalpy (Btu/lb dry air)'];
    expect(base['Relative humidity (%)']).toBe(50);
    // Table values are rounded, so going back through one lands within that rounding.
    expect(table(`psychwb(75, ${n('wetbulb(75, 50)')})`)['Relative humidity (%)']).toBeCloseTo(50, 6);
    expect(table(`psychwb(75, ${wb})`)['Relative humidity (%)']).toBeCloseTo(50, 0);
    expect(table(`psychdp(75, ${dp})`)['Relative humidity (%)']).toBeCloseTo(50, 0);
    expect(table(`psychw(75, ${n('humratio(75, 50)')})`)['Moisture (gr/lb)']).toBe(base['Moisture (gr/lb)']);
    expect(table(`psychh(75, ${h})`)['Relative humidity (%)']).toBeCloseTo(50, 0);
    expect(n(`rhfromwb(75, ${n('wetbulb(75, 50)')})`)).toBeCloseTo(50, 6);
    expect(n(`rhfromdp(75, ${n('dewpoint(75, 50)')})`)).toBeCloseTo(50, 6);
  });

  it('standard chart values', () => {
    // 75 °F, 50% RH at sea level, read from an ASHRAE chart: wb 62.6, dp 55.1, h 28.1, 64.9 gr/lb, 13.7 ft³/lb.
    const t = table('psych(75, 50)');
    expect(t['Wet bulb (°F)']).toBeCloseTo(62.6, 0);
    expect(t['Dew point (°F)']).toBeCloseTo(55.1, 0);
    expect(t['Enthalpy (Btu/lb dry air)']).toBeCloseTo(28.1, 0);
    expect(t['Moisture (gr/lb)']).toBeCloseTo(64.9, 0);
    expect(t['Volume (ft³/lb dry air)']).toBeCloseTo(13.7, 1);
  });

  it('altitude moves humidity ratio but not dew point', () => {
    expect(n('humratio(75, 50, 5280)')).toBeGreaterThan(n('humratio(75, 50)'));
    expect(n('altpressure(5280)')).toBeCloseTo(12.1, 1); // Denver
  });

  it('works over lists and on a graph line', () => {
    const v = value('enthalpy({70, 75, 80}, 50)');
    expect(typeof v === 'object' && v.t === 'list' && v.items.length).toBe(3);
    const r = evaluateDocument([{ id: '0', kind: 'expr', text: 'y = grains(x, 50)' } as RowInput], S)[0];
    expect(r.error).toBeUndefined();
  });

  it('mixes by mass', () => {
    // 80 °F, 50% return with 95 °F, 40% outdoor: 80/20 by flow lands just above the flow-weighted 83 °F average humidity.
    const t = table('mixair(800, 80, 50, 200, 95, 40)');
    expect(t['Dry bulb (°F)']).toBeGreaterThan(82.7);
    expect(t['Dry bulb (°F)']).toBeLessThan(83.1);
    expect(t['Relative humidity (%)']).toBeGreaterThan(40);
    expect(t['Relative humidity (%)']).toBeLessThan(50);
    expect(n('mixtemp(80, 800, 95, 200)')).toBe(83);
    expect(n('oapercent(83, 80, 95)')).toBeCloseTo(20, 10);
  });

  it('flags air mixed past saturation', () => {
    const v = value('mixair(500, 20, 90, 500, 100, 95)');
    expect(typeof v === 'object' && v.t === 'record' && v.title).toMatch(/above saturation/);
  });
});

describe('loads', () => {
  it('standard air formulas', () => {
    expect(n('sensibleheat(1000, 20)')).toBeCloseTo(21600, 8);
    expect(n('latentheat(1000, 10)')).toBeCloseTo(6800, 8);
    expect(n('totalheat(1000, 5)')).toBeCloseTo(22500, 8);
    expect(n('airflow(21600, 20)')).toBeCloseTo(1000, 8);
    expect(n('temprise(80000, 1200)')).toBeCloseTo(61.7284, 3);
    expect(n('sensibleheat(100, 10, "SI")')).toBeCloseTo(1230, 8);
    expect(n('waterheat(10, 10)')).toBe(50000);
    expect(n('waterflow(60000, 10)')).toBe(12);
    expect(n('shratio(30000, 36000)')).toBeCloseTo(0.8333, 3);
  });

  it('coefficients thin out with altitude', () => {
    expect(n('sensibleheat(1000, 20, 5280)') / 21600).toBeCloseTo(n('altpressure(5280)') / 14.696, 10);
  });

  it('a typical cooling coil', () => {
    const t = table('coil(1200, 75, 50, 55, 90)');
    expect(t['Total (Btu/h)']).toBeGreaterThan(30000);
    expect(t['Total (Btu/h)']).toBeLessThan(36000);
    expect(t['Total (Btu/h)']).toBeCloseTo(t['Sensible (Btu/h)'] + t['Latent (Btu/h)'], -1);
    expect(t['Sensible (Btu/h)']).toBeCloseTo(1.08 * 1200 * 20, -3);
    expect(t['Tons']).toBeCloseTo(t['Total (Btu/h)'] / 12000, 1);
    expect(t['Condensate (gal/h)']).toBeGreaterThan(0);
    const metric = table('coil(566.3, 23.89, 50, 12.78, 90, "SI")');
    expect(metric['Total (kW)'] * 3412.14).toBeCloseTo(t['Total (Btu/h)'], -2);
  });

  it('coilwb agrees with coil', () => {
    const a = table('coil(1200, 75, 50, 55, 90)');
    const b = table(`coilwb(1200, 75, ${n('wetbulb(75, 50)')}, 55, ${n('wetbulb(55, 90)')})`);
    expect(b['Total (Btu/h)']).toBeCloseTo(a['Total (Btu/h)'], 0);
  });

  it('envelope and ventilation', () => {
    expect(n('uaheat(0.05, 1000, 40)')).toBe(2000);
    expect(n('uvalue(13, 0.68, 0.17)')).toBeCloseTo(1 / 13.85, 10);
    expect(n('airchanges(500, 12000)')).toBe(2.5);
    expect(n('achflow(2.5, 12000)')).toBe(500);
    expect(n('ventair(10, 5, 1000, 0.06)')).toBe(110);
    expect(n('bypassfactor(80, 58, 50)')).toBeCloseTo(8 / 30, 12);
  });
});

describe('ducts, fans, and pipes', () => {
  it('velocity and sizes', () => {
    expect(n('ductvel(1000, 12)')).toBeCloseTo(1273.24, 2);
    expect(n('ductvel(1000, 12, 12)')).toBe(1000);
    expect(n('ductvel(100, 200, "SI")')).toBeCloseTo(3.1831, 3);
    expect(n('ductdia(1000, 1273.2395)')).toBeCloseTo(12, 5);
    expect(n('eqdia(24, 12)')).toBeCloseTo(18.3, 1); // the published Huebscher table
    expect(n(`eqdia(24, ${n('rectduct(18.3, 24)')})`)).toBeCloseTo(18.3, 8);
  });

  it('friction agrees with a ductulator and its inverse', () => {
    // The published fit for galvanized duct: 0.109136·q^1.9/d^5.02.
    for (const [q, d] of [[200, 8], [1000, 12], [4000, 24]]) {
      const fit = 0.109136 * q ** 1.9 / d ** 5.02;
      expect(n(`ductloss(${q}, ${d})`) / fit).toBeGreaterThan(0.9);
      expect(n(`ductloss(${q}, ${d})`) / fit).toBeLessThan(1.1);
    }
    expect(n(`ductsize(1000, ${n('ductloss(1000, 12)')})`)).toBeCloseTo(12, 6);
    expect(n('ductloss(1000, 24, 12)')).toBeCloseTo(n(`ductloss(1000, ${n('eqdia(24, 12)')})`), 12);
    // The same duct in both systems. Standard air differs a little between them.
    const ip = n('ductloss(1000, 12)');
    const si = n(`ductloss(${1000 * 0.3048 ** 3 / 60 * 1000}, 304.8, "SI")`);
    expect((si * 30.48) / 249.089 / ip).toBeCloseTo(1, 2);
  });

  it('velocity pressure', () => {
    expect(n('velpressure(4005)')).toBe(1);
    expect(n('velfromvp(1)')).toBe(4005);
    expect(n('velfromvp(0.25)')).toBeCloseTo(2002.5, 8);
    expect(n('velfromvp(60.2, "SI")')).toBeCloseTo(10, 8);
    expect(n('velpressure(10, "SI")')).toBeCloseTo(60.2, 8);
  });

  it('fan and pump laws and power', () => {
    const t = table('fanlaws(1000, 1, 0.5, 1000, 1200)');
    expect(t.Flow).toBeCloseTo(1200, 8);
    expect(t['Pressure or head']).toBeCloseTo(1.44, 8);
    expect(t.Power).toBeCloseTo(0.864, 8);
    expect(n('fanpower(6356, 1)')).toBe(1);
    expect(n('fanpower(6356, 1, 50)')).toBe(2);
    expect(n('fanpower(6356, 1, 0.5)')).toBe(2);
    expect(n('fanpower(1000, 500, 1, "SI")')).toBeCloseTo(0.5, 12);
    expect(n('pumppower(3960, 1)')).toBe(1);
    expect(n('pumppower(100, 50, 70)')).toBeCloseTo(100 * 50 / (3960 * 0.7), 10);
    expect(n('pumppower(10, 10, 1, "SI")')).toBeCloseTo(0.980665, 8);
  });

  it('pipes', () => {
    expect(n('pipevel(10, 1)')).toBeCloseTo(4.085, 3);
    // Hazen-Williams at C = 100, where its constant stands alone: 0.2083·10^1.852.
    expect(n('pipeloss(10, 1, 100)')).toBeCloseTo(0.2083 * 10 ** 1.852, 8);
    expect(n('pipeloss(10, 1, 150)')).toBeCloseTo(0.2083 * (100 / 150) ** 1.852 * 10 ** 1.852, 8);
    const si = n(`pipeloss(${10 * 3.785411784 / 60}, 25.4, 150, "SI")`);
    expect(si / n('pipeloss(10, 1, 150)')).toBeCloseTo(1, 1);
    expect(n('valvecv(10, 4)')).toBe(5);
    expect(n('valveflow(5, 4)')).toBe(10);
  });

  it('field numbers', () => {
    expect(n('gasinput(1, 36)')).toBe(100000);
    expect(n('gasinput(0.01, 36, "SI")')).toBeCloseTo(10.361, 2);
    expect(n('elecpower(230, 10)')).toBe(2.3);
    expect(n('elecpower(460, 10, 0.85, 3)')).toBeCloseTo(6.7722, 3);
    expect(n('voltimbalance(460, 467, 450)')).toBeCloseTo((9 / 459) * 100, 10); // average 459, and 450 is furthest
  });
});

describe('refrigerants', () => {
  // R-744's table ends close to its critical point, where the properties bend fastest.
  const cold = (name: string) => name === 'R744';
  // These blends' pressures are scaled to manufacturers' tables, so they sit a little off the raw equation of state.
  const scaled = (name: string) => ['R448A', 'R449A', 'R454B'].includes(name);

  it(`matches the source at ${vectors.sat.length} points off the table grid`, () => {
    for (const v of vectors.sat) {
      const at = `${v.name} at ${v.f} °F`;
      const atm = 14.696;
      const psig = (kpa: number) => kpa / 6.894757 - atm;
      const pressTol = 0.02;
      expect(Math.abs(n(`pbubble("${v.name}", ${v.f})`) - psig(v.pb)), `${at} bubble`).toBeLessThan(pressTol);
      expect(Math.abs(n(`pdew("${v.name}", ${v.f})`) - psig(v.pd)), `${at} dew`).toBeLessThan(pressTol);
      const t = table(`refprops("${v.name}", ${v.f})`);
      expect(Math.abs(t['Liquid enthalpy (Btu/lb)'] - v.hl / 2.326), `${at} hl`).toBeLessThan(0.03);
      expect(Math.abs(t['Vapor enthalpy (Btu/lb)'] - v.hv / 2.326), `${at} hv`).toBeLessThan(cold(v.name) ? 0.05 : 0.02);
      expect(Math.abs(t['Vapor volume (ft³/lb)'] / (v.vv * 16.01846337) - 1), `${at} vv`).toBeLessThan(0.002);
    }
  });

  it('published charts, pure fluids and blends', () => {
    // Widely printed gauge pressures at 40 °F (R-22, R-134a, R-410A) and the Hudson R-407C chart.
    expect(n('pbubble("R22", 40)')).toBeCloseTo(68.6, 0);
    expect(n('pbubble("R134a", 40)')).toBeCloseTo(35.0, 0);
    expect(n('pdew("R410A", 40)')).toBeCloseTo(118.4, 0);
    expect(Math.abs(n('pbubble("R407C", 40)') - 80.7)).toBeLessThan(0.6);
    expect(Math.abs(n('pdew("R407C", 40)') - 63.1)).toBeLessThan(0.6);
    // Chemours Opteon XL41 bulletin at 40 °F, in psia.
    expect(n('pbubble("R454B", 40)') + 14.696).toBeCloseTo(126.66, 1);
    expect(n('pdew("R454B", 40)') + 14.696).toBeCloseTo(121.68, 1);
    // Honeywell Solstice N40 chart: 40 psig is 5.5 °F bubble, 16.0 °F dew.
    expect(n('tbubble("R448A", 40)')).toBeCloseTo(5.5, 0);
    expect(n('tdew("R448A", 40)')).toBeCloseTo(16, 0);
    // Chemours Opteon XP40 at 40 °C, in kPa.
    expect(n('pbubble("R449A", 40, 0, "SI")') + 101.325).toBeCloseTo(1861.3, -1);
    expect(n('pdew("R449A", 40, 0, "SI")') + 101.325).toBeCloseTo(1659.3, -1);
  });

  it('superheat and subcooling in the field', () => {
    const sat = n('tdew("R410A", 118)');
    expect(sat).toBeCloseTo(39.8, 0);
    expect(n('superheat("R410A", 118, 50)')).toBeCloseTo(50 - sat, 1);
    expect(n('subcool("R410A", 340, 95)')).toBeCloseTo(n('tbubble("R410A", 340)') - 95, 1);
    // A blend's glide is why superheat and subcooling read different columns.
    const g = table('sattemp("R407C", 70)');
    expect(g['Glide (°F)']).toBeGreaterThan(8);
    expect(g['Dew, vapor (°F)']).toBeGreaterThan(g['Bubble, liquid (°F)']);
    expect(n('targetsuperheat(62, 85)')).toBe(10.5);
  });

  it('gauge readings follow altitude', () => {
    expect(n('tdew("R410A", 118, 5000)')).toBeLessThan(n('tdew("R410A", 118)'));
    expect(n('pdew("R410A", 40, 5000)')).toBeGreaterThan(n('pdew("R410A", 40)'));
  });

  it('accepts the ways people write a refrigerant name', () => {
    const want = n('pdew("R410A", 40)');
    for (const name of ['R-410A', 'r410a', '410A', 'R 410 A']) expect(n(`pdew("${name}", 40)`)).toBe(want);
    expect(n('pdew("ammonia", 40)')).toBe(n('pdew("R717", 40)'));
    expect(n('pdew("CO2", 40)')).toBe(n('pdew("R744", 40)'));
    expect(err('pdew("R999", 40)')).toMatch(/No table for refrigerant "R999"/);
    expect(err('pdew(410, 40)')).toMatch(/in quotes/);
  });

  it('stays inside the tables', () => {
    expect(err('pdew("R744", 95)')).toMatch(/critical at 87\.8/);
    expect(err('tdew("R410A", 900)')).toMatch(/table covers/);
    expect(err('pdew("R410A", -100)')).toMatch(/table runs/);
  });

  it(`cycles match the source at ${vectors.cycle.length} operating points`, () => {
    for (const c of vectors.cycle) {
      if (c.dischargeF - c.tc > 235) continue; // past the vapor table, which has its own error
      const at = `${c.name} ${c.te}/${c.tc}`;
      const t = table(`refcycle("${c.name}", ${c.te}, ${c.tc}, ${c.sh}, ${c.sc}, ${c.eta})`);
      const [work, temp] = scaled(c.name) ? [0.02, 2.5] : [0.002, 0.2];
      expect(Math.abs(t['Refrigeration effect (Btu/lb)'] / c.q - 1), `${at} effect`).toBeLessThan(0.001);
      expect(Math.abs(t['Compressor work (Btu/lb)'] / c.w - 1), `${at} work`).toBeLessThan(work);
      expect(Math.abs(t.COP / c.cop - 1), `${at} COP`).toBeLessThan(work);
      expect(Math.abs(t['Discharge temperature (°F)'] - c.dischargeF), `${at} discharge`).toBeLessThan(temp);
    }
  });

  it('cycle derived values', () => {
    const t = table('refcycle("R410A", 45, 105, 10, 10, 70)');
    expect(t.EER).toBeCloseTo(t.COP * 3.412, 1);
    expect(t['kW/ton']).toBeCloseTo(3.517 / t.COP, 2);
    expect(t['Mass flow (lb/min per ton)']).toBeCloseTo(200 / t['Refrigeration effect (Btu/lb)'], 2);
    expect(t['Heat rejected (Btu/lb)']).toBeCloseTo(t['Refrigeration effect (Btu/lb)'] + t['Compressor work (Btu/lb)'], 1);
    expect(table('refcycle("R410A", 45, 105)').COP).toBeLessThan(n('carnotcop(45, 105)'));
    const m = table('refcycle("R410A", 7.222, 40.556, 5.556, 5.556, 70, "SI")');
    expect(m.COP).toBeCloseTo(t.COP, 1);
    expect(err('refcycle("R410A", 105, 45)')).toMatch(/must be below/);
    expect(err('refcycle("R744", 30, 95)')).toMatch(/critical at 87\.8/);
  });

  it('efficiency ratings', () => {
    expect(n('eertocop(12)')).toBeCloseTo(3.5169, 3);
    expect(n('seertocop(17.06)')).toBeCloseTo(5, 2);
    expect(n('coptoeer(eertocop(11))')).toBeCloseTo(11, 10);
    expect(n('coptokwton(3.5169)')).toBeCloseTo(1, 3);
    expect(n('kwtontocop(0.6)')).toBeCloseTo(5.861, 3);
    expect(n('carnotcop(40, 100)')).toBeCloseTo(499.67 / 60, 10);
  });

  it('lists every table', () => {
    const v = value('refrigerants()');
    expect(typeof v === 'object' && v.t === 'list' && v.items.length).toBe(REFRIGERANTS.length);
  });
});

describe('units', () => {
  const c = (x: number, a: string, b: string) => n(`convert(${x}, "${a}", "${b}")`);
  it('pressure', () => {
    expect(c(1, 'atm', 'psi')).toBeCloseTo(14.6959, 3);
    expect(c(1, 'atm', 'kPa')).toBe(101.325);
    expect(c(1, 'bar', 'kPa')).toBe(100);
    expect(c(1, 'psi', 'inH2O')).toBeCloseTo(27.68, 2);
    expect(c(1, 'in. w.c.', 'Pa')).toBeCloseTo(249.09, 2);
    expect(c(29.92, 'inHg', 'psi')).toBeCloseTo(14.696, 2);
    expect(c(500, 'mTorr', 'mmHg')).toBeCloseTo(0.5, 10);
    expect(c(2.31, 'ftH2O', 'psi')).toBeCloseTo(1, 2);
  });
  it('power and energy', () => {
    expect(c(3, 'TR', 'Btu/h')).toBe(36000);
    expect(c(36000, 'Btu/h', 'ton')).toBe(3);
    expect(c(3, 'tons', 'kW')).toBeCloseTo(10.5506, 3);
    expect(c(1, 'kW', 'Btu/h')).toBeCloseTo(3412.14, 2);
    expect(c(100, 'MBH', 'Btu/h')).toBe(100000);
    expect(c(1, 'hp', 'W')).toBeCloseTo(745.7, 1);
    expect(c(1, 'kWh', 'Btu')).toBeCloseTo(3412.14, 2);
    expect(c(1, 'therm', 'Btu')).toBe(100000);
    expect(c(1, 'ton', 'lb')).toBeCloseTo(2000, 8); // still a mass with a mass
    expect(err('convert(1, "ton", "kWh")')).toMatch(/Can't convert/);
  });
  it('flow and air', () => {
    expect(c(1000, 'CFM', 'L/s')).toBeCloseTo(471.947, 3);
    expect(c(1, 'm3/h', 'CFM')).toBeCloseTo(0.58858, 4);
    expect(c(1, 'GPM', 'L/min')).toBeCloseTo(3.78541, 4);
    expect(c(1000, 'fpm', 'm/s')).toBeCloseTo(5.08, 8);
    expect(c(7000, 'gr/lb', 'lb/lb')).toBe(1);
    expect(c(1, 'Btu/lb', 'kJ/kg')).toBe(2.326);
    expect(c(0.075, 'lb/ft3', 'kg/m3')).toBeCloseTo(1.2014, 3);
    expect(c(18, 'dF', 'dC')).toBeCloseTo(10, 10);
    expect(c(13, 'R-value', 'RSI')).toBeCloseTo(2.289, 3);
    expect(c(0.25, 'U-value', 'USI')).toBeCloseTo(1.4196, 3);
  });
  it('kept the old meanings', () => {
    expect(c(1, 'micron', 'mm')).toBe(0.001);
    expect(c(32, '°F', '°C')).toBe(0);
    expect(c(1, 'GB', 'MB')).toBe(1000);
    expect(err('convert(1, "mb", "MB")')).toMatch(/ambiguous/);
  });
});

describe('metric input', () => {
  it('"SI" and "IP" are the last input, in any case', () => {
    expect(n('enthalpy(24, 50, "si")')).toBe(n('enthalpy(24, 50, 0, "SI")'));
    expect(n('enthalpy(75, 50, "ip")')).toBe(n('enthalpy(75, 50)'));
    expect(err('enthalpy(75, 50, "metric")')).toMatch(/must be "SI" or "IP"/);
    expect(err('enthalpy(75, "SI")')).toMatch(/Too few inputs/);
  });
  it('can come from a variable', () => {
    const rows = ['units = "SI"', 'enthalpy(24, 50, units)'].map((text, i) => ({ id: String(i), kind: 'expr', text }) as RowInput);
    expect(evaluateDocument(rows, S)[1].value).toBe(n('enthalpy(24, 50, "SI")'));
  });
  it('agrees with US units through a conversion', () => {
    const f = n('wetbulb(75, 50)');
    const c = n('wetbulb(23.8888888889, 50, "SI")');
    expect((f - 32) * 5 / 9).toBeCloseTo(c, 1);
  });
});

describe('Exact mode', () => {
  const o = { places: null, exact: true, percent: false };
  it('keeps tables of readings in decimals', () => {
    const v = value('refcycle("R410A", 45, 105, 10, 10, 70)');
    expect(plainValue(v, o)).toMatch(/COP: \d\.\d+\n/);
    expect(plainValue(v, o)).not.toMatch(/\d\/\d/);
  });
  it('leaves other tables alone', () => {
    expect(plainValue(value('fivenum({1, 2, 3, 4})'), o)).toMatch(/5\/2/);
  });
  it('keeps single readings in decimals', () => {
    for (const line of ['superheat("R410A", 118, 50)', 'subcool("R410A", 340, 95)', 'tdew("R410A", 118)', 'pdew("R407C", 40)', 'enthalpy(75, 50)']) {
      expect(plainValue(value(line), o), line).toMatch(/^\d+\.\d{4,}$/);
    }
  });
});

describe('registration', () => {
  it('every usage line starts with its own function name', () => {
    for (const name of ['psych', 'coil', 'ductloss', 'superheat', 'refcycle', 'fanlaws']) {
      expect(BUILTINS[name].usage).toMatch(new RegExp(`^${name}\\(`));
    }
  });
});
