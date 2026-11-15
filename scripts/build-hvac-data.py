#!/usr/bin/env python3
"""Generates src/engine/refrigerants-data.ts and test/hvac-vectors.json.

    pip install CoolProp psychrolib
    python scripts/build-hvac-data.py

Refrigerant properties come from CoolProp's Helmholtz equations of state. Three blends use estimated
mixing parameters there, so their saturation pressures are scaled to the manufacturers' published tables.
Test vectors are computed directly from CoolProp and PsychroLib at points off the app's table grid.
"""
import json
import math
import os

import CoolProp.CoolProp as CP
import psychrolib as PL

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

# name, CoolProp fluid (pure) or mass fractions (blend), other spellings
FLUIDS = [
    ('R12', 'R12', []),
    ('R22', 'R22', []),
    ('R123', 'R123', []),
    ('R134a', 'R134a', []),
    ('R32', 'R32', []),
    ('R290', 'n-Propane', ['propane']),
    ('R404A', 'R404A', []),
    ('R407C', 'R407C', []),
    ('R410A', 'R410A', []),
    ('R448A', {'R32': 0.24, 'R125': 0.25, 'R1234yf': 0.20, 'R134a': 0.21, 'R1234ze(E)': 0.10}, []),
    ('R449A', {'R32': 0.243, 'R125': 0.247, 'R1234yf': 0.253, 'R134a': 0.257}, []),
    ('R454B', {'R32': 0.689, 'R1234yf': 0.311}, []),
    ('R507A', 'R507A', []),
    ('R513A', {'R1234yf': 0.56, 'R134a': 0.44}, []),
    ('R600a', 'IsoButane', ['isobutane']),
    ('R717', 'Ammonia', ['ammonia', 'NH3']),
    ('R744', 'CO2', ['CO2', 'carbon dioxide']),
    ('R1233zd', 'R1233zd(E)', ['R1233zdE']),
    ('R1234yf', 'R1234yf', []),
    ('R1234ze', 'R1234ze(E)', ['R1234zeE']),
]

# Critical temperatures (°F) from the manufacturers' data sheets, because CoolProp finds two for these mixtures.
CRITICAL = {'R448A': 182.7, 'R449A': 178.7, 'R454B': 172.6, 'R513A': 205.7}

# Manufacturers' saturation tables: Chemours Opteon XL41 and XP40 bulletins, Honeywell Solstice N40 chart.
PUBLISHED = {
    'R454B': ('F psia', [[-40, 24.23, 23.09], [-20, 39.01, 37.25], [0, 59.97, 57.38], [20, 88.64, 84.97], [40, 126.66, 121.68], [60, 175.84, 169.31], [80, 238.08, 229.86], [100, 315.47, 305.56], [120, 410.36, 399.03], [140, 525.41, 513.54], [160, 664.04, 654.04]]),
    'R449A': ('C kPa', [[-60, 48.9, 33.977], [-50, 83.137, 60.314], [-40, 134.175, 100.945], [-30, 207.078, 160.69], [-20, 307.495, 245.066], [-10, 441.584, 360.238], [0, 615.942, 512.986], [10, 837.558, 710.719], [20, 1113.783, 961.536], [30, 1452.326, 1274.375], [40, 1861.299, 1659.303], [50, 2349.297, 2128.113], [60, 2925.507, 2695.661], [70, 3599.35, 3383.92]]),
    'R448A': ('psig F', [[0.0, -51.0, -39.9], [1.0, -48.6, -37.5], [2.0, -46.2, -35.2], [3.0, -44.0, -32.9], [4.0, -41.9, -30.8], [5.0, -39.8, -28.8], [6.0, -37.8, -26.9], [7.0, -35.9, -25.0], [8.0, -34.1, -23.2], [9.0, -32.4, -21.4], [10.0, -30.6, -19.7], [11.0, -29.0, -18.1], [12.0, -27.4, -16.5], [13.0, -25.8, -15.0], [14.0, -24.3, -13.5], [16.0, -21.4, -10.6], [18.0, -18.6, -7.8], [20.0, -16.0, -5.2], [22.0, -13.5, -2.7], [24.0, -11.0, -0.3], [26.0, -8.7, 2.0], [28.0, -6.5, 4.2], [29.0, -5.4, 5.3], [31.0, -3.3, 7.4], [34.0, -0.2, 10.4], [37.0, 2.7, 13.3], [40.0, 5.5, 16.0], [43.0, 8.2, 18.7], [46.0, 10.8, 21.2], [49.0, 13.2, 23.7], [52.0, 15.6, 26.0], [55.0, 17.9, 28.3], [59.0, 20.9, 31.2], [63.0, 23.8, 34.0], [67.0, 26.5, 36.7], [83.0, 36.5, 46.6], [101.0, 46.5, 56.3], [121.0, 56.2, 65.9], [142.0, 65.4, 74.9], [154.0, 70.2, 79.6], [167.0, 75.1, 84.4], [181.0, 80.2, 89.3], [196.0, 85.3, 94.3], [212.0, 90.5, 99.3], [229.0, 95.7, 104.3], [246.0, 100.7, 109.1], [264.0, 105.6, 113.9], [284.0, 110.9, 119.0], [304.0, 115.9, 123.8], [325.0, 121.0, 128.6], [348.0, 126.2, 133.6], [349.0, 126.4, 133.8], [372.0, 131.4, 138.5], [397.0, 136.6, 143.4], [423.0, 141.8, 148.3], [450.0, 146.9, 153.0]]),
}

T_MIN = -60  # °F
T_MAX = 200
SAT_STEP = 10
SH_T_STEP = 20
SUPERHEATS = [0, 15, 30, 50, 75, 100, 140, 180, 240]  # °F above the dew point
PSIA = 6.894757  # kPa
ATM = 14.696
KGM3_PER_LBFT3 = 16.01846337


def K(f):
    return (f + 459.67) * 5 / 9


class Fluid:
    def __init__(self, name, spec):
        self.name = name
        self.blend = isinstance(spec, dict)
        if self.blend:
            self.s = CP.AbstractState('HEOS', '&'.join(spec))
            self.s.set_mass_fractions(list(spec.values()))
        else:
            self.s = CP.AbstractState('HEOS', spec)
        self.tc = CRITICAL[name] if self.blend else self.s.T_critical() * 9 / 5 - 459.67
        self.s.update(CP.QT_INPUTS, 0, K(-40))
        self.h0, self.s0 = self.s.hmass(), self.s.smass()
        self.scale = self.published_scale()

    def sat(self, f, q):
        self.s.update(CP.QT_INPUTS, q, K(f))
        return self.s.p() / 1000, (self.s.hmass() - self.h0) / 1000, (self.s.smass() - self.s0) / 1000, 1 / self.s.rhomass()

    def raw_pressure(self, f, q):
        return self.sat(f, q)[0]

    def published_scale(self):
        """(°F, bubble ratio, dew ratio) knots, published pressure over CoolProp pressure."""
        if self.name not in PUBLISHED:
            return None
        kind, rows = PUBLISHED[self.name]
        knots = []
        if kind == 'F psia':
            for t, pl, pv in rows:
                self.knot(knots, t, pl * PSIA, pv * PSIA)
        elif kind == 'C kPa':
            for t, pl, pv in rows:
                self.knot(knots, t * 9 / 5 + 32, pl, pv)
        else:  # psig, bubble °F, dew °F
            pts = sorted(rows)
            bub = sorted((b, p + ATM) for p, b, d in pts)
            dew = sorted((d, p + ATM) for p, b, d in pts)
            for f in range(-40, 141, 10):
                self.knot(knots, f, lerp(bub, f) * PSIA, lerp(dew, f) * PSIA)
        return sorted(knots)

    def knot(self, knots, f, bubble, dew):
        try:
            knots.append((f, bubble / self.raw_pressure(f, 0), dew / self.raw_pressure(f, 1)))
        except ValueError:
            pass  # past where the mixture solver reaches; the table stops before here too

    def pressure(self, f, q):
        p = self.raw_pressure(f, q)
        if self.scale:
            p *= lerp([(k[0], k[1 + q]) for k in self.scale], f)
        return p

    def vapor(self, dew_f, superheat):
        """Superheated vapor at the raw dew pressure of dew_f."""
        if superheat == 0:
            return self.sat(dew_f, 1)[1:]
        p = self.raw_pressure(dew_f, 1)
        self.s.specify_phase(CP.iphase_gas)
        try:
            self.s.update(CP.PT_INPUTS, p * 1000, K(dew_f + superheat))
            return (self.s.hmass() - self.h0) / 1000, (self.s.smass() - self.s0) / 1000, 1 / self.s.rhomass()
        finally:
            self.s.unspecify_phase()

    def cycle(self, te, tc, sh, sc, eta):
        """The same vapor-compression cycle as refcycle(), directly from the equation of state."""
        pe = self.raw_pressure(te, 1) * 1000
        pc = self.raw_pressure(tc, 0) * 1000
        self.s.specify_phase(CP.iphase_gas)
        self.s.update(CP.PT_INPUTS, pe, K(te + sh))
        h1, s1, v1 = self.s.hmass(), self.s.smass(), 1 / self.s.rhomass()
        self.s.unspecify_phase()
        self.s.update(CP.PSmass_INPUTS, pc, s1)
        h2s = self.s.hmass()
        self.s.update(CP.QT_INPUTS, 0, K(tc - sc))
        h3 = self.s.hmass()
        w = (h2s - h1) / eta
        self.s.update(CP.HmassP_INPUTS, h1 + w, pc)
        t2 = self.s.T() * 9 / 5 - 459.67
        q = h1 - h3
        return {'q': q / 2326, 'w': w / 2326, 'cop': q / w, 'dischargeF': t2, 'v1': v1 * KGM3_PER_LBFT3}


def lerp(pts, x):
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0) if x1 > x0 else y0
    return pts[-1][1]


def sig(x, n):
    if x == 0:
        return '0'
    d = n - 1 - math.floor(math.log10(abs(x)))
    r = round(x, d)
    s = f'{r:.{max(d, 0)}f}'
    if '.' in s:
        s = s.rstrip('0').rstrip('.')
    if s.startswith('0.'):
        s = s[1:]
    elif s.startswith('-0.'):
        s = '-' + s[2:]
    return s or '0'


def arr(xs, f):
    return '[' + ','.join(f(x) for x in xs) + ']'


def table(name, spec, aka):
    fl = Fluid(name, spec)
    # The last grid temperature below critical and T_MAX. A blend's solver can stop short of that.
    top = T_MIN
    for t in range(T_MIN, T_MAX + 1):
        if t >= fl.tc - 3:
            break
        try:
            for q in (0, 1):
                fl.sat(t, q)
        except ValueError:
            break
        if (t - T_MIN) % SAT_STEP == 0:
            top = t
    ts = list(range(T_MIN, top + 1, SAT_STEP))
    pb = [fl.pressure(t, 0) for t in ts]
    pd = [fl.pressure(t, 1) for t in ts]
    liq = [fl.sat(t, 0) for t in ts]
    vap = [fl.sat(t, 1) for t in ts]
    gas = []
    gas_top = math.floor(top / SH_T_STEP) * SH_T_STEP
    for t in range(T_MIN, gas_top + 1, SH_T_STEP):
        gas.append([fl.vapor(t, sh) for sh in SUPERHEATS])
    fl.top = top
    lines = [
        f"  {{ name: '{name}', aka: {json.dumps(aka)}, tc: {fl.tc:.1f}, top: {top},",
        f"    pb: {arr(pb, lambda x: sig(x, 6))},",
    ]
    if any(abs(a - b) > 1e-6 * b for a, b in zip(pb, pd)):
        lines.append(f"    pd: {arr(pd, lambda x: sig(x, 6))},")
    lines += [
        f"    hl: {arr([x[1] for x in liq], lambda x: f'{x:.2f}')},",
        f"    sl: {arr([x[2] for x in liq], lambda x: f'{x:.4f}')},",
        f"    dl: {arr([1 / x[3] for x in liq], lambda x: f'{x:.1f}')},",
        f"    hv: {arr([x[1] for x in vap], lambda x: f'{x:.2f}')},",
        f"    sv: {arr([x[2] for x in vap], lambda x: f'{x:.4f}')},",
        f"    vv: {arr([x[3] for x in vap], lambda x: sig(x, 5))},",
        f"    gh: {arr(gas, lambda row: arr([c[0] for c in row], lambda x: f'{x:.2f}'))},",
        f"    gs: {arr(gas, lambda row: arr([c[1] for c in row], lambda x: f'{x:.4f}'))},",
        f"    gv: {arr(gas, lambda row: arr([c[2] for c in row], lambda x: sig(x, 5)))},",
        "  },",
    ]
    return fl, '\n'.join(lines)


def vectors(fluids):
    out = {'sat': [], 'cycle': [], 'psychIP': [], 'psychSI': []}
    for fl in fluids:
        for t in (-37, -13, 3, 27, 43, 67, 87, 113, 137):
            if t > fl.top - 3:
                continue
            liq, vap = fl.sat(t, 0), fl.sat(t, 1)
            out['sat'].append({'name': fl.name, 'f': t, 'pb': fl.pressure(t, 0), 'pd': fl.pressure(t, 1), 'hl': liq[1], 'hv': vap[1], 'vv': vap[3]})
        for te, tc, sh, sc, eta in ((43, 103, 12, 9, 0.7), (17, 87, 25, 7, 1.0), (-13, 77, 35, 11, 0.65)):
            if tc > fl.top - 3:
                tc = fl.top - 13
            try:
                out['cycle'].append({'name': fl.name, 'te': te, 'tc': tc, 'sh': sh, 'sc': sc, 'eta': eta, **fl.cycle(te, tc, sh, sc, eta)})
            except ValueError:
                pass

    def psych(unit, rows, conv):
        PL.SetUnitSystem(unit)
        PL.PSYCHROLIB_TOLERANCE = 1e-9
        for db, rh, alt in rows:
            p = PL.GetStandardAtmPressure(alt)
            w = PL.GetHumRatioFromRelHum(db, rh, p)
            yield {
                'db': db, 'rh': rh, 'alt': alt, 'p': p, 'w': w,
                'wb': PL.GetTWetBulbFromRelHum(db, rh, p), 'dp': PL.GetTDewPointFromRelHum(db, rh),
                'h': PL.GetMoistAirEnthalpy(db, w) * conv, 'v': PL.GetMoistAirVolume(db, w, p),
                'rho': PL.GetMoistAirDensity(db, w, p), 'pws': PL.GetSatVapPres(db),
            }

    ip = [(db, rh, alt) for db in (-20, 15, 32, 50, 75, 95, 120, 180) for rh in (0.1, 0.5, 0.95) for alt in (0, 5280)]
    si = [(db, rh, alt) for db in (-30, -5, 0, 10, 24, 35, 50, 80) for rh in (0.1, 0.5, 0.95) for alt in (0, 1600)]
    out['psychIP'] = list(psych(PL.IP, ip, 1))
    out['psychSI'] = list(psych(PL.SI, si, 1e-3))
    return out


def main():
    fluids, chunks = [], []
    for name, spec, aka in FLUIDS:
        fl, text = table(name, spec, aka)
        fluids.append(fl)
        chunks.append(text)
        print(f'{name}: to {fl.top} °F, critical {fl.tc:.1f} °F')
    header = f"""// Generated by scripts/build-hvac-data.py. Do not edit.
// Temperatures are grid positions in °F: saturation every {SAT_STEP} from {T_MIN} up to top, vapor every {SH_T_STEP}.
// Pressure in kPa absolute, enthalpy in kJ/kg, entropy in kJ/(kg·K), density in kg/m³, volume in m³/kg.
// Enthalpy and entropy are zero for saturated liquid at -40 °F. pd is left out when bubble and dew match.
export interface RefData {{
  name: string;
  aka: string[];
  tc: number;
  top: number;
  pb: number[];
  pd?: number[];
  hl: number[];
  sl: number[];
  dl: number[];
  hv: number[];
  sv: number[];
  vv: number[];
  gh: number[][];
  gs: number[][];
  gv: number[][];
}}

export const REF_T_MIN = {T_MIN};
export const REF_SAT_STEP = {SAT_STEP};
export const REF_GAS_STEP = {SH_T_STEP};
export const REF_SUPERHEATS = {json.dumps(SUPERHEATS)};
export const REF_PSI = {PSIA};
export const REF_ATM = {ATM};
export const REF_KGM3_PER_LBFT3 = {KGM3_PER_LBFT3};

export const REFRIGERANTS: RefData[] = [
"""
    with open(os.path.join(ROOT, 'src/engine/refrigerants-data.ts'), 'w', encoding='utf-8') as f:
        f.write(header + '\n'.join(chunks) + '\n];\n')
    with open(os.path.join(ROOT, 'test/hvac-vectors.json'), 'w', encoding='utf-8') as f:
        json.dump(vectors(fluids), f, separators=(',', ':'))
        f.write('\n')


main()
